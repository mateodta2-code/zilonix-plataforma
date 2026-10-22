# Resumen del plan técnico — solo Mercado Libre

Fuente: `zilonix-os-web/docs/plan-tecnico.md`, versión v0.3 (16 oct 2026). Este archivo no lo reemplaza. Cubre cuentas y tokens, publicar, la bandeja de preguntas, mensajes y reclamos, avisos, inventario y stock sincronizado, despachos y Full, Mercado Ads, alertas sanitarias de publicaciones, y los límites de la API.

Foto de **esta** plataforma al 22 oct 2026. El estado sale de lo que está en `main`, de las ramas remotas y de los issues abiertos (#29–#77, listados ese día; no había issues cerrados). `docs/ESTADO.md` (21 oct 2026) sigue siendo la foto narrativa del repo; donde difiere, se dice abajo.

**hecho** = el código de esa tarea está en `main`. **en curso** = hay rama o pull request, y no está fusionado. **pendiente** = no está en `main` ni en una rama de esa tarea. Si no hay un issue abierto que la cubra, la columna queda en "—".

La tarea 2.11 del plan son cuatro funciones. Van en filas separadas porque el estado no es el mismo.

## Tareas

| Tarea | Nombre | Estado en la plataforma | Issue |
|---|---|---|---|
| 2.1 | App de la plataforma en Mercado Libre Developers | hecho | — |
| 2.3 | Conectar una cuenta: OAuth, tokens cifrados, candado de renovación | hecho | — |
| 2.5 | Importación inicial al conectar (pedidos de 60 días y publicaciones activas) | hecho | — |
| 2.4 | Avisos (webhooks) y trabajador que consulta el dato real | hecho | — |
| 2.6 | SKU maestro, con enlace publicación ↔ SKU | hecho | — |
| 2.8 | Inventario por bodega y stock sincronizado con Mercado Libre | pendiente | [#56](https://github.com/mateodta2-code/zilonix-plataforma/issues/56), [#57](https://github.com/mateodta2-code/zilonix-plataforma/issues/57), [#64](https://github.com/mateodta2-code/zilonix-plataforma/issues/64) |
| 2.9 | Bandeja de preguntas, mensajes y reclamos | en curso | [#35](https://github.com/mateodta2-code/zilonix-plataforma/issues/35), [#51](https://github.com/mateodta2-code/zilonix-plataforma/issues/51) |
| 2.10 | Despachos: Full, Flex, colecta, impresión de etiquetas | hecho | — |
| 2.11a | Publicar producto y clip | en curso | [#34](https://github.com/mateodta2-code/zilonix-plataforma/issues/34), [#44](https://github.com/mateodta2-code/zilonix-plataforma/issues/44) |
| 2.11b | Promociones | pendiente | — |
| 2.11c | Programar Full | pendiente | [#66](https://github.com/mateodta2-code/zilonix-plataforma/issues/66) |
| 2.11d | Alertas sanitarias de productos publicados | en curso | [#61](https://github.com/mateodta2-code/zilonix-plataforma/issues/61), [#71](https://github.com/mateodta2-code/zilonix-plataforma/issues/71) |
| 2.14 | Límites y reintentos de la API de Mercado Libre | pendiente | [#67](https://github.com/mateodta2-code/zilonix-plataforma/issues/67) |
| — | Mercado Ads | pendiente | — |

Notas de estado, donde la celda sola no alcanza:

- **2.4.** El receptor y el trabajador están en `main`. El trabajador lo dispara un cron sobre el servicio web. La cola y el servicio dedicado siguen abiertos en [#49](https://github.com/mateodta2-code/zilonix-plataforma/issues/49).
- **2.8.** Sigue en pausa hasta definir qué es una bodega en tránsito ([#56](https://github.com/mateodta2-code/zilonix-plataforma/issues/56)). [#57](https://github.com/mateodta2-code/zilonix-plataforma/issues/57) es el stock por SKU con una bodega por defecto. [#64](https://github.com/mateodta2-code/zilonix-plataforma/issues/64) es el envío de ese stock a Mercado Libre.
- **2.9.** La rama `tarea-2.9-bandeja-atencion` existe en el remoto y no tiene pull request. `docs/ESTADO.md` todavía la describe como pull request abierto. [#35](https://github.com/mateodta2-code/zilonix-plataforma/issues/35) es integrarla. [#51](https://github.com/mateodta2-code/zilonix-plataforma/issues/51) es responder, cerrar, asignar, plazos y reclamos.
- **2.10.** El código está en `main`. La migración y la seguridad por fila de esta tarea todavía no se aplicaron en staging ni en producción (`docs/ESTADO.md`).
- **2.11a.** La rama `tarea-2.11-publicar-producto-clip` existe en el remoto y no tiene pull request. Mismo desfase con `docs/ESTADO.md`. [#34](https://github.com/mateodta2-code/zilonix-plataforma/issues/34) es integrarla. [#44](https://github.com/mateodta2-code/zilonix-plataforma/issues/44) es probarla contra una cuenta de prueba; el clip en vivo sigue sin confirmar.
- **2.11c.** [#66](https://github.com/mateodta2-code/zilonix-plataforma/issues/66) es el tablero de envíos a la bodega Full. Es nivel 2: entra si el go/no-go lo habilita.
- **2.11d.** `docs/ESTADO.md` la daba por no empezada. El 22 oct 2026 el pull request [#82](https://github.com/mateodta2-code/zilonix-plataforma/pull/82) porta las funciones puras ([#61](https://github.com/mateodta2-code/zilonix-plataforma/issues/61)). Tablas, trabajo diario y pantalla siguen en [#71](https://github.com/mateodta2-code/zilonix-plataforma/issues/71).
- **2.14.** [#67](https://github.com/mateodta2-code/zilonix-plataforma/issues/67) cubre el límite global de la app y la respuesta 429. El reparto por cuenta de esa misma tarea del plan no tiene issue abierto.
- **Mercado Ads.** El plan v0.3 no le asigna número. Entre los issues abiertos no hay uno que la cubra.

Ampliaciones abiertas que no cambian el número del plan: cuentas y tokens en [#30](https://github.com/mateodta2-code/zilonix-plataforma/issues/30), [#32](https://github.com/mateodta2-code/zilonix-plataforma/issues/32), [#54](https://github.com/mateodta2-code/zilonix-plataforma/issues/54), [#59](https://github.com/mateodta2-code/zilonix-plataforma/issues/59) y [#69](https://github.com/mateodta2-code/zilonix-plataforma/issues/69); publicar en varias cuentas en [#70](https://github.com/mateodta2-code/zilonix-plataforma/issues/70); CSV de SKU y stock inicial en [#58](https://github.com/mateodta2-code/zilonix-plataforma/issues/58); despachos disparados por avisos, dentro de [#49](https://github.com/mateodta2-code/zilonix-plataforma/issues/49).

## Reglas del plan que aplican aquí

- Una sola app de la plataforma en Mercado Libre Developers, con el permiso mínimo de cada función. La certificación de partner no es requisito para operar (2.1).
- Solo OAuth. No se pide ni se guarda la contraseña de Mercado Libre. Un token no se muestra en pantalla ni en logs (2.3).
- Los tokens se guardan cifrados, con versión de clave para poder rotarla (2.3).
- La renovación lleva candado. El refresh token sirve una sola vez, y dos renovaciones a la vez desconectan la cuenta (2.3).
- Si el canal no está habilitado para esa cuenta, se avisa antes de abrir la autorización de Mercado Libre (2.3).
- Si el canje del código falla, se muestra el error y un botón para reintentar (2.3).
- Desconectar avisa qué deja de verse y conserva el histórico (2.3).
- En una migración, los tokens no se copian: cada cuenta se vuelve a conectar con el botón (2.15).
- Un aviso es una señal. Se consulta el dato real con el token de esa cuenta, y un reintento de Mercado Libre no duplica el aviso (2.4).
- Al conectar se traen los pedidos de 60 días y las publicaciones activas, con el progreso a la vista (2.5).
- Una publicación sin SKU se señala. Cambiar el SKU no reescribe los pedidos ya guardados (2.6).
- Las bajas de stock siempre se envían a Mercado Libre, en el mismo camino que las subidas, sin umbral oculto. El cambio tiene que verse en Mercado Libre en 2 minutos o menos (2.8).
- Una pregunta de prueba tiene que llegar a la bandeja en 1 minuto o menos (2.9).
- La guía de Full la gestiona Mercado Libre. Desde la plataforma se imprimen Flex, Places y Colecta, y solo mientras el envío sigue imprimible (2.10, regla portada del sistema actual).
- Con una regla de precio automático activa, editar el precio a mano pregunta antes (pausar la regla, cambiar los límites o desactivarla). La regla no desaparece en silencio (2.11).
- Hay un límite de llamadas por cuenta, reintentos con espera, y una alerta si Mercado Libre desconecta la cuenta. Una caída corta de la API se pone al día sin duplicar (2.14).
- La IA solo sugiere. Un cambio de precio, de stock o una respuesta a un comprador espera la confirmación de una persona.
- Lo que se porta del sistema actual se limpia de nombres propios de ese negocio.

## Requisito directo, en una línea

- La Fase 1 (1.1–1.12) está cerrada: toda tabla de Mercado Libre lleva `empresa_id`, seguridad por fila y `requierePermiso`. El actor de la integración queda separado de las personas.
- La 2.2 (contrato de conector) está hecha. Publicar, stock, pedidos y mensajes pasan por esa interfaz (`docs/conectores.md`).
- La 2.7 (pedidos y línea de tiempo de 8 pasos) está hecha en `main`. Los despachos (2.10) dependen de ella. La línea de tiempo se lee en pasos, con fecha y actor.
- La 2.15 (migración de los datos de Mercado Libre) sigue pendiente, en [#65](https://github.com/mateodta2-code/zilonix-plataforma/issues/65).

## Fuera de este resumen

Falabella y otros marketplaces, facturación DIAN, tesorería, rentabilidad, exportes contables y contabilidad. También quedan afuera, aunque toquen Mercado Libre de costado, la extensión de investigación (2.12), el asistente de primeros pasos (2.13), la IA de ventas (2.16), la app del domiciliario (3.11) y la certificación de partner (5.6). La Fase 0 es del sistema actual: cifrar tokens allá es la 0.6; aquí es la 2.3.
