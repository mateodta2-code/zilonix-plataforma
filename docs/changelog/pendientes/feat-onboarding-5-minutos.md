- **2026-11-01** — issue #323 (Z-MT-14b, onboarding de 5 minutos medible). #60 (Z-MT-14, el onboarding de 4 pasos que #323 dice "no reemplaza") todavía no existe en este repo — ni archivos ni rama —, así que este PR cubre el alcance que #323 pide, sin nada que reutilizar de #60 ni nada que migrar después.

  **`lib/onboarding.ts`** (nuevo): `obtenerProgresoOnboarding(empresaId)` — los 3 pasos del checklist calculados EN VIVO contra lo que ya existe, sin ninguna columna ni tabla nueva. "Crear empresa" ni se consulta (si hay `empresaId` para preguntar, ya existe); "conectar 1 cuenta" reusa `obtenerCuentaMlActiva` (solo cuenta una SIN desconectar); "ver 1 pedido" es un `exists` nuevo y chico contra `pedidos`. 3 pruebas contra Postgres real (`lib/onboarding.test.ts`), progresando de "nada" a "completo".

  **`components/panel/ChecklistOnboarding.tsx`** (nuevo, servidor) + **`ChecklistOnboardingCliente.tsx`** (nuevo, cliente) + su `.module.css` — el checklist arriba de `/panel`, con los 3 pasos, su check cuando está hecho y un botón al siguiente paso concreto (Conectar Mercado Libre / Ver pedidos) solo si el rol de quien mira SÍ tiene acceso a esa pantalla (si no, el paso sale sin botón, nunca manda a un "sin acceso"). Desaparece solo cuando los 3 pasos quedan completos — no hace falta guardar "ya se mostró el cartel de listo" para algo que no vuelve a faltar.

  **"Saltar por ahora" / volver a mostrarlo**: `localStorage`, clave `zilonix-onboarding-oculto-<empresaId>` (mismo patrón ya usado por `SelectorTema.tsx` para el tema claro/oscuro) — por empresa, no por usuario, y sin romper nada si el storage está bloqueado (ventana privada: se muestra siempre, solo no lo recuerda). 5 pruebas de componente (`ChecklistOnboardingCliente.test.tsx`), sin Postgres.

  **`app/panel/page.tsx`** — monta el checklist debajo del saludo, arriba de las pestañas. `puedeConsultarModulo` ahora también acepta `"configuracion"` (lo que pide `/panel/conectar-ml`) para decidir si el paso 2 lleva botón.

  **Estados vacíos con el siguiente paso, en español neutro, sin términos técnicos**:
  - `/panel/pedidos` (vía `components/finanzas/DetalleDiaCuentaProducto.tsx`, prop nueva `mensajeVacio` — opcional, Finanzas → Ventas sigue con su mensaje de siempre): si no hay ninguna cuenta conectada, el mensaje y el botón son "conecta tu cuenta de Mercado Libre", no "no hay ventas en este rango".
  - `/panel/despachos`: mismo caso — sin ninguna cuenta conectada, botón a Conectar Mercado Libre en vez de "no hay despachos pendientes" (que confundía "no conectaste nada" con "no te ha llegado nada todavía").
  - `/panel/conectar-ml`: agrega un `EstadoVacio` explicando para qué sirve conectar, antes del botón que ya existía.

  **Medición (punto 4 del issue) — parcial, a propósito**: la fecha de creación de la empresa YA existe (`empresas.creado_ts`, sin trabajo nuevo). La fecha en la que se completan los 3 pasos **no se guarda**: guardarla de forma confiable (no recalculada distinto en cada visita) pide una columna o fila nueva — una migración —, y el issue pide explícitamente pausar y avisar en ese caso en vez de improvisar algo sin migración (ej. reusar la tabla `auditoria`, que es el log de actividad que la propia persona ve en `/panel/actividad` — meterle un evento sintético de analítica ahí mezclaría dos cosas distintas). Queda sin hacer; si se quiere ese dato, es la próxima migración a pedir turno.

  **No se tocó**: `extension/`, `lib/ml/cliente.ts`, `db/schema.ts` (sin migración), `lib/roles.ts`/`lib/roles-plantillas.ts`, ningún `es-CO`/`COP`/`$` a mano (el checklist no muestra montos ni fechas con moneda).

  Verificado: `npm run typecheck` en verde. `npx vitest run components/panel/ChecklistOnboardingCliente.test.tsx` en verde (5/5, sin Postgres). `lib/onboarding.test.ts` necesita `DATABASE_URL_APP` (no disponible en este entorno) — corre en CI con el Postgres efímero del PR.
