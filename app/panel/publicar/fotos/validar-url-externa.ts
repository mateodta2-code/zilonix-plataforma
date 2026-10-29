import { lookup } from "dns/promises";
import { isIP } from "net";
import { tipoImagenPorMagicBytes, type TipoImagenDetectado } from "./magic-bytes";

// Re-exportado tal cual — el resto del repo (app/api/ml/publicar/fotos/
// route.ts, sus tests) sigue importando esto desde acá, nunca hace
// falta tocar esos imports. La función en sí ahora vive en
// magic-bytes.ts (sin imports de Node) para que el código de ZIP del
// lado del cliente (rama feat-publicar-fotos-zip) también pueda usarla.
export { tipoImagenPorMagicBytes, type TipoImagenDetectado };

// Parte 3, punto C — Canva. El pedido de Mateo descarta aceptar el link
// de "compartir" del diseño (canva.com/design/...): esa página es HTML
// detrás de login, no una imagen — nunca se scrapea el lado del
// servidor (regla general del repo). Solo se acepta un link de
// EXPORTACIÓN real (PNG/JPG) o el CDN de medios de Canva — lista
// cerrada y conservadora, documentada en el changelog; se ajusta solo
// con evidencia real de otro host necesario, nunca "por si acaso".
const HOSTS_EXACTOS_PERMITIDOS = new Set(["media.canva.com"]);
const SUFIJOS_HOST_PERMITIDOS = [".canvausercontent.com"];

export function hostPermitidoCanva(hostname: string): boolean {
  const h = hostname.toLowerCase();
  if (HOSTS_EXACTOS_PERMITIDOS.has(h)) return true;
  return SUFIJOS_HOST_PERMITIDOS.some((sufijo) => h.endsWith(sufijo));
}

export class UrlExternaInvalidaError extends Error {}
export class UrlExternaNoPermitidaError extends Error {}
export class UrlExternaNoDisponibleError extends Error {}
export class UrlExternaDemasiadoGrandeError extends Error {}
export class UrlExternaTipoInvalidoError extends Error {}

const TIMEOUT_MS = 8_000;
// Mismo orden de magnitud que el tope documentado en el pedido (8-10MB)
// — una foto de producto bien comprimida nunca necesita más que esto.
export const TAMANO_MAXIMO_FOTO_EXTERNA_BYTES = 10 * 1024 * 1024;
const TIPOS_IMAGEN_VALIDOS = new Set(["image/jpeg", "image/png", "image/webp"]);

// Rangos privados/especiales reales (RFC 1918, RFC 3927, loopback,
// CGNAT, y 169.254.169.254 — la IP de metadata de AWS/GCP/Azure, el
// blanco clásico de un SSRF contra infraestructura en la nube). Nunca
// se confía en que "parece una URL pública" — se resuelve el DNS de
// verdad y se rechaza si CUALQUIERA de las IPs resueltas cae en estos
// rangos.
function esIpPrivadaOEspecial(ip: string): boolean {
  const version = isIP(ip);
  if (version === 4) {
    const partes = ip.split(".").map(Number);
    const [a, b] = partes;
    if (a === 127) return true; // loopback
    if (a === 10) return true; // privada
    if (a === 172 && b >= 16 && b <= 31) return true; // privada
    if (a === 192 && b === 168) return true; // privada
    if (a === 169 && b === 254) return true; // link-local, incluye la IP de metadata de nube
    if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT (RFC 6598)
    if (a === 0) return true;
    return false;
  }
  if (version === 6) {
    const ipv6 = ip.toLowerCase();
    if (ipv6 === "::1") return true; // loopback
    if (ipv6.startsWith("fe80:")) return true; // link-local
    if (ipv6.startsWith("fc") || ipv6.startsWith("fd")) return true; // unique local (RFC 4193)
    if (ipv6.startsWith("::ffff:")) return esIpPrivadaOEspecial(ipv6.slice(7)); // IPv4-mapeada
    return false;
  }
  return true; // ni v4 ni v6 reconocida — nunca se asume pública
}

// Revisión de seguridad (hallazgo MED) — `res.arrayBuffer()` (lo que
// usaba esto antes) carga el cuerpo ENTERO en memoria antes de poder
// medirlo: un host ya permitido pero comprometido (o un proxy/CDN que
// no manda content-length) podía mandar un cuerpo gigante y esto lo
// bufferizaba completo ANTES de que el chequeo de tamaño de abajo
// corriera. Ahora se lee el stream real por chunks y se corta (se
// cancela el reader, nunca se sigue leyendo) en el momento exacto en
// que se supera el tope — con o sin content-length declarado.
async function leerCuerpoConTope(res: Response, topeBytes: number): Promise<Buffer> {
  if (!res.body || typeof res.body.getReader !== "function") {
    // Respaldo defensivo (algún runtime/mock sin streaming real) —
    // sigue acotado por el chequeo de abajo, nunca confía ciegamente.
    const buffer = Buffer.from(await res.arrayBuffer());
    if (buffer.byteLength > topeBytes) throw new UrlExternaDemasiadoGrandeError("La imagen supera el tamaño máximo permitido.");
    return buffer;
  }
  const reader = res.body.getReader();
  const partes: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > topeBytes) {
        throw new UrlExternaDemasiadoGrandeError("La imagen supera el tamaño máximo permitido.");
      }
      partes.push(value);
    }
  } finally {
    try {
      void reader.cancel();
    } catch {
      // Ya terminado/cancelado — nunca rompe por esto.
    }
  }
  return Buffer.concat(partes.map((p) => Buffer.from(p)));
}

// Descarga una imagen externa con las defensas anti-SSRF que pidió la
// tarea: solo https, solo el allowlist de Canva de arriba, DNS
// resuelto y rechazado si cae en una IP privada/link-local/metadata,
// tiempo máximo, tope de bytes REAL (por chunk, nunca solo por
// content-length — ver leerCuerpoConTope), Content-Type declarado
// verificado Y, además, las firmas binarias reales del archivo
// (tipoImagenPorMagicBytes) — el header nunca es prueba suficiente por
// sí solo. `redirect: "error"` a propósito — un redirect nos podría
// mandar a una IP distinta de la que ya se validó (el mismo truco que
// un SSRF clásico usa para esquivar el chequeo de DNS); mejor rechazar
// que seguirlo a ciegas.
//
// Límite conocido y aceptado para esta primera versión (documentado,
// no silencioso): esto NO fija la conexión a la IP ya resuelta — fetch()
// vuelve a resolver el DNS por su cuenta. Cierra el caso real (un link
// que apunta directo a una IP privada), no un DNS rebinding con TTL=0
// cronometrado — se revisa si aparece evidencia real de que hace falta.
export async function descargarImagenExternaSegura(urlCruda: string): Promise<{ buffer: Buffer; contentType: string }> {
  let url: URL;
  try {
    url = new URL(urlCruda);
  } catch {
    throw new UrlExternaInvalidaError("Ese link no es una URL válida.");
  }
  if (url.protocol !== "https:") throw new UrlExternaInvalidaError("Solo se acepta un link https.");
  if (!hostPermitidoCanva(url.hostname)) {
    throw new UrlExternaNoPermitidaError(`"${url.hostname}" no está en la lista permitida — solo exportaciones reales de Canva, nunca el link de compartir el diseño.`);
  }

  let direcciones: { address: string }[];
  try {
    direcciones = await lookup(url.hostname, { all: true });
  } catch {
    throw new UrlExternaNoDisponibleError("No se pudo resolver ese dominio.");
  }
  if (direcciones.length === 0 || direcciones.some((d) => esIpPrivadaOEspecial(d.address))) {
    throw new UrlExternaNoPermitidaError("Ese dominio resuelve a una dirección privada — no se permite.");
  }

  let res: Response;
  try {
    res = await fetch(url.toString(), { signal: AbortSignal.timeout(TIMEOUT_MS), redirect: "error" });
  } catch {
    throw new UrlExternaNoDisponibleError("No se pudo descargar esa imagen a tiempo.");
  }
  if (!res.ok) throw new UrlExternaNoDisponibleError(`Esa imagen respondió ${res.status}.`);

  const contentTypeDeclarado = (res.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
  if (!TIPOS_IMAGEN_VALIDOS.has(contentTypeDeclarado)) {
    throw new UrlExternaTipoInvalidoError(`Tipo de archivo no permitido (${contentTypeDeclarado || "desconocido"}) — solo JPEG, PNG o WEBP.`);
  }

  // Chequeo rápido por content-length (si viene) ANTES de leer nada —
  // leerCuerpoConTope hace el chequeo REAL de todas formas, pero esto
  // evita abrir el stream para un caso ya descartable de entrada.
  const contentLengthCrudo = res.headers.get("content-length");
  const contentLength = Number(contentLengthCrudo);
  if (contentLengthCrudo && Number.isFinite(contentLength) && contentLength > TAMANO_MAXIMO_FOTO_EXTERNA_BYTES) {
    throw new UrlExternaDemasiadoGrandeError("La imagen supera el tamaño máximo permitido.");
  }

  const buffer = await leerCuerpoConTope(res, TAMANO_MAXIMO_FOTO_EXTERNA_BYTES);

  const contentTypeReal = tipoImagenPorMagicBytes(buffer);
  if (!contentTypeReal) {
    throw new UrlExternaTipoInvalidoError("El archivo descargado no tiene una firma real de JPEG, PNG ni WEBP — el Content-Type declarado no es prueba suficiente.");
  }

  return { buffer, contentType: contentTypeReal };
}
