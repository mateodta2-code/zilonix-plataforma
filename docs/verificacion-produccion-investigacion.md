# Verificación en producción — Investigación (release v0.4.0, Refs #207)

Checklist corto para correr a mano justo después del deploy a producción, antes de dar el release por confirmado. No reemplaza el smoke completo que ya se hizo en staging (#227–#237) — es la versión rápida para confirmar que lo mismo funciona en producción, con una cuenta real de Mercado Libre Colombia conectada.

1. **Deploy real**: `GET /api/version` en producción devuelve `{"version":"0.4.0"}` antes de seguir con lo de abajo.
2. **Abrir `/panel/investigacion`** con una sesión real (rol con permiso `inventario`/`consultar`) — carga sin "Application error" ni ningún error de Mercado Libre sin clasificar.
3. **Buscar "reloj inteligente"** (o un término de volumen real similar) y tocar **Analizar**:
   - Con la extensión de Zilonix instalada y actualizada (confirmar `extension/version.json` = `0.3.13` antes de instalar — si no, bajar el ZIP nuevo y reinstalar completo, nunca solo "Recargar").
   - Aparece al menos un bloque de Mercado Libre Colombia con productos reales (no "Sin dato" en todos).
4. **Precios**: cada fila del bloque muestra un precio real (nunca vacío ni "—" en todas las filas).
5. **Vendidos**: al menos algunas filas muestran un número de vendidos real (columna "Vendidos") — no necesariamente todas (Mercado Libre no siempre expone el dato), pero no todas en blanco.
6. **Fotos**: la foto de cada producto carga de verdad (nunca rota/"—" por el CSP bloqueando el dominio de la imagen) y se puede ampliar con un clic (lightbox).
7. **Full**: la columna "Full" (en bloques de Mercado Libre) muestra "Full"/"No full" real para al menos algunas filas — no todas en "No" (sería indicio de que el selector volvió a romperse, ver issues #229/#235).
8. **Botón Seguir**: en una fila de Mercado Libre con `itemId` identificable, el botón **"Seguir"** lleva a `/panel/investigacion/seguimiento?agregar=<itemId>` y el seguimiento queda agregado (fila nueva en esa pantalla, con su primera revisión real — ver `docs/release-seguimiento-prod.md` si esto es la primera vez que se prueba en producción).

## Si algo falla

- Sin ningún bloque / "Sin dato" en todo: revisar que la extensión instalada sea 0.3.13 (reinstalación completa, nunca solo recargar) y que la cuenta de Mercado Libre conectada en producción siga vigente.
- Fotos rotas: revisar `img-src` en `next.config.mjs` (dominios de imágenes de cada plataforma) — ver el historial de #235/#236/#237 si vuelve a pasar con un dominio nuevo.
- "Application error" en vez de un aviso claro: revisar `docs/CHANGELOG.md` v0.4.0 (issue #147) — los errores reales de Mercado Libre (401/403/5xx) deberían mostrar un mensaje en español, nunca la pantalla genérica de Next.js.

## Qué NO cubre esta lista

- El batch diario de Seguimiento en producción (secreto `SEGUIMIENTO_TRABAJADOR_SECRET_PRODUCCION` + `workflow_dispatch`) — checklist aparte en `docs/release-seguimiento-prod.md` §3.1/§4, issue #207.
- Amazon/Temu/AliExpress/Shein/Alibaba — mismo criterio, pero fuera de esta lista corta (si Mercado Libre funciona, repetir el mismo criterio en una plataforma más alcanza como señal).
