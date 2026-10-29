import { lookup } from "dns/promises";
import { isIP } from "net";

// Primitivas anti-SSRF compartidas — antes vivían SOLO dentro de
// app/panel/publicar/fotos/validar-url-externa.ts (Canva, Parte 3).
// Rama feat-publicar-clip necesita exactamente las mismas 2 cosas
// (resolver un hostname y rechazar si cae en una IP privada) para la
// descarga de video por link — se extrajeron a un módulo propio para
// no duplicar la lista de rangos, nunca para cambiar el criterio.

// Rangos privados/especiales reales (RFC 1918, RFC 3927, loopback,
// CGNAT, y 169.254.169.254 — la IP de metadata de AWS/GCP/Azure, el
// blanco clásico de un SSRF contra infraestructura en la nube). Nunca
// se confía en que "parece una URL pública" — se resuelve el DNS de
// verdad y se rechaza si CUALQUIERA de las IPs resueltas cae en estos
// rangos.
export function esIpPrivadaOEspecial(ip: string): boolean {
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

// 2 errores distintos a propósito (nunca uno solo): un dominio que no
// resuelve (`HostnameNoResueltoError`) es "no disponible ahora" —
// puede ser un link roto o un problema transitorio de DNS; un dominio
// que SÍ resuelve pero a una IP privada (`HostnamePrivadoError`) es un
// intento real de SSRF — cada llamador (fotos, video) mapea cada uno a
// su propio error de dominio, nunca los mezcla en un solo mensaje.
export class HostnameNoResueltoError extends Error {}
export class HostnamePrivadoError extends Error {}

// Resuelve el hostname de verdad y rechaza si CUALQUIERA de las IPs
// (puede resolver a varias — round robin de un CDN real) cae en un
// rango privado/especial. Nunca se llama a fetch antes de esto.
export async function exigirHostnamePublico(hostname: string): Promise<void> {
  let direcciones: { address: string }[];
  try {
    direcciones = await lookup(hostname, { all: true });
  } catch {
    throw new HostnameNoResueltoError("No se pudo resolver ese dominio.");
  }
  if (direcciones.length === 0 || direcciones.some((d) => esIpPrivadaOEspecial(d.address))) {
    throw new HostnamePrivadoError("Ese dominio resuelve a una dirección privada — no se permite.");
  }
}
