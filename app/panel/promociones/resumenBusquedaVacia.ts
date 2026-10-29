import type { TrabajoBusquedaCliente } from "./tipos-cliente";

// Bug real en staging (rama fix-promociones-buscar, Refs #44) — una
// empresa dio "Buscar", la búsqueda terminó de verdad (terminadoTs
// puesto) pero sin ningún candidato (la sospecha confirmada: una
// cuenta sin el scope de Promociones) y la pantalla mostraba el MISMO
// "todavía no hay resultados — dale Buscar arriba" que una página
// recién abierta donde nunca se corrió nada — sin ninguna pista de qué
// pasó, por cuenta. Extraído a parte (sin librería de renderizado de
// React en este repo, ver mensajes-error.ts para el mismo criterio)
// para poder probar la decisión y el texto sin montar el componente.

export function debeMostrarResumenBusquedaVacia(trabajo: TrabajoBusquedaCliente | null, candidatosLength: number): boolean {
  return candidatosLength === 0 && trabajo?.terminadoTs != null;
}

export type LineaResumenCuentaVacia = { cuentaId: string; texto: string; tieneError: boolean };

export function lineasResumenBusquedaVacia(trabajo: TrabajoBusquedaCliente): LineaResumenCuentaVacia[] {
  return trabajo.cuentas.map((c) => ({
    cuentaId: c.cuentaId,
    texto: `${c.nickname}: ${c.productosRevisados} producto(s) revisados, ${c.itemsConPromociones} con promociones.${c.error ? ` ${c.error}` : ""}`,
    tieneError: c.error != null,
  }));
}
