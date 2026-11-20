// Issue #221 — "Clic Analizar en /panel/investigacion = el único clic
// que autoriza abrir pestañas": marca de un solo uso, con ventana
// corta (VENTANA_MS), para que PanelInvestigacion.tsx (que puede
// montar bastante después del submit real — ej. si la persona hizo
// clic en Analizar estando en la pestaña Mercado/Estrategia y recién
// después cambió a Demanda) nunca confunda "se acaba de analizar" con
// "cambié de pestaña tiempo después". Un clic viejo expira solo —
// nunca dispara el escaneo de la extensión sin un clic real reciente.
//
// Issue #227 — suma el país de Mercado Libre elegido en el formulario
// (selector país ML) — viaja junto con la marca para que
// PanelInvestigacion sepa con qué país escanear, sin otro estado
// compartido entre FormularioAnalizar.tsx (el form) y el efecto que
// arranca el escaneo.
//
// Issue #229 — suma la plataforma de inicio elegida en el formulario
// ("Selector de plataforma de inicio antes de Analizar" — hasta esta
// tarea, Analizar arrancaba SIEMPRE con Mercado Libre; ahora la
// persona elige con cuál de las 6 arranca ese clic puntual). El país
// solo aplica cuando `plataforma === "ml"` — FormularioAnalizar.tsx
// oculta el selector de país para las otras 5.
//
// Son funciones finas sobre sessionStorage — no hay lógica real que
// probar con vitest sin un navegador (sessionStorage no existe en
// Node); lo que SÍ es lógica real y probada aparte es
// lib/ml/variantesBusqueda.ts, lib/ml/listadoCliente.ts y la decisión
// de fusionar en PanelInvestigacion.tsx.
const CLAVE = "zilonix:analizar-clic";
const VENTANA_MS = 30000;

export type PlataformaAnalizar = "ml" | "amazon" | "temu" | "aliexpress" | "shein" | "alibaba";
const PLATAFORMAS_VALIDAS: readonly PlataformaAnalizar[] = ["ml", "amazon", "temu", "aliexpress", "shein", "alibaba"];

function esPlataformaValida(valor: unknown): valor is PlataformaAnalizar {
  return typeof valor === "string" && (PLATAFORMAS_VALIDAS as readonly string[]).includes(valor);
}

// «Buscar por foto» — consultas extra que reconoció la IA (solo texto, nunca
// la foto): viajan en la MISMA marca de un solo uso y 30 s, así
// PanelInvestigacion las mezcla con las variantes sin otro estado compartido.
const MAX_CONSULTAS_FOTO = 4;

function limpiarConsultasFoto(valor: unknown): string[] {
  if (!Array.isArray(valor)) return [];
  return valor
    .filter((c): c is string => typeof c === "string")
    .map((c) => c.trim().slice(0, 60))
    .filter(Boolean)
    .slice(0, MAX_CONSULTAS_FOTO);
}

export function marcarClicAnalizar(pais: string, plataforma: PlataformaAnalizar, consultasFoto?: string[]): void {
  try {
    sessionStorage.setItem(CLAVE, JSON.stringify({ ts: Date.now(), pais, plataforma, ...(consultasFoto?.length ? { consultasFoto: limpiarConsultasFoto(consultasFoto) } : {}) }));
  } catch {
    // sessionStorage bloqueado (modo privado estricto, etc.) — el
    // escaneo automático de la extensión simplemente no se dispara;
    // Analizar sigue funcionando igual (solo por API), nunca se rompe
    // la búsqueda por esto.
  }
}

export function consumirClicAnalizarReciente(): { pais: string; plataforma: PlataformaAnalizar; consultasFoto?: string[] } | null {
  let crudo: string | null = null;
  try {
    crudo = sessionStorage.getItem(CLAVE);
    sessionStorage.removeItem(CLAVE); // un solo uso — nunca se vuelve a disparar solo con un remount
  } catch {
    return null;
  }
  if (!crudo) return null;
  try {
    const { ts, pais, plataforma, consultasFoto } = JSON.parse(crudo) as { ts?: number; pais?: string; plataforma?: string; consultasFoto?: unknown };
    if (typeof ts !== "number" || !Number.isFinite(ts) || Date.now() - ts > VENTANA_MS) return null;
    return {
      pais: typeof pais === "string" && pais ? pais : "CO",
      plataforma: esPlataformaValida(plataforma) ? plataforma : "ml",
      ...(limpiarConsultasFoto(consultasFoto).length ? { consultasFoto: limpiarConsultasFoto(consultasFoto) } : {}),
    };
  } catch {
    return null;
  }
}
