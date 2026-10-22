import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { esConsumible } from "./consumibles";
import { leerDetalleAlerta, leerTarjetasListado } from "./html-invima";
import { calcularHallazgos, coincidenciaConAlerta, prepararAlertas, prepararProducto, resumenDeAlerta } from "./hallazgos";
import { clavesDistintivas, extraerRegistros, formatoRaro, normalizar, palabrasDelNombre, partesRegistro } from "./texto";
import type { AlertaEntrada, FilaRegistroInvima, PublicacionEntrada, RegistroEntrada } from "./tipos";

const fixtures = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../tests/fixtures/sanitarias");
const leer = (rel: string) => readFileSync(path.join(fixtures, rel), "utf8");

// Fila de datos.gov.co (ui32-p9f2) tal como la deja consultarEstadoRegistro
// en el OS: estado = estadoregistro, vence = fechavencimiento cortado a día.
// Esa función (red + tabla) no se porta en Z-NV-03a; el cálculo de hallazgos
// ya recibe el registro en esta forma.
type FilaDatosGov = {
  rsynso: string;
  producto: string;
  estadoregistro: string;
  fechavencimiento?: string | null;
  titular: string;
  grupo: string;
};

function registroDesdeDatosGov(fila: FilaDatosGov): RegistroEntrada {
  const filas: FilaRegistroInvima[] = [{
    rsynso: fila.rsynso,
    producto: fila.producto,
    estado: fila.estadoregistro,
    vence: fila.fechavencimiento?.slice(0, 10) || null,
    titular: fila.titular,
    grupo: fila.grupo,
  }];
  return { registro: fila.rsynso, estado: fila.estadoregistro, filas };
}

describe("texto y registros", () => {
  it("normaliza tildes, eñe y signos, y deja solo letras y números", () => {
    expect(normalizar("Colágeno Hidrolizado — Niños")).toBe("colageno hidrolizado ninos");
    expect(normalizar(null)).toBe("");
    expect(normalizar(undefined)).toBe("");
  });

  it("extrae los formatos del INVIMA, los deja en mayúsculas y sin espacios, y no se traba al llamarla dos veces", () => {
    const texto = "RSA-0021928-2022 y RSA-021928-2022, SD 2007-0000316, SD2019-0004387, NSOC75934-16CO, PFM2015-0001234, RSAD05I27915, INVIMA 2017DM-0017015";
    const esperado = [
      "INVIMA2017DM-0017015",
      "NSOC75934-16CO",
      "PFM2015-0001234",
      "RSA-0021928-2022",
      "RSA-021928-2022",
      "RSAD05I27915",
      "SD2007-0000316",
      "SD2019-0004387",
    ];
    expect(extraerRegistros(texto)).toEqual(esperado);
    expect(extraerRegistros(texto)).toEqual(esperado);
    expect(extraerRegistros("rsa-0021928-2022 otra vez RSA-0021928-2022")).toEqual(["RSA-0021928-2022"]);
  });

  it("reduce escrituras distintas del mismo registro a las mismas partes, y marca el número corto desde 2023", () => {
    expect(partesRegistro("RSA-0021928-2022")).toEqual(["RSA", "21928", "2022"]);
    expect(partesRegistro("RSA-021928-2022")).toEqual(["RSA", "21928", "2022"]);
    expect(partesRegistro("SD 2007-0000316")).toEqual(["SD", "316", "2007"]);
    expect(partesRegistro("SD2019-0004387")).toEqual(["SD", "4387", "2019"]);
    expect(partesRegistro("NSOC75934-16CO")).toEqual(["NSOC7593416CO", "", ""]);
    expect(partesRegistro("INVIMA 2017DM-0017015")).toEqual(["2017DM0017015", "", ""]);
    expect(partesRegistro("PFM2015-0001234")).toEqual(["PFM", "1234", "2015"]);
    expect(partesRegistro("RSAD05I27915")).toEqual(["RSAD05I27915", "", ""]);

    expect(formatoRaro("NSA-0021-2025")).toBe(true);
    expect(formatoRaro("RSA-1234-2023")).toBe(true);
    expect(formatoRaro("NSA-0021547-2026")).toBe(false);
    expect(formatoRaro("RSA-0021928-2022")).toBe(false);
    expect(formatoRaro("NSOC75934-16CO")).toBe(false);
  });

  it("quita ingredientes sueltos al armar claves, y los deja al comparar el nombre completo", () => {
    // "Resveratrol" está en catorce alertas ajenas: no puede identificar un producto.
    expect([...clavesDistintivas("Resveratrol colageno Beauty Bloom 100")]).toEqual(["beauty", "bloom"]);
    expect(clavesDistintivas("resveratrol").size).toBe(0);
    // La alerta 326-2024 es la mezcla, sin marca: el ingrediente sí importa.
    expect([...palabrasDelNombre("citrato de magnesio + citrato de potasio")]).toEqual(["citrato", "magnesio", "potasio"]);
  });
});

describe("HTML del INVIMA", () => {
  it("lee el listado real (medicamentos, dispositivos y alimentos)", () => {
    expect(leerTarjetasListado(leer("invima/listado.html"))).toEqual([
      {
        slug: "/alertas-sanitarias/alerta-sanitaria-sobre-suplementos-dietarios-sin-registro-sanitario",
        numero: "",
        direccion: "Medicamentos y productos biológicos",
        titulo: "Alerta Sanitaria sobre : SUPLEMENTOS DIETARIOS SIN REGISTRO SANITARIO",
        tipo: "Alerta sanitaria",
        fecha: "2026-10-20",
        motivo: "",
        pdf: "",
      },
      {
        slug: "/alertas-sanitarias/pumpkin-seed-oil-hair-bond-softgels",
        numero: "358-2026",
        direccion: "Medicamentos y productos biológicos",
        titulo: "PUMPKIN SEED OIL-HAIR BOND SOFTGELS",
        tipo: "Alerta sanitaria",
        fecha: "2026-10-16",
        motivo: "Producto fraudulento",
        pdf: "/alertas-sanitarias/12939/pdf",
      },
      {
        slug: "/alertas-sanitarias/cementos-oseos-con-gentamicina-heraeus-cemento-oseo-radiopaco-a-base-de-pmma-palacos-rg-pro-406080-palacos-mvg-pro-40608",
        numero: "149-2026",
        direccion: "Dispositivos médicos y otras tecnologías",
        titulo: "Cementos óseos con gentamicina Heraeus® Cemento óseo radiopaco a base de PMMA PALACOS® R+G pro 40/60/80, PALACOS® MV+G pro 40/60/80 y COPAL® G+C pro 40/80,",
        tipo: "Informe de seguridad",
        fecha: "2026-10-13",
        motivo: "",
        pdf: "/alertas-sanitarias/12905/pdf",
      },
      {
        slug: "/alertas-sanitarias/comercializacion-fraudulenta-del-producto-colageno-hidrolizado-con-marca-beauty-bloom-2",
        numero: "",
        direccion: "Alimentos y bebidas",
        titulo: "COMERCIALIZACIÓN FRAUDULENTA DEL PRODUCTO COLÁGENO HIDROLIZADO con marca “BEAUTY BLOOM”",
        tipo: "Alerta sanitaria",
        fecha: "2026-07-27",
        motivo: "Producto fraudulento",
        pdf: "/alertas-sanitarias/9985/pdf",
      },
    ]);
  });

  it("lee el detalle real de Pumpkin Seed Oil, con la descripción del problema", () => {
    const detalle = leerDetalleAlerta(leer("invima/detalle-pumpkin-seed-oil.html"));
    expect(detalle.productos).toEqual([{
      producto: "PUMPKIN SEED OIL-HAIR BOND SOFTGELS",
      registro: "Sin registro sanitario",
      titular: "—",
      lote: "—",
    }]);
    expect(detalle.problema).toHaveLength(2455);
    expect(detalle.problema.startsWith("El Instituto Nacional de Vigilancia de Medicamentos y Alimentos (Invima) advierte a la ciudadanía sobre la comercializac")).toBe(true);
    expect(detalle.problema.endsWith("principio activo.")).toBe(true);
  });

  it("deja el problema vacío cuando el INVIMA tituló «Descripción del caso»", () => {
    const detalle = leerDetalleAlerta(leer("invima/detalle-colageno-beauty-bloom.html"));
    expect(detalle.productos).toEqual([{
      producto: "COMERCIALIZACIÓN FRAUDULENTA DEL PRODUCTO COLÁGENO HIDROLIZADO con marca “BEAUTY BLOOM”",
      registro: "Sin registro sanitario",
      titular: "—",
      lote: "—",
    }]);
    expect(detalle.problema).toBe("");
  });

  it("decodifica entidades y lee varias filas de un HTML mínimo armado como el del INVIMA", () => {
    const html = `
      <tr>
        <td data-etiqueta="Producto">Caf&#233; &amp; t&#233;</td>
        <td data-etiqueta="Registro sanitario">RSA-0021928-2022</td>
        <td data-etiqueta="Titular">A &quot;B&quot;</td>
        <td data-etiqueta="Lote / Serial">L&#45;1</td>
      </tr>
      <tr>
        <td data-etiqueta="Producto">Otro</td>
        <td data-etiqueta="Registro sanitario"></td>
        <td data-etiqueta="Titular"></td>
        <td data-etiqueta="Lote / Serial"></td>
      </tr>
      <h3>Descripción del problema</h3>
      <div class="inv-alerta-bloque">Texto &quot;hola&quot;</div>`;
    expect(leerDetalleAlerta(html)).toEqual({
      productos: [
        { producto: "Café & té", registro: "RSA-0021928-2022", titular: 'A "B"', lote: "L-1" },
        { producto: "Otro", registro: "", titular: "", lote: "" },
      ],
      problema: 'Texto "hola"',
    });
  });
});

describe("consumibles por empresa", () => {
  const prefijosZilonix = ["UNM", "VITAL"];

  it("un dominio de suplemento, té o cosmético es consumible sin mirar el SKU", () => {
    expect(esConsumible("MCO-SUPPLEMENTS", "ABC")).toBe(true);
    expect(esConsumible("HERBAL_TEA", "")).toBe(true);
    expect(esConsumible("MCO-TEAS", "UNM")).toBe(false);
    expect(esConsumible("MCO-CELLPHONES", "ABC-1")).toBe(false);
    expect(esConsumible("", null)).toBe(false);
    expect(esConsumible("mco-skin_care", "x")).toBe(true);
  });

  it("UNM y VITAL no están en la lista fija: solo cuentan si la empresa los pasa", () => {
    expect(esConsumible("MCO-CELLPHONES", "UNM123")).toBe(false);
    expect(esConsumible("MCO-CELLPHONES", "vital-x")).toBe(false);
    expect(esConsumible("MCO-CELLPHONES", "UNM123", { prefijosSku: prefijosZilonix })).toBe(true);
    expect(esConsumible("MCO-CELLPHONES", "vital-x", { prefijosSku: prefijosZilonix })).toBe(true);
    expect(esConsumible("MCO-CELLPHONES", "OTRO-UNM", { prefijosSku: prefijosZilonix })).toBe(false);
    expect(esConsumible("MCO-CELLPHONES", "UNM1", { prefijosSku: ["", "  "] })).toBe(false);
    // El prefijo se compara como texto, no como expresión: "U.M" no atrapa "UAM".
    expect(esConsumible("MCO-CELLPHONES", "UAM1", { prefijosSku: ["U.M"] })).toBe(false);
    expect(esConsumible("MCO-CELLPHONES", "U.M1", { prefijosSku: ["unm", "U.M"] })).toBe(true);
  });
});

describe("hallazgos", () => {
  const filasDatos = JSON.parse(leer("datos-gov/ui32-p9f2.json")) as FilaDatosGov[];
  const porRegistro = new Map(filasDatos.map((f) => [f.rsynso, registroDesdeDatosGov(f)]));

  it("la respuesta de datos.gov.co trae los campos que el estado del registro usa", () => {
    for (const fila of filasDatos) {
      expect(fila.rsynso).toBeTruthy();
      expect(fila.producto).toBeTruthy();
      expect(fila.estadoregistro).toBeTruthy();
      expect(fila.titular).toBeTruthy();
      expect(fila.grupo).toBeTruthy();
    }
    expect(porRegistro.get("RSA-002138-2016")?.estado).toBe("Vencido");
    expect(porRegistro.get("RSA-002138-2016")?.filas?.[0]?.vence).toBe("2021-11-01");
    expect(porRegistro.get("SD2019-0004387")?.estado).toBe("Vigente");
    expect(porRegistro.get("NSOC75934-16CO")?.filas?.[0]?.grupo).toBe("COSMETICOS");
  });

  it("agrupa el mismo SKU con y sin xN, y calcula alerta, vencido, otro producto, formato raro y sin registro", () => {
    const tarjetas = leerTarjetasListado(leer("invima/listado.html"));
    const colageno = tarjetas.find((t) => t.slug.includes("colageno"));
    if (!colageno) throw new Error("el fixture del listado no trae la alerta del colágeno");
    const detalle = leerDetalleAlerta(leer("invima/detalle-colageno-beauty-bloom.html"));
    const alertaCol: AlertaEntrada = {
      ...colageno,
      productos: detalle.productos,
      problema: detalle.problema,
      con_detalle: true,
      visto: "2026-10-20T00:00:00.000Z",
    };
    const alertaReg: AlertaEntrada = {
      slug: "/alertas-sanitarias/ejemplo-registro",
      numero: "10-2024",
      direccion: "Alimentos y bebidas",
      titulo: "Alerta por registro RSA-021928-2022",
      tipo: "Alerta sanitaria",
      motivo: "Producto fraudulento",
      fecha: "2024-06-01",
      pdf: "/alertas-sanitarias/1/pdf",
      productos: [{ producto: "Batido de coco", registro: "RSA-021928-2022", titular: "NUTRITION FACTORY SAS", lote: "L1" }],
      problema: "Menciona el registro RSA-021928-2022.",
      con_detalle: true,
      visto: "2026-10-01T00:00:00.000Z",
    };
    const pubs: PublicacionEntrada[] = [
      {
        item_id: "MCO1", alias: "z", sku: "UNMRTAFULLx3", titulo: "Colageno Beauty Bloom x3",
        permalink: "https://ejemplo/1", marca: "Beauty Bloom", nombre_comercial: "Beauty Bloom",
        dominio: "MCO-SUPPLEMENTS", imagen: "https://ejemplo/a.jpg",
        registros: ["RSA-002138-2016"],
      },
      {
        item_id: "MCO2", alias: "z", sku: "UNMRTAFULL", titulo: "Colageno Beauty Bloom",
        permalink: "https://ejemplo/2", marca: "Beauty Bloom", nombre_comercial: null,
        dominio: "MCO-SUPPLEMENTS", imagen: null,
        registros: ["RSA-002138-2016"],
      },
      {
        item_id: "MCO3", alias: "otra", sku: "ABC-TEA", titulo: "Te verde generico",
        permalink: "https://ejemplo/3", marca: null, nombre_comercial: null,
        dominio: "MCO-HERBAL_TEA", imagen: null, registros: [],
      },
      {
        item_id: "MCO4", alias: "z", sku: "COCO-1", titulo: "Crema de coco nutrition factory",
        permalink: "https://ejemplo/4", marca: "Nutrition Factory", nombre_comercial: null,
        dominio: "MCO-FOODS", imagen: null, registros: ["RSA-0021928-2022"],
      },
      {
        item_id: "MCO5", alias: "z", sku: null, titulo: "Algo raro",
        permalink: "https://ejemplo/5", marca: null, nombre_comercial: null,
        dominio: "MCO-SUPPLEMENTS", imagen: null, registros: ["NSA-0021-2025"],
      },
    ];
    const queso = porRegistro.get("RSA-002138-2016");
    const coco = porRegistro.get("RSA-0021928-2022");
    if (!queso || !coco) throw new Error("faltan filas del fixture ui32-p9f2");

    const hallazgos = calcularHallazgos({
      alertas: [alertaCol, alertaReg, { ...alertaCol, slug: "/sin-detalle", con_detalle: false }],
      publicaciones: pubs,
      registros: [queso, coco, { registro: "NSA-0021-2025", estado: "NO_APARECE", filas: [] }],
      revisiones: { "vencido|RSA-002138-2016|UNMRTAFULL": { estado: "revisado", nota: "ok", por: "Franky", cuando: "2026-10-21" } },
      fotos: { "alerta|/alertas-sanitarias/ejemplo-registro|COCO-1": { veredicto: "distinto", explicacion: "otro empaque" } },
      nuevasDesde: "2026-10-10T00:00:00.000Z",
    });

    expect(hallazgos.map((h) => h.clave)).toEqual([
      "alerta|/alertas-sanitarias/comercializacion-fraudulenta-del-producto-colageno-hidrolizado-con-marca-beauty-bloom-2|UNMRTAFULL",
      "alerta|/alertas-sanitarias/ejemplo-registro|COCO-1",
      "vencido|RSA-002138-2016|UNMRTAFULL",
      "otroProducto|RSA-002138-2016|UNMRTAFULL",
      "noAparece|NSA-0021-2025|SIN SKU · MCO5",
      "sinRegistro|ABC-TEA",
    ]);

    const [porMarca, porRegistroSeguro, vencido, otro, raro, sinRegistro] = hallazgos;
    expect(porMarca.nivel).toBe("marca");
    expect(porMarca.detalle).toBe("La alerta menciona la marca Beauty Bloom. Puede ser otro producto de la misma marca.");
    expect(porMarca.alerta?.nueva).toBe(true);
    expect(porMarca.alerta?.pdf).toBe("https://www.invima.gov.co/alertas-sanitarias/9985/pdf");
    expect(porMarca.publicaciones.map((p) => p.item_id)).toEqual(["MCO1", "MCO2"]);
    expect(porMarca.imagen).toBe("https://ejemplo/a.jpg");
    expect(porMarca.titulo).toBe("Colageno Beauty Bloom x3");

    expect(porRegistroSeguro.nivel).toBe("seguro");
    expect(porRegistroSeguro.detalle).toBe("La alerta menciona el mismo registro sanitario que nuestra publicación (RSA-0021928-2022).");
    expect(porRegistroSeguro.alerta?.nueva).toBe(false);
    expect(porRegistroSeguro.foto).toEqual({ veredicto: "distinto", explicacion: "otro empaque" });

    expect(vencido.detalle).toBe("RSA-002138-2016 está vencido desde 2021-11-01 según el INVIMA.");
    expect(vencido.revision).toEqual({ estado: "revisado", nota: "ok", por: "Franky", cuando: "2026-10-21" });
    expect(vencido.invima?.producto?.startsWith("QUESO GRASO")).toBe(true);

    expect(otro.detalle).toBe(
      'En el INVIMA, RSA-002138-2016 es "QUESO GRASO, SEMI DURO DE LECHE DE BUFALA, VARIEDADES: MADURO, CURADO, SEMI CURADO, AÑEJO, GRAN CURACION, RESERVA" de SPANISH CHEESE S.L.. No se parece a nuestra publicación: puede ser un número mal escrito.',
    );
    expect(raro.nivel).toBe("raro");
    expect(raro.detalle).toContain("no sigue la numeración que usa el INVIMA desde 2023");
    expect(sinRegistro.detalle).toBe("La publicación no tiene número de registro sanitario ni en el atributo ni en la descripción. Solo se puede revisar por nombre.");
  });

  it("un registro vigente que no comparte palabras es otro producto, y uno con error no genera hallazgo", () => {
    const hallazgos = calcularHallazgos({
      alertas: [],
      publicaciones: [
        { item_id: "MCO9", alias: "a", sku: "X", titulo: "crema de coco", dominio: "MCO-FOODS", registros: ["RSA-0021928-2022", "SD2019-0004387"] },
      ],
      registros: [
        { registro: "RSA-0021928-2022", estado: "Vigente", filas: [{ producto: "QUESO DURO", titular: "X", estado: "Vigente", vence: "2027-01-01", grupo: "ALIMENTOS" }] },
        { registro: "SD2019-0004387", estado: "ERROR", filas: [] },
      ],
    });
    expect(hallazgos.map((h) => h.tipo)).toEqual(["otroProducto"]);
    expect(hallazgos[0].detalle.startsWith('En el INVIMA, RSA-0021928-2022 es "QUESO DURO" de X.')).toBe(true);
  });

  it("un registro que no aparece y sigue la numeración normal lo dice distinto del formato raro", () => {
    const hallazgos = calcularHallazgos({
      alertas: [],
      publicaciones: [{ item_id: "MCO8", alias: "a", sku: "foo x2", titulo: "t", dominio: "MCO-SUPPLEMENTS", registros: ["RSA-0021928-2024"] }],
      registros: [{ registro: "RSA-0021928-2024", estado: "NO_APARECE", filas: [] }],
    });
    expect(hallazgos.map((h) => `${h.clave}|${h.nivel}`)).toEqual(["noAparece|RSA-0021928-2024|FOO |normal"]);
    expect(hallazgos[0].detalle).toBe("RSA-0021928-2024 no aparece en la base de datos abiertos del INVIMA. Puede estar mal escrito o ser muy reciente.");
  });

  it("coincide por marca, por nombre o por nada, y una alerta sin detalle no se prepara", () => {
    const tarjetas = leerTarjetasListado(leer("invima/listado.html"));
    const colageno = tarjetas.find((t) => t.slug.includes("colageno"));
    if (!colageno) throw new Error("el fixture del listado no trae la alerta del colágeno");
    const detalle = leerDetalleAlerta(leer("invima/detalle-colageno-beauty-bloom.html"));
    const preparadas = prepararAlertas([{
      ...colageno,
      productos: detalle.productos,
      problema: detalle.problema,
      con_detalle: true,
    }]);
    expect(preparadas).toHaveLength(1);
    expect(prepararAlertas([{ slug: "/sin", con_detalle: false, titulo: "x" }])).toHaveLength(0);

    expect(coincidenciaConAlerta(
      prepararProducto({ registros: [], marcas: ["Beauty Bloom"], textos: ["crema facial"] }),
      preparadas[0],
    )).toEqual({
      nivel: "marca",
      detalle: "La alerta menciona la marca Beauty Bloom. Puede ser otro producto de la misma marca.",
    });
    expect(coincidenciaConAlerta(
      prepararProducto({ registros: [], marcas: [], textos: ["colageno hidrolizado beauty bloom"] }),
      preparadas[0],
      { quien: "el producto consultado" },
    )?.nivel).toBe("nombre");
    expect(coincidenciaConAlerta(
      prepararProducto({ registros: [], marcas: ["Otra Marca"], textos: ["shampoo comun"] }),
      preparadas[0],
    )).toBeNull();
    expect(coincidenciaConAlerta(
      prepararProducto({ registros: [], marcas: ["Resveratrol"], textos: ["vitamina"] }),
      preparadas[0],
    )).toBeNull();
  });

  it("arma la ficha de la alerta con la URL pública", () => {
    const ficha = resumenDeAlerta({
      slug: "/alertas-sanitarias/ejemplo",
      numero: "1-2024",
      fecha: "2024-01-02",
      motivo: "Producto fraudulento",
      titulo: "Ejemplo",
      direccion: "Alimentos y bebidas",
      pdf: "/alertas-sanitarias/9/pdf",
      productos: [{ producto: "Uno" }, { producto: "" }],
      visto: "2026-10-20T00:00:00.000Z",
    }, "2026-10-01T00:00:00.000Z");
    expect(ficha.url).toBe("https://www.invima.gov.co/alertas-sanitarias/ejemplo");
    expect(ficha.pdf).toBe("https://www.invima.gov.co/alertas-sanitarias/9/pdf");
    expect(ficha.productos).toEqual(["Uno"]);
    expect(ficha.nueva).toBe(true);
  });
});

// Los cinco casos reales los pasa Frankie después. Hasta entonces estos
// quedan pendientes y el PR no cierra el issue.
describe("casos reales de Frankie (pendientes)", () => {
  it.todo("registro vencido — caso real que pase Frankie");
  it.todo("alerta por nombre — caso real que pase Frankie");
  it.todo("alerta por marca — caso real que pase Frankie");
  it.todo("registro con formato raro — caso real que pase Frankie");
  it.todo("publicación no consumible — caso real que pase Frankie");
});
