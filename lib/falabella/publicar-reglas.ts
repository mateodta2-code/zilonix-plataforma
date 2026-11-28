// Fase 2 de "Publicar en Falabella": reglas de negocio de Mateo (28/11/2026)
// aplicadas como funciones PURAS (sin red, sin base), para poder probarlas
// y para mostrar el borrador ANTES de crear nada en Falabella.
//
// Reglas: marca GENERICO (la marca real va en Modelo), IVA 19%, 1 kg,
// paquete 25×15×25 cm salvo que no quepa, EAN = 9015785935 + últimos 4
// dígitos del SKU, SKU = el de Zilonix, precio normal = oferta + 25.000,
// oferta de 30 días, título ≤ 60 caracteres sin marcas, máximo 8 imágenes
// sin repetidas, no se montan suplementos ni paquetes x2/x3.

export const MARCA_GENERICA = "GENERICO";
export const PREFIJO_EAN = "9015785935";
export const IVA_PORCENTAJE = "19";
export const RECARGO_PRECIO_NORMAL = 25_000;
export const DIAS_OFERTA = 30;
export const MAX_TITULO = 60;
export const MAX_IMAGENES = 8;
export const BODEGA_ENVIO = "Bodega_envio_01";
// CÓDIGO de operador de Colombia en BusinessUnit (docs/products/productcreate).
export const OPERADOR_COLOMBIA = "faco";
const MEDIDAS_POR_DEFECTO = { largo: 25, ancho: 15, alto: 25, peso: 1 };

export type EntradaBorradorFalabella = {
  sku: string;
  titulo: string;
  descripcion: string;
  // Marca real del producto: va en el atributo Modelo, nunca en Brand.
  modelo: string;
  // Precio de Asana = precio de oferta.
  precioOferta: number;
  stock: number;
  categoriaId: number;
  imagenes: string[];
  medidas?: Partial<typeof MEDIDAS_POR_DEFECTO>;
  // Atributos propios de la categoría (FeedName → valor), ver catalogo.ts.
  atributos?: Record<string, string>;
  ahora?: Date;
};

export type EstadoPublicacionFalabella = "borrador" | "creando" | "imagenes" | "publicado" | "rechazado";

export type BorradorFalabella = {
  sku: string;
  titulo: string;
  descripcion: string;
  marca: string;
  ean: string;
  categoriaId: number;
  precioNormal: number;
  precioOferta: number;
  ofertaDesde: string;
  ofertaHasta: string;
  stock: number;
  bodega: string;
  iva: string;
  medidas: typeof MEDIDAS_POR_DEFECTO;
  imagenes: string[];
  atributos: Record<string, string>;
  // Impiden crear el producto. Sin esto el borrador no se puede aprobar.
  problemas: string[];
  // Se muestran pero no bloquean (ej. se recortaron imágenes).
  avisos: string[];
};

export function construirEan(sku: string): string | null {
  const ultimos = sku.trim().slice(-4);
  return /^\d{4}$/.test(ultimos) ? `${PREFIJO_EAN}${ultimos}` : null;
}

// "YYYY-MM-DD HH:MM:SS" en hora de Colombia (UTC-5, sin horario de verano) —
// formato que exige SpecialFromDate/SpecialToDate.
export function formatearFechaOferta(fecha: Date): string {
  const colombia = new Date(fecha.getTime() - 5 * 60 * 60 * 1000);
  return colombia.toISOString().slice(0, 19).replace("T", " ");
}

const PATRON_EXCLUIDO = /\bx\s?[23]\b|\b[23]\s?x\s?1\b|\bpack\b|\bcombo\b|\bpaquete\b|suplement/i;

export function construirBorrador(entrada: EntradaBorradorFalabella): BorradorFalabella {
  const problemas: string[] = [];
  const avisos: string[] = [];
  const ahora = entrada.ahora ?? new Date();
  const sku = entrada.sku.trim();
  const titulo = entrada.titulo.trim();

  if (!sku) problemas.push("Falta el SKU.");
  const ean = construirEan(sku);
  if (sku && !ean) problemas.push(`El SKU "${sku}" no termina en 4 dígitos, no se puede armar el EAN.`);

  if (!titulo) problemas.push("Falta el título.");
  if (titulo.length > MAX_TITULO) problemas.push(`El título tiene ${titulo.length} caracteres; Falabella acepta máximo ${MAX_TITULO}.`);
  if (PATRON_EXCLUIDO.test(titulo)) problemas.push("Por regla no se montan suplementos ni paquetes x2/x3 en Falabella.");

  const descripcion = entrada.descripcion.trim();
  if (descripcion.length < 6) problemas.push("La descripción debe tener al menos 6 caracteres.");
  if (descripcion.length > 25_000) problemas.push("La descripción supera los 25.000 caracteres.");

  if (!Number.isFinite(entrada.precioOferta) || entrada.precioOferta <= 0) problemas.push("Falta el precio (el de Asana).");
  if (!Number.isInteger(entrada.categoriaId) || entrada.categoriaId <= 0) problemas.push("Falta elegir la categoría de Falabella.");
  if (!entrada.modelo.trim()) problemas.push("Falta la marca real (va en el campo Modelo).");
  if (!Number.isInteger(entrada.stock) || entrada.stock < 0) problemas.push("El stock debe ser un entero de 0 o más.");

  // Sin repetidas, en el orden dado: la primera es la portada.
  const vistas = new Set<string>();
  const unicas = entrada.imagenes.map((u) => u.trim()).filter((u) => u && !vistas.has(u) && vistas.add(u));
  if (unicas.length !== entrada.imagenes.filter((u) => u.trim()).length) avisos.push("Se quitaron imágenes repetidas.");
  if (unicas.length === 0) problemas.push("Falta al menos una imagen (la primera es la portada).");
  const imagenes = unicas.slice(0, MAX_IMAGENES);
  if (unicas.length > MAX_IMAGENES) avisos.push(`Falabella acepta ${MAX_IMAGENES} imágenes; se usaron las primeras ${MAX_IMAGENES}.`);
  for (const url of imagenes) {
    if (!/^https:\/\//i.test(url)) problemas.push("Las imágenes deben ser URLs https públicas.");
  }

  const medidas = { ...MEDIDAS_POR_DEFECTO, ...entrada.medidas };
  const hasta = new Date(ahora.getTime() + DIAS_OFERTA * 24 * 60 * 60 * 1000);

  return {
    sku,
    titulo,
    descripcion,
    marca: MARCA_GENERICA,
    ean: ean ?? "",
    categoriaId: entrada.categoriaId,
    precioNormal: Math.round(entrada.precioOferta) + RECARGO_PRECIO_NORMAL,
    precioOferta: Math.round(entrada.precioOferta),
    ofertaDesde: formatearFechaOferta(ahora),
    ofertaHasta: formatearFechaOferta(hasta),
    stock: entrada.stock,
    bodega: BODEGA_ENVIO,
    iva: IVA_PORCENTAJE,
    medidas,
    imagenes: [...new Set(imagenes)],
    atributos: { Modelo: entrada.modelo.trim(), ...entrada.atributos },
    problemas: [...new Set(problemas)],
    avisos,
  };
}

// ---- XML ------------------------------------------------------------------

function esc(texto: string): string {
  return texto.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// El nombre de un atributo viene de Falabella (GetCategoryAttributes), pero
// por defensa solo se acepta un nombre de tag XML seguro.
const NOMBRE_TAG_SEGURO = /^[A-Za-z][A-Za-z0-9_]{0,60}$/;

export function xmlProductCreate(b: BorradorFalabella): string {
  const atributos = Object.entries(b.atributos)
    .filter(([nombre, valor]) => NOMBRE_TAG_SEGURO.test(nombre) && valor.trim())
    .map(([nombre, valor]) => `<${nombre}>${esc(valor)}</${nombre}>`)
    .join("");
  const descripcionSegura = b.descripcion.replace(/]]>/g, "]]]]><![CDATA[>");
  return (
    `<?xml version="1.0" encoding="UTF-8" ?><Request><Product>` +
    `<SellerSku>${esc(b.sku)}</SellerSku>` +
    `<Name>${esc(b.titulo)}</Name>` +
    `<PrimaryCategory>${b.categoriaId}</PrimaryCategory>` +
    `<Description><![CDATA[${descripcionSegura}]]></Description>` +
    `<Brand>${esc(b.marca)}</Brand>` +
    `<ProductId>${esc(b.ean)}</ProductId>` +
    `<BusinessUnits><BusinessUnit>` +
    `<OperatorCode>${OPERADOR_COLOMBIA}</OperatorCode>` +
    `<Price>${b.precioNormal}</Price>` +
    `<SpecialPrice>${b.precioOferta}</SpecialPrice>` +
    `<SpecialFromDate>${b.ofertaDesde}</SpecialFromDate>` +
    `<SpecialToDate>${b.ofertaHasta}</SpecialToDate>` +
    `<Stock>${b.stock}</Stock>` +
    `<Status>active</Status>` +
    `</BusinessUnit></BusinessUnits>` +
    `<ProductData>` +
    `<ConditionType>Nuevo</ConditionType>` +
    `<PackageHeight>${b.medidas.alto}</PackageHeight>` +
    `<PackageWidth>${b.medidas.ancho}</PackageWidth>` +
    `<PackageLength>${b.medidas.largo}</PackageLength>` +
    `<PackageWeight>${b.medidas.peso}</PackageWeight>` +
    `<TaxPercentage>${b.iva}</TaxPercentage>` +
    atributos +
    `</ProductData>` +
    `</Product></Request>`
  );
}

export function xmlImagenes(sku: string, imagenes: string[]): string {
  return (
    `<?xml version="1.0" encoding="UTF-8" ?><Request><ProductImage>` +
    `<SellerSku>${esc(sku)}</SellerSku><Images>${imagenes.map((u) => `<Image>${esc(u)}</Image>`).join("")}</Images>` +
    `</ProductImage></Request>`
  );
}
