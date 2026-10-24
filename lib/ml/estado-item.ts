import { obtenerAccessTokenVigente } from "@/lib/ml/cuentas";
import { actualizarItemMl } from "@/lib/ml/cliente";
import { itemNoModificablePorRevision } from "@/lib/ml/publicar-reglas";

// §11 — pausar/activar una publicación sin entrar a Mercado Libre.
// Tarea 2.11, punto 2/3: fetch directo movido a actualizarItemMl
// (lib/ml/cliente.ts) — valida itemId (el que llega de
// app/panel/publicar/clip/actions.ts) antes de armar la URL.
export async function cambiarEstadoItemMl(empresaId: string, cuentaId: string, itemId: string, activar: boolean): Promise<{ status: string }> {
  const token = await obtenerAccessTokenVigente(empresaId, cuentaId);
  const { ok, status, data, textoCrudo } = await actualizarItemMl(itemId, token, { status: activar ? "active" : "paused" });
  if (!ok) {
    // BUG real (Mateo, 25/9, primero visto en FullyLemon): mientras
    // Mercado Libre revisa una publicación nueva ("under_review"), no
    // deja tocar el status por API — no es un error nuestro.
    if (itemNoModificablePorRevision(textoCrudo)) {
      throw new Error(
        "Mercado Libre todavía está revisando esta publicación (recién creada) y no deja apagarla ni encenderla hasta que termine esa revisión. Intenta de nuevo en un rato."
      );
    }
    throw new Error(`Mercado Libre rechazó el cambio (HTTP ${status}): ${textoCrudo.slice(0, 400)}`);
  }
  return { status: data?.status as string };
}
