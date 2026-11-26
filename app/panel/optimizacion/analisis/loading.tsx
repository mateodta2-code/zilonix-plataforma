import { BarraCarga } from "@/components/marco/BarraCarga";

// Barra azul indeterminada mientras el servidor lee ventas y visitas de la cuenta.
export default function Cargando() {
  return <BarraCarga estado="cargando" titulo="Analizando tus ingresos…" />;
}
