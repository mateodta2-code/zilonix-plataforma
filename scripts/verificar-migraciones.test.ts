import { readFileSync, readdirSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";

// Issue #36 (Z-P0-08), sub-tarea S1 — la colisión real ya documentada
// en docs/ESTADO.md ("Problemas conocidos §3"): dos ramas distintas
// (2.9 y 2.10) generaron cada una su propia migración `0008_*.sql`
// antes de que ninguna se fusionara a `main`. Nadie lo notó hasta
// revisar el journal a mano. Esta prueba lo detecta en CI, en
// cualquier PR, antes de que una migración rota llegue a fusionarse —
// S2 (el paso `npx drizzle-kit check` en `ci.yml`) es trabajo aparte,
// fuera de este PR.
const RAIZ = process.cwd();
const DIR_MIGRACIONES = join(RAIZ, "db/migrations");
const RUTA_JOURNAL = join(DIR_MIGRACIONES, "meta/_journal.json");

type EntradaJournal = { idx: number; tag: string };
type Journal = { entries: EntradaJournal[] };

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

function leerArchivosSqlReales(): string[] {
  return readdirSync(DIR_MIGRACIONES).filter((nombre) => nombre.endsWith(".sql"));
}

function leerJournalReal(): Journal {
  return JSON.parse(readFileSync(RUTA_JOURNAL, "utf8"));
}

describe("Z-P0-08 (issue #36) — el historial real de db/migrations/ está sano", () => {
  it("db/migrations/ no tiene idx fuera de secuencia, tags sin archivo, archivos sin tag, ni prefijos repetidos", () => {
    const problemas = verificarHistorialMigraciones(leerJournalReal(), leerArchivosSqlReales());
    expect(problemas, problemas.join("\n")).toEqual([]);
  });
});

describe("verificarHistorialMigraciones (función pura) — casos de ejemplo en memoria", () => {
  function entrada(idx: number, tag: string): EntradaJournal {
    return { idx, tag };
  }

  it("journal sano, todo contiguo y cada tag con su archivo -> sin problemas", () => {
    const journal: Journal = { entries: [entrada(0, "0000_a"), entrada(1, "0001_b")] };
    const archivos = ["0000_a.sql", "0001_b.sql"];
    expect(verificarHistorialMigraciones(journal, archivos)).toEqual([]);
  });

  it("idx con un hueco (0, 1, 3) -> falla mencionando la posición y el idx encontrado", () => {
    const journal: Journal = { entries: [entrada(0, "0000_a"), entrada(1, "0001_b"), entrada(3, "0003_d")] };
    const archivos = ["0000_a.sql", "0001_b.sql", "0003_d.sql"];
    const problemas = verificarHistorialMigraciones(journal, archivos);
    expect(problemas.some((p) => p.includes("idx=3"))).toBe(true);
  });

  it("idx duplicado (0, 1, 1) -> falla (deja de ser contiguo apenas se ordena)", () => {
    const journal: Journal = { entries: [entrada(0, "0000_a"), entrada(1, "0001_b"), entrada(1, "0001_b_otra")] };
    const archivos = ["0000_a.sql", "0001_b.sql", "0001_b_otra.sql"];
    const problemas = verificarHistorialMigraciones(journal, archivos);
    expect(problemas.length).toBeGreaterThan(0);
  });

  it("una entrada del journal sin su archivo .sql real -> falla mencionando el archivo esperado", () => {
    const journal: Journal = { entries: [entrada(0, "0000_a"), entrada(1, "0001_fantasma")] };
    const archivos = ["0000_a.sql"]; // falta 0001_fantasma.sql
    const problemas = verificarHistorialMigraciones(journal, archivos);
    expect(problemas.some((p) => p.includes("0001_fantasma.sql"))).toBe(true);
  });

  it("un archivo .sql sin entrada en el journal -> falla mencionando el archivo", () => {
    const journal: Journal = { entries: [entrada(0, "0000_a")] };
    const archivos = ["0000_a.sql", "0001_huerfano.sql"]; // sin entrada en el journal
    const problemas = verificarHistorialMigraciones(journal, archivos);
    expect(problemas.some((p) => p.includes("0001_huerfano.sql"))).toBe(true);
  });

  it("dos ramas generan cada una su propia 0008_* (caso real, docs/ESTADO.md §3) -> falla mencionando el prefijo y los dos archivos", () => {
    const journal: Journal = { entries: [entrada(0, "0000_a"), entrada(8, "0008_married_thunderbird")] };
    // Simula exactamente el choque real ya documentado: dos archivos
    // 0008_* en el mismo directorio, como pasaría al fusionar ambas
    // ramas sin que nadie renumere ninguna.
    const archivos = ["0000_a.sql", "0008_married_thunderbird.sql", "0008_useful_skreet.sql"];
    const problemas = verificarHistorialMigraciones(journal, archivos);
    expect(
      problemas.some((p) => p.includes("0008") && p.includes("0008_married_thunderbird.sql") && p.includes("0008_useful_skreet.sql"))
    ).toBe(true);
  });

  it("journal y lista de archivos vacíos -> sin problemas (proyecto nuevo, sin migraciones todavía)", () => {
    expect(verificarHistorialMigraciones({ entries: [] }, [])).toEqual([]);
  });
});
