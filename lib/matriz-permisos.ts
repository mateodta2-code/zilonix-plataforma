import { MODULOS, PERMISOS_PELIGROSOS, permisosDeDueno, PLANTILLAS, type Permiso } from "@/lib/roles-plantillas";

// Tarea 1.8 — "tabla de roles × módulos generada automáticamente en
// docs/ coincide con la que aprobaste". Esta función es la única
// fuente de verdad del contenido de docs/matriz-permisos.md:
// scripts/generar-matriz-permisos.ts la usa para escribir el archivo,
// y lib/matriz-permisos.test.ts hace fallar el CI si lo que está
// committeado deja de coincidir con lo que lib/roles.ts produciría
// ahora mismo — un cambio de plantilla que se olvida de regenerar el
// archivo no pasa desapercibido.
export function generarMatrizMarkdown(): string {
  const lineas: string[] = [];

  lineas.push("# Matriz de permisos — plantillas de fábrica");
  lineas.push("");
  lineas.push(
    "Generado por `npm run docs:permisos` (que corre `scripts/generar-matriz-permisos.ts`) a partir de `lib/roles.ts` — tarea 1.8. **No editar a mano**: `lib/matriz-permisos.test.ts` falla el CI si este archivo deja de coincidir con lo que el generador produciría ahora mismo."
  );
  lineas.push("");
  lineas.push("Un rol de una empresa real nace copiando su plantilla y se puede ajustar después desde `/panel/roles` — esta tabla es el punto de partida, no el permiso final de nadie.");
  lineas.push("");
  lineas.push(`| Rol | ${MODULOS.join(" | ")} |`);
  lineas.push(`|---|${MODULOS.map(() => "---").join("|")}|`);

  const roles: Record<string, Permiso[]> = { Dueño: permisosDeDueno(), ...PLANTILLAS };

  for (const [nombre, permisos] of Object.entries(roles)) {
    const celdas = MODULOS.map((modulo) => {
      const deEsteModulo = permisos.filter((p) => p.modulo === modulo);
      if (deEsteModulo.length === 0) return "—";
      return deEsteModulo.map((p) => `${p.accion} (${p.alcance})`).join(", ");
    });
    lineas.push(`| ${nombre} | ${celdas.join(" | ")} |`);
  }

  lineas.push("");
  lineas.push(
    "**Permisos peligrosos** (piden confirmación aparte al asignarlos desde `/panel/roles`, nunca se activan de un solo clic): " +
      PERMISOS_PELIGROSOS.map((p) => `${p.accion} en ${p.modulo}`).join(", ") +
      "."
  );
  lineas.push("");

  return lineas.join("\n");
}
