import { redirect } from "next/navigation";

// El módulo de Clip se retiró por completo (pedido de Mateo). Esta ruta
// se conserva solo como redirect a /panel/publicar para no romper un
// link viejo guardado (bookmark, una notificación ya mandada, el botón
// "Importar video a Clip" de una extensión ya instalada). Nunca lee ni
// escribe nada — por eso está en RUTAS_EXENTAS
// (scripts/verificar-permisos.test.ts); el permiso real se revisa en
// /panel/publicar.
export default function PublicarClipPage() {
  redirect("/panel/publicar");
}
