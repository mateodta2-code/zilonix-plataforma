import { readdirSync, readFileSync, statSync } from "fs";
import { join, relative } from "path";
import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { esRutaPublica, PATRONES_RUTAS_PUBLICAS } from "@/lib/rutas-publicas";

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
  "app/panel/page.tsx",
  "app/panel/finanzas/page.tsx",
  // Issue #128 (Z-FIN-06) — ver pide finanzas.consultar; crear, editar,
  // desactivar e importar, finanzas.modificar (también en cada acción).
  "app/panel/finanzas/proveedores/page.tsx",
  "app/panel/finanzas/proveedores/actions.ts",
  "app/panel/finanzas/proveedores/[id]/page.tsx",
  "app/panel/finanzas/maestra-sku/page.tsx",
  "app/panel/finanzas/maestra-sku/actions.ts",
  "app/panel/finanzas/maestra-sku/editar/page.tsx",
  "app/panel/finanzas/maestra-sku/alertas/page.tsx",
  "app/panel/finanzas/maestra-sku/importar/page.tsx",
  "app/panel/finanzas/maestra-sku/importar/actions.ts",
  // Issue #131 Parte A — ventas y utilidad, solo lectura: las dos piden
  // finanzas.consultar (y lib/finanzas/ventas-consulta.ts otra vez).
  "app/panel/finanzas/ventas/page.tsx",
  "app/panel/finanzas/ventas/[pedidoId]/page.tsx",
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
  "app/panel/conectar-ml/confirmar-transferencia/page.tsx",
  "app/panel/avisos-ml/page.tsx",
  "app/panel/sku/page.tsx",
  "app/panel/sku/actions.ts",
  "app/panel/sku/sin-vincular/page.tsx",
  "app/panel/sku/sin-vincular/actions.ts",
  "app/panel/sku/importar/page.tsx",
  "app/panel/pedidos/page.tsx",
  "app/panel/pedidos/[id]/page.tsx",
  "app/panel/despachos/page.tsx",
  "app/panel/investigacion/page.tsx",
  "app/panel/investigacion/actions.ts",
  "app/panel/investigacion/seguimiento/page.tsx",
  "app/panel/investigacion/seguimiento/actions.ts",
  "app/panel/investigacion/seguimiento/[id]/page.tsx",
  "app/api/ml/despachos/etiquetas/route.ts",
  "app/panel/publicar/page.tsx",
  "app/panel/publicar/nuevo/page.tsx",
  "app/panel/publicar/nuevo/actions.ts",
  "app/panel/publicar/[id]/page.tsx",
  "app/panel/publicar/clip/page.tsx",
  "app/panel/publicar/clip/actions.ts",
  // ADENDO UX de Publicar — mismo permiso que crear el producto en sí
  // ("inventario","crear"): estas 3 solo AYUDAN a elegir categoría/
  // atributos, nunca publican nada.
  "app/api/ml/publicar/categorias/buscar/route.ts",
  "app/api/ml/publicar/categorias/arbol/route.ts",
  "app/api/ml/publicar/caracteristicas/route.ts",
  "app/api/ml/callback/route.ts",
  "app/api/ml/conectar/route.ts",
  "app/api/ml/clip/route.ts",
  "app/panel/publicidad/page.tsx",
  "app/panel/publicidad/actions.ts",
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
  "app/api/salud/route.ts":
    "monitoreo público: solo un select 1 y, cuando exista la cola, números de trabajos — nunca datos de negocio, nombres de empresa, cadenas de conexión ni el error del driver",
  "app/api/ml/webhooks/route.ts":
    "Mercado Libre llama esta ruta directo, sin sesión de usuario — el permiso real es dbComoAvisoWebhook() (db/empresa-context.ts), que solo deja ver la fila de cuentas_ml cuyo user_id coincide con el del aviso, nunca las de otra empresa",
  "app/api/ml/trabajador/route.ts":
    "la llama un cron, sin sesión de usuario — el permiso real es el secreto compartido x-trabajador-secret, y la conexión trabajador_user (db/trabajador-context.ts) solo puede tocar avisos_ml, ninguna otra tabla",
  "app/api/trabajos/seguimiento/route.ts":
    "la llama un cron, sin sesión de usuario (issue #175) — el permiso real es el secreto compartido x-seguimiento-trabajador-secret, y la conexión seguimiento_trabajador_user (db/trabajador-seguimiento-context.ts) solo puede tocar seguimientos_ml, ninguna otra tabla",
  "app/api/trabajos/publicidad/route.ts":
    "la llama un cron, sin sesión de usuario (issue #254) — el permiso real es el secreto compartido x-publicidad-trabajador-secret, y la conexión publicidad_trabajador_user (db/trabajador-publicidad-context.ts) solo puede listar columnas no secretas de cuentas_ml y leer publicidad_sincronizaciones, nunca los tokens",
  "app/panel/sku/importar/actions.ts":
    "el permiso real (requierePermiso('inventario','modificar')) vive en lib/ml/sku-importar.ts (previsualizarImportacionSkus/confirmarImportacionSkus), llamado ANTES de leer o escribir — este archivo solo adapta el formulario a esas dos funciones, nunca toca la base por su cuenta",
  "app/panel/conectar-ml/confirmar-transferencia/actions.ts":
    "el permiso real (requierePermiso('configuracion','crear')) vive en confirmarTransferenciaCuentaMl (lib/ml/transferencia.ts), llamado ANTES de transferir — este archivo solo resuelve usuario/empresa desde las cookies y borra el pendiente, nunca toca cuentas_ml por su cuenta",
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

// Fix real (2026-10-21) — RUTAS_EXENTAS (exenta del permiso de MÓDULO,
// requierePermiso) y esRutaPublica de lib/rutas-publicas.ts (exenta de
// la SESIÓN de Clerk en el middleware) responden preguntas distintas:
// app/panel/actions.ts está exenta de permiso de módulo (cambiar de
// empresa se revalida contra las membresías reales) pero sí exige
// sesión, así que forzar que las dos listas coincidan completas estaría
// mal. /panel en sí ya no es el ejemplo: app/panel/page.tsx está en
// RUTAS_PROTEGIDAS y llama requierePermiso. La incoherencia real que
// causó el bug del 21/10 fue más angosta: una ruta de MÁQUINA (nadie
// navega ahí con sesión — un webhook, un cron) exenta de permiso de
// módulo tiene que estar TAMBIÉN en esRutaPublica sin excepción; si no,
// el middleware la protege con auth.protect() igual, y una máquina sin
// sesión se cuelga 30s contra el handshake de Clerk (ver
// lib/rutas-publicas.ts para el diagnóstico completo).
//
// Set EXPLÍCITO, no adivinado por texto — antes esto buscaba la
// substring "sin sesión de usuario" dentro del motivo de RUTAS_EXENTAS,
// que funcionaba solo porque esos dos motivos ya decían esa frase por
// casualidad. Un motivo nuevo redactado distinto (ej. "sin sesión,
// llamada por un cron") habría dejado una ruta de máquina real sin
// detectar, en silencio.
const RUTAS_DE_MAQUINA: Record<string, string> = {
  "app/api/ml/webhooks/route.ts": "/api/ml/webhooks",
  "app/api/ml/trabajador/route.ts": "/api/ml/trabajador",
  "app/api/salud/route.ts": "/api/salud",
  "app/api/trabajos/seguimiento/route.ts": "/api/trabajos/seguimiento",
  "app/api/trabajos/publicidad/route.ts": "/api/trabajos/publicidad",
};

// La única ruta pública en el middleware que NO está exenta de
// permisos de módulo: sigue en RUTAS_PROTEGIDAS (sí llama
// requierePermiso dentro de su propio handler) porque sí hay una
// persona real detrás con sesión de Clerk — solo deja de depender del
// auth.protect() del middleware para evitar el mismo bug de rewrite
// colgado. Ver lib/rutas-publicas.ts para la decisión completa.
const PUBLICAS_CON_AUTENTICACION_PROPIA: Record<string, string> = {
  "app/api/ml/callback/route.ts":
    'pública en el middleware (la abre el navegador al volver del OAuth de Mercado Libre, con o sin las cabeceras que dispararían el bug del rewrite) pero sigue protegida de verdad dentro de su propio handler: state+PKCE (lib/ml/pkce-cookie.ts) contra CSRF, sesión real de Clerk (redirige a /sign-in si falta) y requierePermiso("configuracion","crear") antes de guardar nada — por eso además sigue en RUTAS_PROTEGIDAS, no en RUTAS_EXENTAS.',
};

describe("fix middleware (2026-10-21) — coherencia entre RUTAS_EXENTAS, RUTAS_DE_MAQUINA y lib/rutas-publicas.ts", () => {
  for (const [relPath, url] of Object.entries(RUTAS_DE_MAQUINA)) {
    it(`${relPath} (ruta de máquina) está exenta de permiso de módulo y es pública en el middleware`, () => {
      expect(relPath in RUTAS_EXENTAS, `${relPath} está en RUTAS_DE_MAQUINA pero no en RUTAS_EXENTAS — una ruta de máquina real sigue sin necesitar requierePermiso().`).toBe(true);
      expect(
        esRutaPublica(new NextRequest(`https://verificar-permisos.test${url}`)),
        `${relPath} (${url}) está en RUTAS_DE_MAQUINA pero NO es pública en lib/rutas-publicas.ts — el middleware la protegería con auth.protect() igual, que fue justo el bug real del 21/10 (se cuelga 30s y responde 500).`
      ).toBe(true);
    });
  }

  it("toda ruta de RUTAS_DE_MAQUINA sigue existiendo en RUTAS_EXENTAS", () => {
    for (const relPath of Object.keys(RUTAS_DE_MAQUINA)) {
      expect(relPath in RUTAS_EXENTAS, `${relPath} ya no está en RUTAS_EXENTAS — bórrala de RUTAS_DE_MAQUINA en esta prueba.`).toBe(true);
    }
  });

  // Dirección inversa: toda URL pública bajo /api tiene que
  // corresponder a una ruta ya clasificada (RUTAS_EXENTAS o
  // PUBLICAS_CON_AUTENTICACION_PROPIA) — nunca a un patrón abierto. Las
  // rutas públicas de páginas (/, /sign-in(.*), /invitacion(.*)...) no
  // entran acá a propósito: esas sí pueden traer comodines reales
  // (ej. "/sign-in(.*)" cubre las subrutas de Clerk), es solo bajo
  // /api donde un comodín sería peligroso (dejaría pública cualquier
  // ruta de negocio que empiece con ese prefijo).
  for (const patron of PATRONES_RUTAS_PUBLICAS) {
    if (!patron.startsWith("/api")) continue;
    it(`"${patron}" (pública bajo /api) es una URL exacta y corresponde a una ruta clasificada`, () => {
      expect(/[()*+?]/.test(patron), `"${patron}" es pública bajo /api y contiene un comodín — una ruta de máquina tiene que declararse como una URL exacta, nunca como un patrón abierto.`).toBe(false);

      const relPath = `app${patron}/route.ts`;
      const clasificada = relPath in RUTAS_EXENTAS || relPath in PUBLICAS_CON_AUTENTICACION_PROPIA;
      expect(
        clasificada,
        `"${patron}" es pública bajo /api pero "${relPath}" no está en RUTAS_EXENTAS ni en PUBLICAS_CON_AUTENTICACION_PROPIA — toda ruta pública de /api tiene que decir con qué se autentica de verdad.`
      ).toBe(true);
    });
  }

  it("toda ruta de PUBLICAS_CON_AUTENTICACION_PROPIA sigue existiendo como archivo real", () => {
    for (const relPath of Object.keys(PUBLICAS_CON_AUTENTICACION_PROPIA)) {
      expect(archivos.includes(relPath), `${relPath} está en PUBLICAS_CON_AUTENTICACION_PROPIA pero el archivo ya no existe — bórrala de esta prueba.`).toBe(true);
    }
  });
});
