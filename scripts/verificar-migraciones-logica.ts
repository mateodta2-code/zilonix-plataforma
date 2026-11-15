export const MENSAJE_AYUDA =
  "Actualiza tu rama con main y vuelve a generar la migración con npm run db:generate";

export type EntradaJournal = { idx: number; tag: string };
export type Journal = { entries: EntradaJournal[] };

// Función pura, sin tocar el disco — recibe el journal ya parseado y
// la lista de nombres de archivo .sql ya leída, para poder probarla
// con journals de ejemplo fabricados en memoria (incluido el caso real
// de la "0008 duplicada") sin tener que crear archivos reales en disco
// para cada escenario.
export function verificarHistorialMigraciones(journal: Journal, archivosSql: string[]): string[] {
  const problemas: string[] = [];

  // 1) idx contiguos desde 0 — sin huecos, sin duplicados (un idx
  // repetido también rompe la contigüidad: al ordenar, alguna posición
  // va a tener un valor distinto al esperado).
  const idxOrdenados = journal.entries.map((e) => e.idx).sort((a, b) => a - b);
  idxOrdenados.forEach((idx, posicion) => {
    if (idx !== posicion) {
      problemas.push(`El journal tiene un idx fuera de secuencia: en la posición ${posicion} se esperaba idx=${posicion}, se encontró idx=${idx}.`);
    }
  });

  // 2) toda entrada del journal tiene su archivo .sql real (por tag).
  for (const entrada of journal.entries) {
    const archivoEsperado = `${entrada.tag}.sql`;
    if (!archivosSql.includes(archivoEsperado)) {
      problemas.push(
        `El journal tiene la entrada idx=${entrada.idx} (tag "${entrada.tag}") pero no existe el archivo ${archivoEsperado} en db/migrations/.`
      );
    }
  }

  // 3) todo archivo .sql tiene su entrada en el journal (por tag).
  const tagsDelJournal = new Set(journal.entries.map((e) => e.tag));
  for (const archivo of archivosSql) {
    const tag = archivo.replace(/\.sql$/, "");
    if (!tagsDelJournal.has(tag)) {
      problemas.push(`El archivo ${archivo} existe en db/migrations/ pero no tiene ninguna entrada en el journal (tag "${tag}").`);
    }
  }

  // 4) ningún prefijo numérico se repite entre dos .sql — el caso real
  // de la "0008 duplicada": dos ramas, cada una con su propia migración
  // para el mismo número, nunca debería llegar a fusionarse sin que
  // alguien renumere una de las dos a mano.
  const archivosPorPrefijo = new Map<string, string[]>();
  for (const archivo of archivosSql) {
    const match = archivo.match(/^(\d+)_/);
    if (!match) continue; // un nombre sin el prefijo esperado no es asunto de esta regla puntual
    const prefijo = match[1];
    const lista = archivosPorPrefijo.get(prefijo) ?? [];
    lista.push(archivo);
    archivosPorPrefijo.set(prefijo, lista);
  }
  for (const [prefijo, archivos] of archivosPorPrefijo) {
    if (archivos.length > 1) {
      problemas.push(
        `El prefijo ${prefijo} se repite en ${archivos.length} archivos (${archivos.sort().join(", ")}) — dos ramas generaron cada una su propia migración con el mismo número; hay que renumerar una de las dos al fusionar, nunca a mano sin regenerar.`
      );
    }
  }

  return problemas;
}

