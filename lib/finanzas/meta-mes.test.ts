import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { dbComoEmpresa } from "@/db/empresa-context";
import { auditoria, membresias, roles } from "@/db/schema";
import { leerMetaMensual } from "@/lib/metas-mensuales";
import { SinPermisoError, SoloDuenoError } from "@/lib/permisos";
import { crearEmpresaConPermisos } from "@/lib/test-utils/empresa-con-permiso";
import { leerIndicadores, tramoDeHoy } from "./indicadores";
import { fijarMetaDelMes, leerMetaDelMes, primerDiaDelMes } from "./meta-mes";
import { tramosBogota } from "./tablero";

// Inicio (13-nov; #125/#126) — la meta del mes la fija solo el Dueño.

const AHORA = new Date("2026-11-13T15:00:00Z");

// Le cambia el nombre del rol a «Dueño» (con sus permisos de prueba).
async function hacerDueno(empresaId: string, usuarioId: string) {
  await dbComoEmpresa(empresaId, async (tx) => {
    const [m] = await tx.select().from(membresias).where(eq(membresias.usuarioId, usuarioId));
    await tx.update(roles).set({ nombre: "Dueño" }).where(eq(roles.id, m.rolId));
  });
}

const FINANZAS = [
  { modulo: "finanzas" as const, accion: "consultar" as const },
  { modulo: "finanzas" as const, accion: "modificar" as const },
];

describe("meta del mes (#125/#126)", () => {
  it("el Dueño la fija para el mes en curso, queda en la bitácora y se lee con su avance", async () => {
    const e = await crearEmpresaConPermisos("Meta dueño", FINANZAS);
    await hacerDueno(e.empresaId, e.usuarioId);
    await fijarMetaDelMes(e.empresaId, e.usuarioId, AHORA, "20000000");
    expect(primerDiaDelMes(AHORA)).toBe("2026-11-01");
    expect((await leerMetaMensual(e.empresaId, "2026-11-01"))?.metaUtilidad).toBe("20000000.00");

    const mes = await leerIndicadores(e.empresaId, e.usuarioId, tramosBogota(AHORA).actual);
    const meta = await leerMetaDelMes(e.empresaId, e.usuarioId, AHORA, mes);
    expect(meta).toMatchObject({ mes: "2026-11-01", meta: "20000000.00", avance: { porcentaje: "0.0", faltante: "20000000.00", diasRestantes: 17 } });

    const bitacora = await dbComoEmpresa(e.empresaId, (tx) =>
      tx.select().from(auditoria).where(and(eq(auditoria.empresaId, e.empresaId), eq(auditoria.entidad, "meta_mensual")))
    );
    expect(bitacora).toHaveLength(1);
  });

  it("un Gerente con finanzas.modificar no la puede fijar; sin finanzas no se lee", async () => {
    const g = await crearEmpresaConPermisos("Meta gerente", FINANZAS);
    await expect(fijarMetaDelMes(g.empresaId, g.usuarioId, AHORA, "1000")).rejects.toBeInstanceOf(SoloDuenoError);
    expect(await leerMetaMensual(g.empresaId, "2026-11-01")).toBeNull();

    // Un mes sin meta: «sin meta», nunca 0 ni la del mes anterior.
    const mes = await leerIndicadores(g.empresaId, g.usuarioId, tramoDeHoy(AHORA));
    expect(await leerMetaDelMes(g.empresaId, g.usuarioId, AHORA, mes)).toMatchObject({ meta: null, avance: null });

    const sin = await crearEmpresaConPermisos("Meta sin finanzas", [{ modulo: "ventas", accion: "consultar" }]);
    await expect(leerMetaDelMes(sin.empresaId, sin.usuarioId, AHORA, mes)).rejects.toBeInstanceOf(SinPermisoError);
  });

  it("A/B: la meta de A no es la de B", async () => {
    const a = await crearEmpresaConPermisos("Meta A", FINANZAS);
    const b = await crearEmpresaConPermisos("Meta B", FINANZAS);
    await hacerDueno(a.empresaId, a.usuarioId);
    await fijarMetaDelMes(a.empresaId, a.usuarioId, AHORA, "5000");
    expect(await leerMetaMensual(b.empresaId, "2026-11-01")).toBeNull();
  });
});
