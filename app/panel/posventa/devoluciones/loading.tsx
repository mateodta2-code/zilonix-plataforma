import { BarraCarga } from "@/components/marco/BarraCarga";

// Refs #647 — barra azul indeterminada mientras la pestaña lee de Mercado Libre.
export default function Cargando() {
  return <BarraCarga estado="cargando" titulo="Cargando devoluciones…" />;
}
