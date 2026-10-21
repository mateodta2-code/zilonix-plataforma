import { readdirSync, readFileSync, statSync } from "fs";
import { join, relative } from "path";
import { describe, expect, it } from "vitest";

// Tarea 1.8 — "ruta sin [requierePermiso()] = el CI falla", literal.
//
// Primer diseño de esta prueba (descartado): adivinar si un archivo
// "toca negocio" buscando patrones de texto como `dbComoEmpresa(` o
// imports de `@/db/schema` EN EL PROPIO ARCHIVO. No sirve: las
// pantallas de negocio de verdad llaman a lib/roles.ts o
// lib/invitaciones.ts, que son las que tocan la base por debajo — el
// propio archivo de la ruta nunca menciona esos patrones, así que la
// prueba no detectaba nada.
//
// Diseño real: TODA ruta de app/ (page.tsx, route.ts, actions.ts)
// tiene que estar clasificada a mano en una de dos listas — no hay
// tercera opción, y una ruta nueva sin clasificar hace fallar el CI
// hasta que alguien la ponga en una de las dos, a propósito.
const RAIZ = process.cwd();
const APP_DIR = join(RAIZ, "app");

// Rutas que SÍ deben llamar requierePermiso() en su propio código.
const RUTAS_PROTEGIDAS = new Set([
  "app/panel/finanzas/page.tsx",
  "app/panel/actividad/page.tsx",
  "app/panel/invitar/page.tsx",
  "app/panel/invitar/actions.ts",
  "app/panel/roles/page.tsx",
  "app/panel/roles/[rolId]/page.tsx",
  "app/panel/roles/[rolId]/actions.ts",
  "app/panel/roles/[rolId]/confirmar/page.tsx",
  "app/panel/soporte/page.tsx",
  "app/panel/soporte/actions.ts",
  "app/panel/conectar-ml/page.tsx",
  "app/panel/conectar-ml/[cuentaId]/desconectar/page.tsx",
  "app/panel/conectar-ml/[cuentaId]/desconectar/actions.ts",
  "app/panel/avisos-ml/page.tsx",
  "app/panel/sku/page.tsx",
  "app/panel/sku/actions.ts",
  "app/panel/sku/sin-vincular/page.tsx",
  "app/panel/sku/sin-vincular/actions.ts",
  "app/panel/pedidos/page.tsx",
  "app/panel/pedidos/[id]/page.tsx",
  "app/panel/despachos/page.tsx",
  "app/api/ml/despachos/etiquetas/route.ts",
  "app/panel/publicar/page.tsx",
  "app/panel/publicar/nuevo/page.tsx",
  "app/panel/publicar/nuevo/actions.ts",
  "app/panel/publicar/[id]/page.tsx",
  "app/panel/publicar/clip/page.tsx",
  "app/panel/publicar/clip/actions.ts",
  "app/api/ml/callback/route.ts",
  "app/api/ml/conectar/route.ts",
]);

// Tarea 1.11 — eje de autorización APARTE: "¿esta cuenta es
// superadmin?" (plataforma entera, no un módulo de una empresa). Toda
// ruta bajo /superadmin tiene que llamar requiereSuperadmin(), nunca
// requierePermiso() — son preguntas distintas.
const RUTAS_SUPERADMIN = new Set(["app/superadmin/page.tsx", "app/superadmin/[empresaId]/page.tsx"]);

// Rutas exentas, cada una con el motivo real por el que no necesita
// preguntar "¿puede [acción] en [módulo]?".
const RUTAS_EXENTAS: Record<string, string> = {
  "app/page.tsx": "solo lista las empresas propias del usuario para decidir a dónde mandarlo, no lee datos de negocio de ninguna empresa",
  "app/panel/page.tsx": "solo filtra qué módulos mostrar en el nav (consultar); el módulo de destino exige su propio permiso al entrar",
  "app/panel/actions.ts": "cambiar la empresa activa ya se revalida contra las membresías reales del usuario, no es un permiso por módulo",
  "app/crear-empresa/page.tsx": "cualquier usuario con cuenta puede crear su propia empresa — no hay membresía previa que comprobar",
  "app/crear-empresa/actions.ts": "idem",
  "app/panel/invitar/listo/page.tsx": "solo muestra un token que crearInvitacionAction ya generó, no vuelve a tocar la base",
  "app/invitacion/[token]/page.tsx": "el token en la URL es el permiso real (db/empresa-context.ts) — todavía no hay membresía que comprobar",
  "app/invitacion/[token]/actions.ts": "idem",
  "app/cuenta/[[...cuenta]]/page.tsx": "solo monta <UserProfile/> de Clerk; no lee ninguna tabla propia",
  "app/sign-in/[[...sign-in]]/page.tsx": "solo monta <SignIn/> de Clerk",
  "app/sign-up/[[...sign-up]]/page.tsx": "solo monta <SignUp/> de Clerk",
  "app/api/version/route.ts": "expone solo el número de versión, nunca datos de ninguna empresa",
  "app/api/ml/webhooks/route.ts":
    "Mercado Libre llama esta ruta directo, sin sesión de usuario — el permiso real es dbComoAvisoWebhook() (db/empresa-context.ts), que solo deja ver la fila de cuentas_ml cuyo user_id coincide con el del aviso, nunca las de otra empresa",
  "app/api/ml/trabajador/route.ts":
    "la llama un cron, sin sesión de usuario — el permiso real es el secreto compartido x-trabajador-secret, y la conexión trabajador_user (db/trabajador-context.ts) solo puede tocar avisos_ml, ninguna otra tabla",
};

function listarArchivosDeRuta(dir: string): string[] {
  let resultado: string[] = [];
  for (const nombre of readdirSync(dir)) {
    const ruta = join(dir, nombre);
    if (statSync(ruta).isDirectory()) {
      resultado = resultado.concat(listarArchivosDeRuta(ruta));
    } else if (/^(page|route|actions)\.tsx?$/.test(nombre)) {
      resultado.push(ruta);
    }
  }
  return resultado;
}

const archivos = listarArchivosDeRuta(APP_DIR).map((a) => relative(RAIZ, a).replace(/\\/g, "/"));

describe("tarea 1.8/1.11 — toda ruta de app/ está clasificada y usa el candado que dice usar", () => {
  for (const relPath of archivos) {
    it(`${relPath} está en RUTAS_PROTEGIDAS, RUTAS_SUPERADMIN o RUTAS_EXENTAS`, () => {
      const clasificada = RUTAS_PROTEGIDAS.has(relPath) || RUTAS_SUPERADMIN.has(relPath) || relPath in RUTAS_EXENTAS;
      expect(
        clasificada,
        `${relPath} no está clasificada en scripts/verificar-permisos.test.ts — agrégala a RUTAS_PROTEGIDAS (requierePermiso), RUTAS_SUPERADMIN (requiereSuperadmin) o RUTAS_EXENTAS con el motivo real.`
      ).toBe(true);
    });
  }

  for (const relPath of RUTAS_PROTEGIDAS) {
    it(`${relPath} (protegida) llama requierePermiso() de verdad`, () => {
      const contenido = readFileSync(join(RAIZ, relPath), "utf8");
      expect(/requierePermiso\(/.test(contenido), `${relPath} está en RUTAS_PROTEGIDAS pero no llama requierePermiso()`).toBe(true);
    });
  }

  for (const relPath of RUTAS_SUPERADMIN) {
    it(`${relPath} (superadmin) llama requiereSuperadmin() de verdad`, () => {
      const contenido = readFileSync(join(RAIZ, relPath), "utf8");
      expect(/requiereSuperadmin\(/.test(contenido), `${relPath} está en RUTAS_SUPERADMIN pero no llama requiereSuperadmin()`).toBe(true);
    });
  }

  it("ninguna ruta listada (protegida, superadmin o exenta) quedó de un archivo que ya no existe", () => {
    const vigentes = new Set(archivos);
    for (const ruta of [...RUTAS_PROTEGIDAS, ...RUTAS_SUPERADMIN, ...Object.keys(RUTAS_EXENTAS)]) {
      expect(vigentes.has(ruta), `${ruta} está listada pero el archivo ya no existe — bórrala de scripts/verificar-permisos.test.ts`).toBe(true);
    }
  });
});
