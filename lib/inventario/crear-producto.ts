import { and, desc, eq, ilike, inArray, like, ne, or, sql } from "drizzle-orm";
import { dbComoEmpresa } from "@/db/empresa-context";
import { auditoria, bodegas, costosSku, kardexMovimientos, skus, stockBodega } from "@/db/schema";
import { registrarAuditoria } from "@/lib/auditoria";
import { acotarPagina, parsearPagina, patronBusquedaLike } from "@/lib/filtros-listado";
import { CANTIDAD_INICIAL_MAXIMA } from "@/lib/importar-csv-skus";
import { aplicarMovimientosTx } from "@/lib/inventario/movimientos";
import { SkuCodigoDuplicadoError } from "@/lib/ml/sku";

// Issue #280 — «Crear producto (SKU)»: la función OFICIAL para dar de
// alta un producto (SKU + costo/precio en costos_sku + stock inicial al
// kardex). La usan el formulario de /panel/sku/crear y la carga masiva;
// Registro de compras tiene que reutilizar crearProductoTx en vez de
// copiar esta lógica. Sin migración: el stock inicial entra con origen
// "manual" y nota «Inventario inicial» (el enum del kardex no tiene un
// origen propio todavía).

type Tx = Parameters<Parameters<typeof dbComoEmpresa>[1]>[0];

export const NOTA_INVENTARIO_INICIAL = "Inventario inicial";
export const LARGO_MAXIMO_NOMBRE = 200;
export const LARGO_MAXIMO_CODIGO = 60;
export const NUMERO_MAXIMO_SKU_ALEATORIO = 9999;
const PREFIJO_FIJO = "FUL";
// Texto fijo (nunca datos de la persona): el formato del SKU aleatorio.
const FORMATO_SKU_ALEATORIO = /^FUL[A-Z]{3}[0-9]{4}$/;
const RESTRICCION_CODIGO_UNICO = "skus_empresa_codigo_unico";
const REINTENTOS_CHOQUE = 3;
const TAMANO_PAGINA = 25;

// ---------- Errores de la persona (vuelven como aviso) ----------

export class ProductoInvalidoError extends Error {
  constructor(mensaje: string) {
    super(mensaje);
    this.name = "ProductoInvalidoError";
  }
}

export class SkuCodigoInvalidoFormatoError extends Error {
  constructor(mensaje: string) {
    super(mensaje);
    this.name = "SkuCodigoInvalidoFormatoError";
  }
}

export class SkuAleatorioAgotadoError extends Error {
  constructor() {
    super(`Se acabaron los números de SKU aleatorio (${NUMERO_MAXIMO_SKU_ALEATORIO}); usa un SKU manual.`);
    this.name = "SkuAleatorioAgotadoError";
  }
}

// Hereda de la clase que ya usa /panel/sku, con el mensaje que pide
// esta pantalla (dice de qué producto es el código repetido).
export class SkuYaExisteError extends SkuCodigoDuplicadoError {
  constructor(codigo: string, nombreProducto?: string | null) {
    super(codigo);
    this.message = `Ya existe un SKU con el código "${codigo}" en tu empresa${nombreProducto ? ` (producto: ${nombreProducto})` : ""}.`;
    this.name = "SkuYaExisteError";
  }
}

export class CodigoBloqueadoError extends Error {
  constructor() {
    super("El código ya no se puede cambiar porque este SKU tiene movimientos de inventario. El nombre sí.");
    this.name = "CodigoBloqueadoError";
  }
}

export function esErrorDeProducto(error: unknown): error is Error {
  return (
    error instanceof ProductoInvalidoError ||
    error instanceof SkuCodigoInvalidoFormatoError ||
    error instanceof SkuAleatorioAgotadoError ||
    error instanceof SkuCodigoDuplicadoError ||
    error instanceof CodigoBloqueadoError
  );
}

// Choque de un código GENERADO con el índice único (dos personas a la
// vez): uso interno, dispara el reintento con el siguiente número.
class ChoqueSkuGeneradoError extends Error {}

export function esChoqueDeSkuGenerado(error: unknown): boolean {
  return error instanceof ChoqueSkuGeneradoError;
}

// ---------- Generador de SKU aleatorio (puro) ----------

// «FUL» + 3 primeras letras del nombre (sin tildes, ñ → N), completadas
// con X si el nombre trae menos de 3.
export function prefijoSkuAleatorio(nombre: string): string {
  const letras = nombre
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(/[^A-Z]/g, "")
    .slice(0, 3);
  return letras.padEnd(3, "X");
}

export function formatearSkuAleatorio(nombre: string, numero: number): string {
  if (!Number.isSafeInteger(numero) || numero < 1 || numero > NUMERO_MAXIMO_SKU_ALEATORIO) throw new SkuAleatorioAgotadoError();
  return `${PREFIJO_FIJO}${prefijoSkuAleatorio(nombre)}${String(numero).padStart(4, "0")}`;
}

export function numeroDeSkuAleatorio(codigo: string): number | null {
  const normalizado = codigo.trim().toUpperCase();
  return FORMATO_SKU_ALEATORIO.test(normalizado) ? Number(normalizado.slice(6)) : null;
}

// Un solo contador por empresa (no uno por prefijo): el mayor número de
// los códigos con formato FUL+3 letras+4 dígitos, más 1.
export function siguienteNumeroSku(codigosExistentes: string[]): number {
  let mayor = 0;
  for (const codigo of codigosExistentes) {
    const numero = numeroDeSkuAleatorio(codigo);
    if (numero !== null && numero > mayor) mayor = numero;
  }
  const siguiente = mayor + 1;
  if (siguiente > NUMERO_MAXIMO_SKU_ALEATORIO) throw new SkuAleatorioAgotadoError();
  return siguiente;
}

// Asigna códigos a varias filas sin código (carga masiva), en orden,
// saltando los que ya están ocupados (en la empresa o en el archivo).
export function asignarSkusAleatorios(nombres: string[], primerNumero: number, ocupados: Set<string>): string[] {
  let numero = primerNumero;
  return nombres.map((nombre) => {
    for (;;) {
      const codigo = formatearSkuAleatorio(nombre, numero);
      numero++;
      if (!ocupados.has(codigo)) {
        ocupados.add(codigo);
        return codigo;
      }
    }
  });
}

// ---------- Validaciones (puras) ----------

// SKU manual: cualquier código no vacío (ej. «001»), sin espacios
// internos; solo letras sin tilde, números, guion, guion bajo y punto.
// Se guarda normalizado (trim + mayúsculas), igual que costos_sku.
export function validarCodigoManual(texto: string): string {
  const recortado = texto.trim();
  if (!recortado) throw new SkuCodigoInvalidoFormatoError("Escribe el código del SKU o déjalo vacío para generarlo.");
  if (recortado.length > LARGO_MAXIMO_CODIGO) {
    throw new SkuCodigoInvalidoFormatoError(`El código del SKU puede tener hasta ${LARGO_MAXIMO_CODIGO} caracteres.`);
  }
  if (!/^[A-Za-z0-9._-]+$/.test(recortado)) {
    throw new SkuCodigoInvalidoFormatoError(
      `El código "${recortado}" no es válido: usa solo letras sin tilde, números, guion (-), guion bajo (_) o punto, sin espacios.`
    );
  }
  return recortado.toUpperCase();
}

export function validarNombreProducto(texto: string): string {
  const nombre = texto.trim().replace(/\s+/g, " ");
  if (!nombre) throw new ProductoInvalidoError("El nombre del producto es obligatorio.");
  if (nombre.length > LARGO_MAXIMO_NOMBRE) throw new ProductoInvalidoError(`El nombre puede tener hasta ${LARGO_MAXIMO_NOMBRE} caracteres.`);
  return nombre;
}

export function validarStockInicial(cantidad: number): number {
  if (!Number.isSafeInteger(cantidad) || cantidad < 0 || cantidad > CANTIDAD_INICIAL_MAXIMA) {
    throw new ProductoInvalidoError(`El stock inicial tiene que ser un número entero entre 0 y ${CANTIDAD_INICIAL_MAXIMA.toLocaleString("es-CO")}.`);
  }
  return cantidad;
}

// Mismo criterio que la base (upper(btrim(codigo))): «001 », «abc» y
// «ABC» son el mismo SKU.
export function mismoCodigoSku(a: string, b: string): boolean {
  return a.trim().toUpperCase() === b.trim().toUpperCase();
}

// AAAA-MM-DD HH:mm en Bogotá (UTC-5 todo el año).
export function fechaCreacionBogota(fecha: Date): string {
  return new Date(fecha.getTime() - 5 * 60 * 60 * 1000).toISOString().slice(0, 16).replace("T", " ");
}

// ---------- Con base ----------

function esUnicoViolado(error: unknown, restriccion: string): boolean {
  let actual: unknown = error;
  for (let i = 0; i < 3 && actual && typeof actual === "object"; i++) {
    const e = actual as { code?: unknown; constraint_name?: unknown; constraint?: unknown; cause?: unknown };
    if (e.code === "23505" && (e.constraint_name === restriccion || e.constraint === restriccion)) return true;
    actual = e.cause;
  }
  return false;
}

async function skuConCodigoTx(tx: Tx, empresaId: string, codigoNormalizado: string, excluirSkuId?: string) {
  const condiciones = [eq(skus.empresaId, empresaId), sql`upper(btrim(${skus.codigo})) = ${codigoNormalizado}`];
  if (excluirSkuId) condiciones.push(ne(skus.id, excluirSkuId));
  const [fila] = await tx.select({ id: skus.id, nombre: skus.nombre }).from(skus).where(and(...condiciones)).limit(1);
  return fila ?? null;
}

// Mayor número de SKU aleatorio de la empresa (0 si no hay ninguno).
// La regex es texto fijo; el único dato es empresa_id, como parámetro.
export async function mayorNumeroSkuAleatorioTx(tx: Tx, empresaId: string): Promise<number> {
  const [fila] = await tx
    .select({ maximo: sql<string | null>`max(substring(upper(btrim(${skus.codigo})) from 7 for 4)::int)` })
    .from(skus)
    .where(and(eq(skus.empresaId, empresaId), sql`upper(btrim(${skus.codigo})) ~ '^FUL[A-Z]{3}[0-9]{4}$'`));
  return fila?.maximo == null ? 0 : Number(fila.maximo);
}

export async function siguienteSkuAleatorioTx(tx: Tx, empresaId: string, nombre: string): Promise<string> {
  let numero = (await mayorNumeroSkuAleatorioTx(tx, empresaId)) + 1;
  for (;;) {
    const codigo = formatearSkuAleatorio(nombre, numero);
    if (!(await skuConCodigoTx(tx, empresaId, codigo))) return codigo;
    numero++;
  }
}

// Solo lectura: lo que usa el botón «SKU aleatorio».
export async function sugerirSkuAleatorio(empresaId: string, nombre: string): Promise<string> {
  return dbComoEmpresa(empresaId, (tx) => siguienteSkuAleatorioTx(tx, empresaId, nombre));
}

export async function tieneMovimientosSku(tx: Tx, empresaId: string, skuId: string): Promise<boolean> {
  const [fila] = await tx
    .select({ id: kardexMovimientos.id })
    .from(kardexMovimientos)
    .where(and(eq(kardexMovimientos.empresaId, empresaId), eq(kardexMovimientos.skuId, skuId)))
    .limit(1);
  return Boolean(fila);
}

export type DatosProducto = {
  codigo?: string; // vacío = se genera (FUL + 3 letras + 4 números)
  nombre: string;
  costo?: string | null; // ya validado como monto (texto, hasta 2 decimales)
  precioVenta?: string | null;
  stockInicial?: number;
  bodegaId?: string | null;
  // Id de la operación (formulario o carga): queda en la auditoría del
  // alta para que un doble clic no cree el producto dos veces.
  operacionId: string;
};

export type ProductoCreado = { skuId: string; codigo: string; codigoGenerado: boolean; yaExistia?: boolean };

// Alta completa DENTRO del tx que pasan (tiene que venir de
// dbComoEmpresa). El stock inicial entra SOLO por aplicarMovimientosTx:
// nunca un INSERT/UPDATE a stock_bodega o al kardex desde acá.
export async function crearProductoTx(tx: Tx, empresaId: string, usuarioId: string, datos: DatosProducto): Promise<ProductoCreado> {
  if (!/^[0-9A-Za-z:-]{1,120}$/.test(datos.operacionId)) throw new ProductoInvalidoError("El formulario está vencido: recarga la página.");
  const nombre = validarNombreProducto(datos.nombre);
  const stockInicial = validarStockInicial(datos.stockInicial ?? 0);
  const bodegaId = datos.bodegaId?.trim() || null;
  if (stockInicial > 0 && !bodegaId) throw new ProductoInvalidoError("Elige la bodega donde entra el stock inicial.");

  const codigoGenerado = !datos.codigo?.trim();
  let codigo: string;
  if (codigoGenerado) {
    codigo = await siguienteSkuAleatorioTx(tx, empresaId, nombre);
  } else {
    codigo = validarCodigoManual(datos.codigo!);
    const existente = await skuConCodigoTx(tx, empresaId, codigo);
    if (existente) throw new SkuYaExisteError(codigo, existente.nombre);
  }

  let skuId: string;
  try {
    // Savepoint: si choca el índice único, el tx del que llama sigue
    // usable (el reintento o el aviso no dejan la transacción abortada).
    const [fila] = await tx.transaction((sp) =>
      sp.insert(skus).values({ empresaId, codigo, nombre }).returning({ id: skus.id })
    );
    skuId = fila.id;
  } catch (error) {
    if (esUnicoViolado(error, RESTRICCION_CODIGO_UNICO)) {
      if (codigoGenerado) throw new ChoqueSkuGeneradoError();
      throw new SkuYaExisteError(codigo);
    }
    throw error;
  }

  const costo = datos.costo ?? null;
  const precioVenta = datos.precioVenta ?? null;
  if (costo !== null || precioVenta !== null) {
    // Puede existir ya una fila de costos para ese código (importada
    // desde Finanzas): se completa sin borrar lo que no se escribió.
    const cambios = {
      nombreProducto: nombre,
      fuente: "manual" as const,
      actualizadoTs: new Date(),
      actualizadoPor: usuarioId,
      ...(costo !== null ? { costo } : {}),
      ...(precioVenta !== null ? { precioVenta } : {}),
    };
    await tx
      .insert(costosSku)
      .values({ empresaId, skuCodigo: codigo, ...cambios })
      .onConflictDoUpdate({ target: [costosSku.empresaId, costosSku.skuCodigo], set: cambios });
  }

  if (stockInicial > 0) {
    await aplicarMovimientosTx(tx, empresaId, {
      claveIdempotencia: `producto-inicial:${skuId}`,
      origen: "manual",
      actor: { tipo: "persona", usuarioId },
      nota: NOTA_INVENTARIO_INICIAL,
      lineas: [{ tipo: "entrada", bodegaId: bodegaId!, skuId, cantidad: stockInicial }],
    });
  }

  await registrarAuditoria(tx, {
    empresaId,
    usuarioId,
    actorTipo: "persona",
    accion: "crear_sku",
    entidad: "sku",
    entidadId: skuId,
    detalle: `Creó el producto ${codigo} (${nombre})${stockInicial > 0 ? ` con ${stockInicial} unidad(es) de inventario inicial` : ""}.`,
    // operacionId va primero: buscarAltaPorOperacionTx lo busca así.
    valorNuevo: JSON.stringify({ operacionId: datos.operacionId, codigo, nombre, costo, precioVenta, stockInicial, bodegaId }),
  });

  return { skuId, codigo, codigoGenerado };
}

async function buscarAltaPorOperacionTx(tx: Tx, empresaId: string, operacionId: string): Promise<ProductoCreado | null> {
  const [fila] = await tx
    .select({ skuId: auditoria.entidadId, valorNuevo: auditoria.valorNuevo })
    .from(auditoria)
    .where(
      and(
        eq(auditoria.empresaId, empresaId),
        eq(auditoria.accion, "crear_sku"),
        eq(auditoria.entidad, "sku"),
        // operacionId ya pasó por la regex de UUID: no trae % ni _.
        like(auditoria.valorNuevo, `{"operacionId":"${operacionId}",%`)
      )
    )
    .limit(1);
  if (!fila?.skuId) return null;
  const valor = JSON.parse(fila.valorNuevo ?? "{}") as { codigo?: string };
  return { skuId: fila.skuId, codigo: valor.codigo ?? "", codigoGenerado: false, yaExistia: true };
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Una transacción por intento: si dos personas generan el mismo código
// a la vez, reintenta hasta 3 veces con el siguiente número (solo para
// códigos generados; un SKU manual repetido nunca se reintenta).
export async function crearProducto(empresaId: string, usuarioId: string, datos: DatosProducto): Promise<ProductoCreado> {
  if (!UUID_RE.test(datos.operacionId)) throw new ProductoInvalidoError("El formulario está vencido: recarga la página.");
  for (let intento = 0; ; intento++) {
    try {
      return await dbComoEmpresa(empresaId, async (tx) => {
        // Un doble clic llega con el mismo operacionId: el bloqueo los
        // pone en fila y el segundo encuentra el alta del primero.
        await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`producto-alta:${empresaId}:${datos.operacionId}`}))`);
        const previa = await buscarAltaPorOperacionTx(tx, empresaId, datos.operacionId);
        if (previa) return previa;
        return crearProductoTx(tx, empresaId, usuarioId, datos);
      });
    } catch (error) {
      if (error instanceof ChoqueSkuGeneradoError && intento < REINTENTOS_CHOQUE) continue;
      if (error instanceof ChoqueSkuGeneradoError) {
        throw new ProductoInvalidoError("Otra persona está creando SKU al mismo tiempo: intenta de nuevo.");
      }
      throw error;
    }
  }
}

// ---------- Editar ----------

export type DatosEdicion = { skuId: string; nombre: string; codigo?: string | null };

export async function editarProducto(empresaId: string, usuarioId: string, datos: DatosEdicion): Promise<{ codigo: string }> {
  if (!UUID_RE.test(datos.skuId)) throw new ProductoInvalidoError("Ese SKU no existe en tu empresa.");
  const nombre = validarNombreProducto(datos.nombre);
  try {
    return await dbComoEmpresa(empresaId, async (tx) => {
      const [actual] = await tx
        .select({ id: skus.id, codigo: skus.codigo, nombre: skus.nombre, esKit: skus.esKit })
        .from(skus)
        .where(and(eq(skus.empresaId, empresaId), eq(skus.id, datos.skuId)));
      if (!actual) throw new ProductoInvalidoError("Ese SKU no existe en tu empresa.");
      if (actual.esKit) throw new ProductoInvalidoError("Los kits se administran en SKU.");

      const codigoAnterior = actual.codigo.trim().toUpperCase();
      let codigo = codigoAnterior;
      const pedido = datos.codigo?.trim();
      if (pedido && !mismoCodigoSku(pedido, actual.codigo)) {
        // Nunca se confía en que el campo venía deshabilitado.
        if (await tieneMovimientosSku(tx, empresaId, actual.id)) throw new CodigoBloqueadoError();
        codigo = validarCodigoManual(pedido);
        const otro = await skuConCodigoTx(tx, empresaId, codigo, actual.id);
        if (otro) throw new SkuYaExisteError(codigo, otro.nombre);
        const [costoNuevo] = await tx
          .select({ id: costosSku.id })
          .from(costosSku)
          .where(and(eq(costosSku.empresaId, empresaId), eq(costosSku.skuCodigo, codigo)));
        if (costoNuevo) {
          throw new ProductoInvalidoError(`El código "${codigo}" ya tiene costos guardados en Finanzas: elige otro código.`);
        }
      }

      await tx.update(skus).set({ codigo, nombre }).where(and(eq(skus.empresaId, empresaId), eq(skus.id, actual.id)));
      if (codigo !== codigoAnterior) {
        await tx
          .update(costosSku)
          .set({ skuCodigo: codigo, actualizadoTs: new Date(), actualizadoPor: usuarioId })
          .where(and(eq(costosSku.empresaId, empresaId), eq(costosSku.skuCodigo, codigoAnterior)));
      }
      await tx
        .update(costosSku)
        .set({ nombreProducto: nombre })
        .where(and(eq(costosSku.empresaId, empresaId), eq(costosSku.skuCodigo, codigo)));

      await registrarAuditoria(tx, {
        empresaId,
        usuarioId,
        actorTipo: "persona",
        accion: "modificar_sku",
        entidad: "sku",
        entidadId: actual.id,
        detalle: `Editó el producto ${codigo}.`,
        valorAnterior: JSON.stringify({ codigo: actual.codigo, nombre: actual.nombre }),
        valorNuevo: JSON.stringify({ codigo, nombre }),
      });
      return { codigo };
    });
  } catch (error) {
    if (esUnicoViolado(error, RESTRICCION_CODIGO_UNICO)) throw new SkuYaExisteError(String(datos.codigo ?? "").trim().toUpperCase());
    throw error;
  }
}

// ---------- Lista «SKUs creados» ----------

export type SkuCreado = {
  id: string;
  codigo: string;
  nombre: string;
  esKit: boolean;
  creadoTs: Date;
  costo: string | null;
  precioVenta: string | null;
  stockTotal: number | null; // null en kits (no tienen stock propio)
  tieneMovimientos: boolean;
};

export type ResultadoSkusCreados = { filas: SkuCreado[]; total: number; pagina: number; totalPaginas: number };

export async function listarSkusCreados(empresaId: string, filtro: { q?: string; pagina?: number | string } = {}): Promise<ResultadoSkusCreados> {
  const condiciones = [eq(skus.empresaId, empresaId)];
  const patron = patronBusquedaLike(filtro.q);
  const busqueda = patron ? or(ilike(skus.codigo, patron), ilike(skus.nombre, patron)) : undefined;
  if (busqueda) condiciones.push(busqueda);
  const donde = and(...condiciones);

  return dbComoEmpresa(empresaId, async (tx) => {
    const [{ total }] = await tx.select({ total: sql<number>`count(*)::int` }).from(skus).where(donde);
    const totalPaginas = Math.ceil(total / TAMANO_PAGINA);
    const pagina = acotarPagina(parsearPagina(filtro.pagina), totalPaginas);

    const base = await tx
      .select({
        id: skus.id,
        codigo: skus.codigo,
        nombre: skus.nombre,
        esKit: skus.esKit,
        creadoTs: skus.creadoTs,
        costo: costosSku.costo,
        precioVenta: costosSku.precioVenta,
      })
      .from(skus)
      .leftJoin(costosSku, and(eq(costosSku.empresaId, skus.empresaId), sql`${costosSku.skuCodigo} = upper(btrim(${skus.codigo}))`))
      .where(donde)
      .orderBy(desc(skus.creadoTs), desc(skus.id))
      .limit(TAMANO_PAGINA)
      .offset((pagina - 1) * TAMANO_PAGINA);

    const ids = base.map((f) => f.id);
    const stockPorSku = new Map<string, number>();
    const conMovimientos = new Set<string>();
    if (ids.length > 0) {
      const stock = await tx
        .select({ skuId: stockBodega.skuId, total: sql<number>`sum(${stockBodega.disponible} + ${stockBodega.reservado})::int` })
        .from(stockBodega)
        .where(and(eq(stockBodega.empresaId, empresaId), inArray(stockBodega.skuId, ids)))
        .groupBy(stockBodega.skuId);
      stock.forEach((s) => stockPorSku.set(s.skuId, Number(s.total)));
      const movidos = await tx
        .selectDistinct({ skuId: kardexMovimientos.skuId })
        .from(kardexMovimientos)
        .where(and(eq(kardexMovimientos.empresaId, empresaId), inArray(kardexMovimientos.skuId, ids)));
      movidos.forEach((m) => conMovimientos.add(m.skuId));
    }

    return {
      filas: base.map((f) => ({
        ...f,
        stockTotal: f.esKit ? null : (stockPorSku.get(f.id) ?? 0),
        tieneMovimientos: conMovimientos.has(f.id),
      })),
      total,
      pagina,
      totalPaginas,
    };
  });
}

export async function obtenerSkuParaEditar(empresaId: string, skuId: string) {
  if (!UUID_RE.test(skuId)) return null;
  return dbComoEmpresa(empresaId, async (tx) => {
    const [fila] = await tx
      .select({ id: skus.id, codigo: skus.codigo, nombre: skus.nombre, esKit: skus.esKit })
      .from(skus)
      .where(and(eq(skus.empresaId, empresaId), eq(skus.id, skuId)));
    if (!fila) return null;
    return { ...fila, tieneMovimientos: await tieneMovimientosSku(tx, empresaId, fila.id) };
  });
}

// Bodega activa de la empresa (para validar antes de cargar stock y
// dar un aviso claro en vez del error genérico del kardex).
export async function bodegaActivaTx(tx: Tx, empresaId: string, bodegaId: string): Promise<{ id: string; nombre: string } | null> {
  if (!UUID_RE.test(bodegaId)) return null;
  const [fila] = await tx
    .select({ id: bodegas.id, nombre: bodegas.nombre })
    .from(bodegas)
    .where(and(eq(bodegas.empresaId, empresaId), eq(bodegas.id, bodegaId), eq(bodegas.activa, true)));
  return fila ?? null;
}
