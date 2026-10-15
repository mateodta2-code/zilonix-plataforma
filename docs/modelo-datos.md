# Modelo de datos base — tarea 1.2

Diagrama en palabras simples, para aprobar antes de construir (como pide el plan técnico). Siete tablas, el esqueleto de "quién puede hacer qué, en qué empresa".

## 1. `empresas`

Cada negocio que se registra en la plataforma.

| Campo | Qué guarda |
|---|---|
| id | identificador único |
| nombre | nombre del negocio |
| nit | NIT — una empresa por NIT/sociedad (decisión D2) |
| creado_ts | cuándo se registró |

## 2. `usuarios`

Las personas que entran a Zilonix — no pertenecen a una sola empresa, pueden estar en varias (decisión D2: "un login, varias empresas, cambio en 1 clic").

| Campo | Qué guarda |
|---|---|
| id | identificador único |
| email | correo (único en toda la plataforma) |
| nombre | nombre de la persona |
| clerk_user_id | el identificador que le da Clerk (decisión D3) — Clerk maneja el login en sí, acá solo se guarda el vínculo |
| creado_ts | cuándo se creó |

## 3. `roles`

"Dueño", "Operador", "Contador", "Proveedor", "Domiciliario", etc. Algunos son plantillas de fábrica (iguales para cualquier empresa), y cada empresa puede armar los suyos propios a partir de esas plantillas (evidencia real de Effi: un rol "Vendedora" pudo crear usuarios y cambiar la numeración DIAN sin aviso — acá cada rol nace de una plantilla segura, no de cero).

| Campo | Qué guarda |
|---|---|
| id | identificador único |
| nombre | ej. "Operador" |
| empresa_id | vacío = plantilla de fábrica, compartida; con valor = rol propio de esa empresa |
| es_plantilla | si es una de las plantillas base del sistema |

## 4. `membresias`

La conexión real: "esta persona está en esta empresa, con este rol."

| Campo | Qué guarda |
|---|---|
| id | identificador único |
| usuario_id | quién |
| empresa_id | en qué empresa |
| rol_id | con qué rol |
| creado_ts | desde cuándo |

Una persona solo puede tener **un** rol por empresa (no varios roles mezclados en la misma empresa).

## 5. `permisos_rol`

Por cada rol, qué puede hacer en cada módulo (Ventas, Inventario, Facturación, Tesorería, Personas, Configuración...).

| Campo | Qué guarda |
|---|---|
| id | identificador único |
| rol_id | de qué rol |
| modulo | ej. "ventas", "inventario" |
| accion | Consultar / Crear / Modificar / Anular / Autorizar |
| alcance | "todo" o "solo lo propio" (lo que esa persona creó) — confirmado agregar desde ya, evidencia real vista en Effi |

## 6. `invitaciones`

Cuando un dueño invita a alguien por correo.

| Campo | Qué guarda |
|---|---|
| id | identificador único |
| empresa_id | a qué empresa |
| email | a quién se invita |
| rol_id | con qué rol entra |
| token | link de un solo uso |
| invitado_por | qué usuario mandó la invitación |
| expira_ts | hasta cuándo vale |
| aceptada_ts | vacío hasta que se acepte |

## 7. `auditoria`

Quién hizo qué, cuándo, en qué empresa — separando siempre una persona real de una acción automática del sistema (evidencia real de Effi: le atribuían a una persona ventas que en realidad sincronizó la integración sola).

| Campo | Qué guarda |
|---|---|
| id | identificador único |
| empresa_id | en qué empresa (vacío para acciones de plataforma, ej. login) |
| usuario_id | quién, si fue una persona (vacío si fue el sistema) |
| actor_tipo | "persona" o "sistema" |
| accion | qué pasó, en palabras simples |
| entidad | sobre qué (ej. "Ventas", "Facturación") |
| detalle | información extra |
| ts | cuándo |

## Cómo se conectan

```
empresas ──┬── membresias ──── usuarios
           │        │
           │        └── roles ──── permisos_rol
           │
           ├── invitaciones
           └── auditoria
```

## Lo que falta para que esto funcione seguro (próximas tareas, no esta)

- ~~**Seguridad por fila (RLS)** en Postgres~~ — tarea 1.3, completa: `db/rls-setup.sql` ya corrido contra la base real de Railway (ver `docs/rls.md`).
- ~~**Prueba automática de aislamiento**~~ — tarea 1.4, completa: `db/rls.test.ts`, corre en cada PR contra un Postgres real de prueba.
- **Login de verdad con Clerk** (hoy `clerk_user_id` es solo un campo vacío, esperando la integración) — tarea 1.5.
- **Decisión D8 (14/10/2026)**: el acceso del superadmin a cifras agregadas de negocio (no al detalle del comprador) de cualquier empresa es un mecanismo APARTE del de esta tabla — usa su propio rol de base de datos con sus propias políticas, más permisivo solo sobre las tablas agregadas. Se construye en la tarea 1.11, no acá.
