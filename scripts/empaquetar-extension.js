// Issue #174 — npm run extension:zip. Arma el ZIP de extension/ para
// repartir (Chrome no instala un ZIP directo: quien lo recibe tiene
// que descomprimirlo y usar "Cargar descomprimida" — ver
// extension/LEEME.md). Usa el `zip` del sistema en vez de agregar una
// dependencia nueva de npm solo para esto.
const { execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const RAIZ = path.resolve(__dirname, "..");
const CARPETA_EXTENSION = path.join(RAIZ, "extension");
const CARPETA_SALIDA = path.join(RAIZ, "dist", "extension");
const RUTA_CALIBRACION_JSON = path.join(RAIZ, "lib", "seguimiento", "calibracion-aproximados.json");
const RUTA_CALIBRACION_EXTENSION = path.join(CARPETA_EXTENSION, "calibracion-aproximados.js");

// Issue #262 ("Aproximados estilo Selltrix en los 3 lugares") — UNA
// SOLA FUENTE para los factores de vendidos (2.2 Full / 1.55 "+N") y
// la tabla de calibración id→fecha: lib/seguimiento/calibracion-aproximados.json,
// que ya usa lib/seguimiento/aproximados.ts (import directo — Next.js
// resuelve JSON nativo). La extensión no puede `import` un .json
// (content script plano, cargado por manifest.json, sin build) — este
// archivo generado le da el MISMO contenido como un global de JS
// (`window.ZilonixCalibracion`), para que extension/lectores/aproximados.js
// calcule con los mismos números que el servidor, sin mantener una
// copia a mano en dos lugares. Exportada (no solo llamada desde
// empaquetar()) para que lib/seguimiento/calibracion-aproximados.test.ts
// pueda generar el contenido esperado y compararlo contra lo que de
// verdad hay committeado en extension/calibracion-aproximados.js — si
// alguien edita el JSON y se olvida de volver a empaquetar, esa prueba
// lo avisa en vez de dejar la extensión con datos viejos en silencio.
function generarContenidoCalibracionExtension(calibracion) {
  return (
    `// GENERADO — no editar a mano. Issue #262: copia exacta de\n` +
    `// lib/seguimiento/calibracion-aproximados.json, regenerada por\n` +
    `// scripts/empaquetar-extension.js (ver ese archivo) — para que la\n` +
    `// extensión y la app calculen siempre con los mismos números. Para\n` +
    `// cambiar un valor, editá ESE json y volvé a correr\n` +
    `// "npm run extension:zip" (regenera este archivo antes de armar el\n` +
    `// ZIP) — nunca este archivo a mano.\n` +
    `(function () {\n` +
    `  "use strict";\n` +
    `  const calibracion = ${JSON.stringify(calibracion, null, 2)};\n` +
    `  if (typeof module !== "undefined" && module.exports) {\n` +
    `    module.exports = calibracion;\n` +
    `  }\n` +
    `  if (typeof window !== "undefined") {\n` +
    `    window.ZilonixCalibracion = calibracion;\n` +
    `  }\n` +
    `})();\n`
  );
}

function leerCalibracionCanonica() {
  return JSON.parse(fs.readFileSync(RUTA_CALIBRACION_JSON, "utf8"));
}

function regenerarCalibracionExtension() {
  fs.writeFileSync(RUTA_CALIBRACION_EXTENSION, generarContenidoCalibracionExtension(leerCalibracionCanonica()));
}

function leerVersion() {
  const version = JSON.parse(fs.readFileSync(path.join(CARPETA_EXTENSION, "version.json"), "utf8")).version;
  const versionManifest = JSON.parse(fs.readFileSync(path.join(CARPETA_EXTENSION, "manifest.json"), "utf8")).version;
  if (version !== versionManifest) {
    throw new Error(
      `extension/version.json dice ${version} pero extension/manifest.json dice ${versionManifest} — hay que subir las dos juntas antes de empaquetar.`
    );
  }
  return version;
}

function confirmarZipDisponible() {
  try {
    execFileSync("zip", ["-v"], { stdio: "ignore" });
  } catch {
    throw new Error("No se encontró el comando 'zip' en este sistema — instalalo (en Mac/Linux normalmente ya viene) y volvé a intentar.");
  }
}

function empaquetar() {
  confirmarZipDisponible();
  const version = leerVersion();
  // Issue #262 — siempre regenera extension/calibracion-aproximados.js
  // a partir del JSON canónico ANTES de armar el ZIP, para que nunca
  // se empaquete una copia vieja de los factores/la tabla de
  // calibración (ver generarContenidoCalibracionExtension, arriba).
  regenerarCalibracionExtension();
  fs.mkdirSync(CARPETA_SALIDA, { recursive: true });
  const nombreZip = `zilonix-investigacion-v${version}.zip`;
  const rutaZip = path.join(CARPETA_SALIDA, nombreZip);
  if (fs.existsSync(rutaZip)) fs.rmSync(rutaZip);

  // -X: sin metadatos extra de Mac (evita basura __MACOSX en el ZIP).
  // -r: recursivo. Se corre DESDE la carpeta extension/ para que el
  // ZIP contenga los archivos sueltos (manifest.json en la raíz del
  // ZIP), no una carpeta "extension/" adentro — así "Cargar
  // descomprimida" apunta directo a la carpeta correcta. Los *.test.ts
  // (extension/seguridad.test.ts) son para `npm test`, nunca para la
  // extensión real — se excluyen del ZIP.
  execFileSync("zip", ["-r", "-X", rutaZip, ".", "-x", "*.test.ts", "-x", "*.test.js"], { cwd: CARPETA_EXTENSION, stdio: "inherit" });

  console.log(`\nListo: ${path.relative(RAIZ, rutaZip)}`);
}

module.exports = { generarContenidoCalibracionExtension, leerCalibracionCanonica, regenerarCalibracionExtension };

// Issue #262 — exportar las funciones de arriba (para
// lib/seguimiento/calibracion-aproximados.test.ts) nunca debe disparar
// el empaquetado real solo por hacer `require()` de este archivo desde
// una prueba — `empaquetar()` (que sí ejecuta `zip`) solo corre cuando
// este script se invoca directo (`node scripts/empaquetar-extension.js`,
// o `npm run extension:zip`).
if (require.main === module) {
  empaquetar();
}
