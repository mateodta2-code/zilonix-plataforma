// Issue #252 (revisión de Pablo, punto 3) — este validador vivía
// dentro de app/panel/investigacion/seguimiento/actions.ts ("use
// server"), lo que impedía exportarlo para probarlo directo (Next.js
// exige que un archivo "use server" solo exporte funciones async —
// un type guard sync como datoPaginaSeguimientoValido no puede vivir
// ahí si hace falta importarlo desde una prueba). Se movió a este
// módulo plano, sin ningún acceso a Postgres ni a Mercado Libre, para
// poder probarlo con vitest sin tocar la base.
import type { DatoPaginaSeguimiento } from "@/lib/seguimiento/seguimientos";

// Issue #251 (corrección de Pablo, punto 6) — mismos prefijos reales
// de Mercado Libre por país que ya usa el resto del repo (Colombia,
// Argentina, Brasil, México, Chile, Uruguay, Perú) para un id de
// producto/item, o puro numérico para un seller_id de tienda — nunca
// un string cualquiera solo porque "no está vacío".
const PATRON_ID_ML_O_VENDEDOR = /^(MCO|MLA|MLB|MLM|MLC|MLU|MPE)\d+$|^\d+$/;
const MAX_IDS_VISIBLES = 100;
// Issue #251 (corrección de Pablo, punto 6) — background.js puede
// encolar una lectura y entregarla horas después (issue #251, punto 4
// de la revisión anterior) mientras la pestaña de Seguimiento estaba
// cerrada, pero nunca para siempre: 36h es más que suficiente margen
// para esa cola oportunista sin dejar pasar un dato tan viejo que ya
// no sirve ni para la estimación de ventas.
const MAX_HORAS_LEIDO_EN = 36;

function numeroEnteroEnRango(valor: unknown): valor is number | null {
  return valor === null || (typeof valor === "number" && Number.isInteger(valor) && valor >= 0 && valor <= 1_000_000);
}

// Issue #252 (punto 3) — título/precio de respaldo, leídos por la
// extensión directo de la página, para mostrar un nombre cuando la
// revisión automática todavía no pudo confirmar el recurso real en ML
// (ver guardarDatoDePaginaSeguimiento). MAX_LARGO_TITULO solo para
// cortar basura (un selector equivocado trayendo HTML entero, por
// ejemplo) — nunca trunca un título real de ML, que es mucho más corto.
const MAX_LARGO_TITULO = 300;

// Issue #252 (revisión de Pablo, punto 3) — bug real: la extensión
// 0.3.30 (la que estaba instalada cuando Mateo probó el #252) nunca
// mandaba `titulo`/`precio` — quedaban `undefined`, no `null`, así que
// `=== null` descartaba el payload ENTERO (inventario y vendidos
// incluidos) solo porque faltaban estos dos campos nuevos, opcionales
// por diseño. `== null` acepta las dos formas (undefined o null) por
// igual — datoPaginaSeguimientoValido normaliza a `null` de verdad más
// abajo, antes de dar el payload por válido.
function tituloEnRango(valor: unknown): valor is string | null | undefined {
  return valor == null || (typeof valor === "string" && valor.trim().length > 0 && valor.length <= MAX_LARGO_TITULO);
}

function precioEnRango(valor: unknown): valor is number | null | undefined {
  return valor == null || (typeof valor === "number" && Number.isFinite(valor) && valor >= 0 && valor <= 1_000_000_000);
}

// Nunca confía en que `leidoEn` viene bien formado solo porque llegó
// por este canal: tiene que ser una fecha ISO real, nunca futura (un
// reloj de sistema mal puesto no debe mandar datos "del futuro" que
// después nadie podría revisar) y de no más de MAX_HORAS_LEIDO_EN.
function leidoEnValido(valor: unknown): valor is string {
  if (typeof valor !== "string") return false;
  const fecha = new Date(valor);
  if (Number.isNaN(fecha.getTime())) return false;
  const ahoraMs = Date.now();
  if (fecha.getTime() > ahoraMs) return false;
  return ahoraMs - fecha.getTime() <= MAX_HORAS_LEIDO_EN * 60 * 60 * 1000;
}

// Issue #251 — `empresaId` SIEMPRE se resuelve del lado del servidor
// (sesión + cookie, en actions.ts) — nunca se confía en nada que mande
// el cliente salvo el payload en sí, y ESE se valida entero acá, nunca
// se asume que el mensaje de la extensión viene bien formado solo
// porque llegó por este canal.
export function datoPaginaSeguimientoValido(payload: unknown): payload is DatoPaginaSeguimiento {
  if (!payload || typeof payload !== "object") return false;
  const p = payload as Record<string, unknown>;
  if (typeof p.mlIdExterno !== "string" || !PATRON_ID_ML_O_VENDEDOR.test(p.mlIdExterno)) return false;
  if (!leidoEnValido(p.leidoEn)) return false;
  if (p.tipoSeguimiento === "producto") {
    const valido =
      numeroEnteroEnRango(p.inventario) &&
      typeof p.inventarioAproximado === "boolean" &&
      numeroEnteroEnRango(p.vendidos) &&
      typeof p.vendidosExacto === "boolean" &&
      tituloEnRango(p.titulo) &&
      precioEnRango(p.precio);
    // Issue #252 (revisión de Pablo, punto 3) — normaliza `undefined`
    // a `null` de verdad ACÁ, una sola vez, para que el resto del
    // código (tipado `string | null`/`number | null`, nunca `| undefined`)
    // reciba siempre lo que promete su tipo.
    if (valido) {
      p.titulo = p.titulo ?? null;
      p.precio = p.precio ?? null;
    }
    return valido;
  }
  if (p.tipoSeguimiento === "tienda") {
    return (
      numeroEnteroEnRango(p.totalPublicaciones) &&
      Array.isArray(p.idsVisibles) &&
      p.idsVisibles.length <= MAX_IDS_VISIBLES &&
      p.idsVisibles.every((id) => typeof id === "string" && PATRON_ID_ML_O_VENDEDOR.test(id))
    );
  }
  return false;
}
