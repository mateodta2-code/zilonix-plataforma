import { randomUUID } from "crypto";
import { and, eq, inArray, sql } from "drizzle-orm";
import type { db } from "@/db";
import { dbComoEmpresa } from "@/db/empresa-context";
import { auditoria, costosSku, skus, terceros } from "@/db/schema";
import { normalizarSkuCodigo } from "@/lib/costos-sku";
import { leerArchivo, leerMonto, textoDeCelda, type Celda, type FilaArchivo } from "@/lib/importar-archivo";
import { requierePermiso } from "@/lib/permisos";
import { textoAuditoriaTercero, type DatosTercero } from "@/lib/terceros";
import { CAMPOS_MAESTRA, ETIQUETAS_CAMPO, type CampoMaestra, type MapeoColumnas } from "./maestra-campos";

// Issue #128 (Z-FIN-06) — carga de la hoja PRODUCTOS de Zilonix a la
// tabla maestra (costos_sku). Crea o actualiza (upsert) por SKU y nunca
// toca `skus`. Todo o nada: si una fila tiene error, no se guarda
// ninguna. La vista previa y la confirmación corren la MISMA cuenta
// (calcularVistaPrevia); la confirmación la repite dentro de la
// transacción sobre el archivo que vuelve a llegar, nunca confía en lo
// que mostró el navegador.
//
// Reglas de celdas (#127/#128):
// - En una fila que ya existe, una celda vacía no pisa lo guardado; un
//   0 sí lo reemplaza. En una fila nueva, vacía = sin dato.
// - Precio mínimo 0 = "no aplica" (se guarda vacío).
// - Empaque y envío agencia 0 = $0 real.
// - Costo vacío = sin costo (aviso); costo 0 = costo real, sin aviso.
// - Packing igual al del proveedor no crea valor propio; distinto, sí
//   (y se marca) [SUPUESTO del issue].
// - Proveedor: si el nombre (sin distinguir mayúsculas ni espacios de
//   más) no existe en la empresa, se crea al confirmar, como
//   proveedor_producto con pago inmediato (pedido de Sharel, Refs #128).
//   Varias filas con el mismo nombre crean uno solo. Sigue siendo error
//   un nombre que coincide con dos terceros o con uno desactivado.

export { CAMPOS_MAESTRA, ETIQUETAS_CAMPO } from "./maestra-campos";
export type { CampoMaestra, MapeoColumnas } from "./maestra-campos";

// Encabezados de la hoja de Zilonix y variantes comunes, ya pasados
// por normalizarEncabezado (sin tildes, minúsculas, sin signos).
const ALIAS: Record<CampoMaestra, string[]> = {
  producto: ["producto", "nombre producto", "nombre del producto", "nombre"],
  proveedor: ["proveedor"],
  sku: ["sku", "codigo", "codigo sku", "ref", "referencia"],
  costo: ["costo producto", "costo", "costo del producto"],
  empaque: ["packing", "empaque"],
  envio_agencia: ["envio agencia", "envio a agencia", "envio"],
  precio_minimo_unidad: ["precio minimo venta 1", "precio minimo 1", "precio minimo unidad", "precio minimo x1", "minimo 1"],
  precio_minimo_combo_x2: ["precio minimo venta 2", "precio minimo 2", "precio minimo combo x2", "precio minimo x2", "minimo 2"],
  precio_minimo_combo_x3: ["precio minimo venta 3", "precio minimo 3", "precio minimo combo x3", "precio minimo x3", "minimo 3"],
  precio_venta: ["precio venta", "precio de venta"],
};

// La hoja maestra de una empresa tiene cientos de SKU; 5.000 filas de
// datos dejan margen y mantienen la transacción corta.
export const FILAS_MAXIMAS_MAESTRA = 5_000;
const LARGO_MAXIMO_PRODUCTO = 300;
// Solo para el proveedor que se crea desde el archivo: un texto más
// largo casi siempre es una celda corrida, no un nombre.
const LARGO_MAXIMO_PROVEEDOR = 120;
const TAMANO_LOTE = 500;

export function normalizarEncabezado(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function detectarMapeo(encabezados: string[]): MapeoColumnas {
  const mapeo: MapeoColumnas = {};
  const usadas = new Set<number>();
  for (const campo of CAMPOS_MAESTRA) {
    const indice = encabezados.findIndex((h, i) => !usadas.has(i) && ALIAS[campo].includes(normalizarEncabezado(h)));
    if (indice >= 0) {
      mapeo[campo] = indice;
      usadas.add(indice);
    }
  }
  return mapeo;
}

// El mapeo manual llega del navegador: se acepta solo un índice entero
// dentro del encabezado real, sin repetir columna entre dos campos.
export function validarMapeoManual(crudo: unknown, cantidadColumnas: number): MapeoColumnas | null {
  if (!crudo || typeof crudo !== "object") return null;
  const mapeo: MapeoColumnas = {};
  const usadas = new Set<number>();
  for (const campo of CAMPOS_MAESTRA) {
    const valor = (crudo as Record<string, unknown>)[campo];
    if (valor === undefined || valor === null || valor === -1) continue;
    if (typeof valor !== "number" || !Number.isInteger(valor) || valor < 0 || valor >= cantidadColumnas || usadas.has(valor)) return null;
    mapeo[campo] = valor;
    usadas.add(valor);
  }
  return mapeo;
}

type ColumnaMonto = "costo" | "empaque" | "envioAgencia" | "precioMinimoUnidad" | "precioMinimoComboX2" | "precioMinimoComboX3" | "precioVenta";

export type ValoresMaestra = {
  nombreProducto: string | null;
  terceroId: string | null;
} & Record<ColumnaMonto, string | null>;

const CAMPO_A_COLUMNA: Record<Exclude<CampoMaestra, "sku">, keyof ValoresMaestra> = {
  producto: "nombreProducto",
  proveedor: "terceroId",
  costo: "costo",
  empaque: "empaque",
  envio_agencia: "envioAgencia",
  precio_minimo_unidad: "precioMinimoUnidad",
  precio_minimo_combo_x2: "precioMinimoComboX2",
  precio_minimo_combo_x3: "precioMinimoComboX3",
  precio_venta: "precioVenta",
};

export type FilaExistente = ValoresMaestra & { id: string; skuCodigo: string };
export type ProveedorContexto = { id: string; nombre: string; activo: boolean; empaque: string | null };

export type ContextoVistaPrevia = {
  existentes: Map<string, FilaExistente>;
  proveedores: ProveedorContexto[];
  // Nombre en `skus` por código normalizado, solo para avisar si difiere.
  nombresCatalogo: Map<string, string>;
};

export type CambioCampo = { campo: CampoMaestra; anterior: string | null; nuevo: string | null };

export type FilaVistaPrevia = {
  numeroFila: number;
  sku: string;
  estado: "nueva" | "cambio" | "sin_cambios";
  cambios: CambioCampo[];
  avisos: string[];
  valores: ValoresMaestra;
  proveedorNombre: string | null;
  // Nombre del proveedor que no existe y se crea al confirmar (entonces
  // valores.terceroId sigue vacío hasta tener el id real).
  proveedorACrear: string | null;
};

export type ErrorFilaMaestra = { numeroFila: number; columna: string; mensaje: string };

export type VistaPreviaMaestra = {
  encabezados: string[];
  mapeo: MapeoColumnas;
  filas: FilaVistaPrevia[];
  errores: ErrorFilaMaestra[];
  resumen: { nuevas: number; cambios: number; sinCambios: number; conError: number; conAviso: number; proveedoresNuevos: number };
};

function centavos(monto: string): bigint {
  const [entero, fraccion = ""] = monto.split(".");
  return BigInt(entero) * BigInt(100) + BigInt((fraccion + "00").slice(0, 2));
}

function montosIguales(a: string | null, b: string | null): boolean {
  if (a === null || b === null) return a === b;
  return centavos(a) === centavos(b);
}

// Nombre tal como se guarda (sin espacios de más) y clave para comparar
// (además, sin distinguir mayúsculas).
function limpiarNombreProveedor(nombre: string): string {
  return nombre.trim().replace(/\s+/g, " ");
}

function normalizarNombreProveedor(nombre: string): string {
  return limpiarNombreProveedor(nombre).toLowerCase();
}

function vistaVacia(encabezados: string[], mapeo: MapeoColumnas, errores: ErrorFilaMaestra[]): VistaPreviaMaestra {
  return {
    encabezados,
    mapeo,
    filas: [],
    errores,
    resumen: { nuevas: 0, cambios: 0, sinCambios: 0, conError: new Set(errores.map((e) => e.numeroFila)).size, conAviso: 0, proveedoresNuevos: 0 },
  };
}

// Pura: no lee la base ni el reloj. Recibe la hoja ya leída y lo que hay
// guardado para esos SKU.
export function calcularVistaPrevia(
  hoja: FilaArchivo[],
  contexto: ContextoVistaPrevia,
  mapeoManual: MapeoColumnas | null = null
): VistaPreviaMaestra {
  const indiceEncabezado = hoja.findIndex((f) => f.celdas.some((c) => c.tipo !== "vacia"));
  if (indiceEncabezado < 0) return vistaVacia([], {}, [{ numeroFila: 1, columna: "archivo", mensaje: "El archivo está vacío." }]);

  const filaEncabezado = hoja[indiceEncabezado];
  const encabezados = filaEncabezado.celdas.map((c) => textoDeCelda(c));
  const mapeo = mapeoManual ?? detectarMapeo(encabezados);
  if (mapeo.sku === undefined) {
    return vistaVacia(encabezados, mapeo, [
      { numeroFila: filaEncabezado.numeroFila, columna: "SKU", mensaje: "No se encontró la columna SKU. Elígela en la lista de columnas." },
    ]);
  }

  const datos = hoja.slice(indiceEncabezado + 1).filter((f) => f.celdas.some((c) => c.tipo !== "vacia"));
  if (datos.length > FILAS_MAXIMAS_MAESTRA) {
    return vistaVacia(encabezados, mapeo, [
      { numeroFila: datos[FILAS_MAXIMAS_MAESTRA].numeroFila, columna: "archivo", mensaje: `El archivo supera el máximo de ${FILAS_MAXIMAS_MAESTRA} filas de datos.` },
    ]);
  }

  const proveedoresPorNombre = new Map<string, ProveedorContexto[]>();
  for (const p of contexto.proveedores) {
    const clave = normalizarNombreProveedor(p.nombre);
    proveedoresPorNombre.set(clave, [...(proveedoresPorNombre.get(clave) ?? []), p]);
  }
  const proveedoresPorId = new Map(contexto.proveedores.map((p) => [p.id, p]));
  // Clave normalizada → nombre que se va a crear: el de la primera fila
  // que lo trae, así varias filas con el mismo nombre crean uno solo.
  const proveedoresACrear = new Map<string, string>();

  const errores: ErrorFilaMaestra[] = [];
  const filas: FilaVistaPrevia[] = [];
  const filasPorSku = new Map<string, number[]>();

  const celda = (fila: FilaArchivo, campo: CampoMaestra): Celda => {
    const indice = mapeo[campo];
    return indice === undefined ? { tipo: "vacia" } : (fila.celdas[indice] ?? { tipo: "vacia" });
  };

  for (const fila of datos) {
    const { numeroFila } = fila;
    const error = (campo: CampoMaestra | "archivo", mensaje: string) =>
      errores.push({ numeroFila, columna: campo === "archivo" ? "archivo" : ETIQUETAS_CAMPO[campo], mensaje });
    const erroresAntes = errores.length;

    const skuCrudo = textoDeCelda(celda(fila, "sku"));
    if (!skuCrudo) {
      error("sku", "El SKU es obligatorio y quedó vacío.");
      continue;
    }
    const sku = normalizarSkuCodigo(skuCrudo);
    filasPorSku.set(sku, [...(filasPorSku.get(sku) ?? []), numeroFila]);

    const existente = contexto.existentes.get(sku) ?? null;
    // Punto de partida: lo guardado (fila existente) o todo vacío (nueva).
    const valores: ValoresMaestra = existente
      ? {
          nombreProducto: existente.nombreProducto,
          terceroId: existente.terceroId,
          costo: existente.costo,
          empaque: existente.empaque,
          envioAgencia: existente.envioAgencia,
          precioMinimoUnidad: existente.precioMinimoUnidad,
          precioMinimoComboX2: existente.precioMinimoComboX2,
          precioMinimoComboX3: existente.precioMinimoComboX3,
          precioVenta: existente.precioVenta,
        }
      : {
          nombreProducto: null,
          terceroId: null,
          costo: null,
          empaque: null,
          envioAgencia: null,
          precioMinimoUnidad: null,
          precioMinimoComboX2: null,
          precioMinimoComboX3: null,
          precioVenta: null,
        };
    const avisos: string[] = [];

    const producto = textoDeCelda(celda(fila, "producto"));
    if (producto) {
      if (producto.length > LARGO_MAXIMO_PRODUCTO) error("producto", `El nombre supera ${LARGO_MAXIMO_PRODUCTO} caracteres.`);
      else valores.nombreProducto = producto;
      const enCatalogo = contexto.nombresCatalogo.get(sku);
      if (enCatalogo && enCatalogo.trim() !== producto) avisos.push(`En el catálogo de SKU se llama «${enCatalogo}».`);
    }

    let proveedorACrear: string | null = null;
    const proveedorTexto = textoDeCelda(celda(fila, "proveedor"));
    if (proveedorTexto) {
      const clave = normalizarNombreProveedor(proveedorTexto);
      const candidatos = proveedoresPorNombre.get(clave) ?? [];
      if (candidatos.length === 0) {
        const nombre = limpiarNombreProveedor(proveedorTexto);
        if (nombre.length > LARGO_MAXIMO_PROVEEDOR) {
          error("proveedor", `El nombre del proveedor supera ${LARGO_MAXIMO_PROVEEDOR} caracteres.`);
        } else {
          if (!proveedoresACrear.has(clave)) proveedoresACrear.set(clave, nombre);
          proveedorACrear = proveedoresACrear.get(clave)!;
          valores.terceroId = null;
          avisos.push(`Se creará el proveedor «${proveedorACrear}».`);
        }
      } else if (candidatos.length > 1) {
        error("proveedor", `Hay más de un proveedor llamado «${proveedorTexto}». Renombra uno en Proveedores.`);
      } else if (!candidatos[0].activo) {
        error("proveedor", `El proveedor «${candidatos[0].nombre}» está desactivado.`);
      } else {
        valores.terceroId = candidatos[0].id;
      }
    }

    const montos: [CampoMaestra, ColumnaMonto][] = [
      ["costo", "costo"],
      ["envio_agencia", "envioAgencia"],
      ["precio_minimo_unidad", "precioMinimoUnidad"],
      ["precio_minimo_combo_x2", "precioMinimoComboX2"],
      ["precio_minimo_combo_x3", "precioMinimoComboX3"],
      ["precio_venta", "precioVenta"],
    ];
    for (const [campo, columna] of montos) {
      const leido = leerMonto(celda(fila, campo));
      if (leido.tipo === "error") error(campo, leido.mensaje);
      else if (leido.tipo === "monto") {
        const esPrecioMinimo = campo.startsWith("precio_minimo");
        valores[columna] = esPrecioMinimo && centavos(leido.valor) === BigInt(0) ? null : leido.valor;
      }
    }

    const packing = leerMonto(celda(fila, "empaque"));
    if (packing.tipo === "error") error("empaque", packing.mensaje);
    else if (packing.tipo === "monto") {
      const proveedor = valores.terceroId ? proveedoresPorId.get(valores.terceroId) : undefined;
      if (proveedor?.empaque != null && montosIguales(proveedor.empaque, packing.valor)) {
        valores.empaque = null; // queda "del proveedor"
      } else {
        valores.empaque = packing.valor;
        if (proveedor?.empaque != null) avisos.push(`Packing distinto al del proveedor (${proveedor.empaque}): queda propio del SKU.`);
      }
    }

    if (errores.length > erroresAntes) continue;

    if (valores.costo === null) avisos.push("Sin costo: sus ventas quedan fuera de la utilidad.");
    if (valores.costo !== null) {
      for (const [columna, etiqueta] of [
        ["precioMinimoUnidad", "x1"],
        ["precioMinimoComboX2", "x2"],
        ["precioMinimoComboX3", "x3"],
      ] as const) {
        const minimo = valores[columna];
        if (minimo !== null && centavos(minimo) < centavos(valores.costo)) avisos.push(`El precio mínimo ${etiqueta} es menor que el costo.`);
      }
    }

    const cambios: CambioCampo[] = [];
    const nombreDe = (id: string | null) => (id ? (proveedoresPorId.get(id)?.nombre ?? id) : null);
    for (const [campo, columna] of Object.entries(CAMPO_A_COLUMNA) as [Exclude<CampoMaestra, "sku">, keyof ValoresMaestra][]) {
      const anterior = existente ? existente[columna] : null;
      if (columna === "terceroId" && proveedorACrear !== null) {
        // El proveedor nuevo todavía no tiene id: siempre es un cambio.
        cambios.push({ campo, anterior: nombreDe(anterior), nuevo: proveedorACrear });
        continue;
      }
      const nuevo = valores[columna];
      const igual = columna === "nombreProducto" || columna === "terceroId" ? anterior === nuevo : montosIguales(anterior, nuevo);
      if (igual) continue;
      cambios.push(columna === "terceroId" ? { campo, anterior: nombreDe(anterior), nuevo: nombreDe(nuevo) } : { campo, anterior, nuevo });
    }

    filas.push({
      numeroFila,
      sku,
      estado: !existente ? "nueva" : cambios.length > 0 ? "cambio" : "sin_cambios",
      cambios,
      avisos,
      valores,
      proveedorNombre: proveedorACrear ?? (valores.terceroId ? (proveedoresPorId.get(valores.terceroId)?.nombre ?? null) : null),
      proveedorACrear,
    });
  }

  // El mismo SKU (ya normalizado) en dos filas bloquea la carga entera y
  // se señala en todas sus filas: ninguna sabe cuál es la buena.
  for (const [sku, numeros] of filasPorSku) {
    if (numeros.length < 2) continue;
    for (const numeroFila of numeros) {
      errores.push({ numeroFila, columna: "SKU", mensaje: `El SKU ${sku} está repetido en las filas ${numeros.join(", ")}.` });
    }
  }
  errores.sort((a, b) => a.numeroFila - b.numeroFila);

  const filasConError = new Set(errores.map((e) => e.numeroFila));
  const filasSinError = filas.filter((f) => !filasConError.has(f.numeroFila));
  return {
    encabezados,
    mapeo,
    filas: filasSinError,
    errores,
    resumen: {
      nuevas: filasSinError.filter((f) => f.estado === "nueva").length,
      cambios: filasSinError.filter((f) => f.estado === "cambio").length,
      sinCambios: filasSinError.filter((f) => f.estado === "sin_cambios").length,
      conError: filasConError.size,
      conAviso: filasSinError.filter((f) => f.avisos.length > 0).length,
      proveedoresNuevos: new Set(filasSinError.flatMap((f) => (f.proveedorACrear ? [normalizarNombreProveedor(f.proveedorACrear)] : []))).size,
    },
  };
}

export function puedeConfirmar(vista: VistaPreviaMaestra): boolean {
  return vista.errores.length === 0 && vista.resumen.nuevas + vista.resumen.cambios > 0;
}

async function cargarContexto(tx: typeof db, empresaId: string, hoja: FilaArchivo[], mapeo: MapeoColumnas): Promise<ContextoVistaPrevia> {
  const proveedores = await tx
    .select({ id: terceros.id, nombre: terceros.nombre, activo: terceros.activo, empaque: terceros.empaque })
    .from(terceros)
    .where(eq(terceros.empresaId, empresaId));

  // Solo los SKU que trae el archivo. Si el mapeo no tiene SKU, no hay
  // nada que buscar (la vista previa ya va a dar el error).
  const codigos = new Set<string>();
  if (mapeo.sku !== undefined) {
    for (const fila of hoja) {
      const texto = textoDeCelda(fila.celdas[mapeo.sku]);
      if (texto) codigos.add(normalizarSkuCodigo(texto));
    }
  }

  const existentes = new Map<string, FilaExistente>();
  const nombresCatalogo = new Map<string, string>();
  const lista = [...codigos];
  for (let i = 0; i < lista.length; i += TAMANO_LOTE) {
    const lote = lista.slice(i, i + TAMANO_LOTE);
    const filas = await tx
      .select()
      .from(costosSku)
      .where(and(eq(costosSku.empresaId, empresaId), inArray(costosSku.skuCodigo, lote)));
    for (const f of filas) existentes.set(f.skuCodigo, f);
    // skus.codigo puede estar guardado sin normalizar: se cruza por el
    // código normalizado de los dos lados [SUPUESTO de #127].
    const catalogo = await tx
      .select({ codigo: skus.codigo, nombre: skus.nombre })
      .from(skus)
      .where(and(eq(skus.empresaId, empresaId), inArray(sql`upper(btrim(${skus.codigo}))`, lote)));
    for (const s of catalogo) nombresCatalogo.set(normalizarSkuCodigo(s.codigo), s.nombre);
  }
  return { existentes, proveedores, nombresCatalogo };
}

export type ArchivoSubido = { nombre: string; contenido: Buffer };

export class ArchivoMaestraInvalidoError extends Error {
  constructor(mensaje: string) {
    super(mensaje);
    this.name = "ArchivoMaestraInvalidoError";
  }
}

export class ProveedorImportacionError extends Error {
  constructor(mensaje: string) {
    super(mensaje);
    this.name = "ProveedorImportacionError";
  }
}

export class ImportacionMaestraConErroresError extends Error {
  constructor(public readonly vista: VistaPreviaMaestra) {
    super("El archivo tiene filas con error: no se guardó ninguna. Corrígelas y vuelve a subirlo.");
    this.name = "ImportacionMaestraConErroresError";
  }
}

function leerHoja(archivo: ArchivoSubido): FilaArchivo[] {
  const hoja = leerArchivo(archivo.nombre, archivo.contenido);
  if (!hoja.ok) throw new ArchivoMaestraInvalidoError(hoja.mensaje);
  return hoja.filas;
}

function mapeoPara(hoja: FilaArchivo[], mapeoManual: unknown): MapeoColumnas | null {
  if (mapeoManual === undefined || mapeoManual === null) return null;
  const encabezado = hoja.find((f) => f.celdas.some((c) => c.tipo !== "vacia"));
  const mapeo = validarMapeoManual(mapeoManual, encabezado?.celdas.length ?? 0);
  if (!mapeo) throw new ArchivoMaestraInvalidoError("La selección de columnas no es válida: cada columna puede ir a un solo campo.");
  return mapeo;
}

// Solo lectura: nunca escribe.
export async function previsualizarImportacionMaestra(
  empresaId: string,
  usuarioId: string,
  archivo: ArchivoSubido,
  mapeoManual?: unknown
): Promise<VistaPreviaMaestra> {
  await requierePermiso(usuarioId, empresaId, "finanzas", "modificar");
  const hoja = leerHoja(archivo);
  const manual = mapeoPara(hoja, mapeoManual);
  const encabezado = hoja.find((f) => f.celdas.some((c) => c.tipo !== "vacia"));
  const mapeo = manual ?? detectarMapeo((encabezado?.celdas ?? []).map((c) => textoDeCelda(c)));
  const contexto = await dbComoEmpresa(empresaId, (tx) => cargarContexto(tx, empresaId, hoja, mapeo));
  return calcularVistaPrevia(hoja, contexto, manual);
}

export type ResultadoImportacionMaestra = { nuevas: number; actualizadas: number; sinCambios: number; proveedoresCreados: number };

// Crea, dentro de la transacción de la importación, los proveedores que
// el archivo nombra y la empresa no tiene. Devuelve clave normalizada →
// id. Si alguien creó el mismo nombre a mano en medio (choca el UNIQUE
// empresa + nombre), se usa ese y no se duplica; si ese está desactivado,
// la carga entera se cancela con un error claro.
async function crearProveedoresDelArchivo(
  tx: typeof db,
  empresaId: string,
  usuarioId: string,
  filas: FilaVistaPrevia[],
  filasAuditoria: (typeof auditoria.$inferInsert)[]
): Promise<Map<string, string>> {
  const nombres = new Map<string, string>();
  for (const f of filas) {
    if (f.proveedorACrear) nombres.set(normalizarNombreProveedor(f.proveedorACrear), f.proveedorACrear);
  }
  const ids = new Map<string, string>();
  for (const [clave, nombre] of nombres) {
    // [SUPUESTO] proveedor de producto con pago inmediato y sin packing
    // propio: el resto se completa después en Proveedores.
    const datos: DatosTercero = {
      nombre,
      tipo: "proveedor_producto",
      empaque: null,
      condicionPago: "inmediato",
      periodicidad: null,
      plazoDias: null,
      predeterminadoEnvioAgencia: false,
      predeterminadoEmpaque: false,
      predeterminadoFlex: false,
    };
    const [creado] = await tx
      .insert(terceros)
      .values({ empresaId, ...datos, activo: true, actualizadoPor: usuarioId })
      .onConflictDoNothing({ target: [terceros.empresaId, terceros.nombre] })
      .returning({ id: terceros.id });
    if (creado) {
      ids.set(clave, creado.id);
      filasAuditoria.push({
        id: randomUUID(),
        empresaId,
        usuarioId,
        actorTipo: "persona",
        accion: "crear",
        entidad: "tercero",
        entidadId: creado.id,
        detalle: `Creó el tercero «${nombre}» (desde importación maestra).`,
        valorNuevo: textoAuditoriaTercero(datos),
      });
      continue;
    }
    const [existente] = await tx
      .select({ id: terceros.id, activo: terceros.activo })
      .from(terceros)
      .where(and(eq(terceros.empresaId, empresaId), eq(terceros.nombre, nombre)));
    if (!existente) throw new ProveedorImportacionError(`No se pudo crear el proveedor «${nombre}». Vuelve a intentarlo.`);
    if (!existente.activo) throw new ProveedorImportacionError(`El proveedor «${nombre}» se acaba de crear desactivado en Proveedores. Actívalo o cambia el nombre en el archivo.`);
    ids.set(clave, existente.id);
  }
  return ids;
}

function textoValores(valores: Partial<Record<string, string | null>>): string {
  return Object.entries(valores)
    .map(([campo, valor]) => `${campo}=${valor ?? ""}`)
    .join(" ");
}

export async function confirmarImportacionMaestra(
  empresaId: string,
  usuarioId: string,
  archivo: ArchivoSubido,
  mapeoManual?: unknown
): Promise<ResultadoImportacionMaestra> {
  await requierePermiso(usuarioId, empresaId, "finanzas", "modificar");
  const hoja = leerHoja(archivo);
  const manual = mapeoPara(hoja, mapeoManual);
  const encabezado = hoja.find((f) => f.celdas.some((c) => c.tipo !== "vacia"));
  const mapeo = manual ?? detectarMapeo((encabezado?.celdas ?? []).map((c) => textoDeCelda(c)));

  return dbComoEmpresa(empresaId, async (tx) => {
    // Se recalcula adentro de la transacción: si alguien cambió la
    // maestra entre la vista previa y este clic, cuenta lo de ahora.
    const contexto = await cargarContexto(tx, empresaId, hoja, mapeo);
    const vista = calcularVistaPrevia(hoja, contexto, manual);
    if (vista.errores.length > 0) throw new ImportacionMaestraConErroresError(vista);

    const ahora = new Date();
    const filasAuditoria: (typeof auditoria.$inferInsert)[] = [];

    // Primero los proveedores nuevos, para tener su id antes del upsert
    // de costos_sku.
    const idsProveedores = await crearProveedoresDelArchivo(tx, empresaId, usuarioId, vista.filas, filasAuditoria);
    for (const f of vista.filas) {
      if (f.proveedorACrear) f.valores.terceroId = idsProveedores.get(normalizarNombreProveedor(f.proveedorACrear)) ?? null;
    }

    const nuevas = vista.filas.filter((f) => f.estado === "nueva");
    const cambiadas = vista.filas.filter((f) => f.estado === "cambio");

    for (let i = 0; i < nuevas.length; i += TAMANO_LOTE) {
      const lote = nuevas.slice(i, i + TAMANO_LOTE);
      const insertadas = await tx
        .insert(costosSku)
        .values(lote.map((f) => ({ empresaId, skuCodigo: f.sku, ...f.valores, fuente: "archivo" as const, actualizadoPor: usuarioId })))
        .returning({ id: costosSku.id, skuCodigo: costosSku.skuCodigo });
      const idPorSku = new Map(insertadas.map((f) => [f.skuCodigo, f.id]));
      for (const f of lote) {
        filasAuditoria.push({
          id: randomUUID(),
          empresaId,
          usuarioId,
          actorTipo: "persona",
          accion: "crear",
          entidad: "costo_sku",
          entidadId: idPorSku.get(f.sku),
          detalle: `Cargó los costos del SKU ${f.sku} (desde archivo).`,
          valorNuevo: textoValores(Object.fromEntries(f.cambios.map((c) => [c.campo, c.nuevo]))),
        });
      }
    }

    for (const f of cambiadas) {
      const existente = contexto.existentes.get(f.sku)!;
      await tx
        .update(costosSku)
        .set({ ...f.valores, fuente: "archivo", actualizadoTs: ahora, actualizadoPor: usuarioId })
        .where(eq(costosSku.id, existente.id));
      filasAuditoria.push({
        id: randomUUID(),
        empresaId,
        usuarioId,
        actorTipo: "persona",
        accion: "modificar",
        entidad: "costo_sku",
        entidadId: existente.id,
        detalle: `Cambió los costos del SKU ${f.sku} (desde archivo).`,
        valorAnterior: textoValores(Object.fromEntries(f.cambios.map((c) => [c.campo, c.anterior]))),
        valorNuevo: textoValores(Object.fromEntries(f.cambios.map((c) => [c.campo, c.nuevo]))),
      });
    }

    filasAuditoria.push({
      id: randomUUID(),
      empresaId,
      usuarioId,
      actorTipo: "persona",
      accion: "importar_maestra_sku",
      entidad: "costo_sku",
      // Nunca el contenido del archivo, solo el resumen.
      detalle: `Cargó la tabla maestra desde ${archivo.nombre.endsWith(".csv") ? "CSV" : "Excel"}: ${nuevas.length} nueva(s), ${cambiadas.length} cambiada(s), ${vista.resumen.sinCambios} sin cambios, ${idsProveedores.size} proveedor(es) nuevo(s).`,
    });
    for (let i = 0; i < filasAuditoria.length; i += TAMANO_LOTE) {
      await tx.insert(auditoria).values(filasAuditoria.slice(i, i + TAMANO_LOTE));
    }

    return { nuevas: nuevas.length, actualizadas: cambiadas.length, sinCambios: vista.resumen.sinCambios, proveedoresCreados: filasAuditoria.filter((a) => a.entidad === "tercero").length };
  });
}
