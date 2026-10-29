import { buscarItemPorSku } from "@/lib/ml/clip";

// Code review de Pablo (sobre 768305e) — BLOQUEANTE real cerrado:
// esta función vivía exportada desde clip/actions.ts, un archivo con
// "use server" arriba — eso hace que Next.js expusiera CUALQUIER
// función exportada de ahí como una Server Action invocable desde el
// cliente, con su propio id de acción. buscarItemConDatos recibe
// empresaId/cuentaId como parámetros CRUDOS, sin ninguna sesión,
// permiso ni CLIP_HABILITADO adentro (a propósito: solo la resuelve
// page.tsx, que YA tiene la empresa real de la sesión y ya chequeó la
// bandera) — invocada directo como acción, con un empresaId
// cualquiera, hubiera sido una fuga real entre empresas. Movida a su
// propio módulo SIN "use server": un archivo normal solo se puede
// importar desde otro código del servidor (page.tsx, un Server
// Component) — nunca se genera un endpoint de acción para él.
export async function buscarItemConDatos(empresaId: string, cuentaId: string, cuentaIdExterna: string, sku: string) {
  return buscarItemPorSku(empresaId, { id: cuentaId, cuentaIdExterna }, sku);
}
