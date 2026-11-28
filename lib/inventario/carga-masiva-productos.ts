import { and, eq, inArray, sql } from "drizzle-orm";
import { dbComoEmpresa } from "@/db/empresa-context";
import { auditoria, skus } from "@/db/schema";
import { registrarAuditoria } from "@/lib/auditoria";
import { requierePermiso } from "@/lib/permisos";
import { leerArchivo, leerMonto, TAMANO_MAXIMO_ARCHIVO, type Celda, type FilaArchivo } from "@/lib/importar-archivo";
import { CANTIDAD_INICIAL_MAXIMA, detectarDelimitador, partirFilasLogicas, separarCamposCsv } from "@/lib/importar-csv-skus";
import {
  asignarSkusAleatorios,
  bodegaActivaTx,
  crearProductoTx,
  esChoqueDeSkuGenerado,
  LARGO_MAXIMO_NOMBRE,
  mayorNumeroSkuAleatorioTx,
  numeroDeSkuAleatorio,
  validarCodigoManual,
} from "@/lib/inventario/crear-producto";

// Issue #280 — carga masiva de «Crear producto (SKU)»: pegar texto
// (sku;nombre;costo;precio;stock) o subir .csv/.xlsx. A diferencia de
// /panel/sku/importar (lib/ml/sku-importar.ts, que se deja quieto),
// esta trae costo y precio y NUNCA actualiza un SKU que ya existe: lo
// marca como error. El alta de cada línea pasa por crearProductoTx, la
// misma función del formulario de un producto.

type Tx = Parameters<Parameters<typeof dbComoEmpresa>[1]>[0];

export const MAXIMO_PRODUCTOS_CARGA_MASIVA = 1000;
const TAMANO_LOTE_CONSULTA = 1000;
const REINTENTOS_CHOQUE = 3;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class CargaMasivaInvalidaError extends Error {
  constructor(mensaje: string) {
    super(mensaje);
    this.name = "CargaMasivaInvalidaError";
  }
}

// ---------- Entrada: texto pegado → mismas celdas que un archivo ----------

const VACIA: Celda = { tipo: "vacia" };

// Separador en la primera línea no vacía: tabulación (lo que pega
// Excel) > «;» > «,».
export function delimitadorDeLinea(linea: string): string {
  if (linea.includes("\t")) return "\t";
  return detectarDelimitador(linea);
}

export function filasDeTextoPegado(texto: string): { ok: true; filas: FilaArchivo[] } | { ok: false; mensaje: string } {
  if (texto.length > TAMANO_MAXIMO_ARCHIVO) {
    return { ok: false, mensaje: `El texto supera el tamaño máximo de ${TAMANO_MAXIMO_ARCHIVO / (1024 * 1024)} MB.` };
  }
  const limpio = texto.replace(/^﻿/, "");
  const partidas = partirFilasLogicas(limpio);
  if (!partidas.ok) return { ok: false, mensaje: `Hay demasiadas líneas: el máximo es ${MAXIMO_PRODUCTOS_CARGA_MASIVA} productos por carga.` };
  const primera = partidas.filas.find((f) => f.raw.trim() !== "");
  const delimitador = primera ? delimitadorDeLinea(primera.raw) : ";";
  return {
    ok: true,
    filas: partidas.filas.map((f) => ({
      numeroFila: f.numeroFila,
      celdas: separarCamposCsv(f.raw, delimitador).map((c): Celda => (c.trim() === "" ? VACIA : { tipo: "texto", valor: c.trim() })),
    })),
  };
}

export function filasDeArchivo(nombre: string, contenido: Buffer): { ok: true; filas: FilaArchivo[] } | { ok: false; mensaje: string } {
  const hoja = leerArchivo(nombre, contenido);
  return hoja.ok ? { ok: true, filas: hoja.filas } : { ok: false, mensaje: hoja.mensaje };
}

// ---------- Parser puro ----------

export type FilaProductoCarga = {
  numeroLinea: number;
  codigo: string | null; // null = se genera (FUL + 3 letras + 4 números)
  nombre: string;
  costo: string | null;
  precioVenta: string | null;
  stockInicial: number;
};

export type ErrorLineaCarga = { numeroLinea: number; columna: string; mensaje: string };

// Lo que se muestra de cada línea, sea válida o no.
export type LineaCarga = {
  numeroLinea: number;
  sku: string;
  nombre: string;
  costo: string;
  precio: string;
  stock: string;
  fila: FilaProductoCarga | null;
  motivos: string[];
};

export type ResultadoParseoCarga = {
  lineas: LineaCarga[];
  filas: FilaProductoCarga[];
  errores: ErrorLineaCarga[];
  columnasIgnoradas: string[];
  rechazo: string | null; // la carga entera no se procesa (ej. más de 1000 productos)
};

type Columna = "sku" | "nombre" | "costo" | "precio" | "stock";
const ORDEN_SIN_ENCABEZADO: Columna[] = ["sku", "nombre", "costo", "precio", "stock"];
const ALIAS: Record<string, Columna> = {
  sku: "sku",
  codigo: "sku",
  nombre: "nombre",
  costo: "costo",
  precio: "precio",
  precio_venta: "precio",
  precio_de_venta: "precio",
  stock: "stock",
  stock_inicial: "stock",
  cantidad: "stock",
  cantidad_inicial: "stock",
};

function textoCelda(celda: Celda | undefined): string {
  return !celda || celda.tipo === "vacia" ? "" : celda.valor.trim();
}

function normalizarEncabezado(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_");
}

function filaVacia(fila: FilaArchivo): boolean {
  return fila.celdas.every((c) => textoCelda(c) === "");
}

function leerStock(celda: Celda | undefined): { ok: true; valor: number } | { ok: false; mensaje: string } {
  const texto = textoCelda(celda);
  if (texto === "") return { ok: true, valor: 0 };
  if (texto.startsWith("-")) return { ok: false, mensaje: `El stock "${texto}" es negativo.` };
  if (!/^\d+$/.test(texto)) return { ok: false, mensaje: `El stock "${texto}" tiene que ser un número entero (sin decimales).` };
  // Más de 7 dígitos ya pasa el tope: no se llega a Number con un número enorme.
  const sinCeros = texto.replace(/^0+(?=\d)/, "");
  if (sinCeros.length > 7 || Number(sinCeros) > CANTIDAD_INICIAL_MAXIMA) {
    return { ok: false, mensaje: `El stock "${texto}" pasa el máximo de ${CANTIDAD_INICIAL_MAXIMA.toLocaleString("es-CO")}.` };
  }
  return { ok: true, valor: Number(sinCeros) };
}

export function parsearCargaMasivaProductos(entrada: FilaArchivo[]): ResultadoParseoCarga {
  const conDatos = entrada.filter((f) => !filaVacia(f));
  const vacio: ResultadoParseoCarga = { lineas: [], filas: [], errores: [], columnasIgnoradas: [], rechazo: null };
  if (conDatos.length === 0) return { ...vacio, rechazo: "No hay ninguna línea para cargar." };

  // Encabezado opcional: si la primera línea trae la palabra «nombre».
  const primera = conDatos[0];
  const esEncabezado = primera.celdas.some((c) => normalizarEncabezado(textoCelda(c)) === "nombre");
  const posiciones = new Map<Columna, number>();
  const columnasIgnoradas: string[] = [];
  if (esEncabezado) {
    primera.celdas.forEach((c, i) => {
      const texto = textoCelda(c);
      if (!texto) return;
      const columna = ALIAS[normalizarEncabezado(texto)];
      if (columna && !posiciones.has(columna)) posiciones.set(columna, i);
      else columnasIgnoradas.push(texto);
    });
  } else {
    ORDEN_SIN_ENCABEZADO.forEach((c, i) => posiciones.set(c, i));
  }
  const datos = esEncabezado ? conDatos.slice(1) : conDatos;
  if (datos.length === 0) return { ...vacio, columnasIgnoradas, rechazo: "Solo llegó el encabezado: no hay productos para cargar." };
  if (datos.length > MAXIMO_PRODUCTOS_CARGA_MASIVA) {
    return {
      ...vacio,
      columnasIgnoradas,
      rechazo: `La carga tiene ${datos.length} productos y el máximo es ${MAXIMO_PRODUCTOS_CARGA_MASIVA} por carga: pártela en varias.`,
    };
  }

  if (!esEncabezado) {
    let mayorColumna = 0;
    for (const f of datos) f.celdas.forEach((c, i) => { if (i >= ORDEN_SIN_ENCABEZADO.length && textoCelda(c)) mayorColumna = Math.max(mayorColumna, i); });
    for (let i = ORDEN_SIN_ENCABEZADO.length; i <= mayorColumna; i++) columnasIgnoradas.push(`columna ${i + 1}`);
  }

  const celda = (f: FilaArchivo, columna: Columna): Celda | undefined => {
    const i = posiciones.get(columna);
    return i === undefined ? undefined : f.celdas[i];
  };

  const vistos = new Set<string>();
  const lineas: LineaCarga[] = [];
  const errores: ErrorLineaCarga[] = [];
  for (const f of datos) {
    const motivos: string[] = [];
    const error = (columna: string, mensaje: string) => {
      motivos.push(mensaje);
      errores.push({ numeroLinea: f.numeroFila, columna, mensaje });
    };

    const nombre = textoCelda(celda(f, "nombre")).replace(/\s+/g, " ");
    if (!nombre) error("nombre", "Falta el nombre del producto.");
    else if (nombre.length > LARGO_MAXIMO_NOMBRE) error("nombre", `El nombre pasa de ${LARGO_MAXIMO_NOMBRE} caracteres.`);

    const skuTexto = textoCelda(celda(f, "sku"));
    let codigo: string | null = null;
    if (skuTexto) {
      try {
        codigo = validarCodigoManual(skuTexto);
        if (vistos.has(codigo)) error("sku", `El SKU "${codigo}" está repetido en esta carga.`);
        vistos.add(codigo);
      } catch (e) {
        error("sku", (e as Error).message);
      }
    }

    const montos: Record<"costo" | "precio", string | null> = { costo: null, precio: null };
    for (const columna of ["costo", "precio"] as const) {
      const leido = leerMonto(celda(f, columna) ?? VACIA);
      if (leido.tipo === "error") error(columna, `${columna === "costo" ? "Costo" : "Precio"}: ${leido.mensaje}`);
      else if (leido.tipo === "monto") montos[columna] = leido.valor;
    }

    const stock = leerStock(celda(f, "stock"));
    if (!stock.ok) error("stock", stock.mensaje);

    const fila: FilaProductoCarga | null =
      motivos.length === 0
        ? { numeroLinea: f.numeroFila, codigo, nombre, costo: montos.costo, precioVenta: montos.precio, stockInicial: stock.ok ? stock.valor : 0 }
        : null;
    lineas.push({
      numeroLinea: f.numeroFila,
      sku: skuTexto,
      nombre,
      costo: textoCelda(celda(f, "costo")),
      precio: textoCelda(celda(f, "precio")),
      stock: textoCelda(celda(f, "stock")),
      fila,
      motivos,
    });
  }

  return { lineas, filas: lineas.flatMap((l) => (l.fila ? [l.fila] : [])), errores, columnasIgnoradas, rechazo: null };
}

// ---------- Con base ----------

export type LineaVistaCarga = {
  numeroLinea: number;
  codigo: string;
  automatico: boolean;
  nombre: string;
  costo: string | null; // monto ya leído (válidas) o el texto original (con error)
  precio: string | null;
  stock: string;
  estado: "nuevo" | "error";
  motivos: string[];
};

export type VistaPreviaCarga = {
  lineas: LineaVistaCarga[];
  resumen: { listas: number; conError: number; unidades: number };
  columnasIgnoradas: string[];
  rechazo: string | null;
  bodegaNombre: string | null;
};

type FilaResuelta = FilaProductoCarga & { codigoFinal: string; automatico: boolean };

// Valida lo que necesita la base (bodega, SKU que ya existen) y asigna
// los códigos automáticos: el número que se ve en la vista previa es
// orientativo, al confirmar se vuelve a calcular.
async function resolverCargaTx(tx: Tx, empresaId: string, parseo: ResultadoParseoCarga, bodegaId: string) {
  const bodega = bodegaId ? await bodegaActivaTx(tx, empresaId, bodegaId) : null;
  const motivosExtra = new Map<number, string[]>();
  const agregar = (linea: number, mensaje: string) => motivosExtra.set(linea, [...(motivosExtra.get(linea) ?? []), mensaje]);

  const manuales = parseo.filas.filter((f) => f.codigo !== null).map((f) => f.codigo!);
  const existentes = new Map<string, string>();
  for (let i = 0; i < manuales.length; i += TAMANO_LOTE_CONSULTA) {
    const lote = manuales.slice(i, i + TAMANO_LOTE_CONSULTA);
    const filas = await tx
      .select({ codigo: sql<string>`upper(btrim(${skus.codigo}))`, nombre: skus.nombre })
      .from(skus)
      .where(and(eq(skus.empresaId, empresaId), inArray(sql`upper(btrim(${skus.codigo}))`, lote)));
    filas.forEach((f) => existentes.set(f.codigo, f.nombre));
  }

  for (const f of parseo.filas) {
    if (f.codigo && existentes.has(f.codigo)) {
      agregar(f.numeroLinea, `Ya existe un SKU con el código "${f.codigo}" (producto: ${existentes.get(f.codigo)}). Esta carga no actualiza productos.`);
    }
    if (f.stockInicial > 0 && !bodegaId) agregar(f.numeroLinea, "Tiene stock inicial: elige la bodega de la carga.");
    else if (f.stockInicial > 0 && !bodega) agregar(f.numeroLinea, "La bodega elegida no existe o está desactivada.");
  }

  const validas = parseo.filas.filter((f) => !motivosExtra.has(f.numeroLinea));
  // Mismo orden que la confirmación: primero se crean los manuales,
  // después los automáticos, así el contador arranca después del mayor
  // número que ya exista (en la base o entre los manuales de la carga).
  const numerosManuales = validas.map((f) => (f.codigo ? numeroDeSkuAleatorio(f.codigo) ?? 0 : 0));
  const primerNumero = Math.max(await mayorNumeroSkuAleatorioTx(tx, empresaId), ...numerosManuales, 0) + 1;
  const automaticas = validas.filter((f) => f.codigo === null);
  let codigosAuto: string[] = [];
  try {
    codigosAuto = asignarSkusAleatorios(
      automaticas.map((f) => f.nombre),
      primerNumero,
      new Set(validas.flatMap((f) => (f.codigo ? [f.codigo] : [])))
    );
  } catch (e) {
    automaticas.forEach((f) => agregar(f.numeroLinea, (e as Error).message));
  }
  const autoPorLinea = new Map(automaticas.map((f, i) => [f.numeroLinea, codigosAuto[i]]));

  const resueltas: FilaResuelta[] = parseo.filas
    .filter((f) => !motivosExtra.has(f.numeroLinea))
    .map((f) => ({ ...f, codigoFinal: f.codigo ?? autoPorLinea.get(f.numeroLinea)!, automatico: f.codigo === null }));
  return { resueltas, motivosExtra, bodega };
}

function armarVista(parseo: ResultadoParseoCarga, resueltas: FilaResuelta[], motivosExtra: Map<number, string[]>, bodegaNombre: string | null): VistaPreviaCarga {
  const porLinea = new Map(resueltas.map((r) => [r.numeroLinea, r]));
  const lineas: LineaVistaCarga[] = parseo.lineas.map((l) => {
    const r = porLinea.get(l.numeroLinea);
    const motivos = [...l.motivos, ...(motivosExtra.get(l.numeroLinea) ?? [])];
    return r && motivos.length === 0
      ? { numeroLinea: l.numeroLinea, codigo: r.codigoFinal, automatico: r.automatico, nombre: r.nombre, costo: r.costo, precio: r.precioVenta, stock: String(r.stockInicial), estado: "nuevo", motivos: [] }
      : { numeroLinea: l.numeroLinea, codigo: l.sku, automatico: !l.sku, nombre: l.nombre, costo: l.costo || null, precio: l.precio || null, stock: l.stock, estado: "error", motivos };
  });
  return {
    lineas,
    resumen: {
      listas: resueltas.length,
      conError: lineas.filter((l) => l.estado === "error").length,
      unidades: resueltas.reduce((s, r) => s + r.stockInicial, 0),
    },
    columnasIgnoradas: parseo.columnasIgnoradas,
    rechazo: null,
    bodegaNombre,
  };
}

// Vista previa: SOLO lectura.
export async function previsualizarCargaMasivaProductos(
  empresaId: string,
  usuarioId: string,
  entrada: FilaArchivo[],
  bodegaId: string
): Promise<VistaPreviaCarga> {
  await requierePermiso(usuarioId, empresaId, "inventario", "crear");
  const parseo = parsearCargaMasivaProductos(entrada);
  if (parseo.rechazo) {
    return { lineas: [], resumen: { listas: 0, conError: 0, unidades: 0 }, columnasIgnoradas: parseo.columnasIgnoradas, rechazo: parseo.rechazo, bodegaNombre: null };
  }
  return dbComoEmpresa(empresaId, async (tx) => {
    const { resueltas, motivosExtra, bodega } = await resolverCargaTx(tx, empresaId, parseo, bodegaId);
    return armarVista(parseo, resueltas, motivosExtra, bodega?.nombre ?? null);
  });
}

export type ResultadoCargaMasiva = { creados: number; unidades: number; omitidos: number; yaConfirmada?: boolean };

// Confirmar: vuelve a parsear y validar TODO desde cero (nunca confía en
// las filas que dijo el navegador) y crea todo en UNA transacción; si
// algo falla, no queda nada. cargaId (generado al pintar la vista
// previa) evita que un doble clic cree la carga dos veces.
export async function confirmarCargaMasivaProductos(
  empresaId: string,
  usuarioId: string,
  entrada: FilaArchivo[],
  bodegaId: string,
  cargaId: string
): Promise<ResultadoCargaMasiva> {
  await requierePermiso(usuarioId, empresaId, "inventario", "crear");
  if (!UUID_RE.test(cargaId)) throw new CargaMasivaInvalidaError("La vista previa está vencida: vuelve a generarla.");
  const parseo = parsearCargaMasivaProductos(entrada);
  if (parseo.rechazo) throw new CargaMasivaInvalidaError(parseo.rechazo);

  for (let intento = 0; ; intento++) {
    try {
      return await dbComoEmpresa(empresaId, async (tx) => {
        await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`carga-productos:${empresaId}:${cargaId}`}))`);
        const [previa] = await tx
          .select({ valorNuevo: auditoria.valorNuevo })
          .from(auditoria)
          .where(and(eq(auditoria.empresaId, empresaId), eq(auditoria.accion, "carga_masiva_productos"), eq(auditoria.entidadId, cargaId)))
          .limit(1);
        if (previa) return { ...(JSON.parse(previa.valorNuevo ?? "{}") as ResultadoCargaMasiva), yaConfirmada: true };

        const { resueltas } = await resolverCargaTx(tx, empresaId, parseo, bodegaId);
        if (resueltas.length === 0) throw new CargaMasivaInvalidaError("No hay ninguna línea válida para crear: revisa los errores.");

        // Manuales primero, automáticos después (mismo orden que la
        // vista previa). Los automáticos se recalculan acá dentro.
        const ordenadas = [...resueltas.filter((r) => !r.automatico), ...resueltas.filter((r) => r.automatico)];
        let unidades = 0;
        for (const r of ordenadas) {
          await crearProductoTx(tx, empresaId, usuarioId, {
            codigo: r.automatico ? undefined : r.codigoFinal,
            nombre: r.nombre,
            costo: r.costo,
            precioVenta: r.precioVenta,
            stockInicial: r.stockInicial,
            bodegaId: r.stockInicial > 0 ? bodegaId : null,
            operacionId: `${cargaId}:${r.numeroLinea}`,
          });
          unidades += r.stockInicial;
        }
        const omitidos = parseo.lineas.length - resueltas.length;
        const resultado: ResultadoCargaMasiva = { creados: resueltas.length, unidades, omitidos };

        await registrarAuditoria(tx, {
          empresaId,
          usuarioId,
          actorTipo: "persona",
          accion: "carga_masiva_productos",
          entidad: "carga_productos",
          entidadId: cargaId,
          // Nunca el contenido de la carga: solo el resumen.
          detalle: `Carga masiva de productos: ${resultado.creados} creado(s), ${unidades} unidad(es) de inventario inicial, ${omitidos} omitido(s) por error.`,
          valorNuevo: JSON.stringify(resultado),
        });
        return resultado;
      });
    } catch (error) {
      if (esChoqueDeSkuGenerado(error) && intento < REINTENTOS_CHOQUE) continue;
      if (esChoqueDeSkuGenerado(error)) throw new CargaMasivaInvalidaError("Otra persona está creando SKU al mismo tiempo: intenta de nuevo.");
      throw error;
    }
  }
}
