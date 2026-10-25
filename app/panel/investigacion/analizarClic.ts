// Issue #221 — "Clic Analizar en /panel/investigacion = el único clic
// que autoriza abrir pestañas": marca de un solo uso, con ventana
// corta (VENTANA_MS), para que PanelDemanda.tsx (que puede montar
// bastante después del submit real — ej. si la persona hizo clic en
// Analizar estando en la pestaña Mercado/Estrategia y recién después
// cambió a Demanda) nunca confunda "se acaba de analizar" con
// "cambié de pestaña tiempo después". Un clic viejo expira solo —
// nunca dispara el escaneo de la extensión sin un clic real reciente.
//
// Son dos funciones finas sobre sessionStorage — no hay lógica real
// que probar con vitest sin un navegador (sessionStorage no existe en
// Node); lo que SÍ es lógica real y probada aparte es
// lib/ml/variantesBusqueda.ts y la decisión de fusionar/auto-importar
// en app/panel/investigacion/PanelDemanda.tsx.
const CLAVE = "zilonix:analizar-clic";
const VENTANA_MS = 8000;

export function marcarClicAnalizar(): void {
  try {
    sessionStorage.setItem(CLAVE, String(Date.now()));
  } catch {
    // sessionStorage bloqueado (modo privado estricto, etc.) — el
    // escaneo automático de la extensión simplemente no se dispara;
    // Analizar sigue funcionando igual (solo por API), nunca se rompe
    // la búsqueda por esto.
  }
}

export function consumirClicAnalizarReciente(): boolean {
  let marca: string | null = null;
  try {
    marca = sessionStorage.getItem(CLAVE);
    sessionStorage.removeItem(CLAVE); // un solo uso — nunca se vuelve a disparar solo con un remount
  } catch {
    return false;
  }
  if (!marca) return false;
  const ts = Number(marca);
  return Number.isFinite(ts) && Date.now() - ts <= VENTANA_MS;
}
