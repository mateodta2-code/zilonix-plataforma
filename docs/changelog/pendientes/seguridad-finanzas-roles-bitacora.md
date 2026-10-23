- **2026-10-23** — Issue #124 (Z-FIN-02), roles y bitácora. Refs #124.

  **Roles nuevos** en `lib/roles-plantillas.ts` (los 5 que confirmó Mateo): Gerente, Auxiliar (comodín), Tecnología, Contador (el que ya existía, sin cambios) y Operaciones. Todos con alcance "todo":
  - Gerente: ventas, inventario y finanzas con las 5 acciones; personas con consultar/crear/modificar; configuracion con consultar/modificar.
  - Auxiliar: ventas, inventario y finanzas con consultar/crear/modificar.
  - Tecnología: configuracion con consultar/modificar; personas con consultar/crear/modificar; ventas e inventario solo consultar.
  - Operaciones: ventas con consultar/crear/modificar; inventario con consultar/crear/modificar/anular. Despachos y promociones se le suman cuando existan esos módulos — no se agregó nada a `MODULOS`.

  Operador, Contador, Proveedor, Domiciliario y Dueño quedan igual. `/panel/invitar` ya leía `NOMBRES_PLANTILLA`, así que los roles nuevos aparecen y se aceptan sin otro cambio. `docs/matriz-permisos.md` regenerado con `npm run docs:permisos`.

  **Permisos peligrosos en las plantillas** (a la vista, no escondidos): el Gerente nace con `finanzas.anular`, `finanzas.autorizar` y `configuracion.modificar`, y Tecnología con `configuracion.modificar` — los cuatro están en `PERMISOS_PELIGROSOS`. Al copiar la plantilla se crean directo; la confirmación aparte solo aplica al ajustarlos a mano en `/panel/roles`. Sin aprobación de segundo actor en la Fase 1 (decisión de Sharel): no hay `requiereActorDistinto`.

  **Finanzas**: `/panel/finanzas` solo lee y ya exigía `consultar` en el servidor. No tiene ninguna acción que cambie datos todavía, así que no había nada de "editar" que separar — quedó escrito en el comentario que la primera acción de Fase 3 tiene que pedir `crear`/`modificar` con `requierePermiso`.

  **Bitácora** (`/panel/actividad`): filtros por entidad y por quién (incluye "Sistema / integración"), con `?entidad=` y `?usuario=` en la URL. Las opciones salen de la propia bitácora de la empresa (`opcionesFiltroAuditoria`, dentro de `dbComoEmpresa`) y un valor de la URL que no está en esa lista se ignora — nunca llega a la consulta. Sin SQL armado a mano: todo va por `eq()`. **No muestra valor anterior/nuevo**: `auditoria` no tiene esas columnas y no se creó migración (llega con el issue #125); "qué cambió" sigue siendo `detalle`.

  Pruebas: `lib/roles-plantillas.test.ts` (nuevo, sin Postgres) — una por cada rol nuevo con su lista exacta de permisos, y otra que fija los roles que ya existían. `db/auditoria.test.ts` — dos pruebas nuevas: filtrar desde la empresa A por una entidad o una persona de la empresa B devuelve vacío, y las opciones de A no listan nada de B; y los filtros devuelven solo lo pedido. Sin rutas nuevas (`/panel/actividad` ya estaba en `RUTAS_PROTEGIDAS`). Sin migraciones, sin cambios en `db/`.
