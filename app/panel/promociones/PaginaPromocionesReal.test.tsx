// @vitest-environment jsdom
//
// Rama fix-promociones-todas-sin-piso — textos de las reglas (todas sin
// piso, tabla maestra / máximo con piso) y la 4.ª opción «Dejar de
// participar en todas» con su diálogo de confirmación y conteo.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { PaginaPromocionesReal } from "./PaginaPromocionesReal";

afterEach(() => cleanup());

const CUENTAS = [{ id: "11111111-1111-1111-1111-111111111111", nickname: "Mi Tienda", siteId: "MLM" }];
const SIN_MAESTRA = { total: 0, actualizadoTs: null };
const CON_MAESTRA = { total: 12, actualizadoTs: null };

type LlamadaRegla = Record<string, unknown>;
let llamadasRegla: LlamadaRegla[];

beforeEach(() => {
  llamadasRegla = [];
  // jsdom no implementa <dialog>.showModal/close.
  // (hay que marcar `open`: sin eso jsdom oculta el contenido a las consultas por rol).
  HTMLDialogElement.prototype.showModal = function (this: HTMLDialogElement) {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function (this: HTMLDialogElement) {
    this.removeAttribute("open");
  };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: { body?: string }) => {
      if (String(url).startsWith("/api/ml/promociones/publicaciones?")) {
        return { ok: true, json: async () => ({ filas: [], conteosLote: { todas: 0, enPromocion: 0, sinPromocion: 0, conError: 0 }, cursorSiguiente: null }) };
      }
      if (url === "/api/ml/promociones/publicaciones/reglas-aplicar") {
        const cuerpo = JSON.parse(init?.body ?? "{}") as LlamadaRegla;
        llamadasRegla.push(cuerpo);
        if (cuerpo.regla === "salir-todas" && cuerpo.vistaPrevia) {
          return { ok: true, json: async () => ({ revisadas: 5, publicaciones: 2, promociones: 3, salibles: 2, noPermitidas: 1, lecturasConError: 0, porTipo: {} }) };
        }
        if (cuerpo.regla === "salir-todas" && cuerpo.confirmado) {
          return {
            ok: true,
            json: async () => ({
              revisadas: 5,
              salieron: 1,
              errores: 1,
              noPermitidas: 1,
              filas: [
                { itemId: "MLM1", cuentaMlId: "c", tituloProducto: "Taza", tipoPromocion: "DEAL", estado: "salio", error: null },
                { itemId: "MLM2", cuentaMlId: "c", tituloProducto: "Plato", tipoPromocion: "PRICE_DISCOUNT", estado: "error", error: "ML dijo que no" },
                { itemId: "MLM3", cuentaMlId: "c", tituloProducto: "Vaso", tipoPromocion: "DOD", estado: "no_permitida", error: "No se puede salir por API" },
              ],
            }),
          };
        }
        return { ok: true, json: async () => ({ revisadas: 0, participadas: 0, fallidas: 0, omitidas: 0, filas: [] }) };
      }
      return { ok: false, json: async () => ({}) };
    })
  );
});

function montar(maestra = CON_MAESTRA) {
  return render(<PaginaPromocionesReal cuentas={CUENTAS} puedeEjecutar resumenMaestraSku={maestra} />);
}

function botonAplicar(nombre = "Aplicar regla a las publicaciones") {
  return screen.getByRole("button", { name: nombre }) as HTMLButtonElement;
}

describe("PaginaPromocionesReal — reglas (todas sin piso)", () => {
  it("la ayuda explica que «todas» entra SIN precio mínimo y que solo la tabla maestra aplica el piso", () => {
    montar();
    expect(screen.getByText(/entra en todas las promociones disponibles SIN precio mínimo/)).toBeTruthy();
    expect(screen.getByText(/puede dejar productos vendiéndose bajo su costo/)).toBeTruthy();
    expect(screen.queryByText(/nunca se puede saltar, sin importar la regla elegida/)).toBeNull();
  });

  it("hay 4 opciones, la cuarta es «Dejar de participar en todas las promociones»", () => {
    montar();
    expect(screen.getAllByRole("radio")).toHaveLength(4);
    expect(screen.getByLabelText("Dejar de participar en todas las promociones")).toBeTruthy();
  });

  it("tabla maestra vacía: con «todas» el botón NO se bloquea; con «tabla maestra» o «máximo» sí", () => {
    montar(SIN_MAESTRA);
    expect(botonAplicar().disabled).toBe(false);
    fireEvent.click(screen.getByLabelText("Respetar siempre la tabla maestra de SKU con precios mínimos"));
    expect(botonAplicar().disabled).toBe(true);
    fireEvent.click(screen.getByLabelText(/Participar solo hasta un máximo de/));
    expect(botonAplicar().disabled).toBe(true);
    fireEvent.click(screen.getByLabelText("Participar en todas las promociones disponibles"));
    expect(botonAplicar().disabled).toBe(false);
  });

  it("diálogo «Aplicar regla»: «todas» dice sin precio mínimo; «tabla maestra» y «máximo» dicen que el mínimo nunca se salta", () => {
    montar();
    fireEvent.click(botonAplicar());
    expect(screen.getByText("Sin precio mínimo: se entra a todas aunque quede bajo el costo.")).toBeTruthy();
    expect(screen.queryByText(/sin importar la regla/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));

    fireEvent.click(screen.getByLabelText("Respetar siempre la tabla maestra de SKU con precios mínimos"));
    expect(screen.getByText("El precio mínimo de Finanzas nunca se salta.")).toBeTruthy();
    expect(screen.queryByText(/Sin precio mínimo: se entra a todas/)).toBeNull();

    fireEvent.click(screen.getByLabelText(/Participar solo hasta un máximo de/));
    expect(screen.getByText("El precio mínimo de Finanzas nunca se salta.")).toBeTruthy();
  });
});

describe("PaginaPromocionesReal — «Dejar de participar en todas»", () => {
  it("no escribe nada al elegirla: primero una vista previa con el conteo, y recién ahí el botón rojo", async () => {
    montar();
    fireEvent.click(screen.getByLabelText("Dejar de participar en todas las promociones"));
    fireEvent.click(botonAplicar("Revisar y dejar de participar…"));

    await waitFor(() => expect(screen.getByText(/Saldrán/)).toBeTruthy());
    // Conteo: 2 publicaciones de 3 promociones; 1 no se puede por API.
    const resumen = screen.getByText(/Saldrán/).textContent ?? "";
    expect(resumen).toContain("2");
    expect(resumen).toContain("3");
    expect(screen.getByText(/no se pueden dejar por la API/).textContent).toContain("1");
    expect(screen.getByText("Esto quita todas tus publicaciones activas de las promociones. No se puede deshacer desde Seller.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Sí, dejar de participar" })).toBeTruthy();
    expect(screen.getAllByRole("button", { name: "Cancelar" }).length).toBeGreaterThan(0);

    // Solo se pidió la vista previa — ninguna llamada de ejecución todavía.
    expect(llamadasRegla).toHaveLength(1);
    expect(llamadasRegla[0]).toMatchObject({ regla: "salir-todas", vistaPrevia: true });
    expect(llamadasRegla[0].confirmado).toBeUndefined();
  });

  it("al confirmar: manda confirmado:true y muestra el resumen y el resultado por publicación", async () => {
    montar();
    fireEvent.click(screen.getByLabelText("Dejar de participar en todas las promociones"));
    fireEvent.click(botonAplicar("Revisar y dejar de participar…"));
    await waitFor(() => screen.getByRole("button", { name: "Sí, dejar de participar" }));

    fireEvent.click(screen.getByRole("button", { name: "Sí, dejar de participar" }));
    await waitFor(() => expect(screen.getByText(/1 salieron · 1 con error · 1 no se pueden por API/)).toBeTruthy());

    expect(llamadasRegla[1]).toMatchObject({ regla: "salir-todas", confirmado: true });
    expect(screen.getByText(/MLM1 · Taza · Campaña tradicional — Salió/)).toBeTruthy();
    expect(screen.getByText(/MLM2 · Plato · Descuento de precio — Error: ML dijo que no/)).toBeTruthy();
    expect(screen.getByText(/MLM3 · Vaso · Oferta del día — No se puede por API/)).toBeTruthy();
  });

  it("«Cancelar» en la confirmación no manda ninguna ejecución", async () => {
    montar();
    fireEvent.click(screen.getByLabelText("Dejar de participar en todas las promociones"));
    fireEvent.click(botonAplicar("Revisar y dejar de participar…"));
    await waitFor(() => screen.getByRole("button", { name: "Sí, dejar de participar" }));
    fireEvent.click(screen.getAllByRole("button", { name: "Cancelar" })[0]);
    expect(llamadasRegla.every((l) => l.confirmado === undefined)).toBe(true);
  });
});
