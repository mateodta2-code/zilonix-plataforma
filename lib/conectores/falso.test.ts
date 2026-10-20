import { describe, expect, it } from "vitest";
import { ConectorFalso } from "./falso";

// Tarea 2.2 — estas pruebas ejercitan el CONTRATO (interfaz `Conector`),
// no una implementación real de un marketplace. Si el día de mañana
// Mercado Libre pasa estas mismas pruebas con su propia clase, el
// contrato está bien diseñado.

describe("contrato de conector (tarea 2.2)", () => {
  it("no deja usar el conector antes de conectar()", async () => {
    const conector = new ConectorFalso();
    await expect(conector.traerPedidos(new Date(0))).rejects.toThrow();
  });

  it("conectar() devuelve la cuenta autorizada", async () => {
    const conector = new ConectorFalso();
    const cuenta = await conector.conectar({ codigo: "cualquiera" });
    expect(cuenta.cuentaIdExterna).toBeTruthy();
    expect(cuenta.nickname).toBeTruthy();
  });

  it("publicar un producto lo deja disponible en traerProductos()", async () => {
    const conector = new ConectorFalso();
    await conector.conectar({});
    const { idExterno } = await conector.publicarProducto({ titulo: "Camiseta", precio: 50000, stock: 10 });

    const productos = await conector.traerProductos();
    expect(productos).toHaveLength(1);
    expect(productos[0]).toMatchObject({ idExterno, titulo: "Camiseta", precio: 50000, stock: 10 });
  });

  it("actualizarStockPrecio cambia solo lo que se le pasa", async () => {
    const conector = new ConectorFalso();
    await conector.conectar({});
    const { idExterno } = await conector.publicarProducto({ titulo: "Taza", precio: 20000, stock: 5 });

    await conector.actualizarStockPrecio(idExterno, { stock: 3 });
    let [producto] = await conector.traerProductos();
    expect(producto).toMatchObject({ precio: 20000, stock: 3 }); // el precio no se tocó

    await conector.actualizarStockPrecio(idExterno, { precio: 18000 });
    [producto] = await conector.traerProductos();
    expect(producto).toMatchObject({ precio: 18000, stock: 3 }); // el stock no se tocó
  });

  it("actualizar un producto que no existe falla", async () => {
    const conector = new ConectorFalso();
    await conector.conectar({});
    await expect(conector.actualizarStockPrecio("no-existe", { stock: 1 })).rejects.toThrow();
  });

  it("traerPedidos solo trae los que son desde la fecha pedida", async () => {
    const conector = new ConectorFalso();
    await conector.conectar({});
    conector._sembrarPedido({ idExterno: "p1", estado: "pagado", fecha: new Date("2026-01-01"), total: 100, moneda: "COP" });
    conector._sembrarPedido({ idExterno: "p2", estado: "pagado", fecha: new Date("2026-06-01"), total: 200, moneda: "COP" });

    const recientes = await conector.traerPedidos(new Date("2026-03-01"));
    expect(recientes.map((p) => p.idExterno)).toEqual(["p2"]);
  });

  it("responder un mensaje lo deja ver en traerMensajes()", async () => {
    const conector = new ConectorFalso();
    await conector.conectar({});
    conector._sembrarMensaje({
      idExterno: "m1",
      pedidoIdExterno: "p1",
      texto: "¿tienen talla M?",
      fecha: new Date("2026-01-01"),
      deComprador: true,
    });

    await conector.responderMensaje("m1", "Sí, tenemos talla M");

    const mensajes = await conector.traerMensajes(new Date(0));
    expect(mensajes).toHaveLength(2);
    const respuesta = mensajes.find((m) => !m.deComprador);
    expect(respuesta?.texto).toBe("Sí, tenemos talla M");
  });

  it("responder un mensaje que no existe falla", async () => {
    const conector = new ConectorFalso();
    await conector.conectar({});
    await expect(conector.responderMensaje("no-existe", "hola")).rejects.toThrow();
  });
});
