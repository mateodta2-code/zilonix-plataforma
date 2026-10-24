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
    // Issue #174, mejora ML — siempre "estimado": multiplicar/dividir
    // nunca es una cifra que Mercado Libre confirme directamente,
    // aunque "vendidos" sea el exacto. Solo existe en ML (ventasPromedioMes
    // viene undefined en los otros 5 sitios).
    if (datos.ventasPromedioMes !== undefined) {
      html += filaHtml("Ventas promedio al mes (estimado)", textoCampo(datos.ventasPromedioMes), datos.ventasPromedioMes == null);
    }
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

  function renderizarListado(panel, productos) {
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
      if (tipo === "producto") renderizarProducto(panel, lector.leerProducto(document));
      else if (tipo === "listado") renderizarListado(panel, lector.leerListado(document).productos);
      else if (tipo === "tienda" && lector.leerTienda) renderizarTienda(panel, lector.leerTienda(document));
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
})();
