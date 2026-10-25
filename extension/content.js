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
  const TOPE_PRODUCTOS_ENVIO_LISTADO = 20;

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
  // por un clic real de la persona en esta pestaña puntual. En ese
  // caso se manda SIEMPRE (incluso con 0 candidatos — background.js
  // necesita saber que esta variante ya terminó para cerrar la
  // pestaña y seguir con la siguiente, nunca esperar el timeout de
  // más) y con el tipo de mensaje "zilonix:escaneo-resultado" (nunca
  // "zilonix:listado", que sigue siendo solo para el botón manual
  // "Enviar a Zilonix" — background.js los trata distinto: el manual
  // se reenvía tal cual al panel; este otro cierra la pestaña y
  // sigue el escaneo).
  function enviarListadoAZilonix(productos, auto) {
    if (typeof chrome === "undefined" || !chrome.runtime || !chrome.runtime.sendMessage) return;
    const candidatos = ordenarProductosListado(productos)
      .filter((p) => p.titulo && typeof p.precio === "number" && Number.isFinite(p.precio))
      .slice(0, TOPE_PRODUCTOS_ENVIO_LISTADO)
      .map((p) => ({
        titulo: p.titulo,
        precio: p.precio,
        vendidos: typeof p.vendidos === "number" ? p.vendidos : null,
        link: resolverLinkListadoSeguro(p.link),
      }));
    if (!candidatos.length && !auto) return; // manual: nada confiable para mandar, nunca un mensaje vacío
    const mensaje = auto
      ? { tipo: "zilonix:escaneo-resultado", payload: { productos: candidatos } }
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
        const productos = lector.leerListado(document).productos;
        renderizarListado(panel, productos);
        if (esPaginaDeEscaneoAutomatico() && !yaEnviadoEscaneoAutomatico) {
          yaEnviadoEscaneoAutomatico = true;
          enviarListadoAZilonix(productos, true);
        }
      } else if (tipo === "tienda" && lector.leerTienda) renderizarTienda(panel, lector.leerTienda(document));
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
