- **2026-10-25** — issue #248 (Refs), vuelta 3 — con filtro Full puesto en la URL, 0.3.21 ya daba 48/48 OK (la señal de URL de la vuelta 2 funcionó). Sin el filtro, seguía en 0/48 con 6.5s de espera.

  **Esta vez, Mateo consiguió y citó el HTML real del badge en vivo** (DOM vivo, filtro apagado):

  ```html
  <div class="poly-component__shipping-v2">
    <div class="poly-shipping-v2__item">
      <span>
        <span class="polylabel-pill polylabel-fw-semibold">Llega gratis mañana</span>
        <svg aria-label="Enviado por FULL" role="img" class="polylabel-icon" width="44" height="14" viewBox="0 0 41 13">
          <use href="#poly_full"></use>
        </svg>
      </span>
    </div>
  </div>
  ```

  **Con ese HTML real puesto en un fixture de prueba, `detectarFullEnHtmlTarjeta` ya devuelve `true` — sin ningún cambio de selector.** El aria-label real sigue siendo exactamente `"Enviado por FULL"` (selector de Zilonix OS, #242, nunca cambió) y la Capa 1 (atributos, #248 vuelta 1) ya lo agarra sin necesitar el bloque `poly-component__shipp*` (ahora `-v2`, cubierto por substring de todas formas — documentado explícito en comentarios, sin cambio de regex necesario). "FULL" nunca es texto visible aparte — vive solo en el `aria-label` — por eso un strip-tags ingenuo (Capa 2/3, texto) siempre lo pierde; la Capa 1 (atributos) es la que importa, confirmado con una prueba dedicada que remueve ambos atributos (aria-label + href de sprite) y confirma que el texto solo ("Llega gratis mañana") nunca alcanza.

  **Agregado, por pedido explícito**: chequeo DOM prioritario sobre `.poly-component__shipping-v2 use[href*="poly_full"]`/`svg[aria-label*="FULL" i]` en `detectarFullEnTarjeta` — redundante con lo que ya funcionaba para este caso puntual, pero deja la intención explícita en el código. Advertencia de Mateo (`poly-bookmark__icon-full`, ícono de favorito, nunca el programa Full) ya cubierta sin cambios — confirmado con una prueba dedicada.

  **Conclusión: el bug restante es 100% timing, no un selector mal.** Con el filtro puesto, la señal de URL resuelve instantáneo; sin el filtro, Mercado Libre tarda más en hidratar el ícono en las 48 tarjetas de lo que alcanzaban 6.5s. `ESPERA_HIDRATACION_ENVIO_MS` (`extension/content.js`) sube de 6.5s a **12s** — dentro del rango pedido (12-15s), sin tocar el tope externo `maxEsperaMs` (14s) ni el timeout fijo de background.js (15s): la fase de estabilidad del conteo típicamente tarda ~1s, dejando ya ~13s de margen real antes del tope de 14s.

  **Prohibiciones reafirmadas (nunca violadas por este PR)**: nunca login/evasión de captcha; nunca Apify; nunca visitas inventadas; `senalVentas` sin tocar; sin logos de plataforma; ayuda "?" fuera de este PR; `/panel/investigacion/seguimiento` (#246) no se tocó; no se mergeó nada; HTML real citado, no adivinado.

  **Tests**: 3 pruebas nuevas — el HTML real de la vuelta 3 → true; el mismo HTML sin ninguno de los dos atributos reales (aria-label + href de sprite) → false (demuestra por qué la Capa 1 de atributos es imprescindible, no redundante); `poly-bookmark__icon-full` (favorito) → false, confirmando la advertencia de Mateo.

  Verificado: `npm run typecheck` en verde. `npm test`: 728 pruebas en verde (725 + 3 nuevas; mismos 23 archivos fallando solo por `DATABASE_URL_APP`/`DATABASE_URL_TRABAJADOR`, ninguno nuevo). `npm run build` compila y tipa en verde, falla después en el mismo punto ambiental conocido. Extensión 0.3.21 → 0.3.22.
