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
  "puntos": [
    {
      "id": "MCO602965132",
      "tipo": "item",
      "fecha": "2020-12-28"
    },
    {
      "id": "MCO1333873907",
      "tipo": "item",
      "fecha": "2023-08-05"
    },
    {
      "id": "MCO1742001365",
      "tipo": "item",
      "fecha": "2025-12-01"
    },
    {
      "id": "MCO1836584643",
      "tipo": "item",
      "fecha": "2026-02-19"
    },
    {
      "id": "MCO2275587337",
      "tipo": "item",
      "fecha": "2026-10-11"
    },
    {
      "id": "MCO24729698",
      "tipo": "product",
      "fecha": "2023-07-24"
    },
    {
      "id": "MCO52242836",
      "tipo": "product",
      "fecha": "2025-07-11"
    },
    {
      "id": "MCO52762065",
      "tipo": "product",
      "fecha": "2025-07-16"
    },
    {
      "id": "MCO2068057559",
      "tipo": "product",
      "fecha": "2026-04-15"
    }
  ]
};
  if (typeof module !== "undefined" && module.exports) {
    module.exports = calibracion;
  }
  if (typeof window !== "undefined") {
    window.ZilonixCalibracion = calibracion;
  }
})();
