import { HostnameNoResueltoError, HostnamePrivadoError, exigirHostnamePublico } from "@/lib/seguridad/ssrf";

// Resuelve el design_id a partir de lo que el usuario pegue en "Link de
// Canva" — corto (canva.link/xxx, el link de "Compartir") o largo
// (canva.com/design/<id>/edit). El formato del ID (regex) está
// confirmado contra zilonix-os-web/lib/canva.js (extraerDesignId), ya
// funcionando en producción.
//
// A diferencia de esa implementación — que sigue el redirect del link
// corto con un fetch() normal, sin validar host ni IP (hallazgo real de
// la investigación: cualquier usuario logueado podía mandar al
// servidor a pedir cualquier URL/IP interna) — acá cada salto de
// redirección se valida: el destino tiene que ser canva.com (nunca
// cualquier otro host) y su DNS no puede resolver a una IP privada
// (exigirHostnamePublico, lib/seguridad/ssrf.ts — mismas primitivas que
// ya usa el campo de fotos externas, Parte 3 punto C).
const REGEX_DESIGN_ID = /DA[A-Za-z0-9_-]+/;
const TIMEOUT_MS = 8_000;
const MAX_SALTOS = 5;

export class EnlaceCanvaInvalidoError extends Error {}
export class EnlaceCanvaNoPermitidoError extends Error {}
export class EnlaceCanvaNoDisponibleError extends Error {}
export class EnlaceCanvaSinDesignIdError extends Error {}

function hostEsCanvaLink(hostname: string): boolean {
  return hostname.toLowerCase() === "canva.link";
}

function hostEsCanvaCom(hostname: string): boolean {
  const h = hostname.toLowerCase();
  return h === "canva.com" || h.endsWith(".canva.com");
}

function extraerDesignId(url: URL): string | null {
  const match = url.toString().match(REGEX_DESIGN_ID);
  return match ? match[0] : null;
}

async function exigirHostPublico(hostname: string): Promise<void> {
  try {
    await exigirHostnamePublico(hostname);
  } catch (e) {
    if (e instanceof HostnameNoResueltoError) throw new EnlaceCanvaNoDisponibleError(e.message);
    if (e instanceof HostnamePrivadoError) throw new EnlaceCanvaNoPermitidoError(e.message);
    throw e;
  }
}

export async function resolverDesignId(enlaceCrudo: string): Promise<string> {
  let url: URL;
  try {
    url = new URL(enlaceCrudo.trim());
  } catch {
    throw new EnlaceCanvaInvalidoError("Ese link no es una URL válida.");
  }
  if (url.protocol !== "https:") {
    throw new EnlaceCanvaInvalidoError("Solo se acepta un link https.");
  }

  if (!hostEsCanvaCom(url.hostname) && !hostEsCanvaLink(url.hostname)) {
    throw new EnlaceCanvaNoPermitidoError(`"${url.hostname}" no es un link de Canva — pega el link de "Compartir" o el de edición del diseño.`);
  }

  // Link largo: el design_id ya está en la URL, nunca hace falta
  // seguir ninguna redirección para este caso.
  if (hostEsCanvaCom(url.hostname)) {
    const designId = extraerDesignId(url);
    if (!designId) throw new EnlaceCanvaSinDesignIdError("No se encontró el ID del diseño en ese link de Canva.");
    return designId;
  }

  // Link corto (canva.link): hay que seguir la redirección real,
  // validando cada salto — nunca con redirect:"follow", que no deja
  // inspeccionar los saltos intermedios.
  let actual = url;
  for (let salto = 0; salto < MAX_SALTOS; salto++) {
    await exigirHostPublico(actual.hostname);

    let res: Response;
    try {
      res = await fetch(actual.toString(), { redirect: "manual", signal: AbortSignal.timeout(TIMEOUT_MS) });
    } catch {
      throw new EnlaceCanvaNoDisponibleError("No se pudo abrir ese link de Canva a tiempo.");
    }

    if (res.status >= 300 && res.status < 400) {
      const ubicacion = res.headers.get("location");
      if (!ubicacion) throw new EnlaceCanvaNoDisponibleError("Ese link de Canva no redirige a ningún lado.");
      let siguiente: URL;
      try {
        siguiente = new URL(ubicacion, actual);
      } catch {
        throw new EnlaceCanvaNoDisponibleError("Ese link de Canva redirige a una URL inválida.");
      }
      if (siguiente.protocol !== "https:") {
        throw new EnlaceCanvaNoPermitidoError("Ese link de Canva redirige a un destino no permitido.");
      }
      // El destino de la redirección SOLO puede ser canva.com — nunca
      // se sigue a otro host, ni siquiera otro canva.link encadenado.
      if (!hostEsCanvaCom(siguiente.hostname)) {
        throw new EnlaceCanvaNoPermitidoError(`Ese link de Canva redirige a "${siguiente.hostname}", fuera de canva.com.`);
      }
      actual = siguiente;
      continue;
    }

    if (!hostEsCanvaCom(actual.hostname)) {
      throw new EnlaceCanvaNoPermitidoError("Ese link de Canva no terminó en canva.com.");
    }
    const designId = extraerDesignId(actual);
    if (!designId) throw new EnlaceCanvaSinDesignIdError("No se encontró el ID del diseño en ese link de Canva.");
    return designId;
  }

  throw new EnlaceCanvaNoDisponibleError("Ese link de Canva tiene demasiadas redirecciones.");
}
