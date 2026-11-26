import { BarraCarga } from "@/components/marco/BarraCarga";

// Barra azul indeterminada mientras el servidor lee ventas y Ads.
export default function Cargando() {
  return <BarraCarga estado="cargando" titulo="Cargando rendimiento…" />;
}
