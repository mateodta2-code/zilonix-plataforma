import { BarraCarga } from "@/components/marco/BarraCarga";

// Refs #677 — barra azul indeterminada mientras carga la ficha de la publicación.
export default function Cargando() {
  return <BarraCarga estado="cargando" titulo="Cargando la publicación…" />;
}
