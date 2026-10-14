# Reglas no negociables — Zilonix OS / Zilonix Plataforma

Este archivo aplica tanto al Zilonix OS actual (Fase 0, mientras sigue en producción con datos reales) como a la plataforma nueva que se construye a partir de la Fase 1 (`plan-tecnico.md`). Si una regla de acá choca con lo que pide una tarea puntual, esta tiene prioridad — se pausa y se avisa, no se rompe en silencio.

**Nota de ubicación**: este repo (`zilonix-plataforma`) es la plataforma nueva en sí. El plan técnico completo, el mapa del sistema actual y el resto de la documentación de referencia viven en el repo `zilonix-os-web` (`docs/plan-tecnico.md`, `docs/mapa-sistema.md`, `docs/mapa-tablas.md`) — se consultan ahí, no se duplican acá.

## Seguridad — lo que nunca se negocia

- **Ningún secreto en texto plano en un chat, un commit o un comando.** Claves, tokens, contraseñas: se manejan directo en Railway (o el gestor de secretos que corresponda), nunca pegados en una conversación ni materializados en un comando de terminal.
- **Toda ruta cerrada por defecto.** Si una ruta nueva necesita quedar pública o sin sesión, eso se justifica explícitamente (en el PR, en este documento) — nunca por omisión.
- **Nada de rutas de diagnóstico ni de setup en producción sin sesión de admin + auditoría.** Los `ver-*`, `test-*`, `poc-*` y reparaciones corren una vez y se apagan o quedan detrás de `SETUP_HABILITADO`.
- **Tokens de marketplaces y credenciales de DIAN siempre cifrados**, con versión de clave para poder rotarla sin perder acceso.
- **Nunca confiar en el contenido de un webhook o aviso externo** (ML, pasarela de pagos, etc.) — se usa solo como señal para ir a consultar el dato real con la API y el token correspondiente.
- **La IA solo sugiere, nunca ejecuta una acción a partir de texto escrito por un tercero** (un comprador, un mensaje, una reseña) sin que una persona lo confirme.
- **En la plataforma multiempresa: seguridad por fila (RLS) en toda tabla con `empresa_id`**, y la app se conecta a Postgres con un usuario sin privilegios para saltarse esa política. La prueba de aislamiento (empresa A nunca ve datos de empresa B) corre en cada PR, no es opcional.
- **Superadmin nunca ve datos de negocio de un cliente** salvo acceso temporal concedido explícitamente por ese cliente, y queda registrado en auditoría.

## Proceso — lo que siempre se respeta

- **Nada pasa a producción sin pasar antes por staging.** Cada entrega sube el número de versión (visible en el pie de página y en `/api/version`) y queda en `docs/CHANGELOG.md`.
- **Nunca `railway up`.** Deploy solo vía `git push` (auto-deploy) o `railway redeploy`. Siempre verificar el deploy uno mismo (ej. consultando `/api/version` o el endpoint correspondiente) antes de dar algo por terminado.
- **Cada cambio de tablas va en una migración versionada** (Drizzle, en la plataforma nueva) — nunca `CREATE TABLE IF NOT EXISTS` suelto dentro de una ruta.
- **Nunca commits directos a `main` sin pasar por Pull Request.**
- **Todo cambio a la extensión de Chrome exige reinstalación completa** del lado del usuario (nunca alcanza con "Recargar") — bajar el ZIP solo después de confirmar que `version.json` ya muestra la versión nueva.

## Cómo se trabaja con Claude Code en este proyecto

- Respuestas y comentarios de código en español.
- Commits: mensaje completo primero (vía archivo), luego `git commit -F`, luego trabajar por rama + Pull Request (nunca push directo a `main`). Cada commit termina con la línea de atribución que indique el sistema.
- Cada tarea del plan técnico (`zilonix-os-web/docs/plan-tecnico.md`) se trabaja de a una por sesión — no se mezclan varias tareas de fases distintas en el mismo cambio, salvo que el usuario lo pida explícitamente.
- Ante evidencia ambigua (un bug, un comportamiento de una API externa, una decisión de arquitectura): verificar con evidencia real antes de adivinar — preferir un diagnóstico barato (log, prueba puntual, búsqueda) a construir una solución completa sobre un supuesto sin confirmar.
- Las Decisiones pendientes (`zilonix-os-web/docs/plan-tecnico.md`, tabla de Decisiones D1–D6 y N1–N8) se resuelven con Mateo o Debora antes de construir la tarea que depende de ellas — no se asume una por default.

## Qué NO entra a la plataforma nueva

Lo personal de Mateo (trading, proyectos, tareas, reuniones, decisiones, asistente) se queda en el Zilonix OS actual — no se migra ni se generaliza como si fuera parte del producto multiempresa.
