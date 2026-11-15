import { NextResponse } from "next/server";
import { requierePermiso } from "@/lib/permisos";
import { clasificarSenalVentas, linkHttpSeguro, type Bloque, type ProductoListado } from "@/lib/ml/listadoCliente";
import { datosSitioMl, formatearMoneda, formatearNumero, siteIdDeHost } from "@/lib/ml/sitios";
import {
  COLUMNA_ORDEN_DEFECTO,
  construirFilasNicho,
  direccionInicial,
  formatearAntiguedad,
  ordenarFilasNicho,
  totalesNicho,
  type ColumnaNicho,
  type DireccionOrden,
} from "@/lib/ml/tablaNicho";
import { respuestaSiSinPermiso, resolverSesionYEmpresa } from "../../ml/promociones/_ayudantes";

// Tabla "Análisis del nicho" para el botón "Analizar esta página" de la
// extensión. La extensión manda lo que ya leyó de la página de búsqueda
// (nunca un token ni un dato de otra fuente) y SOLO dibuja lo que
// devuelve esta ruta: todo el cálculo (ventas/mes, facturación,
// antigüedad aprox., totales, orden, moneda) sale de lib/ml/tablaNicho.ts.
//
// Auth: sesión de Clerk (cookie) — el middleware ya responde 401 JSON a
// una petición /api/ sin sesión. No se valida `Origin` a propósito: la
// petición sale del service worker de la extensión (Origin
// chrome-extension://…), la ruta solo LEE/calcula (no escribe nada) y
// la respuesta no es legible desde otro sitio sin CORS.
export const dynamic = "force-dynamic";

const MAX_PRODUCTOS = 60;
const COLUMNAS: readonly ColumnaNicho[] = ["orden", "foto", "titulo", "precio", "origen", "antiguedad", "ventasMes", "factMes"];

type Wire = Record<string, unknown>;

function texto(v: unknown, max: number): string | null {
  return typeof v === "string" && v.trim() ? v.slice(0, max) : null;
}

function idMl(v: unknown): string | null {
  return typeof v === "string" && /^[A-Z]{3}\d{4,}$/.test(v) ? v : null;
}

function aProducto(w: Wire): ProductoListado | null {
  const titulo = texto(w.titulo, 300);
  if (!titulo || typeof w.precio !== "number" || !Number.isFinite(w.precio) || w.precio < 0) return null;
  const vendidos = typeof w.vendidos === "number" && Number.isFinite(w.vendidos) && w.vendidos >= 0 ? w.vendidos : null;
  return {
    plataforma: "Mercado Libre",
    itemId: idMl(w.itemId),
    productId: idMl(w.productId),
    titulo,
    precio: w.precio,
    foto: linkHttpSeguro(texto(w.foto, 500)),
    senalVentas: clasificarSenalVentas("Mercado Libre", vendidos),
    esFull: typeof w.esFull === "boolean" ? w.esFull : null,
    esPrime: null,
    esEnvioGratis: null,
    calificacion: null,
    vendedor: null,
    link: linkHttpSeguro(texto(w.link, 800)),
  };
}

export async function POST(request: Request) {
  const sesion = await resolverSesionYEmpresa();
  if (sesion instanceof NextResponse) return sesion;
  const { usuario, empresa } = sesion;

  try {
    // Mismo permiso que la pantalla de Investigación (page.tsx).
    await requierePermiso(usuario.id, empresa.id, "inventario", "consultar");
  } catch (error) {
    const r = respuestaSiSinPermiso(error);
    if (r) return r;
    throw error;
  }

  let cuerpo: Wire;
  try {
    cuerpo = (await request.json()) as Wire;
  } catch {
    return NextResponse.json({ error: "Cuerpo inválido." }, { status: 400 });
  }
  if (!cuerpo || typeof cuerpo !== "object" || !Array.isArray(cuerpo.productos)) {
    return NextResponse.json({ error: "Faltan los productos." }, { status: 400 });
  }

  const siteId = siteIdDeHost(cuerpo.host);
  if (!siteId) return NextResponse.json({ error: "pais_no_soportado" }, { status: 400 });

  const columna: ColumnaNicho = COLUMNAS.includes(cuerpo.columna as ColumnaNicho) ? (cuerpo.columna as ColumnaNicho) : COLUMNA_ORDEN_DEFECTO;
  const direccion: DireccionOrden = cuerpo.direccion === "asc" || cuerpo.direccion === "desc" ? cuerpo.direccion : direccionInicial(columna);

  const productos = (cuerpo.productos as unknown[])
    .slice(0, MAX_PRODUCTOS)
    .map((p) => (p && typeof p === "object" ? aProducto(p as Wire) : null))
    .filter((p): p is ProductoListado => p !== null);
  const bloque: Bloque = { id: "extension", plataforma: "Mercado Libre", termino: "pagina", queriesUsadas: [], creadoTs: 0, productos };

  const ahora = new Date();
  // Todas las filas son del sitio de la búsqueda (moneda y totales de ese país).
  const filas = ordenarFilasNicho(construirFilasNicho([bloque], ahora, null).map((f) => ({ ...f, siteId })), columna, direccion);
  const totales = totalesNicho(filas);
  const sitio = datosSitioMl(siteId);
  const moneda = (n: number | null, s: string) => (n != null ? formatearMoneda(n, s) : null);
  const numero = (n: number | null, s: string) => (n != null ? formatearNumero(Math.round(n), datosSitioMl(s).idioma) : null);

  return NextResponse.json({
    ok: true,
    sitio: { siteId, nombre: sitio.nombre, moneda: sitio.moneda },
    orden: { columna, direccion },
    totales: {
      vendidos: numero(totales.vendidos, siteId),
      ventasMes: numero(totales.ventasMes, siteId),
      factMes: moneda(totales.factMes, siteId),
      aviso: totales.hayOtrosPaises ? `Los totales suman solo ${datosSitioMl(totales.siteId).nombre}.` : null,
    },
    filas: filas.map((f, i) => ({
      n: i + 1,
      foto: f.foto,
      titulo: f.titulo,
      link: f.link,
      precio: formatearMoneda(f.precio, siteId),
      esFull: f.origen === "Full",
      origen: f.origen,
      antiguedad: f.antiguedadDias != null ? formatearAntiguedad(f.antiguedadDias, sitio.idioma) : null,
      ventasMes: numero(f.ventasMes, siteId),
      factMes: moneda(f.factMes, siteId),
    })),
  });
}
