- **2026-10-25** — issue #221 (Refs), decisión de Sharel: construir "Analizar" en `/panel/investigacion` con la misma ambición agresiva de Zilonix OS/Selltrix — **sin copiar sus bugs reales** (facturación histórica × precio tratada como mensual; visitas inventadas como `ventas ÷ 3%`). Slice 1: solo Mercado Libre.

  **Flujo nuevo**: un solo clic en "Analizar", con la extensión instalada, además de la búsqueda de siempre por la API, dispara un escaneo acotado del listado REAL de Mercado Libre para el término y hasta 3 variantes — la extensión abre cada variante en una pestaña activa, la lee (~20 candidatos), la cierra, y sigue con la siguiente, hasta un máximo de 4 pestañas. Nunca abre la publicación individual de ningún candidato encontrado (default explícito del pedido). Resultado final: una fusión automática en la tabla de "listados importados" de Demanda (issue #213) — sin pedir "Importar/Fusionar/Reemplazar" otra vez, porque la persona ya autorizó todo con ESE clic.

  **"El clic de Analizar es el único clic que autoriza"**: `app/panel/investigacion/analizarClic.ts` + `FormularioAnalizar.tsx` (nuevo, Client Component — el form se sacó de `page.tsx`, que sigue siendo Server Component) dejan una marca de un solo uso con ventana de 8s justo antes de la navegación real (GET normal, sin `preventDefault`). `PanelDemanda.tsx` la consume al montar; si expiró o no hay extensión, nunca dispara nada — Analizar sin extensión sigue funcionando exactamente igual que siempre, solo por API.

  **`lib/ml/variantesBusqueda.ts` (nuevo, puro, probado)**: heurística de texto — sin tildes, orden de palabras invertido, singular/plural ingenuo del último token — nunca IA/semántica real, documentado así a propósito ("heurística OK si no hay IA lista"). Nunca inventa una palabra no relacionada con el término original.

  **Puente nuevo, dirección inversa (página → extensión)**: `marcador-zilonix.js` ahora también escucha `window.addEventListener("message")` del lado de la página (antes solo mandaba, nunca recibía) y reenvía `{tipo: "zilonix:iniciar-escaneo"}` a `background.js`. Ahí vive toda la orquestación: abre una pestaña de listado por vez (`chrome.tabs.create`, activa), espera el resultado que `content.js` manda solo (marcador `?_zilonix_escaneo=1` en la URL, invisible para Mercado Libre) o un timeout de 15s, la cierra, sigue con la próxima — sin pedir ningún permiso nuevo (`"tabs"`/`host_permissions`), igual que los puentes de #210/#213.

  **Por qué estos candidatos nunca tienen ventas/mes ni facturación estimada**: un listado de Mercado Libre nunca expone `date_created` por tarjeta (solo la página de un producto lo trae) — sin esa fecha, `ventasMesEst` (`lib/ml/estimacionVentas.ts`) no puede calcular nada y devuelve `null`, nunca inventa. Esto evita, por construcción, el bug real de Zilonix OS de "vendidos históricos × precio como si fuera mensual" — acá simplemente nunca se intenta esa cuenta para estos candidatos. Tampoco se estima ninguna visita en ningún módulo de esta app.

  **Copy actualizado**: la ayuda de "Analizar" ya no dice "solo API" — ahora explica que, con extensión, también escanea el listado real.

  **Extensión 0.3.6 → 0.3.7**.

  **Limitación conocida, documentada**: un Service Worker de Manifest V3 puede reciclarse sin eventos por ~30s — un escaneo de hasta 4 variantes normalmente lo mantiene vivo, pero si se recicla a mitad de camino, ese escaneo se pierde sin aviso (el panel tiene su propio timeout de 90s para nunca quedarse mostrando "Escaneando…" para siempre). Sin `chrome.storage.session` todavía — fuera de alcance de este slice.

  **Fuera de alcance, a propósito**: Amazon/Temu/AliExpress/Shein/Alibaba (siguen siendo "Enviar a Zilonix" manual), "mejor oferta" entre plataformas, historial de escaneos — quedan para otra vuelta.

  **Pruebas nuevas**: `lib/ml/variantesBusqueda.test.ts` (9 casos — vacío, dedup, sin tildes, orden invertido, singular/plural, tope, nunca inventa palabras no relacionadas).

  Verificado: `npm run typecheck` en verde. `npm run build` compila y tipa en verde, falla después en el mismo punto ambiental conocido (`DATABASE_URL_APP` ausente en este entorno). `npm test`: 695 pruebas en verde (mismos 23 archivos fallando solo por `DATABASE_URL_APP`/`DATABASE_URL_TRABAJADOR` ausentes — ninguno nuevo por este cambio).
