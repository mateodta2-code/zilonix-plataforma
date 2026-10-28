import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { guardarMetaMensual, leerMetaMensual } from "../lib/metas-mensuales";
import { dbComoEmpresa } from "./empresa-context";
import { metasMensuales } from "./schema";
import { afirmarAislamiento, crearDosEmpresas, type ContextoDosEmpresas } from "./test-utils/aislamiento";

// Issue #125 — meta de utilidad por empresa y por mes. Mes sin fila =
// sin meta. La RLS aísla; quién puede cambiarla (solo el Dueño) es #126.

describe("metas_mensuales (RLS, issue #125)", () => {
  let contexto: ContextoDosEmpresas;
  let metaAId: string;

  beforeAll(async () => {
    contexto = await crearDosEmpresas();
    const fila = await afirmarAislamiento(contexto, metasMensuales, (tx, empresaId) =>
      tx
        .insert(metasMensuales)
        .values({ empresaId, mes: "2026-10-01", metaUtilidad: "5000000.00" })
        .returning({ id: metasMensuales.id })
    );
    metaAId = fila.id;
  });

  it("sin fila, la lectura es null (no asume 0)", async () => {
    expect(await leerMetaMensual(contexto.empresaAId, "2026-12-01")).toBeNull();
    expect(await leerMetaMensual(contexto.empresaBId, "2026-10-01")).toBeNull();
  });

  it("la moneda que no se manda queda en COP, y repetir empresa+mes+moneda falla", async () => {
    const [fila] = await dbComoEmpresa(contexto.empresaAId, (tx) =>
      tx.select({ moneda: metasMensuales.moneda }).from(metasMensuales).where(eq(metasMensuales.id, metaAId))
    );
    expect(fila.moneda).toBe("COP");

    await expect(
      dbComoEmpresa(contexto.empresaAId, (tx) =>
        tx.insert(metasMensuales).values({ empresaId: contexto.empresaAId, mes: "2026-10-01", metaUtilidad: "1.00", moneda: "COP" })
      )
    ).rejects.toThrow();

    await dbComoEmpresa(contexto.empresaAId, (tx) =>
      tx.insert(metasMensuales).values({ empresaId: contexto.empresaAId, mes: "2026-10-01", metaUtilidad: "1.00", moneda: "USD" })
    );
  });

  it("un mes que no es día 1 o una meta negativa fallan", async () => {
    await expect(
      dbComoEmpresa(contexto.empresaAId, (tx) =>
        tx.insert(metasMensuales).values({ empresaId: contexto.empresaAId, mes: "2026-10-02", metaUtilidad: "10.00" })
      )
    ).rejects.toThrow();
    await expect(
      dbComoEmpresa(contexto.empresaAId, (tx) =>
        tx.insert(metasMensuales).values({ empresaId: contexto.empresaAId, mes: "2026-11-01", metaUtilidad: "-1" })
      )
    ).rejects.toThrow();
    await expect(
      dbComoEmpresa(contexto.empresaAId, (tx) =>
        tx.insert(metasMensuales).values({ empresaId: contexto.empresaAId, mes: "2026-11-01", metaUtilidad: "-0.01" })
      )
    ).rejects.toThrow();
  });

  it("cambiar la meta de octubre no toca la de noviembre, y B no la puede cambiar", async () => {
    await guardarMetaMensual({
      empresaId: contexto.empresaAId,
      usuarioId: contexto.usuarioAId,
      mes: "2026-11-01",
      metaUtilidad: "8000.50",
    });
    await guardarMetaMensual({
      empresaId: contexto.empresaAId,
      usuarioId: contexto.usuarioAId,
      mes: "2026-10-01",
      metaUtilidad: "9000.00",
    });

    const octubre = await leerMetaMensual(contexto.empresaAId, "2026-10-01");
    const noviembre = await leerMetaMensual(contexto.empresaAId, "2026-11-01");
    expect(octubre?.metaUtilidad).toBe("9000.00");
    expect(noviembre?.metaUtilidad).toBe("8000.50");

    const tocadas = await dbComoEmpresa(contexto.empresaBId, (tx) =>
      tx
        .update(metasMensuales)
        .set({ metaUtilidad: "1.00" })
        .where(eq(metasMensuales.id, metaAId))
        .returning({ id: metasMensuales.id })
    );
    expect(tocadas).toHaveLength(0);
    expect((await leerMetaMensual(contexto.empresaAId, "2026-10-01"))?.metaUtilidad).toBe("9000.00");
  });

  it("empresa B no puede insertar una meta con el empresa_id de A", async () => {
    await expect(
      dbComoEmpresa(contexto.empresaBId, (tx) =>
        tx.insert(metasMensuales).values({ empresaId: contexto.empresaAId, mes: "2026-01-01", metaUtilidad: "10.00" })
      )
    ).rejects.toThrow();
  });

  it("una meta 0 sí se guarda", async () => {
    const [fila] = await dbComoEmpresa(contexto.empresaBId, (tx) =>
      tx
        .insert(metasMensuales)
        .values({ empresaId: contexto.empresaBId, mes: "2026-01-01", metaUtilidad: "0" })
        .returning({ metaUtilidad: metasMensuales.metaUtilidad })
    );
    expect(fila.metaUtilidad).toBe("0.00");
  });
});
