- **2026-11-15** — feat(extension): versión 0.3.45 lista para la Chrome Web Store (Refs #414).

  - **Dominio**: el default de producción de la extensión (`extension/config.js`, `background.js`) pasa a `https://seller.zilonix.com`. Staging (`web-staging-d979.up.railway.app`) se conserva. La URL vieja de Railway queda SOLO como origen permitido/`matches` (compatibilidad); no se quitó nada en Railway.
  - **Configuración remota**: ruta pública `GET /api/extension/config` (`lib/extension/configuracion.ts`: servidor, interruptores, textos). `background.js` la descarga (sin credenciales, máx. cada 6 h), la valida y la guarda en `chrome.storage.local`; `config.js` la lee. Si algo falla, quedan los valores por defecto seguros.
  - **Alibaba, en pausa**: interruptor `alibaba` apagado; el botón de Alibaba de la plataforma (Analizar / Demanda) queda oculto. No se tocó el lector.
  - Versión 0.3.44 → 0.3.45 (`manifest.json`, `version.json`). Requiere reinstalación completa de la extensión; publicar en la tienda: Mateo.
