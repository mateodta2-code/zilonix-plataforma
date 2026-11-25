import { BarraCarga } from "@/components/marco/BarraCarga";

// Refs #681 — barra azul indeterminada mientras carga la bitácora general.
export default function Cargando() {
  return <BarraCarga estado="cargando" titulo="Cargando la bitácora…" />;
}
