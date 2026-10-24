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

empaquetar();
