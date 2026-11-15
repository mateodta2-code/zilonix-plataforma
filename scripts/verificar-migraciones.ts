import { readFileSync, readdirSync } from "fs";
import { join } from "path";
import { MENSAJE_AYUDA, verificarHistorialMigraciones } from "./verificar-migraciones-logica";

// Chequeo de CI: números repetidos o journal que no coincide con los .sql.
const dir = join(process.cwd(), "db/migrations");
const journal = JSON.parse(readFileSync(join(dir, "meta/_journal.json"), "utf8"));
const problemas = verificarHistorialMigraciones(journal, readdirSync(dir).filter((n) => n.endsWith(".sql")));
if (problemas.length > 0) {
  console.error(problemas.join("\n"));
  console.error(`\n${MENSAJE_AYUDA}`);
  process.exit(1);
}
console.log("Historial de migraciones sano.");
