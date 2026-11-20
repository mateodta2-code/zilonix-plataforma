// Rama feat-investigacion-buscar-por-foto — baja UNA miniatura de
// Mercado Libre para compararla con la foto. SOLO servidor. Protección
// SSRF en capas: lista blanca de host (https + mlstatic.com), sin
// seguir redirects a ciegas (cada salto se revalida con la misma lista
// blanca), timeout, tope de 300 KB leyendo en streaming y tipo real por
// firma de bytes. Todo en memoria: nada se guarda.
import { detectarTipoImagen, esUrlMiniaturaPermitida, MAX_BYTES_MINIATURA, MAX_REDIRECTS_MINIATURA, TIMEOUT_MINIATURA_MS, type TipoImagen } from "@/lib/ml/buscarPorFoto";

export type MiniaturaDescargada = { mediaType: TipoImagen; base64: string };

async function leerConTope(res: Response, maxBytes: number): Promise<Uint8Array | null> {
  const declarado = Number(res.headers.get("content-length"));
  if (Number.isFinite(declarado) && declarado > maxBytes) return null;
  if (!res.body) return null;
  const lector = res.body.getReader();
  const partes: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await lector.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await lector.cancel().catch(() => undefined);
      return null;
    }
    partes.push(value);
  }
  const todo = new Uint8Array(total);
  let pos = 0;
  for (const p of partes) {
    todo.set(p, pos);
    pos += p.byteLength;
  }
  return todo;
}

// Nunca lanza: cualquier problema devuelve null (la miniatura queda
// como «dudoso» en la comparación).
export async function descargarMiniatura(urlInicial: string): Promise<MiniaturaDescargada | null> {
  try {
    let url = urlInicial;
    for (let salto = 0; salto <= MAX_REDIRECTS_MINIATURA; salto++) {
      if (!esUrlMiniaturaPermitida(url)) return null;
      const res = await fetch(url, { redirect: "manual", signal: AbortSignal.timeout(TIMEOUT_MINIATURA_MS), headers: { accept: "image/*" } });
      if (res.status >= 300 && res.status < 400) {
        const destino = res.headers.get("location");
        if (!destino) return null;
        url = new URL(destino, url).toString(); // se revalida arriba en la siguiente vuelta
        continue;
      }
      if (!res.ok) return null;
      const bytes = await leerConTope(res, MAX_BYTES_MINIATURA);
      if (!bytes) return null;
      const mediaType = detectarTipoImagen(bytes);
      if (!mediaType) return null;
      return { mediaType, base64: Buffer.from(bytes).toString("base64") };
    }
    return null;
  } catch {
    return null;
  }
}
