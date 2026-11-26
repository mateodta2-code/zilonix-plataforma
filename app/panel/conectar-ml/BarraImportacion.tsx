"use client";

import { BarraCarga } from "@/components/marco/BarraCarga";

// Barra azul de la importación inicial (Barra-B). La página es un Server
// Component que ya se refresca sola cada 5 s (ActualizarMientrasImporta):
// este componente solo dibuja lo que llega por props, sin sondeo propio.
// Con varias cuentas, sticky={false} para que las bandas no se apilen
// pegadas arriba.
export function BarraImportacion({
  dias,
  pedidosImportados,
  pedidosEncontrados,
  sticky = true,
}: {
  dias: number;
  pedidosImportados: number;
  pedidosEncontrados: number | null;
  sticky?: boolean;
}) {
  const total = pedidosEncontrados ?? 0;
  return (
    <BarraCarga
      estado="cargando"
      titulo={`Importando pedidos y publicaciones de los últimos ${dias} días…`}
      avance={total > 0 ? { hechos: pedidosImportados, total } : null}
      unidad="pedidos"
      ariaLabel="Progreso de la importación de pedidos"
      sticky={sticky}
    />
  );
}
