import { BarraCarga } from "@/components/marco/BarraCarga";

// Refs #677 — barra azul indeterminada mientras carga la lista del servidor.
export default function Cargando() {
  return <BarraCarga estado="cargando" titulo="Cargando publicaciones…" />;
}
