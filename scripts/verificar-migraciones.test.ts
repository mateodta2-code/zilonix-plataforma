import { readFileSync, readdirSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";
import {
  MENSAJE_AYUDA,
  verificarHistorialMigraciones,
  type EntradaJournal,
  type Journal,
} from "./verificar-migraciones-logica";

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

function leerArchivosSqlReales(): string[] {
  return readdirSync(DIR_MIGRACIONES).filter((nombre) => nombre.endsWith(".sql"));
}

function leerJournalReal(): Journal {
  return JSON.parse(readFileSync(RUTA_JOURNAL, "utf8"));
}

describe("Z-P0-08 (issue #36) — el historial real de db/migrations/ está sano", () => {
  it("db/migrations/ no tiene idx fuera de secuencia, tags sin archivo, archivos sin tag, ni prefijos repetidos", () => {
    const problemas = verificarHistorialMigraciones(leerJournalReal(), leerArchivosSqlReales());
    expect(problemas, `${problemas.join("\n")}\n${MENSAJE_AYUDA}`).toEqual([]);
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
