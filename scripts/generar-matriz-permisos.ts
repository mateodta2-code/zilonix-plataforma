import { writeFileSync } from "fs";
import { join } from "path";
import { generarMatrizMarkdown } from "../lib/matriz-permisos";

const destino = join(process.cwd(), "docs", "matriz-permisos.md");
writeFileSync(destino, generarMatrizMarkdown());
console.log(`docs/matriz-permisos.md actualizado desde lib/roles.ts.`);
