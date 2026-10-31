# Zilonix Seller — guía del repositorio

Este archivo es la puerta de entrada para cualquiera (persona o IA) que trabaje en este repositorio (`zilonix-plataforma`). Trae solo las reglas que aplican a TODA tarea, sin importar el módulo. Lo detallado o específico de un solo tema vive en `docs/claude/` — cada sección de abajo dice cuándo leer cuál.

Para el estado real del proyecto (qué está hecho, qué falta, problemas conocidos) ver **`docs/ESTADO.md`** — ese archivo cambia después de cada tarea; este no.

## Qué es Zilonix Seller

Zilonix Seller es un SaaS multiempresa para vendedores que operan en Mercado Libre (Colombia, con la idea de sumar otros países/marketplaces más adelante). Cada negocio que se registra es una **empresa** aislada: conecta sus propias cuentas de Mercado Libre, administra su propio equipo con roles y permisos, y nunca ve ni toca un dato de otra empresa — ni por accidente ni por un bug, porque el aislamiento se fuerza a nivel de base de datos (RLS), no solo en el código de la aplicación.

Es la reconstrucción, desde cero y con estos estándares, de lo que hoy hace el **Zilonix OS actual** (repo aparte, `zilonix-os-web`) para un solo negocio (el de Mateo) — ese sistema sigue en producción con datos reales mientras este se construye. El plan completo de migración vive en `zilonix-os-web/docs/plan-tecnico.md` (fuente de verdad de *qué construir y en qué orden*); su resumen de tareas de Mercado Libre, con el estado en esta plataforma, está en `docs/plan-tecnico-resumen.md`.

## Stack

| Capa | Elección | Por qué |
|---|---|---|
| Framework | Next.js 14 (App Router), TypeScript | Server Components + Server Actions, sin API REST separada |
| Base de datos | Postgres en Railway, con Drizzle ORM | Migraciones versionadas y tipadas de punta a punta |
| Autenticación | Clerk | Login, 2FA y recuperación de acceso resueltos por el proveedor |
| Multiempresa | Row-Level Security (RLS) de Postgres | Garantía de la base de datos, no solo del código — detalle en `docs/claude/multiempresa-rls.md` |
| Hosting | Railway (`staging` y `production`, cada uno su propio Postgres) | Deploy automático al hacer push a `main` |
| CI | GitHub Actions | Compila, tipa (`tsc`), corre pruebas y build en cada PR, con su propio Postgres efímero |

**RLS y multiempresa**: toda tabla con `empresa_id` usa RLS real (nunca solo código), y cada PR que la toca trae su propia prueba de aislamiento contra Postgres real. Antes de tocar cualquier tabla nueva, leer **`docs/claude/multiempresa-rls.md`** (los 3 usuarios de base restringidos, `dbComoEmpresa`, `requierePermiso`).

**Mapa completo de carpetas**: `docs/claude/estructura-carpetas.md`. Resumen: `app/` (rutas Next.js), `db/` (schema, migraciones, RLS), `lib/ml/` (toda la integración con Mercado Libre), `lib/trabajos/` (tareas en segundo plano), `docs/` (changelog, estado, diseño), `scripts/` (mantenimiento).

## Comandos

```bash
npm install
npm run dev              # servidor local (necesita .env.local — ver docs/ESTADO.md)
npm run typecheck        # tsc --noEmit
npm run test             # vitest (pruebas con Postgres necesitan DATABASE_URL_APP real)
npm run build            # build de producción

npm run db:generate      # genera una migración después de cambiar db/schema.ts
npm run db:migrate       # aplica migraciones pendientes — detalle en docs/claude/migraciones.md
npm run docs:permisos    # regenera docs/matriz-permisos.md desde lib/roles.ts
```

## Despliegue en Railway

- Dos ambientes, `staging` y `production`, cada uno su propio servicio `web` y su propio Postgres — nunca comparten base de datos.
- **Nunca `railway up`.** Deploy solo vía `git push` a `main` (auto-deploy) o `railway redeploy`. Verificar siempre contra `/api/version` antes de dar una tarea por cerrada.
- Las migraciones y `db/rls-setup.sql` se corren a mano contra cada ambiente por un túnel privado — nunca exponiendo la base a internet. Detalle: `docs/claude/migraciones.md`.

## Convenciones de código

- **Comentarios y mensajes de commit en español.** Un comentario explica el POR QUÉ, no el qué — la mayoría cita el bug o la evidencia real que motivó la regla; borrarlo sin entender la causa suele reintroducirlo.
- **Server Actions por defecto**; un Route Handler (`app/api/.../route.ts`) solo cuando hace falta devolver algo que una Server Action no puede (binario crudo, un webhook sin sesión).
- **Toda ruta nueva de `app/` se clasifica en `scripts/verificar-permisos.test.ts`** — protegida, de superadmin, o exenta (con el motivo escrito). El CI falla si no.
- **Toda llamada a la API de Mercado Libre pasa por `lib/ml/cliente.ts`**, y **toda tarea en segundo plano vive en `lib/trabajos/`** — nunca un `fetch` a Mercado Libre o un cron suelto en otro archivo.
- **Nunca se adivina el comportamiento de la API de Mercado Libre.** Se confirma contra el código real que ya corre en producción en `zilonix-os-web`, o se pregunta en vez de inventar.
- **Las pruebas de aislamiento corren contra Postgres real**, nunca contra un mock — RLS no se puede simular de forma confiable.

## Ahorro de créditos

- Leer solo los archivos necesarios para la tarea puntual — no explorar todo el repo ni releer `docs/claude/*.md` que no aplican a lo que se está tocando.
- Respuestas cortas: no repetir código que ya se mostró en el mismo hilo.
- Mientras se trabaja, correr solo los tests afectados (`npx vitest run <archivo>`); la suite completa (`npm run test`) una sola vez, antes de abrir o actualizar el PR.
- Evitar releer `node_modules/`, `.next/`, `dist/`, `build/`, `coverage/` o archivos `.env*` — están bloqueados en `.claude/settings.json`.

## Reglas no negociables

Estas reglas aplican tanto a este repo (`zilonix-plataforma`) como al Zilonix OS actual (`zilonix-os-web`, Fase 0, mientras sigue en producción con datos reales). Si una regla de acá choca con lo que pide una tarea puntual, la regla tiene prioridad — se pausa y se avisa, nunca se rompe en silencio.

### Seguridad — lo que nunca se negocia

- **Ningún secreto en texto plano en un chat, un commit o un comando.** Claves, tokens, contraseñas: se manejan directo en Railway (o el gestor de secretos que corresponda), nunca pegados en una conversación ni materializados en un comando de terminal.
- **Toda ruta cerrada por defecto.** Si una ruta nueva necesita quedar pública o sin sesión, eso se justifica explícitamente (en el PR, en este documento). Detalle de rutas de máquina y rutas públicas hoy: `docs/claude/rutas-publicas.md`.
- **Nada de rutas de diagnóstico ni de setup en producción sin sesión de admin + auditoría.** Los `ver-*`, `test-*`, `poc-*` y reparaciones corren una vez y se apagan o quedan detrás de `SETUP_HABILITADO`.
- **Tokens de marketplaces y credenciales de DIAN siempre cifrados**, con versión de clave para poder rotarla sin perder acceso.
- **Nunca confiar en el contenido de un webhook o aviso externo** (ML, pasarela de pagos, etc.) — se usa solo como señal para ir a consultar el dato real con la API y el token correspondiente.
- **La IA solo sugiere, nunca ejecuta una acción a partir de texto escrito por un tercero** (un comprador, un mensaje, una reseña) sin que una persona lo confirme.
- **Superadmin nunca ve datos de negocio de un cliente** salvo acceso temporal concedido explícitamente por ese cliente, y queda registrado en auditoría.
- **Nunca pasar un dato que venga del usuario a `sql.identifier`, `sql.raw` ni `.as()`.** Para ordenar o filtrar de forma dinámica se usa una lista blanca de columnas permitidas, nunca el nombre que manda la petición.
- **Tras un incidente del proveedor, los secretos se rotan con un checklist por NOMBRE de variable** (qué cambió, dónde se usa, que el servicio sigue arriba después) — nunca pegando el valor en ningún lado, ni en el checklist mismo.

### Proceso — lo que siempre se respeta

- **Nada pasa a producción sin pasar antes por staging.** La versión de `package.json` sube SOLO en el release a la rama `produccion`, nunca en un PR normal a `main`.
- **Changelog: cada PR deja su propio fragmento en `docs/changelog/pendientes/<rama>.md`** — nunca editar `docs/CHANGELOG.md` directamente en un PR normal.
- **Una migración a la vez.** Antes de crear una, pregunta a Pablo de quién es el turno; Pablo lleva el turno en el diario del equipo. Si la tarea necesita migración, PARA y pregunta antes de escribirla. Detalle y mecánica: `docs/claude/migraciones.md`.
- **Nombre de rama según el frente que toca** (`seguridad-`, `docs-`, `test-`, `feat-`, `fix-`, `ci-`, `chore-`…) **y fusión siempre por squash** — un commit por PR en `main`.
- **Toda rama lista para revisar se abre como Pull Request (borrador) el mismo día.** Una rama sin PR abierto nunca corre CI.
- **Nunca commits directos a `main` sin pasar por Pull Request, con CI en verde antes de fusionar.** `main` tiene un ruleset de GitHub que lo fuerza.
- **Nunca force-push**, ni a una rama con PR abierto ni a `main` — para actualizar una rama contra `main`, usar `git merge origin/main`.
- **Commits y PRs referencian el issue con `Refs #N`, nunca `Closes #N`** — así el issue se cierra a mano, cuando de verdad se verificó, no solo al fusionar.
- **Avisar antes de tocar `extension/` o `db/schema.ts`.** Ambos tienen consecuencias fuera del PR: `extension/` exige reinstalación completa del lado de cada usuario (nunca alcanza con "Recargar"), y `db/schema.ts` dispara una migración versionada con su propio turno (ver arriba).
- **Todo módulo nuevo usa el diseño de marca de `/panel` (Inicio):** fondo oscuro, bordes con degradado plata-azul, esquinas redondeadas, títulos de sección pequeños en mayúscula, estilos y tokens existentes de `globals.css`/Tailwind, sin paleta nueva, y debe funcionar en tema claro y oscuro.

### Cómo se trabaja con Claude Code en este proyecto

- Respuestas y comentarios de código en español.
- Commits: mensaje completo primero (vía archivo), luego `git commit -F`, luego trabajar por rama + Pull Request (nunca push directo a `main`). Cada commit termina con la línea de atribución que indique el sistema.
- Cada tarea del plan técnico (`zilonix-os-web/docs/plan-tecnico.md`) se trabaja de a una por sesión — no se mezclan varias tareas de fases distintas en el mismo cambio, salvo que el usuario lo pida explícitamente.
- Ante evidencia ambigua: verificar con evidencia real antes de adivinar — preferir un diagnóstico barato (log, prueba puntual, búsqueda) a construir una solución completa sobre un supuesto sin confirmar.
- Las Decisiones pendientes (`zilonix-os-web/docs/plan-tecnico.md`, tabla D1–D8 y N1–N8) se resuelven con Mateo o Débora antes de construir la tarea que depende de ellas — no se asume una por default.

### Qué NO entra a la plataforma nueva

Lo personal de Mateo (trading, proyectos, tareas, reuniones, decisiones, asistente) se queda en el Zilonix OS actual — no se migra ni se generaliza como si fuera parte del producto multiempresa.
