- **2026-11-24** — Pedidos de Falabella automáticos cada 30 minutos, en staging (Refs #422). Le sirve a Finanzas y a Despachos: ya no hace falta apretar "Sincronizar".

  **Mismo modelo que Publicidad (issue #254)**:
  - `POST /api/trabajos/falabella` (`app/api/trabajos/falabella/route.ts`), pública en el middleware (`lib/rutas-publicas.ts`) y en `RUTAS_DE_MAQUINA`. La única puerta es el secreto `FALABELLA_TRABAJADOR_SECRET` (cabecera `x-falabella-trabajador-secret`), comparado con `timingSafeEqual`. Sin secreto o con uno inválido: 401.
  - `lib/trabajos/sincronizarFalabella.ts` recorre las `cuentas_falabella` con `desconectada_ts IS NULL` de todas las empresas y llama `importarPedidos(empresa, cuenta, ahora − 3 días)`. Una cuenta que falla no corta a las demás: queda en `auditoria` como `sistema` (`sincronizar_pedidos_falabella_fallida`), sin URLs, correos ni firmas en el detalle. La respuesta trae un resumen por cuenta (id, importados, truncado o el nombre del error).
  - `.github/workflows/sincronizar-falabella.yml`: cron `*/30 * * * *` y `workflow_dispatch`, contra staging. Producción queda comentada: entra el sábado 28 con Mateo.

  **Base de datos**: sin migración de Drizzle. `db/rls-setup.sql` suma el rol `falabella_trabajador_user` (contraseña marcador `CAMBIAR_EN_RAILWAY`), que solo puede leer `id`, `empresa_id` y `desconectada_ts` de `cuentas_falabella`. Nada de credenciales ni escrituras con esa conexión (`db/trabajador-falabella-context.ts`, variable `DATABASE_URL_FALABELLA`). Lo corre Mateo a mano en cada ambiente.

  **No se tocó**: `lib/falabella/pedidos.ts`.
