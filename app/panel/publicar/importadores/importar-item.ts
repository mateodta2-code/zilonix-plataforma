import { obtenerAccessTokenVigente } from "@/lib/ml/cuentas";
import { leerDescripcionItemMl, leerItemCompletoMl } from "@/lib/ml/cliente";
import type { ItemImportado } from "../formulario-logica";

// Parte 3, puntos A.1/A.2 — mismo motivo que clip/buscar-item.ts
// (código revisado por Pablo sobre 768305e): esta función recibe
// empresaId/cuentaId CRUDOS, sin sesión/permiso/empresa activa
// adentro, a propósito — solo page.tsx (Server Component, que YA
// resolvió la empresa real de la sesión y ya llamó requierePermiso)
// la puede llamar. Vive en un módulo SIN "use server" para que Next.js
// nunca la exponga como una Server Action invocable directo desde el
// cliente con un empresaId cualquiera — la misma fuga real que se
// cerró ahí.
//
// null = Mercado Libre no pudo traer el ítem (403/404/5xx, o un id que
// nunca existió) — el llamador (page.tsx) lo interpreta como "no se
// puede traer por la API oficial" y la UI manda a usar el bookmarklet
// o el botón de la extensión en su lugar (scraping del servidor está
// prohibido, ver CLAUDE.md).
export async function importarItemCompleto(empresaId: string, cuentaId: string, itemId: string): Promise<ItemImportado | null> {
  const token = await obtenerAccessTokenVigente(empresaId, cuentaId);
  const item = await leerItemCompletoMl(itemId, token);
  if (!item) return null;
  const descripcion = await leerDescripcionItemMl(itemId, token);
  return {
    titulo: item.title ?? "",
    descripcion: descripcion ?? "",
    precio: item.price != null ? String(item.price) : "",
    stock: item.availableQuantity != null ? String(item.availableQuantity) : "",
    sku: item.sellerCustomField ?? "",
    imagenes: item.pictures,
    dimensiones: {},
  };
}
