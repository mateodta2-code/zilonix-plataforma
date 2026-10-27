// Issue #251/#261 (ahora #262, "Aproximados estilo Selltrix en los 3
// lugares") — mismo cálculo que lib/seguimiento/aproximados.ts
// (vendidos estimados, antigüedad por id, ventas/mes, facturación/mes),
// portado a JS plano para el popup de la extensión — nunca una llamada
// a la API de Mercado Libre desde acá, solo aritmética pura sobre lo
// que la página o lib/seguimiento/aproximados.ts ya confirmaron.
//
// UNA SOLA FUENTE para los factores (2.2 Full / 1.55 "+N") y la tabla
// de calibración id→fecha: los dos lados leen
// lib/seguimiento/calibracion-aproximados.json — la app lo importa
// directo (lib/seguimiento/aproximados.ts), y scripts/empaquetar-extension.js
// regenera extension/calibracion-aproximados.js a partir de ESE MISMO
// JSON antes de armar el ZIP (ver ese script) — nunca un valor
// duplicado a mano en dos lugares. extension/aproximados.test.ts
// (issue #262) prueba que los dos lados dan el MISMO resultado para
// los mismos datos de entrada.
(function () {
  "use strict";

  const MS_POR_DIA = 24 * 60 * 60 * 1000;
  const DIAS_POR_MES = 30;

  // Mismo patrón prefijo+dígitos que numeroYPrefijoDeId (lib/seguimiento/
  // aproximados.ts) — acá solo hace falta el número para comparar
  // posiciones entre ids del MISMO país, nunca para confiar en el id
  // antes de llamar a Mercado Libre (esto nunca llama a Mercado Libre).
  function numeroYPrefijoDeId(id) {
    const m = typeof id === "string" ? id.match(/^([A-Z]{3})(\d+)$/) : null;
    if (!m) return null;
    const numero = Number(m[2]);
    return Number.isFinite(numero) ? { prefijo: m[1], numero } : null;
  }

  // 1. Vendidos estimados — igual que vendidosEstimados() del lado del
  // servidor: exacto se usa tal cual, el piso "+N" se ajusta por el
  // factor de Full/no-Full. `calibracion` = { factorVendidosFull,
  // factorVendidosSinFull, puntos } — normalmente window.ZilonixCalibracion
  // (generado, ver el comentario de arriba), pero se puede pasar otro
  // objeto para probar sin depender del global real.
  function vendidosEstimados(vendidos, opciones, calibracion) {
    if (typeof vendidos !== "number" || !Number.isFinite(vendidos) || vendidos < 0) return null;
    if (opciones && opciones.exacto) return vendidos;
    const factor = opciones && opciones.esFull ? calibracion.factorVendidosFull : calibracion.factorVendidosSinFull;
    if (typeof factor !== "number" || !Number.isFinite(factor)) return null;
    return vendidos * factor;
  }

  // 2a. Interpolación (o extrapolación con los 2 puntos más cercanos)
  // entre puntos calibrados del MISMO país y del MISMO tipo
  // (item/product) — idéntico criterio que antiguedadDiasPorId() del
  // lado del servidor. `null` con menos de 2 puntos del mismo
  // país+tipo, o si `id`/los puntos no matchean el patrón.
  function antiguedadDiasPorId(id, tipo, ahoraMs, puntos) {
    const objetivo = numeroYPrefijoDeId(id);
    if (!objetivo) return null;

    const delMismoPaisYTipo = (Array.isArray(puntos) ? puntos : [])
      .filter((p) => p && p.tipo === tipo)
      .map((p) => {
        const np = numeroYPrefijoDeId(p.id);
        const fechaMs = new Date(p.fecha).getTime();
        return np && Number.isFinite(fechaMs) ? { prefijo: np.prefijo, numero: np.numero, fechaMs } : null;
      })
      .filter((p) => p && p.prefijo === objetivo.prefijo)
      .sort((a, b) => a.numero - b.numero);
    if (delMismoPaisYTipo.length < 2) return null;

    let i = 0;
    while (i < delMismoPaisYTipo.length - 2 && delMismoPaisYTipo[i + 1].numero <= objetivo.numero) i++;
    const a = delMismoPaisYTipo[i];
    const b = delMismoPaisYTipo[i + 1];
    if (a.numero === b.numero) return null; // 2 puntos calibrados con el mismo número — no hay con qué interpolar

    const fraccion = (objetivo.numero - a.numero) / (b.numero - a.numero);
    const fechaInterpoladaMs = a.fechaMs + fraccion * (b.fechaMs - a.fechaMs);
    const dias = (ahoraMs - fechaInterpoladaMs) / MS_POR_DIA;
    return dias > 0 ? dias : null;
  }

  // 2b. date_created real (cuando la página lo incrusta, leerDatosIncrustados
  // en lectores/mercadolibre.js) siempre gana; la interpolación por id
  // es solo un respaldo mientras no lo tengamos — mismo criterio que
  // antiguedadDias() del lado del servidor.
  function antiguedadDias(opciones, calibracion) {
    if (opciones && opciones.dateCreated != null) {
      const creadoMs = new Date(opciones.dateCreated).getTime();
      if (Number.isFinite(creadoMs)) {
        const dias = (opciones.ahoraMs - creadoMs) / MS_POR_DIA;
        return dias > 0 ? dias : null;
      }
    }
    if (!opciones || opciones.mlId == null) return null;
    if (opciones.tipo !== "item" && opciones.tipo !== "product") return null;
    return antiguedadDiasPorId(opciones.mlId, opciones.tipo, opciones.ahoraMs, calibracion ? calibracion.puntos : []);
  }

  // 3. Ventas/mes — vendidos estimados × min(30, días) / días, mismo
  // tope que del lado del servidor (nunca infla una publicación de
  // pocos días extrapolando sobre casi nada de historial real).
  function ventasMes(vendidosEst, dias) {
    if (typeof vendidosEst !== "number" || !Number.isFinite(vendidosEst) || vendidosEst < 0) return null;
    if (typeof dias !== "number" || !Number.isFinite(dias) || dias <= 0) return null;
    return (vendidosEst * Math.min(DIAS_POR_MES, dias)) / dias;
  }

  // 4. Facturación/mes — ventas/mes × precio actual de la página.
  function facturacionMes(ventasMesValor, precio) {
    if (typeof ventasMesValor !== "number" || !Number.isFinite(ventasMesValor)) return null;
    if (typeof precio !== "number" || !Number.isFinite(precio) || precio < 0) return null;
    return ventasMesValor * precio;
  }

  const api = { vendidosEstimados, antiguedadDiasPorId, antiguedadDias, ventasMes, facturacionMes, numeroYPrefijoDeId };

  // Issue #174 — mismo patrón dual que extension/utilidades.js: en el
  // navegador real no existe `module`; en Node (vitest) no existe
  // `window`.
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
  if (typeof window !== "undefined") {
    window.ZilonixAproximados = api;
  }
})();
