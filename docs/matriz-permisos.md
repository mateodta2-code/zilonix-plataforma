# Matriz de permisos — plantillas de fábrica

Generado por `npm run docs:permisos` (que corre `scripts/generar-matriz-permisos.ts`) a partir de `lib/roles.ts` — tarea 1.8. **No editar a mano**: `lib/matriz-permisos.test.ts` falla el CI si este archivo deja de coincidir con lo que el generador produciría ahora mismo.

Un rol de una empresa real nace copiando su plantilla y se puede ajustar después desde `/panel/roles` — esta tabla es el punto de partida, no el permiso final de nadie.

| Rol | ventas | inventario | finanzas | personas | configuracion | publicidad | promociones |
|---|---|---|---|---|---|---|---|
| Dueño | consultar (todo), crear (todo), modificar (todo), anular (todo), autorizar (todo), aprobar (todo), ejecutar (todo) | consultar (todo), crear (todo), modificar (todo), anular (todo), autorizar (todo), aprobar (todo), ejecutar (todo) | consultar (todo), crear (todo), modificar (todo), anular (todo), autorizar (todo), aprobar (todo), ejecutar (todo) | consultar (todo), crear (todo), modificar (todo), anular (todo), autorizar (todo), aprobar (todo), ejecutar (todo) | consultar (todo), crear (todo), modificar (todo), anular (todo), autorizar (todo), aprobar (todo), ejecutar (todo) | consultar (todo), crear (todo), modificar (todo), anular (todo), autorizar (todo), aprobar (todo), ejecutar (todo) | consultar (todo), crear (todo), modificar (todo), anular (todo), autorizar (todo), aprobar (todo), ejecutar (todo) |
| Gerente | consultar (todo), crear (todo), modificar (todo), anular (todo), autorizar (todo) | consultar (todo), crear (todo), modificar (todo), anular (todo), autorizar (todo) | consultar (todo), crear (todo), modificar (todo), anular (todo), autorizar (todo) | consultar (todo), crear (todo), modificar (todo) | consultar (todo), modificar (todo) | consultar (todo) | consultar (todo), aprobar (todo), ejecutar (todo) |
| Auxiliar | consultar (todo), crear (todo), modificar (todo) | consultar (todo), crear (todo), modificar (todo) | consultar (todo), crear (todo), modificar (todo) | — | — | consultar (todo) | — |
| Tecnología | consultar (todo) | consultar (todo) | — | consultar (todo), crear (todo), modificar (todo) | consultar (todo), modificar (todo) | — | — |
| Operaciones | consultar (todo), crear (todo), modificar (todo) | consultar (todo), crear (todo), modificar (todo), anular (todo) | — | — | — | consultar (todo) | — |
| Operador | consultar (todo), crear (todo), modificar (todo) | consultar (todo), modificar (todo) | — | — | — | — | consultar (todo) |
| Contador | consultar (todo) | consultar (todo) | consultar (todo), crear (todo), modificar (todo), autorizar (todo) | — | — | — | — |
| Proveedor | — | — | — | — | — | — | — |
| Domiciliario | — | — | — | — | — | — | — |

**Permisos peligrosos** (piden confirmación aparte al asignarlos desde `/panel/roles`, nunca se activan de un solo clic): autorizar en configuracion, modificar en configuracion, autorizar en finanzas, anular en finanzas, autorizar en personas, ejecutar en promociones.
