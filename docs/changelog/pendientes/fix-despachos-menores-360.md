- **2026-11-02** — Refs #319 (menores de la revisión del PR #360): `liberarAviso` (`lib/ml/trabajador.ts`) ahora atrapa su propio error en vez de dejarlo propagar — antes, si el `UPDATE` que la libera fallaba (ej. Postgres caído) justo en el `trabajo.catch()` del trabajo huérfano que ya nadie espera (tras vencer el tope de 5s del webhook), quedaba como una promesa sin manejar; ahora se registra con `console.error` y nunca rompe el proceso, sin cambiar el comportamiento normal (sigue liberando el aviso para que el cron de respaldo lo retome). Test nuevo en `lib/ml/trabajador.test.ts`: el trabajo de fondo falla (500 real de Mercado Libre, nunca un 429) DESPUÉS del tope de `intentarProcesarAvisoAhora` — confirma que el aviso queda liberado (`procesado_ts` vuelve a null, nunca se queda "reclamado" para siempre) y que el cron de respaldo lo retoma después.

  Sin tocar `extension/`, `lib/ml/cliente.ts` ni `db/schema.ts`. Sin migración.

  Verificado: `npm run typecheck` en verde. `npx vitest run lib/ml/trabajador.test.ts` no se pudo correr en este sandbox (falta `DATABASE_URL_APP` — sin Postgres local ni Docker disponibles acá; limitación ambiental, no del código, igual que otros fragmentos de este changelog) — queda a validar por CI, que sí tiene el Postgres efímero.

  Refs #319
