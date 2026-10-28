import { and, eq, isNull } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { dbComoEmpresa } from "./empresa-context";
import { pedidoItems, pedidos, pedidosFinanzas, ventasCorrecciones, type CampoCorreccionVenta } from "./schema";
import { crearDosEmpresas, type ContextoDosEmpresas } from "./test-utils/aislamiento";
import { crearVentaDePrueba, type VentaDePrueba } from "./test-utils/venta";

// Issue #129 (Z-FIN-07) — correcciones manuales: no se editan ni se
// borran; el único cambio permitido es anularlas.
describe("ventas_correcciones (RLS, issue #129)", () => {
  let contexto: ContextoDosEmpresas;
  let ventaA: VentaDePrueba;

  beforeAll(async () => {
    contexto = await crearDosEmpresas();
    ventaA = await crearVentaDePrueba(contexto.empresaAId, { lineas: 2 });
  });

  function corregir(datos: { linea?: number | null; campo?: CampoCorreccionVenta; valorNuevo?: string; nota?: string; anuladaTs?: Date }, venta = ventaA) {
    return dbComoEmpresa(contexto.empresaAId, (tx) =>
      tx
        .insert(ventasCorrecciones)
        .values({
          empresaId: contexto.empresaAId,
          pedidoId: venta.pedidoId,
          linea: datos.linea ?? null,
          campo: datos.campo ?? "costo_producto",
          valorNuevo: datos.valorNuevo ?? "40000.00",
          nota: datos.nota ?? "Factura del proveedor",
          creadoPor: contexto.usuarioAId,
          anuladaTs: datos.anuladaTs,
        })
        .returning({ id: ventasCorrecciones.id })
    ).then(([fila]) => fila.id);
  }

  function anular(empresaId: string, id: string) {
    return dbComoEmpresa(empresaId, (tx) =>
      tx.update(ventasCorrecciones).set({ anuladaTs: new Date() }).where(eq(ventasCorrecciones.id, id)).returning({ id: ventasCorrecciones.id })
    );
  }

  it("dos correcciones activas del mismo (pedido, linea, campo) fallan; anular la primera permite la segunda", async () => {
    const primera = await corregir({ linea: 1 });
    await expect(corregir({ linea: 1, valorNuevo: "41000.00" })).rejects.toThrow();

    // Otra línea u otro campo no chocan.
    await corregir({ linea: 2 });
    await corregir({ linea: 1, campo: "flete_ml" });

    expect(await anular(contexto.empresaAId, primera)).toHaveLength(1);
    await corregir({ linea: 1, valorNuevo: "41000.00" });

    const activas = await dbComoEmpresa(contexto.empresaAId, (tx) =>
      tx
        .select()
        .from(ventasCorrecciones)
        .where(and(eq(ventasCorrecciones.pedidoId, ventaA.pedidoId), eq(ventasCorrecciones.linea, 1), eq(ventasCorrecciones.campo, "costo_producto"), isNull(ventasCorrecciones.anuladaTs)))
    );
    expect(activas.map((f) => f.valorNuevo)).toEqual(["41000.00"]);
  });

  it("con linea vacía (toda la orden) también hay una sola activa por campo", async () => {
    const primera = await corregir({ campo: "envio_agencia", valorNuevo: "12000" });
    await expect(corregir({ campo: "envio_agencia", valorNuevo: "15000" })).rejects.toThrow();
    await anular(contexto.empresaAId, primera);
    await corregir({ campo: "envio_agencia", valorNuevo: "15000" });
  });

  it("campo fuera de la lista cerrada, nota vacía, valor negativo o línea inexistente se rechazan en la base", async () => {
    await expect(corregir({ campo: "precio_venta" as CampoCorreccionVenta, linea: 2 })).rejects.toThrow();
    await expect(corregir({ campo: "empaque", nota: "   " })).rejects.toThrow();
    await expect(corregir({ campo: "empaque", valorNuevo: "-5" })).rejects.toThrow();
    await expect(corregir({ campo: "empaque", linea: 7 })).rejects.toThrow();
  });

  it("no se edita, no se des-anula, no nace anulada y no se borra", async () => {
    const id = await corregir({ linea: 2, campo: "comision_ml" });

    // El GRANT de UPDATE es solo de anulada_ts.
    await expect(
      dbComoEmpresa(contexto.empresaAId, (tx) => tx.update(ventasCorrecciones).set({ valorNuevo: "1.00" }).where(eq(ventasCorrecciones.id, id)))
    ).rejects.toThrow(/permission denied/);
    await expect(
      dbComoEmpresa(contexto.empresaAId, (tx) => tx.update(ventasCorrecciones).set({ nota: "otra" }).where(eq(ventasCorrecciones.id, id)))
    ).rejects.toThrow(/permission denied/);
    await expect(dbComoEmpresa(contexto.empresaAId, (tx) => tx.delete(ventasCorrecciones).where(eq(ventasCorrecciones.id, id)))).rejects.toThrow(
      /permission denied/
    );

    // Anulada una vez, ya no la toma ningún UPDATE: ni para des-anularla
    // ni para cambiarle la fecha.
    expect(await anular(contexto.empresaAId, id)).toHaveLength(1);
    const desanuladas = await dbComoEmpresa(contexto.empresaAId, (tx) =>
      tx.update(ventasCorrecciones).set({ anuladaTs: null }).where(eq(ventasCorrecciones.id, id)).returning({ id: ventasCorrecciones.id })
    );
    expect(desanuladas).toHaveLength(0);
    expect(await anular(contexto.empresaAId, id)).toHaveLength(0);

    // Activa → activa tampoco: el UPDATE tiene que dejarla anulada.
    const otra = await corregir({ linea: 2, campo: "comision_ml" });
    await expect(
      dbComoEmpresa(contexto.empresaAId, (tx) => tx.update(ventasCorrecciones).set({ anuladaTs: null }).where(eq(ventasCorrecciones.id, otra)))
    ).rejects.toThrow();

    await expect(corregir({ linea: 1, campo: "empaque", anuladaTs: new Date() })).rejects.toThrow();
  });

  it("empresa B no ve ni anula las correcciones de A, ni crea una sobre la venta de A", async () => {
    const id = await corregir({ linea: 1, campo: "empaque" });

    const veB = await dbComoEmpresa(contexto.empresaBId, (tx) => tx.select().from(ventasCorrecciones).where(eq(ventasCorrecciones.id, id)));
    expect(veB).toHaveLength(0);
    expect(await anular(contexto.empresaBId, id)).toHaveLength(0);

    await expect(
      dbComoEmpresa(contexto.empresaBId, (tx) =>
        tx.insert(ventasCorrecciones).values({
          empresaId: contexto.empresaBId,
          pedidoId: ventaA.pedidoId,
          campo: "empaque",
          valorNuevo: "1.00",
          nota: "intento de B",
          creadoPor: contexto.usuarioBId,
        })
      )
    ).rejects.toThrow();
    await expect(
      dbComoEmpresa(contexto.empresaBId, (tx) =>
        tx.insert(ventasCorrecciones).values({
          empresaId: contexto.empresaAId,
          pedidoId: ventaA.pedidoId,
          campo: "empaque",
          valorNuevo: "1.00",
          nota: "intento de B",
          creadoPor: contexto.usuarioBId,
        })
      )
    ).rejects.toThrow();
  });

  it("borrar el pedido no deja cabecera, líneas ni correcciones huérfanas", async () => {
    const venta = await crearVentaDePrueba(contexto.empresaAId, { lineas: 2 });
    await corregir({ linea: 1 }, venta);
    await corregir({ campo: "envio_agencia" }, venta);

    await dbComoEmpresa(contexto.empresaAId, (tx) => tx.delete(pedidos).where(eq(pedidos.id, venta.pedidoId)));

    const quedan = await dbComoEmpresa(contexto.empresaAId, async (tx) => ({
      cabecera: await tx.select().from(pedidosFinanzas).where(eq(pedidosFinanzas.pedidoId, venta.pedidoId)),
      lineas: await tx.select().from(pedidoItems).where(eq(pedidoItems.pedidoId, venta.pedidoId)),
      correcciones: await tx.select().from(ventasCorrecciones).where(eq(ventasCorrecciones.pedidoId, venta.pedidoId)),
    }));
    expect(quedan).toEqual({ cabecera: [], lineas: [], correcciones: [] });
  });
});
