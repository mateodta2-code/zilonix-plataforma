// Issue #174 — orquesta el lector del sitio activo (window.ZilonixLectorActivo,
// puesto por el lectores/<sitio>.js que carga justo antes de este
// archivo, mismo content_scripts del manifest) y dibuja el panel
// flotante. Nunca navega, nunca hace clic por su cuenta, nunca inicia
// sesión: solo lee el DOM que el usuario ya tiene abierto en pantalla.
(function () {
  "use strict";
  const U = window.ZilonixUtilidades;
  const ZS = window.ZilonixSeguridad;
  const lector = window.ZilonixLectorActivo;
  if (!U || !ZS || !lector) return; // sitio sin lector/seguridad cargados — nada que hacer acá
  // Issue #262 ("Aproximados estilo Selltrix en los 3 lugares") —
  // optativos a propósito: solo Mercado Libre los carga (manifest.json),
  // nunca los otros 5 sitios — ver "Análisis aprox." en renderizarProducto.
  const APROX = window.ZilonixAproximados;
  const CAL = window.ZilonixCalibracion;

  const SIN_DATO = "No disponible";
  const PANEL_ID = "zilonix-panel-investigacion-174";
  const RETARDO_REESCANEO_MS = 900; // sitios SPA (ML, Amazon) cambian el DOM sin recargar la página

  // Issue #174, revisión de Pablo — textoCampo es la ÚNICA puerta por
  // la que pasa texto de la página (título, vendedor, nombre de un
  // producto del Top 10...) antes de entrar a un template de HTML más
  // abajo: siempre devuelve el texto YA escapado (extension/seguridad.js),
  // nunca el crudo. El resultado se usa con innerHTML — nunca con
  // .textContent, que mostraría las entidades escapadas tal cual en
  // vez de interpretarlas.
  function textoCampo(valor) {
    const texto = valor === null || valor === undefined || valor === "" ? SIN_DATO : String(valor);
    return ZS.escaparHtml(texto);
  }

  function formatoPrecio(valor, moneda) {
    if (valor === null || valor === undefined) return SIN_DATO;
    const numero = valor.toLocaleString("es-CO", { maximumFractionDigits: 2 });
    // moneda siempre es un literal fijo nuestro ("COP") o null, nunca
    // texto de la página — no hace falta escaparlo.
    return moneda ? `${moneda} ${numero}` : numero;
  }

  // etiqueta siempre es un string fijo nuestro (ej. "Precio",
  // "Vendedor / tienda") — nunca de la página, no hace falta
  // escaparlo. valorHtml SÍ puede venir de la página: quien llama a
  // filaHtml() tiene que pasarlo ya escapado (por textoCampo(), o ser
  // HTML fijo nuestro como el chip de "Full").
  function filaHtml(etiqueta, valorHtml, sinDato) {
    return `<div class="zx-fila"><span class="zx-fila__etiqueta">${etiqueta}</span><span class="zx-fila__valor" data-sin-dato="${sinDato ? "true" : "false"}">${valorHtml}</span></div>`;
  }

  function csvDeProducto(datos) {
    const filas = [
      ["campo", "valor"],
      ["sitio", lector.sitio],
      ["url", location.href],
      ["titulo", datos.titulo],
      ["precio", datos.precio],
      ["moneda", datos.moneda],
      ["precioAnterior", datos.precioAnterior],
      ["descuentoPorcentaje", datos.descuentoPorcentaje],
      ["vendidos", datos.vendidos],
      ["vendedor", datos.vendedor],
      ["calificacion", datos.calificacion],
      ["numeroOpiniones", datos.numeroOpiniones],
    ];
    if (datos.vendidosExacto !== undefined) filas.push(["vendidosExacto", datos.vendidosExacto]);
    if (datos.ventasPromedioMes !== undefined) filas.push(["ventasPromedioMesEstimado", datos.ventasPromedioMes]);
    if (datos.esCatalogo !== undefined) filas.push(["esCatalogo", datos.esCatalogo], ["esFull", datos.esFull], ["envioGratis", datos.envioGratis]);
    return filas.map((fila) => fila.map(ZS.celdaCsv).join(",")).join("\n");
  }

  function csvDeListado(productos) {
    const encabezado = ["titulo", "precio", "vendidos", "link"];
    const filas = [encabezado, ...productos.map((p) => [p.titulo, p.precio, p.vendidos, p.link])];
    return filas.map((fila) => fila.map(ZS.celdaCsv).join(",")).join("\n");
  }

  async function copiarAlPortapapeles(texto, boton) {
    try {
      await navigator.clipboard.writeText(texto);
      boton.textContent = "Copiado ✓";
      boton.dataset.copiado = "true";
      setTimeout(() => {
        boton.textContent = "Copiar datos (CSV)";
        boton.dataset.copiado = "false";
      }, 1500);
    } catch {
      boton.textContent = "No se pudo copiar";
      setTimeout(() => (boton.textContent = "Copiar datos (CSV)"), 1500);
    }
  }

  // --- Agregados del listado (cuántos, min/prom/máx, suma vendidos, top 10) ---
  // Issue #248 (vuelta 6) — el chip "Full detectados" YA NO sale de
  // acá (ver `renderizarListado`): `productos` nunca incluye Ads
  // (nunca mezcla pago con orgánico, regla de siempre), pero decisión
  // de producto de Sharel confirmó con evidencia real que los Ad son
  // justamente los que más muestran el badge Full (listado real de
  // teteros: ~60 tarjetas, ~12 Ad —la mayoría Full— + ~48 orgánicos
  // con ~0-1 Full) — contar Full solo sobre `productos` daba un 0/48
  // técnicamente correcto pero engañoso, con badges Full bien visibles
  // en pantalla. El chip ahora usa `estadisticasFull` (de
  // `leerListado`, `lectores/mercadolibre.js`), que sí cuenta sobre
  // TODAS las tarjetas visibles.
  function calcularResumenListado(productos) {
    const precios = productos.map((p) => p.precio).filter((p) => typeof p === "number" && Number.isFinite(p));
    const vendidosConDato = productos.filter((p) => typeof p.vendidos === "number");
    const sumaVendidos = vendidosConDato.reduce((acc, p) => acc + p.vendidos, 0);
    const top10 = [...vendidosConDato].sort((a, b) => b.vendidos - a.vendidos).slice(0, 10);
    return {
      total: productos.length,
      precioMinimo: precios.length ? Math.min(...precios) : null,
      precioPromedio: precios.length ? Math.round((precios.reduce((a, b) => a + b, 0) / precios.length) * 100) / 100 : null,
      precioMaximo: precios.length ? Math.max(...precios) : null,
      sumaVendidos: vendidosConDato.length ? sumaVendidos : null,
      top10,
    };
  }

  // --- Panel (Shadow DOM: aísla el CSS de acá del CSS del sitio) ---
  function obtenerOCrearPanel() {
    let host = document.getElementById(PANEL_ID);
    if (host && host.shadowRoot) return host.shadowRoot.querySelector(".zx-panel");
    host = document.createElement("div");
    host.id = PANEL_ID;
    document.documentElement.appendChild(host);
    const raiz = host.attachShadow({ mode: "open" });
    const hoja = document.createElement("link");
    hoja.rel = "stylesheet";
    hoja.href = chrome.runtime.getURL("panel.css");
    raiz.appendChild(hoja);
    const panel = document.createElement("div");
    panel.className = "zx-panel";
    raiz.appendChild(panel);
    return panel;
  }

  function cablearEncabezado(panel, subtitulo) {
    const cuerpo = panel.querySelector(".zx-panel__cuerpo");
    const botonColapsar = panel.querySelector("[data-accion='colapsar']");
    const botonCerrar = panel.querySelector("[data-accion='cerrar']");
    panel.querySelector(".zx-panel__sitio").textContent = subtitulo;
    botonColapsar.onclick = () => {
      const oculto = cuerpo.hasAttribute("hidden");
      if (oculto) cuerpo.removeAttribute("hidden");
      else cuerpo.setAttribute("hidden", "");
      botonColapsar.textContent = oculto ? "▾" : "▸";
    };
    botonCerrar.onclick = () => panel.closest ? (panel.getRootNode().host || panel).remove() : panel.remove();
  }

  // Issue #174 — "Seguir en Zilonix": construida por completo con
  // createElement/textContent (nunca innerHTML) y la URL nunca se
  // escribe en el DOM como atributo/texto — solo vive en esta clausura
  // de JS, pasada directo a window.open. No hay ninguna superficie de
  // HTML/atributo que escapar acá, a propósito.
  function agregarBotonSeguir(panel, url, etiqueta) {
    if (!url) return; // mercadolibre.js ya devuelve null si no pudo confirmar el id/seller_id — nunca se inventa un link
    const pie = panel.querySelector(".zx-panel__pie");
    const boton = document.createElement("button");
    boton.type = "button";
    boton.className = "zx-boton-seguir";
    boton.textContent = etiqueta;
    boton.onclick = () => {
      // SOLO por este clic real de la persona — nunca se abre nada al
      // leer la página. noopener: la pestaña nueva no recibe ningún
      // acceso de vuelta a esta página.
      window.open(url, "_blank", "noopener,noreferrer");
    };
    pie.appendChild(boton);
  }

  function renderizarEsqueleto(panel, tituloPanel, subtituloSitio) {
    panel.innerHTML = `
      <div class="zx-panel__encabezado">
        <div>
          <p class="zx-panel__titulo">${tituloPanel}</p>
          <span class="zx-panel__sitio"></span>
        </div>
        <div>
          <button type="button" class="zx-panel__boton-icono" data-accion="colapsar" title="Colapsar/expandir">▾</button>
          <button type="button" class="zx-panel__boton-icono" data-accion="cerrar" title="Cerrar">✕</button>
        </div>
      </div>
      <div class="zx-panel__cuerpo"></div>
      <div class="zx-panel__pie">
        <button type="button" class="zx-boton-copiar">Copiar datos (CSV)</button>
      </div>
    `;
    cablearEncabezado(panel, subtituloSitio);
    return panel.querySelector(".zx-panel__cuerpo");
  }

  // Issue #262 ("Aproximados estilo Selltrix en los 3 lugares") —
  // reemplaza el viejo "Ventas promedio al mes (estimado)" (que solo
  // funcionaba con date_created real, ausente en la mayoría de las
  // páginas, sobre todo un PDP de catálogo /p/) por un bloque completo
  // con los 4 cálculos de Selltrix, usando EXACTAMENTE la misma fuente
  // de factores/calibración que la app (extension/lectores/aproximados.js
  // + extension/calibracion-aproximados.js, generado desde
  // lib/seguimiento/calibracion-aproximados.json — ver ese archivo).
  // Nunca llama a la API de Mercado Libre: todo sale de `datos`, ya
  // leído del DOM/JSON incrustado de esta misma página por
  // lectores/mercadolibre.js.
  function tipoIdDePagina() {
    // Mismo criterio que PATRON_CATALOGO del lado del servidor
    // (lib/seguimiento/link.ts): "/p/" antes del id real de Mercado
    // Libre es un catálogo ("product"); cualquier otra cosa es una
    // publicación puntual ("item"). Nunca se confía en esto para
    // llamar a Mercado Libre — solo para elegir qué tabla de
    // calibración usar, y antiguedadDias() cae a null si el id no
    // matchea nada calibrado de todas formas.
    return /\/p\/[a-z]{3}\d+/i.test(location.href) ? "product" : "item";
  }

  function formatoAntiguedad(dias) {
    if (dias == null) return null;
    const meses = Math.floor(dias / 30);
    return meses >= 1 ? `${meses} m` : `${Math.round(dias)} d`;
  }

  // Issue #262 (revisión de Pablo, punto menor) — "Sin dato" (nunca
  // SIN_DATO = "No disponible", el genérico del resto del panel) para
  // los 3 campos aprox. que pueden faltar acá — mismo texto que ya usa
  // la app (page.tsx/[id]/page.tsx) para lo mismo, para que las dos
  // pantallas digan exactamente lo mismo ante el mismo "todavía no hay
  // dato para estimar esto".
  const SIN_DATO_APROX = "Sin dato";

  // Issue #251 (fix "aproximados siempre visibles") — bug real probado
  // en staging: sin vendidos (0, o un "+N" que la ficha no muestra)
  // esta función devolvía "" — el bloque entero desaparecía del panel,
  // indistinguible de un error silencioso. Ahora SIEMPRE dibuja el
  // bloque: "Vendidos estimados" explica por qué falta ("Sin dato (0 o
  // no visible en ML)") en vez de desaparecer, y el resto de las filas
  // caen solas a "Sin dato" (ya lo hacían) porque dias/ventasMesEst/
  // facturacionMesEst quedan en null cuando no hay vendidosEst de
  // dónde partir.
  function bloqueAnalisisAproximado(datos) {
    if (!APROX || !CAL) return ""; // sitio sin estos globales cargados (solo Mercado Libre los trae, ver manifest.json) — nunca pasa en Mercado Libre, así que "" acá nunca es el bug de arriba

    const vendidosEst =
      typeof datos.vendidos === "number"
        ? APROX.vendidosEstimados(datos.vendidos, { exacto: datos.vendidosExacto === true, esFull: datos.esFull === true }, CAL)
        : null;

    const dias =
      vendidosEst != null
        ? APROX.antiguedadDias({ dateCreated: datos.dateCreated, mlId: datos.itemId, tipo: tipoIdDePagina(), ahoraMs: Date.now() }, CAL)
        : null;
    const ventasMesEst = vendidosEst != null ? APROX.ventasMes(vendidosEst, dias) : null;
    const facturacionMesEst = ventasMesEst != null ? APROX.facturacionMes(ventasMesEst, datos.precio) : null;

    const etiquetaMl = datos.vendidosExacto === false ? ` <span class="zx-fila__valor--chip">+${textoCampo(datos.vendidos)} en ML</span>` : "";

    let html = '<p class="zx-seccion-titulo">Análisis aprox.</p>';
    html += filaHtml(
      "Vendidos estimados",
      vendidosEst != null ? `${Math.round(vendidosEst)}${etiquetaMl}` : `${SIN_DATO_APROX} (0 o no visible en ML)`,
      vendidosEst == null
    );
    html += filaHtml("Antigüedad", formatoAntiguedad(dias) ?? SIN_DATO_APROX, dias == null);
    html += filaHtml("Ventas/mes", ventasMesEst != null ? Math.round(ventasMesEst) : SIN_DATO_APROX, ventasMesEst == null);
    html += filaHtml("Facturación/mes", facturacionMesEst != null ? formatoPrecio(facturacionMesEst, datos.moneda) : SIN_DATO_APROX, facturacionMesEst == null);
    html +=
      '<p class="zx-nota-aprox">Estimado: vendidos × factor según Full/"+N" (2.2 / 1.55), llevado a "por mes" con la antigüedad real o calibrada de la publicación — nunca un dato que Mercado Libre confirme directamente.</p>';
    return html;
  }

  function renderizarProducto(panel, datos) {
    const cuerpo = renderizarEsqueleto(panel, "Zilonix · Investigación", lector.sitio);
    let html = `<p class="zx-titulo-producto">${textoCampo(datos.titulo)}</p>`;
    html += filaHtml("Precio", formatoPrecio(datos.precio, datos.moneda), datos.precio == null);
    html += filaHtml("Precio anterior", formatoPrecio(datos.precioAnterior, datos.moneda), datos.precioAnterior == null);
    html += filaHtml("Descuento", datos.descuentoPorcentaje != null ? `${datos.descuentoPorcentaje}%` : SIN_DATO, datos.descuentoPorcentaje == null);
    // Issue #174, mejora ML — vendidosExacto viene del JSON que la
    // propia página incrusta (sold_quantity real, ver
    // lectores/mercadolibre.js); undefined en los otros 5 sitios
    // (siguen con la etiqueta genérica "Vendidos" de siempre).
    const etiquetaVendidos = datos.vendidosExacto === true ? "Vendidos (exacto)" : datos.vendidosExacto === false ? "Vendidos (aproximado)" : "Vendidos";
    html += filaHtml(etiquetaVendidos, textoCampo(datos.vendidos), datos.vendidos == null);
    html += filaHtml("Vendedor / tienda", textoCampo(datos.vendedor), datos.vendedor == null);
    html += filaHtml("Calificación", datos.calificacion != null ? `${datos.calificacion} / 5` : SIN_DATO, datos.calificacion == null);
    html += filaHtml("N° de opiniones", textoCampo(datos.numeroOpiniones), datos.numeroOpiniones == null);
    if (datos.esCatalogo !== undefined) {
      html += filaHtml("Catálogo (varios vendedores)", datos.esCatalogo ? "Sí" : "No", false);
      html += filaHtml("Full", datos.esFull ? '<span class="zx-fila__valor--chip">FULL</span>' : "No", false);
      html += filaHtml("Envío gratis", datos.envioGratis ? "Sí" : "No", false);
    }
    html += bloqueAnalisisAproximado(datos);
    cuerpo.innerHTML = html;

    const boton = panel.querySelector(".zx-boton-copiar");
    boton.onclick = () => copiarAlPortapapeles(csvDeProducto(datos), boton);
    // Issue #174 — solo Mercado Libre manda linkSeguir (undefined en
    // los otros 5 sitios); null cuando no se pudo confirmar el id.
    agregarBotonSeguir(panel, datos.linkSeguir, "Seguir en Zilonix");
  }

  // Issue #174 — página de un vendedor/tienda: panel mínimo, solo el
  // nombre (si se puede leer) y el botón de seguir — nunca inventa un
  // seller_id que no se pudo confirmar en el HTML.
  function renderizarTienda(panel, datos) {
    const cuerpo = renderizarEsqueleto(panel, "Zilonix · Investigación", lector.sitio);
    cuerpo.innerHTML = `<p class="zx-titulo-producto">${textoCampo(datos.nombreTienda)}</p>`;
    const botonCopiar = panel.querySelector(".zx-boton-copiar");
    botonCopiar.remove(); // nada que copiar en una página de tienda — nunca un CSV vacío
    agregarBotonSeguir(panel, datos.linkSeguir, "Seguir tienda en Zilonix");
    if (!datos.linkSeguir) {
      panel.querySelector(".zx-panel__pie").insertAdjacentHTML("afterbegin", '<p class="zx-vacio">No se pudo confirmar el vendedor de esta página.</p>');
    }
  }

  // Issue #248 (vuelta 6) — `estadisticasFull` es OPCIONAL a propósito
  // (viene de `leerListado`, `lectores/mercadolibre.js`, solo en
  // Mercado Libre hoy): decisión de producto de Sharel, el chip
  // "Full detectados" tiene que contar Full sobre TODAS las tarjetas
  // visibles — orgánicos Y Ads — porque en la práctica los Ad son
  // justamente los que más muestran el badge Full real. `productos`
  // (el parámetro de arriba) SIGUE sin Ads, sin cambios — nunca se
  // usa para este chip, solo para "Productos visibles"/precios/top10,
  // que siguen siendo solo orgánicos a propósito (nunca mezclar pago
  // con orgánico en lo que se analiza/exporta).
  function renderizarListado(panel, productos, estadisticasFull) {
    const cuerpo = renderizarEsqueleto(panel, "Zilonix · Resumen de búsqueda", lector.sitio);
    if (!productos.length) {
      cuerpo.innerHTML = '<p class="zx-vacio">No se reconoció ningún producto en esta página todavía.</p>';
      return;
    }
    const resumen = calcularResumenListado(productos);
    let html = "";
    html += filaHtml("Productos visibles", resumen.total, false);
    html += filaHtml("Precio mínimo", formatoPrecio(resumen.precioMinimo, null), resumen.precioMinimo == null);
    html += filaHtml("Precio promedio", formatoPrecio(resumen.precioPromedio, null), resumen.precioPromedio == null);
    html += filaHtml("Precio máximo", formatoPrecio(resumen.precioMaximo, null), resumen.precioMaximo == null);
    html += filaHtml("Suma de vendidos visibles", textoCampo(resumen.sumaVendidos), resumen.sumaVendidos == null);
    // Issue #247/#248 — solo se muestra si el sitio de verdad confirma
    // Full (hoy, solo Mercado Libre expone `estadisticasFull`); nunca
    // "0/Y" en un sitio que ni lo mide, y nunca "0/0" si el listado no
    // tiene ninguna tarjeta todavía.
    if (estadisticasFull && estadisticasFull.totalTarjetas > 0) {
      html += filaHtml("Full detectados", `${estadisticasFull.conFull}/${estadisticasFull.totalTarjetas}`, false);
    }

    if (resumen.top10.length) {
      html += `<p class="zx-titulo-producto" style="margin-top:10px">Top ${resumen.top10.length} por vendidos</p><ul class="zx-top10">`;
      html += resumen.top10
        .map((p) => {
          // Issue #174, revisión de Pablo — el link del Top 10 solo se
          // usa si es de verdad http(s) (ZilonixSeguridad.linkSeguro,
          // con new URL real) — nunca un javascript:/data: disfrazado.
          // Si no es seguro, el producto igual aparece, solo que como
          // texto suelto, sin link.
          const urlSegura = ZS.linkSeguro(p.link);
          return urlSegura
            ? `<li><a href="${ZS.escaparHtml(urlSegura)}" target="_blank" rel="noreferrer">${textoCampo(p.titulo)}</a><span class="zx-top10__vendidos">${p.vendidos}</span></li>`
            : `<li><span>${textoCampo(p.titulo)}</span><span class="zx-top10__vendidos">${p.vendidos}</span></li>`;
        })
        .join("");
      html += "</ul>";
    } else {
      html += '<p class="zx-vacio">Ninguno de los productos visibles muestra "vendidos" en este sitio.</p>';
    }
    cuerpo.innerHTML = html;

    const boton = panel.querySelector(".zx-boton-copiar");
    boton.onclick = () => copiarAlPortapapeles(csvDeListado(productos), boton);
    agregarBotonEnviarListado(panel, productos);
  }

  // Issue #213 — "Enviar a Zilonix": mismo estilo que "Seguir en
  // Zilonix" (zx-boton-seguir, plateado) — construido con createElement/
  // textContent, nunca innerHTML, mismo criterio que agregarBotonSeguir.
  // Un solo clic real dispara el envío; nunca se repite solo ni en un
  // reescaneo automático.
  function agregarBotonEnviarListado(panel, productos) {
    const pie = panel.querySelector(".zx-panel__pie");
    const boton = document.createElement("button");
    boton.type = "button";
    boton.className = "zx-boton-seguir";
    boton.textContent = "Enviar a Zilonix";
    boton.onclick = () => {
      enviarListadoAZilonix(productos, false);
      boton.textContent = "Enviado ✓";
      boton.disabled = true;
      setTimeout(() => {
        boton.textContent = "Enviar a Zilonix";
        boton.disabled = false;
      }, 1500);
    };
    pie.appendChild(boton);
  }

  // Issue #213 — "Importar listado": en una página de búsqueda/listado
  // (cualquiera de los 6 sitios), con un clic real de la persona en el
  // botón "Enviar a Zilonix" del panel flotante, se manda hasta
  // TOPE_PRODUCTOS_ENVIO_LISTADO candidatos (título, precio, vendidos
  // si el sitio lo muestra, link ya resuelto a absoluto y validado) al
  // panel de Investigación, por el mismo relevo que "Completar
  // vendidos" (content.js -> background.js -> marcador-zilonix.js ->
  // postMessage). Nunca manda nada solo al cargar la página — siempre
  // detrás del clic del botón.
  // Issue #229 — "maximizar volumen", tope subido de 20 a 30 (mismo
  // límite para el botón manual "Enviar a Zilonix" y para el escaneo
  // automático de Analizar/#221/#225 — ambos pasan por esta constante).
  const TOPE_PRODUCTOS_ENVIO_LISTADO = 30;

  // Mismo criterio de orden que ordenarPorVendidos (lib/ml/investigacionCliente.ts,
  // panel): con vendidos real siempre antes que sin dato, más vendidos
  // primero; entre los que no tienen dato, precio descendente.
  function ordenarProductosListado(productos) {
    return [...productos].sort((a, b) => {
      const aVendidos = typeof a.vendidos === "number";
      const bVendidos = typeof b.vendidos === "number";
      if (aVendidos && bVendidos) return b.vendidos - a.vendidos;
      if (aVendidos) return -1;
      if (bVendidos) return 1;
      const aPrecio = typeof a.precio === "number" ? a.precio : -Infinity;
      const bPrecio = typeof b.precio === "number" ? b.precio : -Infinity;
      return bPrecio - aPrecio;
    });
  }

  // El link de un listado puede venir relativo (ej. Amazon: "/dp/XXXX")
  // — se resuelve contra la URL real de esta página ANTES de validarlo
  // con ZilonixSeguridad.linkSeguro (que exige http(s) real), para no
  // perder el link solo por venir sin dominio. Nunca un javascript:/
  // data: disfrazado: linkSeguro lo descarta igual después de resolver.
  function resolverLinkListadoSeguro(valor) {
    if (typeof valor !== "string" || !valor) return null;
    try {
      return ZS.linkSeguro(new URL(valor, location.href).href);
    } catch {
      return null;
    }
  }

  // Issue #221 — "Analizar estilo OS": `auto` es true SOLO cuando esta
  // pestaña de listado la abrió el escaneo automático (background.js,
  // marcada con ?_zilonix_escaneo=1 en la URL — ver más abajo), nunca
  // por un clic real de la persona en esta pestaña puntual. Issue #229,
  // bug real corregido: hasta esta tarea, SOLO `urlListadoMl` (Mercado
  // Libre) le ponía este marcador a la URL — las 5 plataformas no-ML
  // (`PLATAFORMAS` en background.js) nunca lo tuvieron, así que
  // `esPaginaDeEscaneoAutomatico()` siempre daba `false` para ellas y
  // esta función nunca se llamaba — por eso el clic "Analizar también
  // en: Amazon/Temu/…" no traía nada, siempre agotaba el timeout con 0
  // resultados. Corregido agregando el mismo marcador a las 5 URLs
  // (`conMarcadorEscaneo`, background.js) — esta función de acá no
  // necesitó ningún cambio, ya era genérica por plataforma. En ese
  // caso se manda SIEMPRE (incluso con 0 candidatos — background.js
  // necesita saber que esta variante ya terminó para cerrar la
  // pestaña y seguir con la siguiente, nunca esperar el timeout de
  // más) y con el tipo de mensaje "zilonix:escaneo-resultado" (nunca
  // "zilonix:listado", que sigue siendo solo para el botón manual
  // "Enviar a Zilonix" — background.js los trata distinto: el manual
  // se reenvía tal cual al panel; este otro cierra la pestaña y
  // sigue el escaneo).
  // Issue #225 — `captcha` (true SOLO para Alibaba, ver
  // extension/lectores/alibaba.js) avisa a background.js que esta
  // variante quedó bloqueada — nunca se evade, se espera a que la
  // persona la resuelva a mano (ver la nota en reescanear(), abajo).
  // Issue #227 — "fotos ampliables" + sorts por calificación/Full:
  // suma foto/calificacion/esFull/esEnvioGratis/vendedor/itemId al
  // mensaje — cada campo queda `null`/`undefined` cuando el lector del
  // sitio no lo confirma (nunca inventado). `itemId` SOLO lo manda
  // mercadolibre.js (issue #227, punto 9 "Seguir solo ML") — en el
  // resto de los lectores esta propiedad no existe, así que queda
  // `null` acá, nunca se arma un id falso.
  function enviarListadoAZilonix(productos, auto, captcha) {
    if (typeof chrome === "undefined" || !chrome.runtime || !chrome.runtime.sendMessage) return;
    const candidatos = ordenarProductosListado(productos)
      .filter((p) => p.titulo && typeof p.precio === "number" && Number.isFinite(p.precio))
      .slice(0, TOPE_PRODUCTOS_ENVIO_LISTADO)
      .map((p) => ({
        titulo: p.titulo,
        precio: p.precio,
        vendidos: typeof p.vendidos === "number" ? p.vendidos : null,
        foto: resolverLinkListadoSeguro(p.foto),
        calificacion: typeof p.calificacion === "number" && Number.isFinite(p.calificacion) ? p.calificacion : null,
        esFull: typeof p.esFull === "boolean" ? p.esFull : null,
        // Issue #235, punto 8 — "% PRIME" en el banner de Amazon, nunca
        // mezclado con Full (ver lectores/amazon.js) — null en el
        // resto de los lectores (esa propiedad no existe ahí).
        esPrime: typeof p.esPrime === "boolean" ? p.esPrime : null,
        esEnvioGratis: typeof p.esEnvioGratis === "boolean" ? p.esEnvioGratis : null,
        vendedor: typeof p.vendedor === "string" && p.vendedor ? p.vendedor : null,
        itemId: typeof p.itemId === "string" && p.itemId ? p.itemId : null,
        // Issue #251 (fix "aproximados siempre visibles") — id de
        // catálogo (/p/MCO…), SOLO lo manda mercadolibre.js (igual que
        // itemId, ver comentario de arriba) — nunca inventado en el
        // resto de los lectores.
        productId: typeof p.productId === "string" && p.productId ? p.productId : null,
        link: resolverLinkListadoSeguro(p.link),
      }));
    if (!candidatos.length && !auto && !captcha) return; // manual: nada confiable para mandar, nunca un mensaje vacío
    const mensaje = auto
      ? { tipo: "zilonix:escaneo-resultado", payload: { productos: candidatos, captcha: Boolean(captcha) } }
      : { tipo: "zilonix:listado", payload: { plataforma: lector.sitio, url: location.href, productos: candidatos } };
    try {
      chrome.runtime.sendMessage(mensaje, () => {
        void chrome.runtime.lastError; // sin panel de Investigación abierto en ninguna pestaña — nunca un error real
      });
    } catch {
      // Contexto de la extensión invalidado — nunca rompe el panel.
    }
  }

  // Issue #221 — marca puesta por background.js al abrir esta pestaña
  // como parte del escaneo automático de "Analizar" — nunca la pone
  // la persona a mano. Cuando está, el listado se manda solo, sin
  // esperar el clic de "Enviar a Zilonix" (tendría sentido pedirle a
  // la persona que haga 4 clics más después de Analizar). Se manda
  // una sola vez por carga de página, nunca en cada reescaneo del
  // MutationObserver.
  function esPaginaDeEscaneoAutomatico() {
    try {
      return new URL(location.href).searchParams.get("_zilonix_escaneo") === "1";
    } catch {
      return false;
    }
  }
  let yaEnviadoEscaneoAutomatico = false;

  // Issue #251 (revisión de Pablo, punto 4) — marca puesta por
  // background.js (conMarcadorResena) al navegar la pestaña de fondo
  // de "Top 8 reseñas" — nunca la pone la persona a mano. Gatea SOLO
  // los envíos de Seguimiento (ver enviarInventarioFichaAZilonix/
  // enviarPublicacionesTiendaAZilonix, abajo): esta pestaña la abrió la
  // extensión para leer reseñas de un candidato cualquiera, nunca
  // porque la persona entró a ver un competidor que sigue — mandar
  // inventario/vendidos desde acá sería un dato real pero mal
  // atribuido a "la persona lo revisó", que es la premisa de
  // Seguimiento. No afecta "Completar vendidos"/reseñas en sí, que
  // siguen mandándose igual desde esta misma pestaña (ese es justo el
  // propósito de que la extensión la abra).
  function esPaginaDeLecturaResenas() {
    try {
      return new URL(location.href).searchParams.get("_zilonix_resena") === "1";
    } catch {
      return false;
    }
  }
  // Issue #225 — aviso de captcha, UN solo uso por carga de página —
  // a propósito NUNCA bloquea que, más adelante en la MISMA carga, se
  // mande el resultado real una vez que el captcha se resuelva (ese
  // es yaEnviadoEscaneoAutomatico, arriba, un flag INDEPENDIENTE).
  let yaAvisadoCaptcha = false;

  // Issue #231 — bug real confirmado por un incidente YA diagnosticado
  // y corregido en zilonix-os-web (chrome-extension-busqueda/
  // scraper-listado.js, commit "ML ahora tarda ~9s en pintar
  // resultados — scraper leía antes de que aparecieran"): Mercado
  // Libre (y cualquier sitio SPA) puede tardar varios segundos en
  // pintar las tarjetas reales del listado después de que la página
  // "cargó" — `document_idle` dispara mucho antes de eso. El código
  // de acá hasta esta tarea leía el DOM UNA sola vez en el primer
  // reescaneo automático y mandaba lo que hubiera (muchas veces 0
  // tarjetas, porque ML seguía renderizando) — y, como
  // `yaEnviadoEscaneoAutomatico` queda en `true` después de ese envío,
  // NUNCA volvía a intentar, aunque el MutationObserver siguiera
  // reescaneando la página normalmente. Esto explica el smoke real de
  // Sharel: "banner conectado, chips de variantes IA visibles, pero
  // nunca aparece ningún bloque" — el escaneo SÍ corría, pero siempre
  // mandaba un resultado vacío antes de tiempo.
  //
  // `esperarListadoEstable` es el mismo patrón confirmado en el código
  // real de zilonix-os-web (`esperarTarjetas`): no alcanza con "ya
  // apareció la primera tarjeta" — un SPA puede seguir agregando más a
  // mitad de un render en progreso — se exige que la CANTIDAD de
  // candidatos que `lector.leerListado` encuentra quede estable por
  // `esperaEstabilidadMs` antes de leer de verdad. Genérico (no
  // specific de Mercado Libre): usa `lector.leerListado`, que ya
  // existe para los 6 sitios, así que esta espera también ayuda al
  // volumen de las otras 5 plataformas si son lentas en renderizar.
  //
  // `maxEsperaMs` queda en 14s (issue #233 — antes 10s), bien cerca
  // del timeout fijo de 15s que ya tiene background.js
  // (TIMEOUT_POR_VARIANTE_MS/TIEMPO_MAX_POR_TERMINO_MS, sin cambios
  // por esta tarea): el margen de 1s que queda es solo para el
  // mensaje de vuelta — background.js es quien de verdad corta la
  // espera si hace falta (ver manejarEscaneoAutomatico, abajo: si
  // esto termina sin ver nada, NUNCA se manda un resultado vacío por
  // cuenta propia, se deja que el timeout externo decida).
  //
  // Issue #247/#248 (vueltas 1 a 3) — habían agregado una SEGUNDA fase
  // de espera acá, específica para que Mercado Libre hidrate el badge
  // Full dentro de cada tarjeta (más allá de la cantidad ya estable),
  // subiendo varias veces (1.8s -> 6.5s -> 12s) buscando el bug real
  // del 0/48. Issue #248 (vuelta 4) — Mateo confirmó con HTML real que
  // el detector de Full (`detectarFullEnTarjeta`, `lectores/mercadolibre.js`)
  // ya reconoce el badge real sin ninguna capa extra — Zilonix OS
  // nunca tuvo esta segunda fase, solo `esperarTarjetas()` (cantidad
  // estable) + el selector directo. Se saca esa fase entera y se
  // vuelve al mismo criterio simple de OS: esperar solo la cantidad
  // de tarjetas estable, nada específico de Full.
  //
  // Issue #248 (vuelta 5) — con eso solo, el smoke de Pablo (listado
  // "tetero" sin filtro) seguía en 0/48 con badges Full visibles.
  // Causa real: esta función medía "estable" con
  // `lector.leerListado(document).productos.length` — la cantidad YA
  // FILTRADA (sin anuncios, sin tarjetas inválidas) — que puede quedar
  // quieta ANTES de que Mercado Libre termine de hidratar el badge
  // Full DENTRO de cada tarjeta, aunque la cantidad de tarjetas en sí
  // siga cambiando. `esperarTarjetas()` de Zilonix OS mide la cantidad
  // CRUDA de `li` (`document.querySelectorAll('li.ui-search-layout__item').length`)
  // — nunca tiene este problema. Se usa esa misma cuenta cruda cuando
  // el lector activo la expone (`lector.contarTarjetasListado`, hoy
  // solo Mercado Libre, ver `lectores/mercadolibre.js`) — si no la
  // expone (las otras 5 plataformas, sin este bug reportado), se cae
  // a `productos.length`, el criterio genérico de siempre.
  function esperarListadoEstable(maxEsperaMs, esperaEstabilidadMs, intervaloMs) {
    maxEsperaMs = typeof maxEsperaMs === "number" ? maxEsperaMs : 14000;
    esperaEstabilidadMs = typeof esperaEstabilidadMs === "number" ? esperaEstabilidadMs : 1000;
    intervaloMs = typeof intervaloMs === "number" ? intervaloMs : 400;
    return new Promise((resolve) => {
      const inicio = Date.now();
      let ultimaCantidad = -1;
      let ultimoCambio = Date.now();
      const intervalo = setInterval(() => {
        let resultado;
        try {
          resultado = lector.leerListado(document);
        } catch {
          resultado = { productos: [] };
        }
        if (resultado && resultado.captcha) {
          clearInterval(intervalo);
          resolve({ productos: [], captcha: true, estadisticasFull: null });
          return;
        }
        const productos = (resultado && resultado.productos) || [];
        // Issue #248 (vuelta 6) — se lleva junto con `productos` hasta
        // el resolve final (ver `lector.leerListado`,
        // `lectores/mercadolibre.js`) para que quien renderice tenga
        // las estadísticas de Full de la MISMA lectura ya estabilizada
        // — nunca undefined solo porque este helper no las reenviaba.
        const estadisticasFull = (resultado && resultado.estadisticasFull) || null;
        let cantidad;
        try {
          cantidad = typeof lector.contarTarjetasListado === "function" ? lector.contarTarjetasListado(document) : productos.length;
        } catch {
          cantidad = productos.length;
        }
        const ahora = Date.now();
        if (cantidad !== ultimaCantidad) {
          ultimaCantidad = cantidad;
          ultimoCambio = ahora;
        }
        const estable = cantidad > 0 && ahora - ultimoCambio >= esperaEstabilidadMs;
        const seAgotoElTiempo = ahora - inicio > maxEsperaMs;
        if (estable || seAgotoElTiempo) {
          clearInterval(intervalo);
          resolve({ productos, captcha: false, estadisticasFull });
        }
      }, intervaloMs);
    });
  }

  // Issue #248 (vuelta 5) — Pablo confirmó que el panel FLOTANTE de un
  // listado (el que se ve al navegar normal, sin "Analizar"
  // automático) llamaba `lector.leerListado(document)` EN CALIENTE,
  // directo desde `reescanear()`, sin pasar nunca por
  // `esperarListadoEstable` — esa espera solo corría del lado del
  // escaneo automático (`manejarEscaneoAutomatico`, abajo). El chip
  // "Full detectados" de ese panel podía mostrar 0/Y con badges reales
  // visibles en la página por la misma razón de siempre: una lectura
  // tomada antes de que el sitio termine de hidratar. Se agrega el
  // mismo guard de "nunca dos esperas en paralelo" que ya usa
  // `manejarEscaneoAutomatico` (ver `esperandoEscaneoAutomatico`,
  // abajo) — si el MutationObserver dispara `reescanear()` de nuevo
  // mientras esta espera sigue en curso, ese reescaneo se ignora acá
  // (no hace falta: cuando la espera en curso resuelva, pinta con lo
  // que haya en ese momento, que ya va a incluir cualquier cambio
  // reciente del DOM).
  let esperandoListadoFlotante = false;
  async function manejarListadoFlotante(panel) {
    if (esperandoListadoFlotante) return;
    esperandoListadoFlotante = true;
    try {
      const resultado = await esperarListadoEstable();
      // Nunca se pinta un captcha como si fuera un listado real — el
      // aviso de captcha para el escaneo automático ya lo maneja
      // manejarEscaneoAutomatico por su cuenta; acá, sin nada confiable
      // que mostrar, se deja el panel como esté.
      if (resultado.captcha) return;
      renderizarListado(panel, resultado.productos, resultado.estadisticasFull);
    } finally {
      esperandoListadoFlotante = false;
    }
  }
  // Evita arrancar dos esperas en paralelo si el MutationObserver
  // dispara varios reescaneos mientras la primera espera todavía no
  // terminó — `yaEnviadoEscaneoAutomatico` solo pasa a `true` recién
  // cuando el envío real ya ocurrió (ver manejarEscaneoAutomatico).
  let esperandoEscaneoAutomatico = false;

  // Issue #235 — sondeo activo tras un captcha (hoy solo Alibaba, ver
  // alibaba.js/hayCaptchaAlibaba — genérico igual, por si otro sitio
  // suma captcha el día de mañana): lee el DOM cada 2s, independiente
  // del MutationObserver, buscando candidatos reales. Nunca resuelve
  // ni hace clic por la persona — solo MIRA si ya lo hizo. Tope de
  // 110s (por debajo de los 120s fijos que background.js
  // — TIEMPO_MAX_CAPTCHA_MS — le da a la persona antes de rendirse del
  // todo), para dejar un margen real al mensaje de vuelta.
  let esperandoCaptchaResuelto = false;
  const TIEMPO_MAX_ESPERA_CAPTCHA_MS = 110000;
  const INTERVALO_POLL_CAPTCHA_MS = 2000;

  function iniciarEsperaCaptchaResuelto() {
    if (esperandoCaptchaResuelto || yaEnviadoEscaneoAutomatico) return;
    esperandoCaptchaResuelto = true;
    const inicio = Date.now();
    const intervalo = setInterval(() => {
      if (yaEnviadoEscaneoAutomatico) {
        clearInterval(intervalo);
        esperandoCaptchaResuelto = false;
        return;
      }
      if (Date.now() - inicio > TIEMPO_MAX_ESPERA_CAPTCHA_MS) {
        clearInterval(intervalo);
        esperandoCaptchaResuelto = false;
        return; // background.js tiene su propio timeout fijo — acá no se manda nada vacío, mismo criterio que #233 punto C
      }
      let resultado;
      try {
        resultado = lector.leerListado(document);
      } catch {
        resultado = { productos: [] };
      }
      if (resultado && resultado.captcha) return; // sigue bloqueado — se sigue esperando, nunca se intenta resolver
      const productos = (resultado && resultado.productos) || [];
      if (!productos.length) return; // todavía nada real que mandar
      clearInterval(intervalo);
      esperandoCaptchaResuelto = false;
      yaEnviadoEscaneoAutomatico = true;
      enviarListadoAZilonix(productos, true, false);
    }, INTERVALO_POLL_CAPTCHA_MS);
  }

  async function manejarEscaneoAutomatico() {
    if (yaEnviadoEscaneoAutomatico || esperandoEscaneoAutomatico) return;
    esperandoEscaneoAutomatico = true;
    try {
      const resultado = await esperarListadoEstable();
      if (yaEnviadoEscaneoAutomatico) return; // se resolvió por otro camino mientras tanto — nunca debería pasar, defensivo
      if (resultado.captcha) {
        // Issue #225 — mismo criterio de siempre: nunca se marca
        // yaEnviadoEscaneoAutomatico acá, la persona resuelve a mano.
        if (!yaAvisadoCaptcha) {
          yaAvisadoCaptcha = true;
          enviarListadoAZilonix([], true, true);
        }
        // Issue #235 — bug real del smoke: "aviso de captcha OK, pero
        // nunca reanuda el escaneo al resolver a mano". Hasta esta
        // tarea, el único camino para volver a intentar después de un
        // captcha era pasivo: esperar a que el MutationObserver
        // (observa SOLO document.body, nunca document.head) detectara
        // un cambio real en el DOM, o que la URL cambiara. Si Alibaba
        // resuelve el captcha de una forma que ese observer no agarra
        // bien (ej. un cambio que tarda en reflejarse en el body, o un
        // reload cuya URL final pierde el marcador `_zilonix_escaneo=1`),
        // nunca se reintentaba — el escaneo quedaba "trabado" hasta el
        // timeout fijo de 120s de background.js (TIEMPO_MAX_CAPTCHA_MS),
        // sin ningún intento activo mientras tanto. Se agrega un sondeo
        // PROPIO, activo, que no depende del MutationObserver — mismo
        // criterio de "nunca evadir, nunca mandar vacío antes de
        // tiempo" (#233, punto C) aplicado acá: nunca se resuelve ni
        // se hace clic por la persona, solo se vuelve a LEER el DOM
        // cada 2s, por si la persona ya lo resolvió a mano.
        iniciarEsperaCaptchaResuelto();
        return;
      }
      if (!resultado.productos.length) {
        // Issue #233, punto C — bug real: hasta esta tarea, si
        // esperarListadoEstable agotaba maxEsperaMs sin ver NINGÚN
        // candidato, igual se mandaba ese resultado vacío y se
        // marcaba yaEnviadoEscaneoAutomatico — cerrando la puerta a
        // cualquier intento posterior (el MutationObserver podía
        // seguir viendo la página seguir cargando después). Nunca se
        // adelanta esa decisión desde acá con menos información que
        // la que tiene background.js: se deja sin marcar nada, para
        // que (a) el timeout EXTERNO fijo de 15s
        // (TIMEOUT_POR_VARIANTE_MS/TIEMPO_MAX_POR_TERMINO_MS) sea
        // quien de verdad cierre esta variante si nunca hubo nada
        // real, o (b) si el MutationObserver dispara otro reescaneo
        // antes de que ese timeout externo llegue, se intente de
        // nuevo con lo que haya en ese momento.
        return;
      }
      yaEnviadoEscaneoAutomatico = true;
      enviarListadoAZilonix(resultado.productos, true, false);
    } finally {
      esperandoEscaneoAutomatico = false;
    }
  }

  // Issue #210 — "Completar vendidos": cuando la persona abre un
  // candidato de Mercado Libre (por el botón "Completar vendidos
  // (~5)" del panel de Investigación, o por cualquier otro motivo —
  // no hace falta saber por qué se abrió) y se confirma un itemId real
  // con algún dato de vendidos, se lo manda a extension/background.js,
  // que lo reenvía a cualquier pestaña abierta (solo el panel de
  // Investigación tiene extension/marcador-zilonix.js escuchando, así
  // que en el resto no hace nada). Nunca manda nada sin itemId
  // confirmado — nunca inventa, nunca abre ni navega ninguna pestaña
  // por su cuenta. Genérico a propósito (no solo Mercado Libre): solo
  // el lector de ML pone itemId/vendidos reales en `datos`, así que en
  // los otros 5 sitios esta función no hace nada.
  function enviarVendidosAZilonix(datos) {
    if (!datos || typeof datos.itemId !== "string" || datos.vendidos == null) return;
    if (typeof chrome === "undefined" || !chrome.runtime || !chrome.runtime.sendMessage) return;
    const payload = {
      itemId: datos.itemId,
      sold_quantity: datos.vendidos,
      date_created: datos.dateCreated || null,
      esFull: datos.esFull === true,
      etiquetaMasN: datos.vendidosExacto === false,
    };
    try {
      chrome.runtime.sendMessage({ tipo: "zilonix:vendidos", payload }, () => {
        // Sin background.js disponible (extensión recién actualizada,
        // pestaña abierta antes del reinicio) — nunca rompe el panel.
        void chrome.runtime.lastError;
      });
    } catch {
      // Contexto de la extensión invalidado (ej. recién reinstalada) — ídem, nunca rompe el panel.
    }
  }

  // Issue #251 — mismo criterio y mismo relevo que enviarVendidosAZilonix
  // (arriba): nunca manda nada sin un id real confirmado, nunca sabe
  // (ni le hace falta saber) si esto corresponde a un seguimiento
  // activo — background.js lo reenvía a cualquier pestaña abierta y
  // Seguimiento (el único que escucha "dato-pagina-seguimiento") decide
  // si le importa. Disparado SOLO por un clic real de la persona —
  // abrir la ficha de un competidor o la tienda que sigue — igual que
  // "Completar vendidos": nunca la extensión navega sola a ninguna de
  // estas páginas.
  function enviarDatoPaginaSeguimientoAZilonix(payload) {
    if (typeof chrome === "undefined" || !chrome.runtime || !chrome.runtime.sendMessage) return;
    try {
      chrome.runtime.sendMessage({ tipo: "zilonix:dato-pagina-seguimiento", payload }, () => {
        void chrome.runtime.lastError; // sin panel de Seguimiento abierto en ninguna pestaña — nunca un error real
      });
    } catch {
      // Contexto de la extensión invalidado — nunca rompe el panel.
    }
  }

  // Issue #251 — ficha de un producto de competencia: inventario
  // máximo del selector de cantidad + "+N vendidos" (ya leídos por
  // lector.leerProducto, issue #174/#197) — nunca manda nada si no hay
  // itemId confirmado.
  function enviarInventarioFichaAZilonix(datos) {
    if (!datos || typeof datos.itemId !== "string") return;
    if (datos.inventarioMaximo == null && datos.vendidos == null) return;
    enviarDatoPaginaSeguimientoAZilonix({
      tipoSeguimiento: "producto",
      mlIdExterno: datos.itemId,
      inventario: datos.inventarioMaximo,
      inventarioAproximado: datos.inventarioMaximoAproximado === true,
      vendidos: datos.vendidos,
      vendidosExacto: datos.vendidosExacto === true,
      // Issue #252 (punto 3) — respaldo para el nombre: si la revisión
      // automática todavía no pudo confirmar el recurso real en ML
      // (ej. recurso_ml guardado mal antes del #250), el servidor usa
      // esto para no dejar el seguimiento en "Pendiente de primera
      // revisión" para siempre.
      titulo: datos.titulo ?? null,
      precio: datos.precio ?? null,
      // Issue #251 (corrección de Pablo, punto 6/7) — cuándo se LEYÓ
      // la página de verdad, nunca cuándo llega al servidor:
      // background.js puede encolar esto y entregarlo horas después
      // (punto 4 de la revisión anterior) — sin esto, el servidor
      // habría usado "ahora" (el momento de la entrega) para decidir a
      // qué día pertenece la lectura.
      leidoEn: new Date().toISOString(),
    });
  }

  // Issue #251 — página de una tienda seguida: total de publicaciones
  // + ids MCO visibles (lector.leerTienda) — nunca manda nada sin un
  // sellerId confirmado.
  function enviarPublicacionesTiendaAZilonix(datos) {
    if (!datos || typeof datos.sellerId !== "string") return;
    if (datos.totalPublicaciones == null) return;
    enviarDatoPaginaSeguimientoAZilonix({
      tipoSeguimiento: "tienda",
      mlIdExterno: datos.sellerId,
      totalPublicaciones: datos.totalPublicaciones,
      idsVisibles: Array.isArray(datos.idsVisibles) ? datos.idsVisibles : [],
      leidoEn: new Date().toISOString(),
    });
  }

  // Issue #225 — "Top 8 reseñas": cuando background.js está leyendo
  // reseñas (una sola pestaña reutilizada, navegada con
  // chrome.tabs.update — ver extension/LEEME.md), cada navegación
  // reinyecta este content script de cero, así que esta marca de "un
  // solo envío" siempre arranca en false para esa página — nunca se
  // manda dos veces la reseña de la MISMA PDP (si se mandara dos
  // veces, la segunda podría llegarle a background.js después de que
  // ya avanzó al siguiente item y quedaría mal atribuida). Mismo
  // criterio que lector.leerResenas: solo Mercado Libre lo implementa,
  // en los otros 5 sitios esto simplemente nunca encuentra nada que
  // mandar.
  let yaEnviadaResenaEstaPagina = false;
  function enviarResenaAZilonix(itemId, resena) {
    if (yaEnviadaResenaEstaPagina) return;
    if (typeof itemId !== "string" || !resena) return;
    if (typeof chrome === "undefined" || !chrome.runtime || !chrome.runtime.sendMessage) return;
    yaEnviadaResenaEstaPagina = true;
    try {
      chrome.runtime.sendMessage({ tipo: "zilonix:resena", payload: { itemId, resena } }, () => {
        void chrome.runtime.lastError; // sin "Ver reseñas" en curso en ningún panel — nunca un error real
      });
    } catch {
      // Contexto de la extensión invalidado — nunca rompe el panel.
    }
  }

  function reescanear() {
    let tipo;
    try {
      tipo = lector.tipoDePagina(location.href, document);
    } catch {
      tipo = null;
    }
    if (!tipo) return; // ni producto ni listado reconocido — no se dibuja nada encima de la página

    const panel = obtenerOCrearPanel();
    try {
      if (tipo === "producto") {
        const datos = lector.leerProducto(document);
        renderizarProducto(panel, datos);
        enviarVendidosAZilonix(datos);
        // Issue #251 (revisión de Pablo, punto 4) — nunca en una
        // pestaña que la propia extensión abrió para "Analizar" o
        // "Top 8 reseñas" (ver esPaginaDeEscaneoAutomatico/
        // esPaginaDeLecturaResenas, arriba). Sí se manda en cualquier
        // otra, incluidas las que abre el botón "Actualizar todo" del
        // panel de Seguimiento (window.open desde la página, nunca
        // marcadas por background.js — un clic real, igual que abrir
        // la ficha a mano).
        if (!esPaginaDeEscaneoAutomatico() && !esPaginaDeLecturaResenas()) {
          enviarInventarioFichaAZilonix(datos);
        }
        // Issue #225 — se intenta SIEMPRE que haya un itemId confirmado
        // (igual que enviarVendidosAZilonix), no solo durante un "Ver
        // reseñas" activo — background.js es quien decide si le
        // importa (solo si esta pestaña es la que está leyendo
        // reseñas en este momento, ver avanzarLecturaResena).
        if (lector.leerResenas && datos && typeof datos.itemId === "string") {
          const resena = lector.leerResenas(document);
          if (resena && resena.resenasTotales != null) enviarResenaAZilonix(datos.itemId, resena);
        }
      } else if (tipo === "listado") {
        // Issue #248 (vuelta 5) — ya no se pinta con una lectura en
        // caliente: `manejarListadoFlotante` espera a que el listado
        // se estabilice (mismo criterio que el escaneo automático,
        // abajo) antes de pintar el panel — ver el comentario completo
        // junto a `esperarListadoEstable`/`manejarListadoFlotante`,
        // arriba.
        void manejarListadoFlotante(panel);
        // Issue #231 — ya no se decide acá mismo con esta UNA lectura
        // sincrónica (ver manejarEscaneoAutomatico/esperarListadoEstable
        // arriba: el bug real era mandar 0 candidatos antes de que el
        // sitio terminara de renderizar). Esto sigue dependiendo del
        // mismo marcador de siempre (`_zilonix_escaneo=1`) y del mismo
        // flag de un solo envío — solo que la decisión de QUÉ mandar
        // ahora espera a que el listado se estabilice.
        if (esPaginaDeEscaneoAutomatico() && !yaEnviadoEscaneoAutomatico) {
          void manejarEscaneoAutomatico();
        }
      } else if (tipo === "tienda" && lector.leerTienda) {
        const datosTienda = lector.leerTienda(document);
        renderizarTienda(panel, datosTienda);
        // Issue #251 (revisión de Pablo, punto 4) — mismo criterio que
        // el bloque "producto", arriba.
        if (!esPaginaDeEscaneoAutomatico() && !esPaginaDeLecturaResenas()) {
          enviarPublicacionesTiendaAZilonix(datosTienda);
        }
      }
    } catch (error) {
      // Un selector roto en vivo nunca deja la página del usuario rota
      // — solo el panel se queda sin mostrar nada, con el error en la
      // consola de la extensión para poder arreglarlo después.
      console.warn("[Zilonix Investigación] no se pudo leer la página:", error);
    }
  }

  let temporizador = null;
  function reescanearConRetardo() {
    clearTimeout(temporizador);
    temporizador = setTimeout(reescanear, RETARDO_REESCANEO_MS);
  }

  reescanear();
  new MutationObserver(reescanearConRetardo).observe(document.body, { childList: true, subtree: true });
  // Sitios SPA (ML, Amazon) cambian la URL con history.pushState sin
  // disparar ningún evento propio — se detecta comparando el href.
  let ultimaUrl = location.href;
  setInterval(() => {
    if (location.href !== ultimaUrl) {
      ultimaUrl = location.href;
      reescanearConRetardo();
    }
  }, 1000);

  // Issue #251 (fix "aproximados siempre visibles") — mismo patrón
  // dual que extension/lectores/aproximados.js: en el navegador real
  // no existe `module`, así que esto nunca corre ahí; en Node
  // (vitest, content.test.ts) permite probar bloqueAnalisisAproximado
  // (la función pura detrás del bloque "Análisis aprox.") sin un DOM
  // real — nunca se exporta nada que dependa de document/chrome.
  if (typeof module !== "undefined" && module.exports) {
    module.exports = { bloqueAnalisisAproximado, tipoIdDePagina };
  }
})();
