import { describe, expect, it } from "vitest";
import { leerReclamosMl } from "@/lib/ml/cliente";
import {
  accionesDelVendedor,
  calcularPlazoReclamo,
  iniciales,
  leerAfectaReputacionMl,
  leerEnvioMl,
  leerFotoItemMl,
  leerMensajesReclamoMl,
  leerMotivoReclamoMl,
  leerOrdenMl,
  leerReclamoMl,
  nombreComprador,
  archivoAdjuntoValido,
} from "@/lib/ml/reclamos";

const RECLAMO = {
  id: 5619539113,
  type: "mediations",
  stage: "dispute",
  status: "opened",
  reason_id: "PDD9939",
  resource: "order",
  resource_id: 2000016192611261,
  site_id: "MCO",
  date_created: "2026-11-24T19:35:00.000-05:00",
  players: [
    { role: "complainant", type: "buyer", user_id: 111, available_actions: [] },
    {
      role: "respondent",
      type: "seller",
      user_id: 222,
      available_actions: [
        { action: "open_dispute", due_date: "2026-11-27T23:59:59.000-05:00", mandatory: false },
        { action: "refund", due_date: "2026-11-26T23:59:59.000-05:00", mandatory: true },
      ],
    },
  ],
};

describe("leerReclamoMl / leerReclamosMl", () => {
  it("lee el reclamo con sus jugadores y acciones", () => {
    const r = leerReclamoMl(RECLAMO)!;
    expect(r).toMatchObject({ id: "5619539113", etapa: "dispute", recurso: "order", recursoId: "2000016192611261", motivoId: "PDD9939" });
    expect(accionesDelVendedor(r.jugadores)).toEqual(["open_dispute", "refund"]);
  });
  it("el listado trae los players para mostrar el plazo", () => {
    const { reclamos } = leerReclamosMl({ paging: { total: 1 }, data: [RECLAMO] });
    expect(reclamos[0].jugadores[1].acciones[1]).toEqual({ accion: "refund", vence: "2026-11-26T23:59:59.000-05:00", obligatoria: true });
  });
  it("sin id o basura → null", () => {
    expect(leerReclamoMl({})).toBeNull();
    expect(leerReclamoMl(null)).toBeNull();
  });
});

describe("leerMensajesReclamoMl", () => {
  it("ordena por fecha y lee adjuntos válidos, descartando nombres peligrosos", () => {
    const m = leerMensajesReclamoMl([
      { sender_role: "respondent", receiver_role: "complainant", message: "Hola", date_created: "2026-11-24T20:00:00.000-05:00", stage: "claim", attachments: [] },
      {
        sender_role: "complainant",
        receiver_role: "respondent",
        message: "El producto no cierra en el cuello de mi Malamute",
        date_created: "2026-11-24T19:35:00.000-05:00",
        attachments: [
          { filename: "abc_123.png", original_filename: "foto.png", size: 1024, type: "image/png" },
          { filename: "../etc/passwd", original_filename: "x" },
        ],
      },
    ]);
    expect(m.map((x) => x.rolEmisor)).toEqual(["complainant", "respondent"]);
    expect(m[0].adjuntos).toEqual([{ archivo: "abc_123.png", nombre: "foto.png", tamano: 1024, tipo: "image/png" }]);
  });
  it("respuesta inesperada → lista vacía", () => {
    expect(leerMensajesReclamoMl({ error: "x" })).toEqual([]);
  });
  it("un mensaje en etapa dispute del mediador conserva el rol", () => {
    const [m] = leerMensajesReclamoMl([{ sender_role: "mediator", receiver_role: "respondent", message: "Estamos revisando", stage: "dispute" }]);
    expect(m).toMatchObject({ rolEmisor: "mediator", etapa: "dispute" });
  });
});

describe("reputación, motivo y plazo", () => {
  it("lee affects-reputation", () => {
    expect(leerAfectaReputacionMl({ affects_reputation: "not_affected", has_incentive: false, due_date: "2026-11-26T23:59:59.000-05:00" })).toEqual({
      afecta: false,
      tieneIncentivo: false,
      vence: "2026-11-26T23:59:59.000-05:00",
    });
  });
  it("reason/affects-reputation que fallan (null) no rompen el plazo", () => {
    expect(leerAfectaReputacionMl(null)).toBeNull();
    expect(leerMotivoReclamoMl(undefined)).toBeNull();
    const r = leerReclamoMl(RECLAMO)!;
    expect(calcularPlazoReclamo(null, r.jugadores)).toBe("2026-11-26T23:59:59.000-05:00");
  });
  it("el plazo de affects-reputation tiene prioridad", () => {
    const r = leerReclamoMl(RECLAMO)!;
    const rep = { afecta: false, tieneIncentivo: null, vence: "2026-11-25T10:00:00.000-05:00" };
    expect(calcularPlazoReclamo(rep, r.jugadores)).toBe("2026-11-25T10:00:00.000-05:00");
  });
  it("sin plazo en ninguna parte → null", () => {
    expect(calcularPlazoReclamo(null, [])).toBeNull();
  });
  it("lee el detalle del motivo", () => {
    expect(leerMotivoReclamoMl({ id: "PDD9939", name: "Arrepentimiento", detail: "El comprador no lo quiere" })).toEqual({ nombre: "Arrepentimiento", detalle: "El comprador no lo quiere" });
  });
});

describe("venta, envío, foto y nombre", () => {
  const ORDEN = {
    date_created: "2026-11-21T20:48:00.000-05:00",
    currency_id: "COP",
    buyer: { id: 1, nickname: "COMPRADOR1", first_name: "Ana", last_name: "Pérez" },
    shipping: { id: 4000001 },
    order_items: [
      {
        item: { id: "MCO123456", title: "Chaleco", variation_attributes: [{ name: "Color", value_name: "Gris" }, { name: "Talla", value_name: "L" }] },
        unit_price: 69900,
        quantity: 1,
        currency_id: "COP",
      },
    ],
  };
  it("lee la orden con variaciones, precio y unidades", () => {
    const o = leerOrdenMl(ORDEN)!;
    expect(o.productos[0]).toMatchObject({ itemId: "MCO123456", precioUnitario: 69900, cantidad: 1, variaciones: [{ nombre: "Color", valor: "Gris" }, { nombre: "Talla", valor: "L" }] });
    expect(o.envioId).toBe("4000001");
  });
  it("lee ciudad y receptor del envío", () => {
    expect(leerEnvioMl({ receiver_address: { city: { name: "Medellín" }, receiver_name: "Ana P." } })).toEqual({ ciudad: "Medellín", receptor: "Ana P." });
    expect(leerEnvioMl(null)).toEqual({ ciudad: null, receptor: null });
  });
  it("foto: prefiere pictures https, cae a thumbnail y rechaza http", () => {
    expect(leerFotoItemMl({ pictures: [{ secure_url: "https://http2.mlstatic.com/a.jpg" }], thumbnail: "https://x/t.jpg" })).toBe("https://http2.mlstatic.com/a.jpg");
    expect(leerFotoItemMl({ thumbnail: "https://x/t.jpg" })).toBe("https://x/t.jpg");
    expect(leerFotoItemMl({ thumbnail: "http://x/t.jpg" })).toBeNull();
  });
  it("nombre del comprador: orden → envío → nickname → «Comprador»", () => {
    const o = leerOrdenMl(ORDEN)!;
    expect(nombreComprador(o, "Otro")).toBe("Ana Pérez");
    const sinNombre = leerOrdenMl({ ...ORDEN, buyer: { nickname: "COMPRADOR1" } })!;
    expect(nombreComprador(sinNombre, "Ana P.")).toBe("Ana P.");
    expect(nombreComprador(sinNombre, null)).toBe("COMPRADOR1");
    expect(nombreComprador(null, null)).toBe("Comprador");
  });
  it("iniciales", () => {
    expect(iniciales("Ana Pérez")).toBe("AP");
    expect(iniciales("Comprador")).toBe("CO");
  });
});

describe("archivoAdjuntoValido", () => {
  it.each([["foto.png", true], ["a_b-1.pdf", true], ["../x", false], ["a/b", false], [".x", false], ["a..b", false], ["", false]])("%s → %s", (n, ok) => {
    expect(archivoAdjuntoValido(n as string)).toBe(ok);
  });
});
