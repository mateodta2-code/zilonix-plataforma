"use client";

import { CopiarTexto } from "./CopiarTexto";

// Envoltorio fino: el SKU visible, copiable con un clic. Sin SKU no
// renderiza nada — cada pantalla conserva su "—" / "sin SKU" actual.
export function SkuCopiable({ sku, comoSpan, prefijo }: { sku: string | null | undefined; comoSpan?: boolean; prefijo?: string }) {
  if (!sku) return null;
  return (
    <>
      {prefijo}
      <CopiarTexto valor={sku} etiquetaAria={"Copiar SKU " + sku} mensajeCopiado="SKU copiado" comoSpan={comoSpan} />
    </>
  );
}
