import { obtenerAccessTokenVigente } from "@/lib/ml/cuentas";
import { itemNoModificablePorRevision } from "@/lib/ml/publicar-reglas";

// §11 — pausar/activar una publicación sin entrar a Mercado Libre.
export async function cambiarEstadoItemMl(empresaId: string, cuentaId: string, itemId: string, activar: boolean): Promise<{ status: string }> {
  const token = await obtenerAccessTokenVigente(empresaId, cuentaId);
  const res = await fetch(`https://api.mercadolibre.com/items/${itemId}`, {
    method: "PUT",
    headers: { Authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ status: activar ? "active" : "paused" }),
  });
  const texto = await res.text().catch(() => "");
  if (!res.ok) {
    // BUG real (Mateo, 25/9, primero visto en FullyLemon): mientras
    // Mercado Libre revisa una publicación nueva ("under_review"), no
    // deja tocar el status por API — no es un error nuestro.
    if (itemNoModificablePorRevision(texto)) {
      throw new Error(
        "Mercado Libre todavía está revisando esta publicación (recién creada) y no deja apagarla ni encenderla hasta que termine esa revisión. Intenta de nuevo en un rato."
      );
    }
    throw new Error(`Mercado Libre rechazó el cambio (HTTP ${res.status}): ${texto.slice(0, 400)}`);
  }
  const data = JSON.parse(texto);
  return { status: data.status };
}
