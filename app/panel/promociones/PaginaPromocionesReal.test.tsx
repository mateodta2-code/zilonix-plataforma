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
let llamadasTexto: { url: string; metodo: string; cuerpo: LlamadaRegla }[];
function filaLista(itemId: string) {
  return {
    itemId, cuentaMlId: CUENTAS[0].id, nicknameCuenta: "Mi Tienda", siteId: "MLM", tituloProducto: `Producto ${itemId}`, thumbnail: null, skuCodigo: null,
    precioOriginal: 100, stock: 1, tieneVariantes: false, estado: "sin_promocion", promociones: [], motivoError: null,
  };
}
const FILAS_LISTA = [filaLista("MLM1"), filaLista("MLM2")];

let respuestaInterpretar: { status: number; body: unknown };

beforeEach(() => {
  llamadasRegla = [];
  llamadasTexto = [];
  respuestaInterpretar = {
    status: 200,
    body: { entendido: ["no entrar en promociones cuyo nombre contenga «black friday»"], noEntendido: ["que sea bonito"], json: { version: 1 } },
  };
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
        return { ok: true, json: async () => ({ filas: FILAS_LISTA, conteosLote: { todas: 2, enPromocion: 0, sinPromocion: 2, conError: 0 }, cursorSiguiente: null }) };
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
      if (String(url).startsWith("/api/ml/promociones/reglas-adicionales")) {
        llamadasTexto.push({ url: String(url), metodo: (init as { method?: string })?.method ?? "GET", cuerpo: JSON.parse(init?.body ?? "{}") as LlamadaRegla });
        if (String(url).endsWith("/interpretar")) return { ok: respuestaInterpretar.status === 200, json: async () => respuestaInterpretar.body };
        return { ok: true, json: async () => ({ ok: true }) };
      }
      return { ok: false, json: async () => ({}) };
    })
  );
});

function montar(maestra = CON_MAESTRA, puedeAprobar = true) {
  return render(<PaginaPromocionesReal cuentas={CUENTAS} puedeEjecutar puedeAprobar={puedeAprobar} resumenMaestraSku={maestra} />);
}

// Espera a que cargue la lista y marca «Seleccionar todas» (Promo-A: sin selección no se aplica nada).
async function marcarTodas() {
  const caja = (await screen.findByLabelText(/Seleccionar todas/)) as HTMLInputElement;
  fireEvent.click(caja);
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

  it("tabla maestra vacía: con «todas» el botón NO se bloquea; con «tabla maestra» o «máximo» sí", async () => {
    montar(SIN_MAESTRA);
    await marcarTodas();
    expect(botonAplicar().disabled).toBe(false);
    fireEvent.click(screen.getByLabelText("Respetar siempre la tabla maestra de SKU con precios mínimos"));
    expect(botonAplicar().disabled).toBe(true);
    fireEvent.click(screen.getByLabelText(/Participar solo hasta un máximo de/));
    expect(botonAplicar().disabled).toBe(true);
    fireEvent.click(screen.getByLabelText("Participar en todas las promociones disponibles"));
    expect(botonAplicar().disabled).toBe(false);
  });

  it("diálogo «Aplicar regla»: «todas» dice sin precio mínimo; «tabla maestra» y «máximo» dicen que el mínimo nunca se salta", async () => {
    montar();
    await marcarTodas();
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

describe("PaginaPromocionesReal — aplicar regla solo a lo seleccionado (Promo-A)", () => {
  it("cada fila tiene un checkbox accesible con el título, y ya no dice «Se aplica sobre todas las cuentas»", async () => {
    montar();
    expect(await screen.findByLabelText("Seleccionar Producto MLM1")).toBeTruthy();
    expect(screen.getByLabelText("Seleccionar Producto MLM2")).toBeTruthy();
    expect(screen.queryByText(/sobre todas las cuentas/)).toBeNull();
  });

  it("sin selección: botón deshabilitado, «Se aplica a 0 publicaciones» y NO llama al endpoint", async () => {
    montar();
    await screen.findByLabelText(/Seleccionar todas/);
    expect(botonAplicar().disabled).toBe(true);
    expect(screen.getByText(/Se aplica a 0 publicaciones seleccionadas/)).toBeTruthy();
    fireEvent.click(botonAplicar());
    expect(llamadasRegla).toHaveLength(0);
  });

  it("«Seleccionar todas» marca las cargadas y se puede deseleccionar", async () => {
    montar();
    const todas = (await screen.findByLabelText(/Seleccionar todas/)) as HTMLInputElement;
    fireEvent.click(todas);
    expect(screen.getByText(/Se aplica a 2 publicaciones seleccionadas/)).toBeTruthy();
    expect(botonAplicar().disabled).toBe(false);
    fireEvent.click(todas);
    expect(screen.getByText(/Se aplica a 0 publicaciones seleccionadas/)).toBeTruthy();
    expect(botonAplicar().disabled).toBe(true);
  });

  it("con 1 de 2 marcada: el body lleva SOLO esa (con su cuenta), la regla elegida, y la selección se limpia al aplicar", async () => {
    montar();
    fireEvent.click(await screen.findByLabelText("Seleccionar Producto MLM2"));
    expect(screen.getByText(/Se aplica a 1 publicaciones seleccionadas/)).toBeTruthy();
    fireEvent.click(screen.getByLabelText(/Participar solo hasta un máximo de/));
    fireEvent.click(botonAplicar());
    fireEvent.click(screen.getByRole("button", { name: "Aplicar" }));
    await waitFor(() => expect(llamadasRegla).toHaveLength(1));
    expect(llamadasRegla[0]).toMatchObject({ regla: "maximo", maximoPct: 15, seleccion: [{ cuentaId: CUENTAS[0].id, itemId: "MLM2" }] });
    expect(llamadasRegla[0].cuentaId).toBeUndefined();
    await waitFor(() => expect(screen.getByText(/Se aplica a 0 publicaciones seleccionadas/)).toBeTruthy());
  });

  it("con 2 marcadas manda las 2", async () => {
    montar();
    await marcarTodas();
    fireEvent.click(botonAplicar());
    fireEvent.click(screen.getByRole("button", { name: "Aplicar" }));
    await waitFor(() => expect(llamadasRegla).toHaveLength(1));
    expect(llamadasRegla[0].seleccion).toHaveLength(2);
  });
});

describe("PaginaPromocionesReal — «Dejar de participar en todas»", () => {
  it("no escribe nada al elegirla: primero una vista previa con el conteo, y recién ahí el botón rojo", async () => {
    montar();
    await marcarTodas();
    fireEvent.click(screen.getByLabelText("Dejar de participar en todas las promociones"));
    fireEvent.click(botonAplicar("Revisar y dejar de participar…"));

    await waitFor(() => expect(screen.getByText(/Saldrán/)).toBeTruthy());
    // Conteo: 2 publicaciones de 3 promociones; 1 no se puede por API.
    const resumen = screen.getByText(/Saldrán/).textContent ?? "";
    expect(resumen).toContain("2");
    expect(resumen).toContain("3");
    expect(screen.getByText(/no se pueden dejar por la API/).textContent).toContain("1");
    expect(screen.getByText("Esto quita las publicaciones seleccionadas de sus promociones activas. No se puede deshacer desde Seller.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Sí, dejar de participar" })).toBeTruthy();
    expect(screen.getAllByRole("button", { name: "Cancelar" }).length).toBeGreaterThan(0);

    // Solo se pidió la vista previa — ninguna llamada de ejecución todavía.
    expect(llamadasRegla).toHaveLength(1);
    expect(llamadasRegla[0]).toMatchObject({ regla: "salir-todas", vistaPrevia: true });
    expect(llamadasRegla[0].seleccion).toHaveLength(2); // solo las seleccionadas
    expect(llamadasRegla[0].confirmado).toBeUndefined();
  });

  it("al confirmar: manda confirmado:true y muestra el resumen y el resultado por publicación", async () => {
    montar();
    await marcarTodas();
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
    await marcarTodas();
    fireEvent.click(screen.getByLabelText("Dejar de participar en todas las promociones"));
    fireEvent.click(botonAplicar("Revisar y dejar de participar…"));
    await waitFor(() => screen.getByRole("button", { name: "Sí, dejar de participar" }));
    fireEvent.click(screen.getAllByRole("button", { name: "Cancelar" })[0]);
    expect(llamadasRegla.every((l) => l.confirmado === undefined)).toBe(true);
  });
});

describe("PaginaPromocionesReal — «Reglas adicionales» (PR 2)", () => {
  const ETIQUETA = "Reglas adicionales";

  it("el recuadro solo aparece con «Respetar siempre la tabla maestra»", () => {
    montar();
    expect(screen.queryByLabelText(ETIQUETA)).toBeNull();
    fireEvent.click(screen.getByLabelText("Respetar siempre la tabla maestra de SKU con precios mínimos"));
    expect(screen.getByLabelText(ETIQUETA)).toBeTruthy();
    fireEvent.click(screen.getByLabelText("Participar en todas las promociones disponibles"));
    expect(screen.queryByLabelText(ETIQUETA)).toBeNull();
    fireEvent.click(screen.getByLabelText("Dejar de participar en todas las promociones"));
    expect(screen.queryByLabelText(ETIQUETA)).toBeNull();
  });

  it("Interpretar muestra «Entendí esto» y «No entendí», y NO guarda nada hasta confirmar", async () => {
    montar();
    fireEvent.click(screen.getByLabelText("Respetar siempre la tabla maestra de SKU con precios mínimos"));
    fireEvent.change(screen.getByLabelText(ETIQUETA), { target: { value: "no entrar en Black Friday, que sea bonito" } });
    fireEvent.click(screen.getByRole("button", { name: "Interpretar" }));

    await waitFor(() => expect(screen.getByText("Entendí esto:")).toBeTruthy());
    expect(screen.getByText("no entrar en promociones cuyo nombre contenga «black friday»")).toBeTruthy();
    expect(screen.getByText("No entendí:")).toBeTruthy();
    expect(screen.getByText("que sea bonito")).toBeTruthy();
    expect(llamadasTexto.map((l) => l.metodo)).toEqual(["POST"]); // solo interpretó
    expect(llamadasTexto.some((l) => l.metodo === "PUT")).toBe(false);
  });

  it("Descartar no guarda; Confirmar y guardar manda confirmado:true con el JSON interpretado", async () => {
    montar();
    fireEvent.click(screen.getByLabelText("Respetar siempre la tabla maestra de SKU con precios mínimos"));
    fireEvent.change(screen.getByLabelText(ETIQUETA), { target: { value: "no entrar en Black Friday" } });
    fireEvent.click(screen.getByRole("button", { name: "Interpretar" }));
    await waitFor(() => screen.getByText("Entendí esto:"));

    fireEvent.click(screen.getByRole("button", { name: "Descartar" }));
    expect(screen.queryByText("Entendí esto:")).toBeNull();
    expect(llamadasTexto.some((l) => l.metodo === "PUT")).toBe(false);

    fireEvent.click(screen.getByRole("button", { name: "Interpretar" }));
    await waitFor(() => screen.getByText("Entendí esto:"));
    fireEvent.click(screen.getByRole("button", { name: "Confirmar y guardar" }));
    await waitFor(() => expect(llamadasTexto.some((l) => l.metodo === "PUT")).toBe(true));
    const put = llamadasTexto.find((l) => l.metodo === "PUT")!;
    expect(put.cuerpo).toMatchObject({ cuentaId: "todas", texto: "no entrar en Black Friday", json: { version: 1 }, confirmado: true });
  });

  it("si lo escrito cambia después de interpretar, la interpretación se descarta (nunca se guarda un texto distinto)", async () => {
    montar();
    fireEvent.click(screen.getByLabelText("Respetar siempre la tabla maestra de SKU con precios mínimos"));
    fireEvent.change(screen.getByLabelText(ETIQUETA), { target: { value: "uno" } });
    fireEvent.click(screen.getByRole("button", { name: "Interpretar" }));
    await waitFor(() => screen.getByText("Entendí esto:"));
    fireEvent.change(screen.getByLabelText(ETIQUETA), { target: { value: "otro texto" } });
    expect(screen.queryByText("Entendí esto:")).toBeNull();
  });

  it("sin IA conectada: mensaje claro con enlace, nada falla en silencio", async () => {
    respuestaInterpretar = { status: 409, body: { error: "Conecta tu IA en Administración → Conectar IA", codigo: "sin_ia" } };
    montar();
    fireEvent.click(screen.getByLabelText("Respetar siempre la tabla maestra de SKU con precios mínimos"));
    fireEvent.change(screen.getByLabelText(ETIQUETA), { target: { value: "algo" } });
    fireEvent.click(screen.getByRole("button", { name: "Interpretar" }));
    await waitFor(() => expect(screen.getByText("Conecta tu IA en Administración → Conectar IA")).toBeTruthy());
    expect(screen.getByText("Conecta tu IA en Administración → Conectar IA").getAttribute("href")).toBe("/panel/conectar-ia");
  });

  it("sin permiso 'aprobar': no hay botón Interpretar y el recuadro queda deshabilitado", () => {
    montar(CON_MAESTRA, false);
    fireEvent.click(screen.getByLabelText("Respetar siempre la tabla maestra de SKU con precios mínimos"));
    expect(screen.queryByRole("button", { name: "Interpretar" })).toBeNull();
    expect((screen.getByLabelText(ETIQUETA) as HTMLTextAreaElement).disabled).toBe(true);
  });
});

describe("PaginaPromocionesReal — «Aplicada» vs «Programada»", () => {
  function promo(tipoPromocion: string, estadoMl: string) {
    return {
      tipoPromocion, promotionIdMl: `${tipoPromocion}-1`, estadoMl, esCompartida: false, soloEnMl: false, puedeSalirApi: true,
      precioOriginal: 100, precioActual: 90, precioMinimo: null, precioSugerido: null, maxDiscountedPrice: null, gananciaEstimada: null,
      cumpleReglas: true, accionSugerida: null, motivoRevisarManual: null, reglaAdicionalMotivo: null,
    };
  }
  function fila(itemId: string, promociones: ReturnType<typeof promo>[]) {
    return {
      itemId, cuentaMlId: CUENTAS[0].id, nicknameCuenta: "Mi Tienda", siteId: "MLM", tituloProducto: `Prod ${itemId}`, thumbnail: null, skuCodigo: null,
      precioOriginal: 100, stock: 1, tieneVariantes: false, estado: "en_promocion", promociones, motivoError: null,
    };
  }
  function simular(filas: unknown[]) {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (String(url).startsWith("/api/ml/promociones/publicaciones?")) {
          return { ok: true, json: async () => ({ filas, conteosLote: { todas: filas.length, enPromocion: filas.length, sinPromocion: 0, conError: 0 }, cursorSiguiente: null }) };
        }
        return { ok: false, json: async () => ({}) };
      })
    );
  }

  it("fila con solo «pending»: «Promoción programada», no «En promoción aplicada»", async () => {
    simular([fila("MLM1", [promo("DEAL", "pending")])]);
    montar();
    await waitFor(() => expect(screen.getByText("Promoción programada")).toBeTruthy());
    expect(screen.queryByText("En promoción aplicada")).toBeNull();
  });

  it("fila con «started» y «pending»: «En promoción aplicada»", async () => {
    simular([fila("MLM1", [promo("DEAL", "pending"), promo("PRICE_DISCOUNT", "started")])]);
    montar();
    await waitFor(() => expect(screen.getByText("En promoción aplicada")).toBeTruthy());
    expect(screen.queryByText("Promoción programada")).toBeNull();
  });

  it("en el detalle cada promoción dice «Aplicada» o «Programada»", async () => {
    simular([fila("MLM1", [promo("DEAL", "pending"), promo("PRICE_DISCOUNT", "started")])]);
    montar();
    await waitFor(() => screen.getByText("En promoción aplicada"));
    fireEvent.click(screen.getByText("Prod MLM1"));
    expect(screen.getByText("Aplicada")).toBeTruthy();
    expect(screen.getByText("Programada")).toBeTruthy();
    expect(screen.getAllByRole("button", { name: "Dejar de participar" })).toHaveLength(2);
  });
});

describe("PaginaPromocionesReal — pestaña Bitácora (Promo-B)", () => {
  it("muestra la pestaña Bitácora y al abrirla pide el historial, sin perder la lista", async () => {
    montar();
    await screen.findByText("Producto MLM1");
    const pedidos = () => (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.map((c) => String(c[0]));
    expect(pedidos().some((u) => u.startsWith("/api/ml/promociones/historial"))).toBe(false);
    fireEvent.click(screen.getByRole("tab", { name: "Bitácora" }));
    await waitFor(() => expect(pedidos().some((u) => u.startsWith("/api/ml/promociones/historial"))).toBe(true));
    fireEvent.click(screen.getByRole("tab", { name: "Publicaciones" }));
    expect(screen.getByText("Producto MLM1")).toBeTruthy();
  });
});

describe("PaginaPromocionesReal — Promo-D (regla en la fila por producto)", () => {
  const urlsLista = () => (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.map((l) => String(l[0])).filter((u) => u.startsWith("/api/ml/promociones/publicaciones?"));

  it("pide la lista con regla=todas al inicio, y recarga con otra regla al cambiarla (y vuelve a todas)", async () => {
    montar();
    await screen.findByLabelText(/Seleccionar todas/);
    expect(urlsLista()).toHaveLength(1);
    expect(urlsLista()[0]).toContain("regla=todas");
    fireEvent.click(screen.getByLabelText("Respetar siempre la tabla maestra de SKU con precios mínimos"));
    await waitFor(() => expect(urlsLista()).toHaveLength(2));
    expect(urlsLista()[1]).toContain("regla=tabla-maestra");
    fireEvent.click(screen.getByLabelText("Participar en todas las promociones disponibles"));
    await waitFor(() => expect(urlsLista()).toHaveLength(3));
    expect(urlsLista()[2]).toContain("regla=todas");
  });

  it("el motivo de una promoción no marcable aparece UNA sola vez", async () => {
    const motivo = "El piso (54000) está por encima del máximo que permite esta promoción puntual (46550)";
    const promo = {
      tipoPromocion: "PRICE_DISCOUNT", promotionIdMl: "p1", estadoMl: "candidate", esCompartida: false, soloEnMl: false, puedeSalirApi: true,
      precioOriginal: 49000, precioActual: null, precioMinimo: 54000, precioSugerido: 54000, maxDiscountedPrice: 46550, gananciaEstimada: null,
      cumpleReglas: false, accionSugerida: null, motivoRevisarManual: motivo, reglaAdicionalMotivo: null,
    };
    const base = vi.mocked(fetch).getMockImplementation() as (u: string, i?: { body?: string }) => Promise<unknown>;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: { body?: string }) =>
        String(url).startsWith("/api/ml/promociones/publicaciones?")
          ? { ok: true, json: async () => ({ filas: [{ ...filaLista("MLM1"), estado: "sin_promocion", promociones: [promo] }], conteosLote: { todas: 1, enPromocion: 0, sinPromocion: 1, conError: 0 }, cursorSiguiente: null }) }
          : base(url, init)
      )
    );
    montar();
    fireEvent.click(await screen.findByText("Producto MLM1"));
    await screen.findAllByText(new RegExp("El piso \\(54000\\)"));
    expect(screen.getAllByText(new RegExp("El piso \\(54000\\)"))).toHaveLength(1);
  });
});
