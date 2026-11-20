// Publicar → «Crear con IA» — freno de CONCURRENCIA de las llamadas de
// texto por empresa (decisión de Mateo, 19-nov-2026): sin límite por
// minuto, hora, día ni mes (cada empresa paga su IA). Solo un máximo de
// llamadas al mismo tiempo para proteger el servidor; las demás esperan
// en fila y arrancan solas. En memoria, por proceso. El PR2 de imágenes
// cuenta en la base (máximo 2 generando por empresa).

export const MAXIMO_TEXTO_SIMULTANEO_POR_EMPRESA = 4;

const enCurso = new Map<string, number>();
const enEspera = new Map<string, (() => void)[]>();

async function tomarCupo(empresaId: string, maximo: number): Promise<void> {
  const ocupados = enCurso.get(empresaId) ?? 0;
  if (ocupados < maximo) {
    enCurso.set(empresaId, ocupados + 1);
    return;
  }
  // Sin cupo: espera su turno. Quien libera le pasa el cupo directo.
  await new Promise<void>((resolver) => {
    const fila = enEspera.get(empresaId) ?? [];
    fila.push(resolver);
    enEspera.set(empresaId, fila);
  });
}

function soltarCupo(empresaId: string): void {
  const siguiente = enEspera.get(empresaId)?.shift();
  if (siguiente) {
    siguiente(); // el cupo pasa al siguiente, enCurso no cambia
    return;
  }
  const ocupados = (enCurso.get(empresaId) ?? 1) - 1;
  if (ocupados <= 0) enCurso.delete(empresaId);
  else enCurso.set(empresaId, ocupados);
}

// Corre `tarea` cuando la empresa tiene cupo; nunca la rechaza.
export async function conCupoDeTexto<T>(empresaId: string, tarea: () => Promise<T>, maximo = MAXIMO_TEXTO_SIMULTANEO_POR_EMPRESA): Promise<T> {
  await tomarCupo(empresaId, maximo);
  try {
    return await tarea();
  } finally {
    soltarCupo(empresaId);
  }
}

// Solo para pruebas.
export function llamadasDeTextoEnCurso(empresaId: string): number {
  return enCurso.get(empresaId) ?? 0;
}

export function reiniciarFrenoTexto(): void {
  enCurso.clear();
  enEspera.clear();
}
