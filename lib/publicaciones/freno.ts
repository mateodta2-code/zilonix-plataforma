// Publicar → «Crear con IA» — freno anti-abuso de las llamadas de TEXTO
// por empresa. No es un cupo (cada empresa paga su IA): solo evita que un
// error o un abuso queme la cuenta de IA de la empresa. En memoria, por
// proceso (no hace falta tabla para textos); el PR2 de imágenes cuenta
// en la base.

export const MAXIMO_LLAMADAS_TEXTO_POR_MINUTO = 30;
const VENTANA_MS = 60_000;

const llamadas = new Map<string, number[]>();

// true = puede seguir (y queda contada); false = llegó al tope.
export function permitirLlamadaTexto(empresaId: string, ahora = Date.now(), maximo = MAXIMO_LLAMADAS_TEXTO_POR_MINUTO): boolean {
  const recientes = (llamadas.get(empresaId) ?? []).filter((t) => ahora - t < VENTANA_MS);
  if (recientes.length >= maximo) {
    llamadas.set(empresaId, recientes);
    return false;
  }
  recientes.push(ahora);
  llamadas.set(empresaId, recientes);
  return true;
}

// Solo para pruebas.
export function reiniciarFrenoTexto(): void {
  llamadas.clear();
}
