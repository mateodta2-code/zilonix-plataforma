import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { guardarConfiguracionFinanzas, leerConfiguracionFinanzas } from "../lib/configuracion-finanzas";
import { dbComoEmpresa } from "./empresa-context";
import { auditoria, configuracionFinanzas } from "./schema";
import { afirmarAislamiento, crearDosEmpresas, type ContextoDosEmpresas } from "./test-utils/aislamiento";

// Issue #125 — una fila de configuración por empresa. Sin fila, la
// lectura es null: no se rellena 19 % ni ningún otro default.

describe("configuracion_finanzas (RLS, issue #125)", () => {
  let contexto: ContextoDosEmpresas;

  beforeAll(async () => {
    contexto = await crearDosEmpresas();
    await afirmarAislamiento(contexto, configuracionFinanzas, (tx, empresaId) =>
      tx
        .insert(configuracionFinanzas)
        .values({
          empresaId,
          flexValor: "10000.00",
          ivaPublicidad: "19.00",
          plazoVencimientoDias: 3,
        })
        .returning({ id: configuracionFinanzas.id })
    );
  });

  it("sin fila, la lectura es null (no inventa 19 % ni 3 días)", async () => {
    expect(await leerConfiguracionFinanzas(contexto.empresaBId)).toBeNull();
  });

  it("la segunda fila de la misma empresa falla", async () => {
    await expect(
      dbComoEmpresa(contexto.empresaAId, (tx) =>
        tx.insert(configuracionFinanzas).values({ empresaId: contexto.empresaAId, plazoVencimientoDias: 5 })
      )
    ).rejects.toThrow();
  });

  it("iva_publicidad rechaza negativos y valores mayores a 100, y acepta null, 0 y 100", async () => {
    const [fila] = await dbComoEmpresa(contexto.empresaAId, (tx) => tx.select().from(configuracionFinanzas));
    for (const invalido of ["-1", "-0.01", "100.01", "101"]) {
      await expect(
        dbComoEmpresa(contexto.empresaAId, (tx) =>
          tx.update(configuracionFinanzas).set({ ivaPublicidad: invalido }).where(eq(configuracionFinanzas.id, fila.id))
        )
      ).rejects.toThrow();
    }
    for (const valido of [null, "0", "100", "19.00"]) {
      await dbComoEmpresa(contexto.empresaAId, (tx) =>
        tx.update(configuracionFinanzas).set({ ivaPublicidad: valido }).where(eq(configuracionFinanzas.id, fila.id))
      );
    }
    const [queda] = await dbComoEmpresa(contexto.empresaAId, (tx) =>
      tx.select({ iva: configuracionFinanzas.ivaPublicidad }).from(configuracionFinanzas)
    );
    expect(queda.iva).toBe("19.00");
  });

  it("plazo_vencimiento_dias rechaza negativos y, si no se manda, queda en 3", async () => {
    const [filaA] = await dbComoEmpresa(contexto.empresaAId, (tx) => tx.select().from(configuracionFinanzas));
    await expect(
      dbComoEmpresa(contexto.empresaAId, (tx) =>
        tx.update(configuracionFinanzas).set({ plazoVencimientoDias: -1 }).where(eq(configuracionFinanzas.id, filaA.id))
      )
    ).rejects.toThrow();

    const [filaB] = await dbComoEmpresa(contexto.empresaBId, (tx) =>
      tx.insert(configuracionFinanzas).values({ empresaId: contexto.empresaBId }).returning()
    );
    expect(filaB.plazoVencimientoDias).toBe(3);
    expect(filaB.ivaPublicidad).toBeNull();
    expect(filaB.flexValor).toBeNull();
    expect(filaB.avisoCorreoActivo).toBeNull();
    expect(filaB.avisoWhatsappActivo).toBeNull();
    expect(filaB.avisoCorreoDestino).toBeNull();
    expect(filaB.avisoWhatsappDestino).toBeNull();
  });

  it("el correo y el WhatsApp no quedan en la bitácora ni en los logs", async () => {
    const correo = "contabilidad@zilonix.test";
    const whatsapp = "+57 300 111 2233";
    const llamadas: string[] = [];
    const spies = (["log", "info", "warn", "error", "debug"] as const).map((metodo) =>
      vi.spyOn(console, metodo).mockImplementation((...args: unknown[]) => {
        llamadas.push(args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" "));
      })
    );
    try {
      const { id } = await guardarConfiguracionFinanzas(contexto.empresaBId, contexto.usuarioBId, {
        flexValor: null,
        ivaPublicidad: null,
        plazoVencimientoDias: 3,
        avisoDiasAntes: null,
        avisoCorreoActivo: true,
        avisoWhatsappActivo: false,
        avisoCorreoDestino: correo,
        avisoWhatsappDestino: whatsapp,
      });
      const filas = await dbComoEmpresa(contexto.empresaBId, (tx) =>
        tx.select().from(auditoria).where(eq(auditoria.entidadId, id))
      );
      expect(filas.length).toBeGreaterThan(0);
      const texto = JSON.stringify(filas);
      expect(texto).not.toContain(correo);
      expect(texto).not.toContain("contabilidad");
      expect(texto).not.toContain("573001112233");
      expect(texto).not.toContain(whatsapp);
      expect(texto).toContain("***test");
      expect(texto).toContain("***2233");
      expect(llamadas.join("\n")).not.toContain(correo);
      expect(llamadas.join("\n")).not.toContain(whatsapp);
    } finally {
      spies.forEach((s) => s.mockRestore());
    }
  });
});
