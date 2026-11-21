import { randomUUID } from "crypto";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { cifrarToken } from "../lib/cifrado";
import { cambioEsDeLaPublicacion, crearNotaBitacora, guardarRevisionCambio, leerCambiosPublicacion, publicacionesParaRevisar } from "../lib/optimizacion/bitacora";
import { dbComoEmpresa } from "./empresa-context";
import { auditoria, cuentasMl, optimizacionNotas, optimizacionRevisiones } from "./schema";
import { crearDosEmpresas } from "./test-utils/aislamiento";

// Optimización → bitácora (migración 0035) contra Postgres real: cada
// empresa solo ve sus notas y revisiones, no se borran, una revisión por
// cambio y el aviso «Revisar cambio» se va cuando el cambio está revisado
// (con resultado: un comentario solo no lo quita, migración 0036).

const ITEM = "MCO1342632705";

async function crearCuenta(empresaId: string) {
  const [c] = await dbComoEmpresa(empresaId, (tx) =>
    tx
      .insert(cuentasMl)
      .values({
        empresaId,
        cuentaIdExterna: `${Date.now()}${Math.floor(Math.random() * 100000)}`,
        nickname: "TIENDA",
        accessTokenCifrado: cifrarToken("a"),
        refreshTokenCifrado: cifrarToken("r"),
        tokenExpiraTs: new Date(Date.now() + 3600_000),
      })
      .returning({ id: cuentasMl.id })
  );
  return c.id;
}

// app_user solo puede insertar en auditoria (nunca editarla): el cambio
// «de hace N días» se inserta ya con esa fecha.
async function cambioHaceDias(empresaId: string, usuarioId: string, dias: number): Promise<string> {
  const id = randomUUID();
  await dbComoEmpresa(empresaId, (tx) =>
    tx.insert(auditoria).values({
      id,
      empresaId,
      usuarioId,
      actorTipo: "persona",
      accion: "cambiar_precio_publicacion",
      entidad: "publicacion_ml",
      entidadId: ITEM,
      valorAnterior: "100",
      valorNuevo: "90",
      ts: new Date(Date.now() - dias * 86_400_000),
    })
  );
  return id;
}

describe("optimizacion_notas / optimizacion_revisiones (RLS y bitácora)", () => {
  it("B no ve las notas ni las revisiones de A; nadie las borra", async () => {
    const { empresaAId, empresaBId, usuarioAId } = await crearDosEmpresas();
    const cuentaA = await crearCuenta(empresaAId);
    const notaId = await crearNotaBitacora(empresaAId, { usuarioId: usuarioAId, cuentaMlId: cuentaA, itemId: ITEM, fechaCambio: new Date(), texto: "Subí la campaña" });
    await guardarRevisionCambio(empresaAId, { usuarioId: usuarioAId, ref: `nota:${notaId}`, itemId: ITEM, resultado: "sirvio", comentario: null });

    expect(await dbComoEmpresa(empresaBId, (tx) => tx.select().from(optimizacionNotas).where(eq(optimizacionNotas.id, notaId)))).toHaveLength(0);
    expect(await dbComoEmpresa(empresaBId, (tx) => tx.select().from(optimizacionRevisiones).where(eq(optimizacionRevisiones.itemId, ITEM)))).toHaveLength(0);
    expect(await cambioEsDeLaPublicacion(empresaBId, `nota:${notaId}`, ITEM)).toBe(false);
    await expect(dbComoEmpresa(empresaAId, (tx) => tx.delete(optimizacionNotas).where(eq(optimizacionNotas.id, notaId)))).rejects.toThrow(/permission denied/);
    await expect(dbComoEmpresa(empresaAId, (tx) => tx.delete(optimizacionRevisiones).where(eq(optimizacionRevisiones.itemId, ITEM)))).rejects.toThrow(/permission denied/);
  });

  it("una revisión por cambio: volver a revisar la actualiza", async () => {
    const { empresaAId, usuarioAId } = await crearDosEmpresas();
    const id = await cambioHaceDias(empresaAId, usuarioAId, 8);
    const ref = `auditoria:${id}`;
    await guardarRevisionCambio(empresaAId, { usuarioId: usuarioAId, ref, itemId: ITEM, resultado: "no_sirvio", comentario: "bajó" });
    await guardarRevisionCambio(empresaAId, { usuarioId: usuarioAId, ref, itemId: ITEM, resultado: "sirvio", comentario: null });
    const filas = await dbComoEmpresa(empresaAId, (tx) => tx.select().from(optimizacionRevisiones).where(eq(optimizacionRevisiones.cambioRef, ref)));
    expect(filas).toHaveLength(1);
    expect(filas[0].resultado).toBe("sirvio");
    const cambios = await leerCambiosPublicacion(empresaAId, ITEM);
    expect(cambios.find((c) => c.ref === ref)?.revision?.resultado).toBe("sirvio");
  });

  it("«Revisar cambio»: sale con un cambio de hace 8 días sin revisar y se va al revisarlo; una nota también cuenta", async () => {
    const { empresaAId, usuarioAId } = await crearDosEmpresas();
    const id = await cambioHaceDias(empresaAId, usuarioAId, 8);
    expect(await publicacionesParaRevisar(empresaAId, [ITEM], new Date())).toEqual([ITEM]);
    await guardarRevisionCambio(empresaAId, { usuarioId: usuarioAId, ref: `auditoria:${id}`, itemId: ITEM, resultado: "sin_cambio", comentario: null });
    expect(await publicacionesParaRevisar(empresaAId, [ITEM], new Date())).toEqual([]);
    const cuenta = await crearCuenta(empresaAId);
    await crearNotaBitacora(empresaAId, { usuarioId: usuarioAId, cuentaMlId: cuenta, itemId: ITEM, fechaCambio: new Date(Date.now() - 9 * 86_400_000), texto: "Cambio en Mercado Libre" });
    expect(await publicacionesParaRevisar(empresaAId, [ITEM], new Date())).toEqual([ITEM]);
  });

  it("solo comentario (0036): se guarda sin resultado, «Revisar cambio» sigue hasta elegir resultado", async () => {
    const { empresaAId, usuarioAId } = await crearDosEmpresas();
    const id = await cambioHaceDias(empresaAId, usuarioAId, 8);
    const ref = `auditoria:${id}`;
    await guardarRevisionCambio(empresaAId, { usuarioId: usuarioAId, ref, itemId: ITEM, resultado: null, comentario: "bajé el precio por la competencia" });
    const cambio = (await leerCambiosPublicacion(empresaAId, ITEM)).find((c) => c.ref === ref);
    expect(cambio?.revision).toMatchObject({ resultado: null, comentario: "bajé el precio por la competencia" });
    expect(await publicacionesParaRevisar(empresaAId, [ITEM], new Date())).toEqual([ITEM]);
    await guardarRevisionCambio(empresaAId, { usuarioId: usuarioAId, ref, itemId: ITEM, resultado: "sirvio", comentario: "bajé el precio por la competencia" });
    expect(await publicacionesParaRevisar(empresaAId, [ITEM], new Date())).toEqual([]);
    // Ni resultado ni comentario: la base no lo acepta.
    await expect(
      dbComoEmpresa(empresaAId, (tx) => tx.insert(optimizacionRevisiones).values({ empresaId: empresaAId, cambioRef: `auditoria:${randomUUID()}`, itemId: ITEM, resultado: null, comentario: null }))
    ).rejects.toThrow();
  });

  it("los CHECK de la base: id de publicación, texto y resultado válidos", async () => {
    const { empresaAId, usuarioAId } = await crearDosEmpresas();
    await expect(crearNotaBitacora(empresaAId, { usuarioId: usuarioAId, cuentaMlId: null as unknown as string, itemId: "no-es-un-item", fechaCambio: new Date(), texto: "x" })).rejects.toThrow();
    await expect(
      dbComoEmpresa(empresaAId, (tx) => tx.insert(optimizacionRevisiones).values({ empresaId: empresaAId, cambioRef: `auditoria:${randomUUID()}`, itemId: ITEM, resultado: "genial" }))
    ).rejects.toThrow();
  });
});
