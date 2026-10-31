import { readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";

// Issue #175, punto 7 — chequeo estático (sin Postgres, sin montar
// React): confirma que cada archivo real llama al candado de permisos
// que dice usar. La lógica de negocio real que estos archivos delegan
// (agregar/listar/marcar leída) ya la prueba lib/seguimiento/seguimientos.test.ts
// contra Postgres real.
function contenidoDe(archivo: string): string {
  return readFileSync(join(__dirname, archivo), "utf8");
}

// Issue #252 (revisión de Pablo, punto 3) — datoPaginaSeguimientoValido
// (y los patrones/topes que usa) se movieron de actions.ts a
// lib/seguimiento/validarDatoPagina.ts (actions.ts tiene "use server",
// que exige que TODO lo exportado sea async — un type guard sync no
// podía vivir ahí si hacía falta importarlo en una prueba).
function contenidoValidador(): string {
  return readFileSync(join(__dirname, "../../../../lib/seguimiento/validarDatoPagina.ts"), "utf8");
}

describe("/panel/investigacion/seguimiento — mismo permiso que Investigación para ver, 'modificar' para escribir (issue #175)", () => {
  it("page.tsx pide inventario.consultar (ver la lista y las alertas)", () => {
    expect(contenidoDe("page.tsx")).toMatch(/requierePermiso\(\s*usuario\.id,\s*empresa\.id,\s*"inventario",\s*"consultar"\s*\)/);
  });

  it("[id]/page.tsx (detalle) pide inventario.consultar", () => {
    expect(contenidoDe("[id]/page.tsx")).toMatch(/requierePermiso\(\s*usuario\.id,\s*empresa\.id,\s*"inventario",\s*"consultar"\s*\)/);
  });

  it("actions.ts pide inventario.modificar en las 4 acciones de escritura (agregar, quitar, marcar leída, guardar dato de página — issue #251)", () => {
    const contenido = contenidoDe("actions.ts");
    const coincidencias = contenido.match(/requierePermiso\(\s*usuario\.id,\s*empresa\.id,\s*"inventario",\s*"modificar"\s*\)/g) ?? [];
    // Corrección de Pablo (punto 7) — guardarDatoPaginaSeguimientoAction
    // Y guardarVariosDatosPaginaSeguimientoAction (la cola en lote)
    // ahora comparten UN SOLO chequeo (empresaConPermisoDeExtension) en
    // vez de tener el suyo cada una — sigue siendo 4 llamadas reales en
    // el archivo (agregar, quitar, marcar leída, el helper compartido),
    // nunca una por acción de extensión.
    expect(coincidencias.length).toBe(4);
  });
});

// Issue #251 (corrección de Pablo, punto 6) — chequeo estático del
// validador de la extensión: sin Postgres ni Clerk (los helpers de
// permiso/sesión no son triviales de montar en un test unitario), pero
// confirma que las reglas reales que pidió la revisión están en el
// código, no solo en la intención. El comportamiento real (acepta/
// rechaza un payload concreto) ya lo prueba indirectamente
// lib/seguimiento/seguimientos.test.ts contra Postgres real, llamando
// guardarDatoDePaginaSeguimiento con datos ya validados.
describe("datoPaginaSeguimientoValido — validador real de la extensión (issue #251, corrección de Pablo al punto 6)", () => {
  it("mlIdExterno e idsVisibles se validan con el patrón real de ids de Mercado Libre, no 'cualquier string no vacío'", () => {
    expect(contenidoValidador()).toMatch(/PATRON_ID_ML_O_VENDEDOR\s*=\s*\/\^\(MCO\|MLA\|MLB\|MLM\|MLC\|MLU\|MPE\)\\d\+\$\|\^\\d\+\$\//);
  });

  it("inventario/vendidos/totalPublicaciones se validan con Number.isInteger y un rango real (0 a 1_000_000)", () => {
    const contenido = contenidoValidador();
    expect(contenido).toMatch(/Number\.isInteger\(valor\)/);
    expect(contenido).toMatch(/valor\s*>=\s*0/);
    expect(contenido).toMatch(/valor\s*<=\s*1_000_000/);
  });

  it("idsVisibles tiene un tope real (100)", () => {
    const contenido = contenidoValidador();
    expect(contenido).toMatch(/MAX_IDS_VISIBLES\s*=\s*100/);
    expect(contenido).toMatch(/idsVisibles\.length\s*<=\s*MAX_IDS_VISIBLES/);
  });

  it("leidoEn se valida como fecha ISO real, nunca futura, y con un tope de antigüedad (36h)", () => {
    const contenido = contenidoValidador();
    expect(contenido).toMatch(/MAX_HORAS_LEIDO_EN\s*=\s*36/);
    expect(contenido).toMatch(/fecha\.getTime\(\)\s*>\s*ahoraMs/); // nunca en el futuro
  });

  // Issue #252 (revisión de Pablo, punto 3) — bug real: la extensión
  // 0.3.30 nunca mandaba `titulo`/`precio` (undefined, no null) — eso
  // descartaba el payload ENTERO. tituloEnRango/precioEnRango tienen
  // que aceptar las dos formas por igual (== null, nunca === null a
  // secas) para no volver a romperlo.
  it("titulo/precio aceptan tanto null como undefined (== null, nunca === null a secas) — nunca descartan el payload solo porque la extensión vieja no los manda", () => {
    const contenido = contenidoValidador();
    expect(contenido).toMatch(/function tituloEnRango\(valor: unknown\)[\s\S]{0,80}valor == null/);
    expect(contenido).toMatch(/function precioEnRango\(valor: unknown\)[\s\S]{0,80}valor == null/);
  });
});

// Issue #182 — la extensión (0.3.0, "Seguir en Zilonix") abre esta
// pantalla con ?agregar=<itemId MCO> o ?agregar_tienda=<sellerId
// numérico>. Mismo criterio que el resto de este archivo: chequeo
// estático de texto, sin montar React ni Postgres — la lógica real
// (buscarSeguimientoActivoPorMlId, agregarSeguimiento) ya la prueba
// lib/seguimiento/seguimientos.test.ts contra Postgres real.
describe("?agregar / ?agregar_tienda — la extensión agrega un seguimiento al abrir la pantalla (issue #182)", () => {
  it("page.tsx valida el FORMATO del id antes de llamar a procesarAgregarPorQuery (nunca confía en el query param tal cual)", () => {
    const contenido = contenidoDe("page.tsx");
    expect(contenido).toMatch(/PATRON_ID_ITEM\s*=\s*\/\^MCO\\d\+\$\//);
    expect(contenido).toMatch(/PATRON_ID_VENDEDOR\s*=\s*\/\^\\d\+\$\//);
    expect(contenido).toMatch(/procesarAgregarPorQuery\(/);

    // Orden real: el chequeo de formato tiene que pasar ANTES que la
    // llamada — nunca al revés, nunca en paralelo.
    const idxChequeoItem = contenido.indexOf("PATRON_ID_ITEM.test(searchParams.agregar)");
    const idxLlamadaProducto = contenido.indexOf('procesarAgregarPorQuery(empresa.id, usuario.id, { tipo: "producto"');
    expect(idxChequeoItem).toBeGreaterThan(-1);
    expect(idxLlamadaProducto).toBeGreaterThan(idxChequeoItem);
  });

  it("actions.ts: procesarAgregarPorQuery pide inventario.modificar, igual que las demás acciones de escritura", () => {
    const contenido = contenidoDe("actions.ts");
    expect(contenido).toMatch(/requierePermiso\(\s*usuarioId,\s*empresaId,\s*"inventario",\s*"modificar"\s*\)/);
  });

  it("actions.ts: todos los redirects de procesarAgregarPorQuery son REPLACE (nunca push) — para que F5 o 'volver atrás' no vuelvan a agregar", () => {
    const contenido = contenidoDe("actions.ts");
    const inicio = contenido.indexOf("export async function procesarAgregarPorQuery");
    const fin = contenido.indexOf("export async function eliminarSeguimientoAction");
    expect(inicio).toBeGreaterThan(-1);
    const bloque = contenido.slice(inicio, fin);

    const totalRedirects = (bloque.match(/redirect\(/g) ?? []).length;
    const redirectsConReplace = (bloque.match(/redirect\([\s\S]*?,\s*RedirectType\.replace\s*\)/g) ?? []).length;
    expect(totalRedirects).toBeGreaterThanOrEqual(4); // sin permiso, ya existía, error de agregarSeguimiento, éxito
    expect(redirectsConReplace).toBe(totalRedirects);
  });
});

// Refs #175 — diagnóstico real: "productos seguidos sin datos" venía
// de que empresaConPermisoDeExtension()/guardarDatoPaginaSeguimientoAction/
// guardarVariosDatosPaginaSeguimientoAction devolvían `void` en
// silencio (actions.ts, L170-193 en el reporte original) ante
// cualquier fallo — sin sesión, sin empresa, sin permiso, payload
// inválido, seguimiento ya no activo. Mismo criterio de prueba que el
// resto de este archivo: chequeo estático de texto (Clerk/cookies no
// son triviales de montar en un test unitario) — el comportamiento
// real de guardarDatoDePaginaSeguimiento (la pieza con lógica de
// negocio real) ya lo prueba lib/seguimiento/seguimientos.test.ts
// contra Postgres real.
describe("actions.ts — fallos de la extensión ya no se tragan en silencio (issue #175)", () => {
  it("empresaConPermisoDeExtension: logea un motivo real (console.warn) en sus 3 ramas de fallo, nunca un return null mudo", () => {
    const contenido = contenidoDe("actions.ts");
    const inicio = contenido.indexOf("async function empresaConPermisoDeExtension");
    const fin = contenido.indexOf("export type ResultadoGuardadoExtension");
    expect(inicio).toBeGreaterThan(-1);
    const bloque = contenido.slice(inicio, fin);

    expect(bloque).toMatch(/motivo:\s*"sin_sesion"/);
    expect(bloque).toMatch(/motivo:\s*"sin_empresa"/);
    expect(bloque).toMatch(/motivo:\s*"sin_permiso"/);
    // Las 3 ramas de fallo real (sin sesión / empresaActivaDe lanza /
    // SinPermisoError) tienen su propio console.warn antes del return.
    expect((bloque.match(/console\.warn\(/g) ?? []).length).toBe(3);
  });

  it("guardarDatoPaginaSeguimientoAction y guardarVariosDatosPaginaSeguimientoAction ya no devuelven void: cada rama devuelve un resultado tipado", () => {
    const contenido = contenidoDe("actions.ts");
    expect(contenido).toMatch(/export type ResultadoGuardadoExtension\s*=/);
    expect(contenido).toMatch(/async function guardarDatoPaginaSeguimientoAction\(payload: unknown\): Promise<ResultadoGuardadoExtension>/);
    expect(contenido).toMatch(/async function guardarVariosDatosPaginaSeguimientoAction\(payloads: unknown\): Promise<ResultadoGuardadoExtension>/);
    // Nunca un `return;` desnudo dentro de estas dos funciones — todo
    // return tiene que traer un valor (ok:true u ok:false + motivo).
    const inicioUna = contenido.indexOf("export async function guardarDatoPaginaSeguimientoAction");
    const inicioLote = contenido.indexOf("export async function guardarVariosDatosPaginaSeguimientoAction");
    const bloqueAmbas = contenido.slice(inicioUna);
    expect(inicioUna).toBeGreaterThan(-1);
    expect(inicioLote).toBeGreaterThan(inicioUna);
    expect(bloqueAmbas).not.toMatch(/return;\s*\n/);
  });

  it("dispararPrimeraRevision reintenta una vez si el primer intento falla (issue #175, punto 2: 'refuérzala si falla')", () => {
    const contenido = contenidoDe("actions.ts");
    const inicio = contenido.indexOf("async function dispararPrimeraRevision");
    const fin = contenido.indexOf("export async function agregarSeguimientoAction");
    expect(inicio).toBeGreaterThan(-1);
    const bloque = contenido.slice(inicio, fin);
    // Dos llamadas reales a revisarAhoraUnSeguimiento (primer intento +
    // reintento), nunca solo una.
    expect((bloque.match(/revisarAhoraUnSeguimiento\(seguimiento\)/g) ?? []).length).toBe(2);
  });
});

// Refs #175 — EscuchaExtension.tsx es el componente que de verdad veía
// el payload.ok/motivo que las Server Actions de arriba ahora
// devuelven: antes ignoraba el resultado entero (`.then(() =>
// router.refresh())`) así que un guardado fallido no dejaba NINGÚN
// rastro visible. Chequeo estático (montar este componente necesita
// jsdom + mocks de next/navigation; el contrato real que importa
// mantener es "si falla, se ve un Toast").
describe("EscuchaExtension.tsx — guardado fallido de la extensión ahora se ve en pantalla (issue #175)", () => {
  function contenidoEscucha(): string {
    return readFileSync(join(__dirname, "EscuchaExtension.tsx"), "utf8");
  }

  it("usa el componente Toast real (components/marco/Toast.tsx), no un aviso inventado", () => {
    const contenido = contenidoEscucha();
    expect(contenido).toMatch(/import\s*{\s*Toast,\s*type ItemToast\s*}\s*from\s*"@\/components\/marco\/Toast"/);
    expect(contenido).toMatch(/<Toast items={toasts} onCerrar={cerrarToast} \/>/);
  });

  it("el guardado individual ('dato-pagina-seguimiento') avisa SIEMPRE que el resultado no sea ok", () => {
    const contenido = contenidoEscucha();
    const inicio = contenido.indexOf('datos.tipo === "dato-pagina-seguimiento"');
    const fin = contenido.indexOf('datos.tipo === "cola-seguimiento"');
    const bloque = contenido.slice(inicio, fin);
    expect(bloque).toMatch(/if\s*\(!resultado\.ok\)\s*avisar\(MENSAJE_DE_MOTIVO\[resultado\.motivo\]\)/);
  });

  it("el guardado en lote ('cola-seguimiento') solo avisa fallos de LOTE, nunca por un item viejo puntual de la cola", () => {
    const contenido = contenidoEscucha();
    expect(contenido).toMatch(/MOTIVOS_DE_LOTE_PARA_AVISAR\s*=\s*new Set<MotivoFallo>\(\["sin_sesion",\s*"sin_empresa",\s*"sin_permiso"\]\)/);
    expect(contenido).toMatch(/MOTIVOS_DE_LOTE_PARA_AVISAR\.has\(resultado\.motivo\)/);
  });

  it("todo motivo de ResultadoGuardadoExtension tiene un mensaje real en español, nunca un texto genérico", () => {
    const contenido = contenidoEscucha();
    for (const motivo of ["payload_invalido", "sin_sesion", "sin_empresa", "sin_permiso", "seguimiento_inactivo", "tipo_no_coincide"]) {
      expect(contenido).toMatch(new RegExp(`${motivo}:\\s*"[^"]{20,}"`));
    }
  });
});

// Refs #175 — banner de página: diagnóstico real en staging (cron con
// "procesados: 5, fallidos: 0" pero las filas en "Sin dato") sin
// ninguna pista de que la causa era no tener NINGUNA cuenta de
// Mercado Libre conectada. Reusa obtenerCuentaMlActiva (lib/ml/cuentas.ts)
// — nunca una columna/migración nueva, nunca una llamada a Mercado
// Libre desde la pantalla.
describe("page.tsx — aviso de 'sin cuenta de Mercado Libre conectada' (issue #175)", () => {
  it("solo avisa cuando hay seguimientos activos Y ninguna cuenta ML activa — reusa obtenerCuentaMlActiva, sin llamar a Mercado Libre", () => {
    const contenido = contenidoDe("page.tsx");
    expect(contenido).toMatch(/import\s*{\s*obtenerCuentaMlActiva\s*}\s*from\s*"@\/lib\/ml\/cuentas"/);
    expect(contenido).toMatch(/!cuentaMlActiva\s*&&\s*seguimientos\.length\s*>\s*0/);
    expect(contenido).toMatch(/href="\/panel\/conectar-ml"/);
  });
});
