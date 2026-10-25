import { describe, expect, it } from "vitest";
import {
  aplicarVendidosConfirmados,
  calcularKpisMercado,
  calcularResumenBloque,
  calcularResumenLocalBloque,
  clasificarSenalVentas,
  esRelevanteAlTermino,
  facturacionEstimadaListado,
  fusionarProductos,
  generarEstrategiaListado,
  generarVeredictoListado,
  linkHttpSeguro,
  mejorOpcionParaImportar,
  ordenarProductos,
  type ProductoListado,
} from "./listadoCliente";

function producto(parciales: Partial<ProductoListado> & { plataforma: string; titulo: string }): ProductoListado {
  return {
    itemId: null,
    precio: 10_000,
    foto: null,
    senalVentas: { valor: null, tipo: "ausente" },
    esFull: null,
    esPrime: null,
    esEnvioGratis: null,
    calificacion: null,
    vendedor: null,
    link: null,
    ...parciales,
  };
}

describe("clasificarSenalVentas — issue #227", () => {
  it("sin número -> ausente", () => {
    expect(clasificarSenalVentas("Amazon", null)).toEqual({ valor: null, tipo: "ausente" });
  });
  it("Amazon -> mensual_piso", () => {
    expect(clasificarSenalVentas("Amazon", 500)).toEqual({ valor: 500, tipo: "mensual_piso" });
  });
  it("Mercado Libre (cualquier país) y las 4 plataformas restantes -> acumulado_sin_periodo, nunca mensual", () => {
    for (const plataforma of ["Mercado Libre Colombia", "Mercado Libre Argentina", "Temu", "AliExpress", "Shein", "Alibaba"]) {
      expect(clasificarSenalVentas(plataforma, 500)).toEqual({ valor: 500, tipo: "acumulado_sin_periodo" });
    }
  });
});

describe("linkHttpSeguro", () => {
  it("acepta http(s), rechaza javascript:/data:, nunca lanza", () => {
    expect(linkHttpSeguro("https://amazon.com/dp/X")).toBe("https://amazon.com/dp/X");
    expect(linkHttpSeguro("javascript:alert(1)")).toBeNull();
    expect(linkHttpSeguro(null)).toBeNull();
  });
});

describe("fusionarProductos", () => {
  it("dedup por link, agrega el resto", () => {
    const actuales = [producto({ plataforma: "Amazon", titulo: "A", link: "https://a.com/1" })];
    const nuevos = [producto({ plataforma: "Amazon", titulo: "A", link: "https://a.com/1" }), producto({ plataforma: "Amazon", titulo: "B", link: "https://a.com/2" })];
    expect(fusionarProductos(actuales, nuevos)).toHaveLength(2);
  });
});

describe("aplicarVendidosConfirmados — issue #210 adaptado (#227)", () => {
  it("completa solo la fila con itemId correcto y senalVentas ausente", () => {
    const productos = [
      producto({ plataforma: "Mercado Libre Colombia", titulo: "A", itemId: "MCO1" }),
      producto({ plataforma: "Mercado Libre Colombia", titulo: "B", itemId: "MCO2" }),
    ];
    const resultado = aplicarVendidosConfirmados(productos, { itemId: "MCO1", sold_quantity: 40, date_created: null, esFull: false, etiquetaMasN: false });
    expect(resultado[0].senalVentas).toEqual({ valor: 40, tipo: "acumulado_sin_periodo" });
    expect(resultado[1].senalVentas.tipo).toBe("ausente"); // nunca toca otra fila
  });

  it("nunca pisa un vendidos que el listado ya había confirmado", () => {
    const productos = [producto({ plataforma: "Mercado Libre Colombia", titulo: "A", itemId: "MCO1", senalVentas: { valor: 7, tipo: "acumulado_sin_periodo" } })];
    const resultado = aplicarVendidosConfirmados(productos, { itemId: "MCO1", sold_quantity: 999, date_created: null, esFull: false, etiquetaMasN: false });
    expect(resultado[0].senalVentas.valor).toBe(7);
  });
});

describe("facturacionEstimadaListado — issue #227 (nunca histórico×precio como mensual)", () => {
  it("mensual_piso (Amazon) -> precio × valor", () => {
    const p = producto({ plataforma: "Amazon", titulo: "A", precio: 1000, senalVentas: { valor: 50, tipo: "mensual_piso" } });
    expect(facturacionEstimadaListado(p)).toBe(50_000);
  });

  it("acumulado_sin_periodo -> null, NUNCA se multiplica (ese sería el bug prohibido)", () => {
    const p = producto({ plataforma: "Temu", titulo: "A", precio: 1000, senalVentas: { valor: 50, tipo: "acumulado_sin_periodo" } });
    expect(facturacionEstimadaListado(p)).toBeNull();
  });

  it("ausente -> null", () => {
    const p = producto({ plataforma: "Amazon", titulo: "A", precio: 1000 });
    expect(facturacionEstimadaListado(p)).toBeNull();
  });
});

describe("ordenarProductos — 6 sorts (issue #227)", () => {
  const a = producto({ plataforma: "Amazon", titulo: "barato-full-malo", precio: 100, esFull: true, calificacion: 2, senalVentas: { valor: 10, tipo: "mensual_piso" } });
  const b = producto({ plataforma: "Amazon", titulo: "caro-sin-full-bueno", precio: 900, esFull: false, calificacion: 5, senalVentas: { valor: 1, tipo: "mensual_piso" } });

  it("precioAsc / precioDesc", () => {
    expect(ordenarProductos([b, a], "precioAsc")[0]).toBe(a);
    expect(ordenarProductos([a, b], "precioDesc")[0]).toBe(b);
  });

  it("calificacion (más alta primero)", () => {
    expect(ordenarProductos([a, b], "calificacion")[0]).toBe(b);
  });

  it("full (true primero)", () => {
    expect(ordenarProductos([b, a], "full")[0]).toBe(a);
  });

  it("vendidos (señal más alta primero, sin importar el tipo)", () => {
    expect(ordenarProductos([b, a], "vendidos")[0]).toBe(a); // 10 > 1
  });

  it("facturacion (precio×mensual_piso más alto primero; ausente/acumulado siempre al final)", () => {
    const c = producto({ plataforma: "Temu", titulo: "sin-dato-mensual", precio: 999_999, senalVentas: { valor: 999_999, tipo: "acumulado_sin_periodo" } });
    const orden = ordenarProductos([c, a, b], "facturacion");
    expect(orden[orden.length - 1]).toBe(c); // nunca arriba solo por tener un número grande de OTRO tipo
  });
});

describe("calcularResumenBloque — separa sumas por tipo, nunca mezcladas", () => {
  it("suma acumulado y mensual por separado", () => {
    const resumen = calcularResumenBloque([
      producto({ plataforma: "Temu", titulo: "A", senalVentas: { valor: 5, tipo: "acumulado_sin_periodo" } }),
      producto({ plataforma: "Amazon", titulo: "B", senalVentas: { valor: 100, tipo: "mensual_piso" } }),
    ]);
    expect(resumen.sumaAcumuladaSinPeriodo).toBe(5);
    expect(resumen.sumaMensualPiso).toBe(100);
  });
});

describe("calcularKpisMercado (solo ML)", () => {
  it("vendedoresDistintos, %Full y %envío gratis solo sobre filas con dato confirmado", () => {
    const kpis = calcularKpisMercado([
      producto({ plataforma: "Mercado Libre Colombia", titulo: "A", vendedor: "Vendedor 1", esFull: true, esEnvioGratis: true }),
      producto({ plataforma: "Mercado Libre Colombia", titulo: "B", vendedor: "Vendedor 2", esFull: false, esEnvioGratis: null }),
      producto({ plataforma: "Mercado Libre Colombia", titulo: "C", vendedor: "Vendedor 1" }),
    ]);
    expect(kpis.publicacionesEncontradas).toBe(3);
    expect(kpis.vendedoresDistintos).toBe(2);
    expect(kpis.porcentajeFull).toBe(50);
    expect(kpis.porcentajeEnvioGratis).toBe(100); // solo A tiene el dato confirmado
  });
});

describe("generarEstrategiaListado / generarVeredictoListado — nunca 'demanda alta/baja' sin date_created", () => {
  it("veredicto nunca menciona una tasa mensual estimada (eliminado a propósito, issue #227)", () => {
    const veredicto = generarVeredictoListado({ publicacionesEncontradas: 10, vendedoresDistintos: 8 });
    expect(veredicto).not.toMatch(/mes|mensual/i);
  });

  it("pocos vendedores -> oportunidad; muchos -> competido", () => {
    expect(generarVeredictoListado({ publicacionesEncontradas: 5, vendedoresDistintos: 1 })).toMatch(/poca competencia/i);
    expect(generarVeredictoListado({ publicacionesEncontradas: 5, vendedoresDistintos: 6 })).toMatch(/competido/i);
  });

  it("estrategia: ticket alto/bajo y Full siguen los mismos umbrales reales de siempre", () => {
    const reglas = generarEstrategiaListado({ publicacionesEncontradas: 10, vendedoresDistintos: 3, precioPromedio: 70_000, porcentajeFull: 90 });
    expect(reglas.some((r) => /ticket alto/i.test(r.texto))).toBe(true);
    expect(reglas.some((r) => /ya usa full/i.test(r.texto))).toBe(true);
  });
});

describe("esRelevanteAlTermino — issue #235, filtro obligatorio para 'Mejor opción para importar'", () => {
  it("el título comparte una palabra significativa con el término -> relevante", () => {
    expect(esRelevanteAlTermino("Reloj Casio Digital Hombre", "reloj casio")).toBe(true);
  });

  it("plural/singular simple (substring en cualquier dirección) sigue contando como relevante", () => {
    expect(esRelevanteAlTermino("Pack de 3 Relojes Deportivos", "reloj")).toBe(true);
  });

  it("un accesorio sin ninguna palabra en común con el término -> NO relevante (el bug real de Zilonix OS: estuche vacío, cinta, puntero)", () => {
    expect(esRelevanteAlTermino("Estuche Vacío Organizador de Joyas", "reloj casio")).toBe(false);
    expect(esRelevanteAlTermino("Cinta Métrica 5 Metros", "reloj casio")).toBe(false);
    expect(esRelevanteAlTermino("Puntero Láser para Presentaciones", "reloj casio")).toBe(false);
  });

  it("stopwords (de, la, para...) nunca cuentan como palabra significativa para decidir relevancia", () => {
    expect(esRelevanteAlTermino("Correa de Cuero para Reloj", "para de")).toBe(true); // término sin palabras útiles -> nunca se descarta todo
  });

  it("título vacío nunca se asume relevante a ciegas", () => {
    expect(esRelevanteAlTermino("", "reloj casio")).toBe(false);
  });
});

describe("mejorOpcionParaImportar — issue #235, punto 7", () => {
  it("nunca elige el más barato si es irrelevante al término (el bug real de Zilonix OS)", () => {
    const productos = [
      producto({ plataforma: "Mercado Libre Colombia", titulo: "Estuche Vacío Organizador de Joyas", precio: 5_000, calificacion: 5 }),
      producto({ plataforma: "Mercado Libre Colombia", titulo: "Reloj Casio Digital Hombre", precio: 80_000, calificacion: 4.5, senalVentas: { valor: 200, tipo: "acumulado_sin_periodo" } }),
    ];
    const mejor = mejorOpcionParaImportar(productos, "reloj casio");
    expect(mejor?.producto.titulo).toBe("Reloj Casio Digital Hombre");
  });

  it("entre candidatos relevantes, balancea precio + calificación + volumen (nunca solo el más barato)", () => {
    const productos = [
      producto({ plataforma: "Amazon", titulo: "Reloj Casio barato", precio: 50_000, calificacion: 2, senalVentas: { valor: 5, tipo: "mensual_piso" } }),
      producto({ plataforma: "Amazon", titulo: "Reloj Casio premium", precio: 90_000, calificacion: 4.9, senalVentas: { valor: 300, tipo: "mensual_piso" } }),
    ];
    const mejor = mejorOpcionParaImportar(productos, "reloj casio");
    expect(mejor?.producto.titulo).toBe("Reloj Casio premium");
    expect(mejor?.razon).toMatch(/compras\/mes/);
  });

  it("la razón nunca llama 'mensual' a un acumulado (senalVentas honesto también acá)", () => {
    const productos = [producto({ plataforma: "Mercado Libre Colombia", titulo: "Reloj Casio", precio: 60_000, senalVentas: { valor: 150, tipo: "acumulado_sin_periodo" } })];
    const mejor = mejorOpcionParaImportar(productos, "reloj casio");
    expect(mejor?.razon).toMatch(/acumulado — nunca \/mes/);
    expect(mejor?.razon).not.toMatch(/\/mes"|compras\/mes/);
  });

  it("sin ningún candidato relevante -> null, nunca se fuerza una 'mejor opción' irrelevante", () => {
    const productos = [producto({ plataforma: "Mercado Libre Colombia", titulo: "Cinta Métrica", precio: 3_000 })];
    expect(mejorOpcionParaImportar(productos, "reloj casio")).toBeNull();
  });

  it("lista vacía -> null", () => {
    expect(mejorOpcionParaImportar([], "reloj casio")).toBeNull();
  });
});

describe("calcularResumenLocalBloque — issue #235, punto 8, banner estilo Zilonix OS por bloque", () => {
  it("Amazon con mensual_piso -> volumenEtiqueta 'Comprados/mes', % Prime (nunca % Full)", () => {
    const resumen = calcularResumenLocalBloque([
      producto({ plataforma: "Amazon", titulo: "A", precio: 50_000, calificacion: 4, esPrime: true, senalVentas: { valor: 100, tipo: "mensual_piso" } }),
      producto({ plataforma: "Amazon", titulo: "B", precio: 70_000, calificacion: 3, esPrime: false, senalVentas: { valor: 50, tipo: "mensual_piso" } }),
    ]);
    expect(resumen.volumenEtiqueta).toBe("Comprados/mes");
    expect(resumen.volumenValor).toBe(150);
    expect(resumen.porcentajePrime).toBe(50);
    expect(resumen.porcentajeFull).toBeNull(); // Amazon nunca confirma esFull — nunca se inventa
  });

  it("Mercado Libre con acumulado -> volumenEtiqueta 'Acumulado', % Full (nunca % Prime)", () => {
    const resumen = calcularResumenLocalBloque([
      producto({ plataforma: "Mercado Libre Colombia", titulo: "A", precio: 50_000, esFull: true, senalVentas: { valor: 300, tipo: "acumulado_sin_periodo" } }),
      producto({ plataforma: "Mercado Libre Colombia", titulo: "B", precio: 70_000, esFull: false, senalVentas: { valor: 100, tipo: "acumulado_sin_periodo" } }),
    ]);
    expect(resumen.volumenEtiqueta).toBe("Acumulado");
    expect(resumen.volumenValor).toBe(400);
    expect(resumen.porcentajeFull).toBe(50);
    expect(resumen.porcentajePrime).toBeNull();
  });

  it("estrellasPromedio solo sobre filas con calificación real", () => {
    const resumen = calcularResumenLocalBloque([
      producto({ plataforma: "Amazon", titulo: "A", calificacion: 5 }),
      producto({ plataforma: "Amazon", titulo: "B", calificacion: 3 }),
      producto({ plataforma: "Amazon", titulo: "C", calificacion: null }),
    ]);
    expect(resumen.estrellasPromedio).toBe(4);
  });

  it("demandaValidada exige >=5 productos Y un volumen real confirmado — nunca con pocos datos o sin ninguna señal", () => {
    const pocos = calcularResumenLocalBloque([producto({ plataforma: "Amazon", titulo: "A", senalVentas: { valor: 100, tipo: "mensual_piso" } })]);
    expect(pocos.demandaValidada).toBe(false);

    const sinSenal = calcularResumenLocalBloque(
      Array.from({ length: 6 }, (_, i) => producto({ plataforma: "Mercado Libre Colombia", titulo: `Prod ${i}` }))
    );
    expect(sinSenal.demandaValidada).toBe(false);

    const validada = calcularResumenLocalBloque(
      Array.from({ length: 6 }, (_, i) => producto({ plataforma: "Amazon", titulo: `Prod ${i}`, senalVentas: { valor: 10, tipo: "mensual_piso" } }))
    );
    expect(validada.demandaValidada).toBe(true);
  });
});
