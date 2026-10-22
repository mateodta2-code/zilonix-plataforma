# Zilonix Seller — guía del repositorio

Este archivo es la puerta de entrada para cualquiera (persona o IA) que trabaje en este repositorio (`zilonix-plataforma`). Las reglas no negociables están al final — son las que nunca se rompen en silencio, pase lo que pase con el resto.

Para el estado real del proyecto (qué está hecho, qué falta, problemas conocidos) ver **`docs/ESTADO.md`** — ese archivo cambia después de cada tarea; este no.

## Qué es Zilonix Seller

Zilonix Seller es un SaaS multiempresa para vendedores que operan en Mercado Libre (Colombia, con la idea de sumar otros países/marketplaces más adelante). Cada negocio que se registra es una **empresa** aislada: conecta sus propias cuentas de Mercado Libre, administra su propio equipo con roles y permisos, y nunca ve ni toca un dato de otra empresa — ni por accidente ni por un bug, porque el aislamiento se fuerza a nivel de base de datos (RLS), no solo en el código de la aplicación.

Es la reconstrucción, desde cero y con estos estándares, de lo que hoy hace el **Zilonix OS actual** (repo aparte, `zilonix-os-web`) para un solo negocio (el de Mateo) — ese sistema sigue en producción con datos reales mientras este se construye; no se apaga ni se migra de golpe. El plan completo de migración y el mapa del sistema actual viven en `zilonix-os-web/docs/plan-tecnico.md` — ese documento es la fuente de verdad de *qué construir y en qué orden*; este repo es donde eso se construye.

**Para quién es**: hoy, un solo equipo de prueba (Mateo/Débora) mientras se construye la Fase 2. La idea de producto es llegar a vendedores de Mercado Libre en Colombia que hoy usan Excel, el panel nativo de Mercado Libre, o herramientas como Bling/Effi/UpSeller — con mejor seguridad por empresa, permisos reales por rol y una integración más profunda y confiable con Mercado Libre que la de esos competidores (investigación real en `zilonix-os-web/docs/investigacion/`).

## Stack y arquitectura

| Capa | Elección | Por qué |
|---|---|---|
| Framework | Next.js 14 (App Router), TypeScript | Server Components + Server Actions para no mantener una API REST separada del front |
| Base de datos | Postgres en Railway, con Drizzle ORM | Migraciones versionadas y tipadas de punta a punta |
| Autenticación | Clerk | Login, registro, verificación de correo, 2FA y recuperación de acceso resueltos por el proveedor, no a mano |
| Multiempresa | Row-Level Security (RLS) de Postgres | El aislamiento entre empresas es una garantía de la base de datos, no solo del código — ver abajo |
| Hosting | Railway (`staging` y `production`, cada uno su propio Postgres) | Mismo proveedor que Zilonix OS; deploy automático al hacer push a `main` |
| CI | GitHub Actions | Compila, tipa (`tsc`), corre pruebas y build en cada Pull Request, con su propio Postgres efímero |

### Cómo se separan las empresas (léelo antes de tocar cualquier tabla nueva)

1. **Toda tabla con datos de una empresa tiene una columna `empresa_id`** y una política de RLS (`db/rls-setup.sql`) que compara esa columna contra `current_setting('app.empresa_actual')`.
2. **La aplicación nunca se conecta a Postgres con el superusuario.** Hay tres usuarios de base, cada uno más limitado que el anterior:
   - `app_user` (`DATABASE_URL_APP`) — el único que usa el tráfico normal de la app. Respeta RLS siempre.
   - `superadmin_user` (`DATABASE_URL_SUPERADMIN`) — solo lectura de cifras agregadas para el panel `/superadmin`, nunca datos de negocio de una empresa sin acceso temporal explícito.
   - `trabajador_user` (`DATABASE_URL_TRABAJADOR`) — solo puede tocar `avisos_ml`, para el proceso que procesa notificaciones de Mercado Libre.
   - `DATABASE_URL` (el superusuario que da Railway) **solo se usa para correr migraciones** (`npm run db:migrate`), nunca para una consulta de negocio.
3. **Toda consulta de negocio pasa por `dbComoEmpresa(empresaId, fn)`** (`db/empresa-context.ts`) — fija `app.empresa_actual` con `SET LOCAL` dentro de una transacción (nunca un `SET` normal, que se filtraría a otra petición por el pool de conexiones) y recién ahí corre la consulta. Nunca se consulta una tabla de negocio directo con `db` sin pasar por este helper.
4. **Cada PR que agrega o cambia una tabla con `empresa_id` tiene que traer su propia prueba de aislamiento** contra Postgres real (no un mock — RLS no se puede simular): crear dos empresas, confirmar que una nunca ve, edita ni borra una fila de la otra. Toda tabla nueva usa la plantilla `db/test-utils/aislamiento.ts` (`crearDosEmpresas()` y `afirmarAislamiento(tabla, insertarFila)`), que comprueba que la empresa B no ve, no edita, no borra ni inserta una fila con el `empresa_id` de A, pasando por `dbComoEmpresa` / `app_user`. Si ese insert no se puede armar solo con `empresaId`, el test pasa `insertarFilaAjena`.
5. **Los permisos dentro de una empresa son una capa aparte**, por encima de RLS: `requierePermiso(usuarioId, empresaId, modulo, accion)` (`lib/permisos.ts`) es la única función que toda ruta de negocio debe llamar antes de leer o escribir algo — `scripts/verificar-permisos.test.ts` hace fallar el CI si una ruta nueva de `app/` no está clasificada como protegida (y de verdad la llama), exenta (con el motivo escrito) o de superadmin.

### Despliegue en Railway

- Dos ambientes: `staging` y `production`, cada uno su propio servicio `web` y su propio Postgres — nunca comparten base de datos.
- El deploy es automático al hacer push a `main` (o `railway redeploy`). **Nunca `railway up`** — regla no negociable, ver más abajo.
- Las migraciones de Drizzle y `db/rls-setup.sql` no se aplican solas con el deploy — hay que correrlas a mano contra cada ambiente por un túnel privado (`railway connect <servicio-postgres> --tunnel-only`), nunca exponiendo la base a internet.
- Verificar un deploy siempre contra `/api/version` (devuelve `{"version": "..."}`) antes de dar una tarea por cerrada.

## Estructura de carpetas

```
app/              Next.js App Router — una carpeta por ruta real
  api/            Route Handlers (solo cuando no alcanza una Server Action — ej. devolver un PDF/binario crudo)
  panel/          Pantallas de negocio, una vez con sesión y empresa activa
  sign-in/ sign-up/   Páginas de Clerk
  superadmin/     Panel aparte, otro eje de autorización (requiereSuperadmin(), no requierePermiso())
db/
  schema.ts       Única fuente de verdad del modelo de datos (Drizzle)
  migrations/     Generadas con `npm run db:generate`, nunca escritas a mano
  rls-setup.sql   Usuarios de base + políticas de RLS — script repetible, corrido a mano (tiene contraseñas)
  empresa-context.ts / superadmin-context.ts / trabajador-context.ts   Los únicos puntos de entrada a Postgres
  *.test.ts       Pruebas de aislamiento/RLS contra Postgres real
lib/
  ml/             Todo lo específico de la integración con Mercado Libre (OAuth, pedidos, publicar, despachos...)
  conectores/     Contrato genérico para un marketplace (hoy solo ML lo implementa de verdad)
  permisos.ts, roles.ts, auditoria.ts, membresias.ts, empresas.ts, usuarios.ts   Lógica de negocio transversal
docs/
  CHANGELOG.md    Registro de cada entrega real — qué tarea, qué se construyó, qué quedó pendiente
  ESTADO.md       Foto actual del proyecto (ver arriba)
  modelo-datos.md, rls.md, conectores.md, matriz-permisos.md   Documentación de diseño específica
scripts/          Scripts de mantenimiento (generar/verificar la matriz de permisos)
middleware.ts     Toda ruta cerrada por defecto salvo las listadas explícitamente (Clerk + límite de peticiones)
```

## Comandos

```bash
npm install
npm run dev              # servidor local (necesita .env.local — ver docs/ESTADO.md para las variables)
npm run typecheck        # tsc --noEmit
npm run test             # vitest (pruebas que tocan Postgres necesitan DATABASE_URL_APP apuntando a una base real)
npm run build             # build de producción

npm run db:generate       # genera una migración después de cambiar db/schema.ts
npm run db:migrate        # aplica migraciones pendientes contra DATABASE_URL (el superusuario)
npm run docs:permisos     # regenera docs/matriz-permisos.md desde lib/roles.ts
```

**Desplegar**: nunca `railway up`. Push a `main` (vía PR, ver reglas abajo) despliega solo; o `railway redeploy` si hace falta repetir el mismo build. Después de migraciones nuevas, correrlas a mano contra el ambiente correspondiente por el túnel privado (ver arriba).

## Convenciones de código

- **Comentarios y mensajes de commit en español.** El código (nombres de función, variables) también, salvo términos técnicos sin traducción natural.
- **Un comentario explica el POR QUÉ, no el qué.** La mayoría de los comentarios de este repo citan el bug real o la evidencia real (de Zilonix OS, de un competidor investigado, o de staging) que motivó la regla — eso es intencional, no ruido: borrar el comentario sin entender la causa real suele reintroducir el bug.
- **Server Actions por defecto**; un Route Handler (`app/api/.../route.ts`) solo cuando hace falta devolver algo que una Server Action no puede (binario crudo, un webhook externo sin sesión).
- **Toda ruta nueva de `app/` se clasifica en `scripts/verificar-permisos.test.ts`** — protegida (llama `requierePermiso`), de superadmin (llama `requiereSuperadmin`), o exenta (con el motivo escrito al lado). El CI falla si no.
- **Nunca se adivina el comportamiento de la API de Mercado Libre.** Antes de portar o construir algo que la toque, se confirma contra el código real que ya corre en producción en `zilonix-os-web` (o, si no existe precedente, se pregunta en vez de inventar) — así quedó documentado cada módulo de `lib/ml/`.
- **Las pruebas de aislamiento corren contra Postgres real**, nunca contra un mock de la base — RLS no se puede simular de forma confiable.

## Reglas no negociables

Estas reglas aplican tanto a este repo (`zilonix-plataforma`) como al Zilonix OS actual (`zilonix-os-web`, Fase 0, mientras sigue en producción con datos reales). Si una regla de acá choca con lo que pide una tarea puntual, la regla tiene prioridad — se pausa y se avisa, nunca se rompe en silencio.

### Seguridad — lo que nunca se negocia

- **Ningún secreto en texto plano en un chat, un commit o un comando.** Claves, tokens, contraseñas: se manejan directo en Railway (o el gestor de secretos que corresponda), nunca pegados en una conversación ni materializados en un comando de terminal.
- **Toda ruta cerrada por defecto.** Si una ruta nueva necesita quedar pública o sin sesión, eso se justifica explícitamente (en el PR, en este documento) — nunca por omisión.
- **Nada de rutas de diagnóstico ni de setup en producción sin sesión de admin + auditoría.** Los `ver-*`, `test-*`, `poc-*` y reparaciones corren una vez y se apagan o quedan detrás de `SETUP_HABILITADO`.
- **Tokens de marketplaces y credenciales de DIAN siempre cifrados**, con versión de clave para poder rotarla sin perder acceso.
- **Nunca confiar en el contenido de un webhook o aviso externo** (ML, pasarela de pagos, etc.) — se usa solo como señal para ir a consultar el dato real con la API y el token correspondiente.
- **La IA solo sugiere, nunca ejecuta una acción a partir de texto escrito por un tercero** (un comprador, un mensaje, una reseña) sin que una persona lo confirme.
- **En la plataforma multiempresa: seguridad por fila (RLS) en toda tabla con `empresa_id`**, y la app se conecta a Postgres con un usuario sin privilegios para saltarse esa política. La prueba de aislamiento (empresa A nunca ve datos de empresa B) corre en cada PR, no es opcional.
- **Superadmin nunca ve datos de negocio de un cliente** salvo acceso temporal concedido explícitamente por ese cliente, y queda registrado en auditoría.

### Proceso — lo que siempre se respeta

- **Nada pasa a producción sin pasar antes por staging.** Cada entrega sube el número de versión (visible en el pie de página y en `/api/version`) y queda en `docs/CHANGELOG.md`.
- **Nunca `railway up`.** Deploy solo vía `git push` (auto-deploy) o `railway redeploy`. Siempre verificar el deploy uno mismo (ej. consultando `/api/version` o el endpoint correspondiente) antes de dar algo por terminado.
- **Cada cambio de tablas va en una migración versionada** (Drizzle, en la plataforma nueva) — nunca `CREATE TABLE IF NOT EXISTS` suelto dentro de una ruta.
- **Nunca commits directos a `main` sin pasar por Pull Request.** Toda rama se fusiona por PR, con CI en verde.
- **Todo cambio a la extensión de Chrome exige reinstalación completa** del lado del usuario (nunca alcanza con "Recargar") — bajar el ZIP solo después de confirmar que `version.json` ya muestra la versión nueva.

### Cómo se trabaja con Claude Code en este proyecto

- Respuestas y comentarios de código en español.
- Commits: mensaje completo primero (vía archivo), luego `git commit -F`, luego trabajar por rama + Pull Request (nunca push directo a `main`). Cada commit termina con la línea de atribución que indique el sistema.
- Cada tarea del plan técnico (`zilonix-os-web/docs/plan-tecnico.md`) se trabaja de a una por sesión — no se mezclan varias tareas de fases distintas en el mismo cambio, salvo que el usuario lo pida explícitamente.
- Ante evidencia ambigua (un bug, un comportamiento de una API externa, una decisión de arquitectura): verificar con evidencia real antes de adivinar — preferir un diagnóstico barato (log, prueba puntual, búsqueda) a construir una solución completa sobre un supuesto sin confirmar.
- Las Decisiones pendientes (`zilonix-os-web/docs/plan-tecnico.md`, tabla de Decisiones D1–D8 y N1–N8) se resuelven con Mateo o Débora antes de construir la tarea que depende de ellas — no se asume una por default.

### Qué NO entra a la plataforma nueva

Lo personal de Mateo (trading, proyectos, tareas, reuniones, decisiones, asistente) se queda en el Zilonix OS actual — no se migra ni se generaliza como si fuera parte del producto multiempresa.
