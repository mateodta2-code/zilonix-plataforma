import { randomUUID } from "crypto";
import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { dbComoEmpresa } from "./empresa-context";
import { dbTrabajadorSeguimiento } from "./trabajador-seguimiento-context";
import { seguimientoAlertas, seguimientoFotos, seguimientosMl } from "./schema";
import { afirmarAislamiento, crearDosEmpresas, type ContextoDosEmpresas } from "./test-utils/aislamiento";

// Issue #175 — mismas tres tablas nuevas (seguimientos_ml,
// seguimiento_fotos, seguimiento_alertas), misma plantilla genérica de
// aislamiento (db/test-utils/aislamiento.ts, issue #39) que ya prueban
// el resto de las tablas de negocio: empresa B nunca ve, edita ni
// borra una fila de empresa A.
describe("aislamiento por empresa — seguimientos_ml / seguimiento_fotos / seguimiento_alertas (issue #175)", () => {
  let contexto: ContextoDosEmpresas;

  beforeAll(async () => {
    contexto = await crearDosEmpresas();
  });

  function datosSeguimiento(empresaId: string) {
    return {
      empresaId,
      tipo: "producto" as const,
      recursoMl: "item" as const,
      mlIdExterno: `MCO${randomUUID().replace(/-/g, "").slice(0, 10)}`,
      nombre: "Producto de prueba (aislamiento)",
      linkOriginal: "https://articulo.mercadolibre.com.co/MCO-1",
    };
  }

  it("empresa B nunca ve, edita ni borra un seguimiento de empresa A", async () => {
    await afirmarAislamiento(contexto, seguimientosMl, (tx, empresaId) =>
      tx
        .insert(seguimientosMl)
        .values({ ...datosSeguimiento(empresaId), creadoPor: contexto.usuarioAId })
        .returning({ id: seguimientosMl.id })
    );
  });

  it("empresa B nunca ve, edita ni borra una foto de empresa A", async () => {
    const [seguimiento] = await dbComoEmpresa(contexto.empresaAId, (tx) =>
      tx
        .insert(seguimientosMl)
        .values({ ...datosSeguimiento(contexto.empresaAId), creadoPor: contexto.usuarioAId })
        .returning({ id: seguimientosMl.id })
    );

    await afirmarAislamiento(contexto, seguimientoFotos, (tx, empresaId) =>
      tx
        .insert(seguimientoFotos)
        .values({ empresaId, seguimientoId: seguimiento.id, fecha: new Date(), precio: "50000" })
        .returning({ id: seguimientoFotos.id })
    );
  });

  it("empresa B nunca ve, edita ni borra una alerta de empresa A", async () => {
    const [seguimiento] = await dbComoEmpresa(contexto.empresaAId, (tx) =>
      tx
        .insert(seguimientosMl)
        .values({ ...datosSeguimiento(contexto.empresaAId), creadoPor: contexto.usuarioAId })
        .returning({ id: seguimientosMl.id })
    );
    const [foto] = await dbComoEmpresa(contexto.empresaAId, (tx) =>
      tx
        .insert(seguimientoFotos)
        .values({ empresaId: contexto.empresaAId, seguimientoId: seguimiento.id, fecha: new Date(), precio: "50000" })
        .returning({ id: seguimientoFotos.id })
    );

    await afirmarAislamiento(contexto, seguimientoAlertas, (tx, empresaId) =>
      tx
        .insert(seguimientoAlertas)
        .values({
          empresaId,
          seguimientoId: seguimiento.id,
          fotoId: foto.id,
          tipo: "precio_bajo",
          detalle: { precioAnterior: 60000, precioNuevo: 50000, porcentaje: -16.67 },
        })
        .returning({ id: seguimientoAlertas.id })
    );
  });

  // Issue #175 — "una foto por seguimiento por día": el índice único
  // (seguimiento_id, fecha) es el candado real, no solo una convención
  // de la aplicación.
  it("dos fotos del MISMO seguimiento en la MISMA fecha chocan con el índice único", async () => {
    const [seguimiento] = await dbComoEmpresa(contexto.empresaAId, (tx) =>
      tx
        .insert(seguimientosMl)
        .values({ ...datosSeguimiento(contexto.empresaAId), creadoPor: contexto.usuarioAId })
        .returning({ id: seguimientosMl.id })
    );
    const fecha = new Date("2026-10-24T00:00:00.000Z");
    await dbComoEmpresa(contexto.empresaAId, (tx) =>
      tx.insert(seguimientoFotos).values({ empresaId: contexto.empresaAId, seguimientoId: seguimiento.id, fecha, precio: "10000" })
    );
    await expect(
      dbComoEmpresa(contexto.empresaAId, (tx) =>
        tx.insert(seguimientoFotos).values({ empresaId: contexto.empresaAId, seguimientoId: seguimiento.id, fecha, precio: "11000" })
      )
    ).rejects.toThrow();
  });

  // Issue #175 — "no tiene sentido seguir el mismo producto/tienda dos
  // veces en la misma empresa": índice único (empresa_id, ml_id_externo).
  it("dos seguimientos del MISMO ml_id_externo en la MISMA empresa chocan con el índice único", async () => {
    const datos = datosSeguimiento(contexto.empresaAId);
    await dbComoEmpresa(contexto.empresaAId, (tx) => tx.insert(seguimientosMl).values({ ...datos, creadoPor: contexto.usuarioAId }));
    await expect(
      dbComoEmpresa(contexto.empresaAId, (tx) => tx.insert(seguimientosMl).values({ ...datos, creadoPor: contexto.usuarioAId }))
    ).rejects.toThrow();
  });

  // El mismo ml_id_externo SÍ puede repetirse entre empresas DISTINTAS
  // — el índice es (empresa_id, ml_id_externo), nunca solo ml_id_externo.
  it("el mismo ml_id_externo en empresas DISTINTAS no choca", async () => {
    const mlIdExterno = `MCO${randomUUID().replace(/-/g, "").slice(0, 10)}`;
    await dbComoEmpresa(contexto.empresaAId, (tx) =>
      tx.insert(seguimientosMl).values({ ...datosSeguimiento(contexto.empresaAId), mlIdExterno, creadoPor: contexto.usuarioAId })
    );
    await expect(
      dbComoEmpresa(contexto.empresaBId, (tx) =>
        tx.insert(seguimientosMl).values({ ...datosSeguimiento(contexto.empresaBId), mlIdExterno, creadoPor: contexto.usuarioBId })
      )
    ).resolves.toBeDefined();
  });

  // Issue #175 — mínimo privilegio real: seguimiento_trabajador_user
  // (db/trabajador-seguimiento-context.ts, usado por la revisión
  // diaria para enumerar seguimientos de CUALQUIER empresa) solo tiene
  // GRANT UPDATE de la columna ultima_revision_ts, nunca de la fila
  // completa — Postgres rechaza el UPDATE si se intenta tocar
  // cualquier otra columna, aunque la fila sí sea visible por la
  // política FOR SELECT de este rol.
  it("seguimiento_trabajador_user puede marcar ultima_revision_ts pero NUNCA cambiar otra columna (ej. nombre)", async () => {
    const [seguimiento] = await dbComoEmpresa(contexto.empresaAId, (tx) =>
      tx
        .insert(seguimientosMl)
        .values({ ...datosSeguimiento(contexto.empresaAId), creadoPor: contexto.usuarioAId })
        .returning({ id: seguimientosMl.id })
    );

    await expect(
      dbTrabajadorSeguimiento.update(seguimientosMl).set({ ultimaRevisionTs: new Date() }).where(eq(seguimientosMl.id, seguimiento.id))
    ).resolves.toBeDefined();

    await expect(
      dbTrabajadorSeguimiento.update(seguimientosMl).set({ nombre: "Nombre robado" }).where(eq(seguimientosMl.id, seguimiento.id))
    ).rejects.toThrow();

    const [sigueIgual] = await dbComoEmpresa(contexto.empresaAId, (tx) => tx.select({ nombre: seguimientosMl.nombre }).from(seguimientosMl).where(eq(seguimientosMl.id, seguimiento.id)));
    expect(sigueIgual.nombre).not.toBe("Nombre robado");
  });
});
