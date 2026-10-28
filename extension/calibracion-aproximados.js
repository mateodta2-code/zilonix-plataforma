// GENERADO — no editar a mano. Issue #262: copia exacta de
// lib/seguimiento/calibracion-aproximados.json, regenerada por
// scripts/empaquetar-extension.js (ver ese archivo) — para que la
// extensión y la app calculen siempre con los mismos números. Para
// cambiar un valor, editá ESE json y volvé a correr
// "npm run extension:zip" (regenera este archivo antes de armar el
// ZIP) — nunca este archivo a mano.
(function () {
  "use strict";
  const calibracion = {
  "factorVendidosFull": 2.2,
  "factorVendidosSinFull": 1.55,
  "puntos": []
};
  if (typeof module !== "undefined" && module.exports) {
    module.exports = calibracion;
  }
  if (typeof window !== "undefined") {
    window.ZilonixCalibracion = calibracion;
  }
})();
