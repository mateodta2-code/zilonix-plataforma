// Z-FIN-00 (issue #122). Lógica pura del diagnóstico de acceso a la
// API de Mercado Libre — sin red, sin base, para poder probarla sola.
// El ejecutable es scripts/finanzas/verificar-acceso-ml.ts.
//
// Regla de salida (criterio de aceptación del issue): se imprimen
// estados, códigos HTTP, tiempos y NOMBRES de campos — nunca valores,
// tokens, montos ni datos de compradores. Por eso acá solo hay
// funciones que devuelven booleanos ("¿el campo vino?") o valores de
// una lista blanca cerrada (logistic_type, money_release_status).

export const CAPACIDADES = ["a", "b", "c", "d", "e", "f"] as const;
export type Capacidad = (typeof CAPACIDADES)[number];

export const NOMBRE_CAPACIDAD: Record<Capacidad, string> = {
  a: "token",
  b: "orden+SKU+comisión",
  c: "envío",
  d: "liberación pago",
  e: "reclamos/devol.",
  f: "publicidad",
};

export type Estado =
  | "OK"
  | "falta permiso"
  | "no disponible"
  | "sin muestra"
  | "token vencido"
  | "desconectada"
  | "limitado (429)"
  | "sin respuesta"
  | "error";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// El script no arranca sin la confirmación explícita ni con una
// empresa mal escrita: es la única barrera contra correrlo "a ver qué
// pasa" contra producción sin haberlo decidido.
export function validarEntorno(env: Record<string, string | undefined>): string[] {
  const errores: string[] = [];
  if (env.CONFIRMO_SOLO_LECTURA !== "si") {
    errores.push("Falta CONFIRMO_SOLO_LECTURA=si (confirmación de que se corre solo para leer).");
  }
  // Revisión del PR #146: el diagnóstico es para staging. Sin esta
  // confirmación explícita no corre, aunque las demás variables estén.
  if (env.AMBIENTE_CONFIRMADO !== "staging") {
    errores.push("Falta AMBIENTE_CONFIRMADO=staging (confirmación de contra qué ambiente se corre).");
  }
  if (!env.EMPRESA_ID || !UUID_RE.test(env.EMPRESA_ID)) {
    errores.push("Falta EMPRESA_ID (UUID de la empresa cuyas cuentas ML se revisan).");
  }
  for (const nombre of ["DATABASE_URL_APP", "ML_TOKEN_KEY_V1"]) {
    if (!env[nombre]) errores.push(`Falta la variable ${nombre} (no se imprime su valor).`);
  }
  return errores;
}

// Para que quien corre el script vea contra qué base está conectado
// antes de leer nada: solo el host, nunca usuario, clave, puerto ni
// nombre de base. Una cadena que no se puede leer como URL no se
// imprime ni en parte.
export function hostDeConexion(url: string | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname || null;
  } catch {
    return null;
  }
}

export function clasificarStatus(status: number): Estado {
  if (status >= 200 && status < 300) return "OK";
  if (status === 401 || status === 403) return "falta permiso";
  if (status === 404) return "no disponible";
  if (status === 429) return "limitado (429)";
  if (status === 0) return "sin respuesta";
  return "error";
}

// "¿Vino este campo?" con rutas simples: "a.b" entra a objetos, "a[].b"
// recorre una lista y basta con que UN elemento lo traiga. null o ""
// cuentan como "no vino" (ej. seller_sku: null en la documentación).
export function campoPresente(dato: unknown, ruta: string): boolean {
  const partes = ruta.split(".");
  let actuales: unknown[] = [dato];
  for (const parte of partes) {
    const esLista = parte.endsWith("[]");
    const clave = esLista ? parte.slice(0, -2) : parte;
    const siguientes: unknown[] = [];
    for (const actual of actuales) {
      if (!actual || typeof actual !== "object") continue;
      const valor = (actual as Record<string, unknown>)[clave];
      if (esLista) {
        if (Array.isArray(valor)) siguientes.push(...valor);
      } else {
        siguientes.push(valor);
      }
    }
    actuales = siguientes;
  }
  return actuales.some((v) => v !== undefined && v !== null && v !== "");
}

export function camposPresentes(dato: unknown, rutas: string[]): Record<string, boolean> {
  return Object.fromEntries(rutas.map((r) => [r, campoPresente(dato, r)]));
}

// logistic_type conocidos (5 vistos en Zilonix OS, issue #122). Lo que
// no esté acá se imprime como "nuevo" y NO con su valor crudo: el
// issue pide alertar valores nuevos, pero un texto libre que manda ML
// nunca sale tal cual por consola.
export const LOGISTIC_TYPES_CONOCIDOS = ["fulfillment", "self_service", "cross_docking", "xd_drop_off", "drop_off"] as const;
export const ESTADOS_LIBERACION_CONOCIDOS = ["released", "pending"] as const;

// Llaves de primer nivel de /shipments/{id}/costs que se pueden nombrar
// en la salida (revisión del PR #146): las que esperamos según el OS y
// la documentación oficial ("Costos del envío": senders, receiver,
// save). Cualquier otra se cuenta, pero no se imprime su nombre — igual
// criterio que logistic_type.
export const LLAVES_COSTOS_CONOCIDAS = ["senders", "receiver", "gross_amount", "save"] as const;

export function llavesDeListaBlanca(dato: unknown, permitidas: readonly string[]): string {
  if (!dato || typeof dato !== "object" || Array.isArray(dato)) return "-";
  const llaves = Object.keys(dato);
  const conocidas = llaves.filter((l) => permitidas.includes(l));
  const otras = llaves.length - conocidas.length;
  const partes = [conocidas.join("/") || "ninguna conocida"];
  if (otras > 0) partes.push(`+${otras} no conocida(s)`);
  return partes.join(", ");
}

export function valorDeListaBlanca(valor: unknown, permitidos: readonly string[]): string | null {
  if (valor === undefined || valor === null || valor === "") return null;
  return typeof valor === "string" && permitidos.includes(valor) ? valor : "(valor nuevo)";
}

// Ids de ML que el script reusa para la llamada siguiente (orden →
// envío, anunciante → campañas). Se validan antes de armar la ruta,
// igual que en lib/ml/cliente.ts — nunca se pega texto sin validar.
export function idNumerico(valor: unknown): string | null {
  const texto = typeof valor === "number" ? String(valor) : typeof valor === "string" ? valor : "";
  return /^\d+$/.test(texto) ? texto : null;
}

export function idItem(valor: unknown): string | null {
  return typeof valor === "string" && /^MCO\d+$/.test(valor) ? valor : null;
}

// Backoff exponencial con jitter, la recomendación de la documentación
// oficial ("Rate Limit / Error 429"): 1s, 2s, 4s (+ hasta 30%).
export function esperaBackoffMs(intento: number, azar: number = Math.random()): number {
  const base = 1000 * 2 ** intento;
  return Math.round(base + base * 0.3 * azar);
}

export type ResultadoCapacidad = {
  estado: Estado;
  // Códigos HTTP vistos y nombres de campos con presente/ausente —
  // nunca un valor de negocio.
  detalle: string;
};

export type ResultadoCuenta = {
  etiqueta: string;
  capacidades: Record<Capacidad, ResultadoCapacidad>;
  llamadas: number;
  respuestas429: number;
  msTotal: number;
  msMaximo: number;
};

export function formatearTablaResumen(cuentas: ResultadoCuenta[]): string {
  const encabezado = ["Cuenta", ...CAPACIDADES.map((c) => `(${c}) ${NOMBRE_CAPACIDAD[c]}`), "llamadas", "429", "ms total", "ms máx"];
  const filas = cuentas.map((c) => [
    c.etiqueta,
    ...CAPACIDADES.map((cap) => c.capacidades[cap].estado),
    String(c.llamadas),
    String(c.respuestas429),
    String(c.msTotal),
    String(c.msMaximo),
  ]);
  const lineas = [encabezado, encabezado.map(() => "---"), ...filas].map((f) => `| ${f.join(" | ")} |`);
  return lineas.join("\n");
}

export function formatearDetalle(cuentas: ResultadoCuenta[]): string {
  const bloques = cuentas.map((c) =>
    [`### ${c.etiqueta}`, ...CAPACIDADES.map((cap) => `- (${cap}) ${NOMBRE_CAPACIDAD[cap]}: ${c.capacidades[cap].estado} — ${c.capacidades[cap].detalle}`)].join("\n")
  );
  return bloques.join("\n\n");
}

// Mensaje de error apto para consola: solo el nombre del tipo de
// error, nunca el mensaje crudo (postgres.js y fetch pueden meter datos
// de conexión o la URL completa en él — mismo criterio que
// scripts/comparar-conteos-logica.ts).
export function errorSeguro(error: unknown): string {
  return error instanceof Error ? error.name : "Error";
}
