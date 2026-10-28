import { readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";
// scripts/empaquetar-extension.js es CommonJS plano (lo corre Node
// directo, `node scripts/empaquetar-extension.js`) — vitest lo importa
// igual, sin build. `require.main === module` (al final de ese
// archivo) evita que este import dispare el empaquetado real (`zip`)
// solo por hacer `require()`.
import { generarContenidoCalibracionExtension, leerCalibracionCanonica } from "../../scripts/empaquetar-extension.js";

// Issue #262 ("Aproximados estilo Selltrix en los 3 lugares") — bug
// real que esto evita: lib/seguimiento/calibracion-aproximados.json es
// la ÚNICA fuente de los factores de vendidos y la tabla de
// calibración id→fecha, pero extension/calibracion-aproximados.js (lo
// que de verdad carga la extensión, un archivo generado) es una copia
// committeada — si alguien edita el JSON (ej. después de correr
// scripts/generar-calibracion-id-fecha.ts) y se olvida de volver a
// correr `npm run extension:zip`, la extensión instalada seguiría
// calculando con los factores/la tabla VIEJOS, en silencio, sin que
// nada lo avise. Esta prueba lee los dos archivos reales del repo y
// confirma que la copia generada coincide EXACTO con lo que
// regenerarla de nuevo produciría a partir del JSON canónico.
describe("extension/calibracion-aproximados.js nunca queda desincronizada del JSON canónico (issue #262)", () => {
  it("el archivo generado y comiteado coincide con lo que regenerarlo ahora mismo produciría", () => {
    const calibracion = leerCalibracionCanonica();
    const esperado = generarContenidoCalibracionExtension(calibracion);
    const real = readFileSync(join(__dirname, "../../extension/calibracion-aproximados.js"), "utf8");
    expect(real).toBe(esperado);
  });
});
