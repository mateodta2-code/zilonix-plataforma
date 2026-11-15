- **2026-11-15** — Conector Falabella, primer corte real (issue por crear). Adelanta la tarea 5.1 del plan técnico (Fase 5, "Escalar") fuera de secuencia — **decisión confirmada con Mateo/Debora el 15/11**, a sabiendas de que las Fases 3 (DIAN) y 4 (piloto pagado) todavía no empezaron.

  **Alcance de este corte, a propósito acotado**: conectar una cuenta de Falabella Seller Center (API Key, no OAuth — Falabella no tiene ese flujo) y traer sus pedidos reales. `traerProductos`/`publicarProducto`/`actualizarStockPrecio`/mensajes quedan sin implementar (lanzan un error explícito, nunca una ejecución silenciosa) — mismo criterio que Promociones/Programar Full de Mercado Libre, todavía incompletas.

  **Contrato de conector (tarea 2.2)**: `lib/conectores/falabella.ts` es el primer caso REAL que implementa la interfaz `Conector` (`lib/conectores/tipos.ts`) — hasta ahora solo se había probado contra `ConectorFalso` (en memoria).

  **Base de datos** (`db/schema.ts`, migración `0024_curious_baron_strucker.sql` — **turno de migración NO confirmado con Pablo todavía**, generada localmente, no aplicada en staging ni producción): `cuentas_falabella` y `pedidos_falabella`, tablas PARALELAS a `cuentas_ml`/`pedidos` (no se generalizan esas dos para los dos marketplaces a la vez en este cambio — ver nota en `db/schema.ts` sobre el alcance). `db/rls-setup.sql` actualizado con GRANT + RLS + política de aislamiento simple para las dos tablas nuevas (sin las políticas de transferencia/webhook de `cuentas_ml`, este corte no las necesita).

  **Cifrado**: `lib/cifrado.ts` gana `cifrarTokenFalabella`/`descifrarTokenFalabella`, con su propia variable de entorno `FALABELLA_TOKEN_KEY_V1` — nunca comparte clave con `ML_TOKEN_KEY_V1` (marketplaces distintos, secretos distintos).

  **API de Falabella** (`lib/falabella/cliente.ts`): firma HMAC-SHA256 por request (API Key como clave, parámetros ordenados alfabéticamente, RFC 3986 URL-encoded), confirmada contra `developers.falabella.com/docs/signing-requests`. **Incógnita real, documentada en el código, no adivinada a ciegas**: los nombres exactos de los parámetros de filtro de fecha/paginación de `GetOrders` (`CreatedAfter`/`Limit`/`Offset` en `lib/falabella/pedidos.ts`) son la hipótesis mejor fundada (misma familia de API que Lazada/Linio/Daraz), no una confirmación directa de la documentación de Falabella (la tabla de parámetros queda colapsada sin credenciales reales) — se terminan de confirmar contra una cuenta real antes de dar el conector por cerrado del todo.

  **UI**: `/panel/conectar-falabella` (página + Server Actions), mismo diseño de marca y mismo criterio de errores con código fijo (nunca texto crudo en la URL) que `/panel/conectar-ml`.

  Verificado: `npm run typecheck` en verde. `npx vitest run lib/falabella/cliente.test.ts scripts/verificar-permisos.test.ts` en verde (252 pruebas). `npm run build` compila y tipa en verde, falla después en el mismo punto ambiental conocido (`DATABASE_URL_APP` ausente en este entorno — no es nuevo). `db/rls-falabella.test.ts` (prueba de aislamiento de las 2 tablas nuevas, mismo patrón que `db/rls-cuentas-ml.test.ts`) escrita pero **no corrida contra Postgres real todavía** — necesita CI o un túnel a staging, ninguno disponible en este entorno local.

  **No se tocó**: `cuentas_ml`, `pedidos`, ni ningún módulo de Mercado Libre.

  **Pendiente antes de fusionar**: confirmar con Pablo el turno de migración; correr `db/rls-falabella.test.ts` contra Postgres real (CI o staging); aplicar la migración y `db/rls-setup.sql` contra staging y producción; conseguir una cuenta real de Falabella para confirmar los nombres de parámetro de `GetOrders` y el primer pedido importado de verdad.
