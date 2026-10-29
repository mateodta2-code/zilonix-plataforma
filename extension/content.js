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
  // Issue #273 (revisión de Pablo, punto 2) — mismo criterio opcional
  // que APROX/CAL: solo Mercado Libre carga config.js (manifest.json,
  // "Seguir en Zilonix"/"Seguir tienda" son funciones solo de ahí) —
  // se usa para mostrar a qué ambiente (staging/producción) se manda
  // "Seguir en Zilonix", ver el texto chico en renderizarEsqueleto.
  const CONFIG = window.ZilonixConfig;

  const SIN_DATO = "No disponible";
  const PANEL_ID = "zilonix-panel-investigacion-174";
  const RETARDO_REESCANEO_MS = 900; // sitios SPA (ML, Amazon) cambian el DOM sin recargar la página

  // Issue #273 (Mateo) — "el panel aparece siempre, y si lo minimizo o
  // lo cierro vuelve enseguida": causa real confirmada leyendo el
  // final de este archivo — reescanear() (MutationObserver +
  // setInterval, abajo) se dispara con CUALQUIER mutación del DOM de
  // una página ML normal (muchas por segundo) y nunca chequeaba nada
  // antes de llamar a obtenerOCrearPanel(); cerrar con botonCerrar
  // (cablearEncabezado) solo hace host.remove() — el próximo tick del
  // observer/intervalo, obtenerOCrearPanel() no encuentra el nodo y lo
  // vuelve a crear de cero. Minimizar tampoco sobrevivía: renderizarEsqueleto
  // hace panel.innerHTML = "..." en CADA reescanear() (varias veces por
  // segundo en una página viva), reconstruyendo el cuerpo sin el
  // atributo "hidden" que había puesto el clic anterior.
  // Interruptor global (chrome.storage.local, permiso "storage" que ya
  // existe) + 2 estados por pestaña (sessionStorage — por pestaña Y
  // origen, nunca sobrevive una pestaña nueva ni se comparte entre
  // pestañas, correcto para "cerrado/minimizado EN ESTA pestaña"):
  // nunca un permiso nuevo, nunca un host_permission nuevo.
  const CLAVE_INTERRUPTOR = "zilonixInterruptorEncendido"; // chrome.storage.local — compartido entre pestañas/sitios
  const CLAVE_PANEL_CERRADO = "zilonix-panel-cerrado-174"; // sessionStorage — por pestaña
  const CLAVE_PANEL_MINIMIZADO = "zilonix-panel-minimizado-174"; // sessionStorage — por pestaña

  // Default ON (comportamiento de siempre) hasta que leerInterruptorInicial
  // (abajo, al final del archivo) confirme lo contrario — nunca aparece
  // y desaparece de golpe mientras se resuelve chrome.storage.local.get.
  let interruptorEncendido = true;

  // --- Funciones puras de abajo (issue #273) — mismo criterio que
  // bloqueAnalisisAproximado/tipoIdDePagina (ver el export al final):
  // reciben el storage como parámetro en vez de leer sessionStorage/
  // chrome.storage directo, para poder probarlas con un storage-fake
  // {getItem,setItem,removeItem}/{get,set} sin DOM ni chrome real.

  // `valorGuardado` es lo que YA hay en chrome.storage.local (undefined
  // la primera vez que se instala/usa esta versión) -- default TRUE
  // (comportamiento de siempre) salvo que de verdad se haya guardado
  // `false` explícito.
  function valorInterruptorDesdeStorage(valorGuardado) {
    return valorGuardado !== false;
  }

  // Issue #273 (revisión de Pablo, punto 1 — HIGH) — nombre corregido:
  // esto SOLO decide si el panel se CREA/DIBUJA (obtenerOCrearPanel +
  // renderizarProducto/renderizarTienda/manejarListadoFlotante) — nunca
  // si la página se lee ni si los envíos silenciosos (enviarVendidosAZilonix,
  // enviarInventarioFichaAZilonix, enviarPublicacionesTiendaAZilonix,
  // manejarEscaneoAutomatico) corren. Antes de esta corrección se
  // llamaba debeReescanearAuto y gateaba reescanear() ENTERO desde el
  // principio — bug real encontrado por Pablo: con el interruptor
  // apagado, o con la pestaña cerrada con la X, "Completar vendidos" y
  // el relevo de datos de Seguimiento se perdían en silencio, nunca
  // llegaban a leer la página siquiera. Pura y separada a propósito:
  // es el corazón del bug real de "vuelve a aparecer", así que queda
  // probada sola, sin depender del resto de reescanear().
  function debeDibujarPanel(interruptorEnc, panelCerrado) {
    return interruptorEnc && !panelCerrado;
  }

  function leerPanelCerrado(storage) {
    if (!storage) return false;
    try {
      return storage.getItem(CLAVE_PANEL_CERRADO) === "1";
    } catch {
      return false; // sessionStorage bloqueado (ej. contexto restringido) — nunca revienta, se comporta como "no cerrado"
    }
  }

  function escribirPanelCerrado(storage, cerrado) {
    if (!storage) return;
    try {
      if (cerrado) storage.setItem(CLAVE_PANEL_CERRADO, "1");
      else storage.removeItem(CLAVE_PANEL_CERRADO);
    } catch {
      // ídem arriba, nunca revienta
    }
  }

  function leerPanelMinimizado(storage) {
    if (!storage) return false;
    try {
      return storage.getItem(CLAVE_PANEL_MINIMIZADO) === "1";
    } catch {
      return false;
    }
  }

  function escribirPanelMinimizado(storage, minimizado) {
    if (!storage) return;
    try {
      if (minimizado) storage.setItem(CLAVE_PANEL_MINIMIZADO, "1");
      else storage.removeItem(CLAVE_PANEL_MINIMIZADO);
    } catch {
      // nunca revienta
    }
  }

  // `typeof sessionStorage` nunca revienta ni con la variable sin
  // declarar en ningún lado (a diferencia de referenciarla directo) —
  // seguro de llamar siempre, incluido en los tests de vitest (sin DOM
  // real, ver content.test.ts) y en un iframe sandboxeado de 3ros que
  // bloquee el acceso (el try/catch de adentro cubre ESE caso puntual).
  function storageDeSesion() {
    try {
      return typeof sessionStorage !== "undefined" ? sessionStorage : null;
    } catch {
      return null;
    }
  }

  // Mismo criterio que storageDeSesion — nunca revienta sin chrome.storage
  // real disponible (vitest, o la extensión recién reinstalada/con el
  // contexto invalidado).
  function storageExtension() {
    try {
      return typeof chrome !== "undefined" && chrome.storage && chrome.storage.local ? chrome.storage.local : null;
    } catch {
      return null;
    }
  }

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

  // Issue #273 — devuelve el host REAL del panel (el <div id=PANEL_ID>
  // fuera del shadow DOM), nunca el nodo `panel` de adentro — mismo
  // criterio que ya usaba botonCerrar antes de esta tarea, reutilizado
  // acá (apagar el interruptor desde el propio switch también saca el
  // panel entero de la página, no solo lo esconde).
  function hostDelPanel(panel) {
    return (panel.getRootNode && panel.getRootNode().host) || panel;
  }

  function cablearEncabezado(panel, subtitulo) {
    const cuerpo = panel.querySelector(".zx-panel__cuerpo");
    const botonColapsar = panel.querySelector("[data-accion='colapsar']");
    const botonCerrar = panel.querySelector("[data-accion='cerrar']");
    const inputInterruptor = panel.querySelector("[data-accion='interruptor']");
    const textoInterruptor = panel.querySelector("[data-accion='interruptor-texto']");
    panel.querySelector(".zx-panel__sitio").textContent = subtitulo;
    botonColapsar.onclick = () => {
      const estabaOculto = cuerpo.hasAttribute("hidden");
      if (estabaOculto) cuerpo.removeAttribute("hidden");
      else cuerpo.setAttribute("hidden", "");
      botonColapsar.textContent = estabaOculto ? "▾" : "▸";
      // Issue #273 — persiste el nuevo estado por pestaña: el próximo
      // reescanear() (reconstruye panel.innerHTML entero) lo vuelve a
      // aplicar con aplicarEstadoMinimizado, en vez de perderlo.
      escribirPanelMinimizado(storageDeSesion(), !estabaOculto);
    };
    botonCerrar.onclick = () => {
      // Issue #273 — causa real del "vuelve a aparecer": antes solo
      // sacaba el nodo del DOM, sin avisarle a reescanear() que esta
      // pestaña lo cerró. Ahora, además, se marca "cerrado en esta
      // pestaña" — debeDibujarPanel (arriba) corta la parte de DIBUJO
      // de reescanear() (nunca la lectura ni los envíos, ver el
      // comentario completo de reescanear()) antes de volver a crear
      // el panel, pase lo que pase con el MutationObserver/el
      // intervalo de abajo. Se reabre solo con un clic real en el
      // ícono de la extensión (mostrarPanelPorIcono).
      escribirPanelCerrado(storageDeSesion(), true);
      hostDelPanel(panel).remove();
    };
    // Issue #273 — interruptor global, visible en TODOS los tipos de
    // panel (producto/tienda/listado — los 3 pasan por acá, ver
    // renderizarEsqueleto). El estado real vive en chrome.storage.local
    // (interruptorEncendido, variable de módulo mantenida al día por
    // chrome.storage.onChanged, al final del archivo) — acá solo se
    // refleja y se escribe, nunca se decide por su cuenta.
    if (inputInterruptor) {
      inputInterruptor.checked = interruptorEncendido;
      if (textoInterruptor) textoInterruptor.textContent = interruptorEncendido ? "Zilonix encendido" : "Zilonix apagado";
      inputInterruptor.onchange = () => {
        const encendido = inputInterruptor.checked;
        if (textoInterruptor) textoInterruptor.textContent = encendido ? "Zilonix encendido" : "Zilonix apagado";
        const storage = storageExtension();
        if (storage) {
          try {
            storage.set({ [CLAVE_INTERRUPTOR]: encendido });
          } catch {
            // contexto de la extensión invalidado — nunca rompe el panel
          }
        }
        if (!encendido) {
          // Apagar desde acá mismo esconde YA este panel en esta
          // pestaña — nunca espera al próximo tick del
          // MutationObserver/intervalo (que de todas formas ya no lo
          // volvería a dibujar solo una vez que interruptorEncendido
          // se actualice, pero este panel YA construido seguiría
          // visible hasta que algo lo saque). chrome.storage.onChanged
          // (al final del archivo) actualiza interruptorEncendido en
          // TODAS las pestañas igual — esto solo adelanta el efecto
          // visual en ESTA, sin esperar la vuelta del storage.
          hostDelPanel(panel).remove();
        }
      };
    }
  }

  // Issue #273 — renderizarEsqueleto (abajo) reconstruye panel.innerHTML
  // ENTERO en cada reescanear() (varias veces por segundo en una
  // página viva) — sin esto, "minimizado" se perdía apenas llegaba la
  // próxima mutación del DOM, que es casi inmediata. Se aplica DESPUÉS
  // de cablearEncabezado (que ya dejó el botón/cuerpo recién creados,
  // sin "hidden").
  function aplicarEstadoMinimizado(panel) {
    if (!leerPanelMinimizado(storageDeSesion())) return;
    const cuerpo = panel.querySelector(".zx-panel__cuerpo");
    const botonColapsar = panel.querySelector("[data-accion='colapsar']");
    if (cuerpo) cuerpo.setAttribute("hidden", "");
    if (botonColapsar) botonColapsar.textContent = "▸";
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

  // Parte 3, punto D ("Importar a Publicar") — mismo relevo YA
  // probado que "Completar vendidos"/"Enviar a Zilonix" (content.js ->
  // background.js -> marcador-zilonix.js -> postMessage, ver el
  // comentario completo de enviarVendidosAZilonix más abajo): nunca
  // abre una pestaña nueva, nunca navega sola — si /panel/publicar
  // (extension/marcador-zilonix.js, matches ampliado en manifest.json)
  // ya está abierto en alguna pestaña, el mensaje llega ahí; si no, el
  // broadcast simplemente no tiene ningún listener y no pasa nada
  // (mismo criterio de siempre, nunca se adivina ni se encola sin que
  // la persona lo sepa). Solo Mercado Libre tiene
  // `lector.leerGaleriaYDescripcion` (ver mercadolibre.js) — en los
  // otros 5 sitios este botón directamente no se agrega.
  function agregarBotonImportarPublicar(panel, datos) {
    if (typeof lector.leerGaleriaYDescripcion !== "function") return;
    if (!datos || !datos.titulo) return; // nada confiable que importar todavía
    const pie = panel.querySelector(".zx-panel__pie");
    const boton = document.createElement("button");
    boton.type = "button";
    boton.className = "zx-boton-seguir";
    boton.textContent = "Importar a Publicar";
    boton.onclick = () => {
      // SOLO por este clic real — mismo criterio que agregarBotonSeguir,
      // nunca se lee la galería/descripción completa al cargar la
      // página, solo cuando la persona de verdad quiere importar.
      let extra;
      try {
        extra = lector.leerGaleriaYDescripcion(document);
      } catch {
        extra = { descripcion: null, imagenes: [] };
      }
      const payload = {
        titulo: datos.titulo,
        descripcion: (extra && extra.descripcion) || null,
        precio: typeof datos.precio === "number" ? datos.precio : null,
        imagenes: (extra && extra.imagenes) || [],
      };
      if (typeof chrome === "undefined" || !chrome.runtime || !chrome.runtime.sendMessage) return;
      try {
        // Issue #44 (revisión de Pablo sobre el PR #290) — bug real
        // que Mateo reportó: "no pasó nada" en una ficha sin
        // /panel/publicar ya abierto, porque el mensaje se perdía en
        // silencio. Ahora background.js SIEMPRE abre o enfoca una
        // pestaña de Publicar — el texto del botón refleja las 2
        // etapas reales: "Abriendo Publicar…" mientras background.js
        // decide/abre/enfoca (puede tardar un instante, nunca
        // instantáneo como antes), "Enviado ✓" recién cuando confirma
        // que terminó — nunca antes, a diferencia de la versión vieja
        // que marcaba "Enviado ✓" apenas se llamaba a sendMessage, sin
        // esperar ninguna confirmación real.
        boton.textContent = "Abriendo Publicar…";
        chrome.runtime.sendMessage({ tipo: "zilonix:importar-publicar", payload }, () => {
          void chrome.runtime.lastError; // Service Worker dormido/reciclado justo en este instante — nunca un error real
          boton.textContent = "Enviado ✓";
          setTimeout(() => (boton.textContent = "Importar a Publicar"), 1500);
        });
      } catch {
        // Contexto de la extensión invalidado — nunca rompe el panel.
        boton.textContent = "Importar a Publicar";
      }
    };
    pie.appendChild(boton);
  }

  // Issue #44 (anexo "Importar video a Clip") — mismo relevo YA
  // probado que "Importar a Publicar" (arriba): content.js ->
  // background.js (que abre o enfoca /panel/publicar#clip, mismo
  // mecanismo exacto de manejarAbrirOEnfocarPublicar) ->
  // marcador-zilonix.js -> postMessage. El video SIGUE con la marca de
  // agua del sitio (Mateo lo aceptó explícitamente para las 7
  // plataformas) — nunca se intenta quitarla ni reconstruir un stream.
  // Mercado Libre puede rechazar en moderación un clip con el logo de
  // otra plataforma (documentado en extension/LEEME.md) — decisión de
  // la persona al elegir cuál video subir, no de la extensión.
  //
  // `resultadoVideo` sale de `lector.leerVideo(document)` (opcional —
  // solo lo exponen las 7 plataformas de este anexo, ver
  // lectores/video-comun.js) con la forma
  // `{candidatos: string[], huboVideoNoDescargable: boolean}`. Sin
  // ningún candidato y sin ese aviso, el botón directamente no se
  // agrega — "el botón solo aparece en páginas de producto o de video
  // donde el lector encontró al menos un video".
  function agregarBotonImportarVideo(panel, resultadoVideo) {
    if (!resultadoVideo) return;
    const pie = panel.querySelector(".zx-panel__pie");
    const candidatos = Array.isArray(resultadoVideo.candidatos) ? resultadoVideo.candidatos : [];
    if (candidatos.length === 0) {
      // Solo había un stream HLS (.m3u8) o un blob: local -- nunca se
      // reconstruye un stream, se avisa y se deja en manos de la
      // persona (descargarlo y subirlo desde el computador).
      if (resultadoVideo.huboVideoNoDescargable) {
        const aviso = document.createElement("p");
        aviso.className = "zx-vacio";
        aviso.textContent = "Este video no se puede traer, descárgalo y súbelo desde el computador.";
        pie.appendChild(aviso);
      }
      return;
    }

    // Revisión de Pablo (sobre a6fdcbd, HIGH 1) — bug real: hasta esta
    // corrección, el botón marcaba "Enviado ✓" apenas llegaba CUALQUIER
    // respuesta de background.js, sin mirar si de verdad hizo algo —
    // una URL que background.js rechaza (`{ok:false}`, última línea
    // real de defensa) terminaba mostrando éxito en silencio. Ahora
    // solo "Enviado ✓" si `respuesta.ok` es real; si no, un mensaje
    // claro en el pie del panel, nunca silencio.
    function mostrarErrorImportarVideo() {
      let aviso = pie.querySelector(".zx-video-error");
      if (!aviso) {
        aviso = document.createElement("p");
        aviso.className = "zx-vacio zx-video-error";
        pie.appendChild(aviso);
      }
      aviso.textContent = "No pude tomar ese video, prueba descargarlo y subirlo desde la computadora.";
    }

    function crearBotonVideo(url, etiqueta) {
      const boton = document.createElement("button");
      boton.type = "button";
      boton.className = "zx-boton-seguir";
      boton.textContent = etiqueta;
      boton.onclick = () => {
        if (typeof chrome === "undefined" || !chrome.runtime || !chrome.runtime.sendMessage) return;
        const payload = { url, origen: lector.sitio, paginaUrl: location.href };
        try {
          // Mismas 2 etapas reales que "Importar a Publicar": nunca
          // marca "Enviado ✓" hasta que background.js de verdad
          // confirme que abrió o enfocó /panel/publicar#clip.
          boton.textContent = "Abriendo Publicar…";
          chrome.runtime.sendMessage({ tipo: "zilonix:importar-video", payload }, (respuesta) => {
            const error = chrome.runtime.lastError; // Service Worker dormido/reciclado justo en este instante — nunca un error real
            void error;
            if (error || !respuesta || !respuesta.ok) {
              mostrarErrorImportarVideo();
              boton.textContent = etiqueta;
              return;
            }
            boton.textContent = "Enviado ✓";
            setTimeout(() => (boton.textContent = etiqueta), 1500);
          });
        } catch {
          // Contexto de la extensión invalidado — nunca rompe el panel.
          boton.textContent = etiqueta;
        }
      };
      return boton;
    }

    if (candidatos.length === 1) {
      pie.appendChild(crearBotonVideo(candidatos[0], "Importar video a Clip"));
      return;
    }

    // Más de un video encontrado en la misma página -- nunca se elige
    // uno a ciegas, la persona decide cuál (ej. una ficha con video de
    // portada Y un video de reseña, o varias calidades del mismo video).
    const lista = document.createElement("div");
    lista.className = "zx-lista-videos";
    candidatos.forEach((url, indice) => {
      lista.appendChild(crearBotonVideo(url, `Importar video ${indice + 1} a Clip`));
    });
    pie.appendChild(lista);
  }

  // Issue #273 (revisión de Pablo, punto 2) — puro (string -> string),
  // para poder probarlo sin chrome/DOM real. "Enviando a: Staging" vs.
  // "Enviando a: Producción" — el único marcador real que distingue los
  // 2 hosts de Seller (ver ORIGENES_SELLER_PERMITIDOS, extension/marcador-zilonix.js)
  // es la palabra "staging" en el subdominio — nunca hace falta una
  // lista aparte acá, alcanza con ese substring.
  function etiquetaAmbienteDeUrlApp(urlApp) {
    return typeof urlApp === "string" && urlApp.includes("staging") ? "Staging" : "Producción";
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
      <div class="zx-panel__interruptor">
        <span class="zx-panel__interruptor-texto" data-accion="interruptor-texto">Zilonix encendido</span>
        <label class="zx-interruptor" title="Encender o apagar el panel automático de Zilonix en todas las páginas">
          <input type="checkbox" class="zx-interruptor__input" data-accion="interruptor" />
          <span class="zx-interruptor__pista"><span class="zx-interruptor__perilla"></span></span>
        </label>
      </div>
      ${CONFIG ? `<p class="zx-panel__ambiente">Enviando a: ${etiquetaAmbienteDeUrlApp(CONFIG.URL_APP)}</p>` : ""}
      <div class="zx-panel__cuerpo"></div>
      <div class="zx-panel__pie">
        <button type="button" class="zx-boton-copiar">Copiar datos (CSV)</button>
      </div>
    `;
    cablearEncabezado(panel, subtituloSitio);
    aplicarEstadoMinimizado(panel);
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
    // Issue #251 (smoke de Mateo) — revisado para "/up/MCOU…" (ficha
    // "user product"): el regex de abajo NUNCA matchea "/up/" (no
    // contiene el substring literal "/p/"), así que cae al default
    // "item" — correcto a propósito: el id real de esas fichas (del
    // wid/pdp_filters, ver extraerWidDeUrl en lectores/mercadolibre.js)
    // es siempre un itemId de publicación puntual, nunca un id de
    // catálogo. Nunca hace falta un caso aparte para "/up/" acá.
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
    // Issue #251 (smoke de Mateo) — "(falta antigüedad)" explícito (no
    // el "Sin dato" bare de las otras filas): sin wid/pdp_filters/date_created
    // confirmado, nunca hay con qué interpolar — el bloque entero sigue
    // dibujándose igual (nunca se oculta), solo esta fila explica por qué.
    html += filaHtml("Antigüedad", formatoAntiguedad(dias) ?? `${SIN_DATO_APROX} (falta antigüedad)`, dias == null);
    html += filaHtml("Ventas/mes", ventasMesEst != null ? Math.round(ventasMesEst) : SIN_DATO_APROX, ventasMesEst == null);
    html += filaHtml("Facturación/mes", facturacionMesEst != null ? formatoPrecio(facturacionMesEst, datos.moneda) : SIN_DATO_APROX, facturacionMesEst == null);
    html +=
      '<p class="zx-nota-aprox">Estimado: vendidos × factor según Full/"+N" (2.2 / 1.55), llevado a "por mes" con la antigüedad real o calibrada de la publicación — nunca un dato que Mercado Libre confirme directamente.</p>';
    return html;
  }

  function renderizarProducto(panel, datos, resultadoVideo) {
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
    // Parte 3, punto D — mismo criterio: al lado de "Seguir en
    // Zilonix", nunca lo reemplaza.
    agregarBotonImportarPublicar(panel, datos);
    // Issue #44 (anexo "Importar video a Clip") — al lado de los 2
    // botones de arriba, nunca los reemplaza. Las 6 plataformas de
    // este bloque ("producto") lo exponen vía lector.leerVideo.
    agregarBotonImportarVideo(panel, resultadoVideo);
  }

  // Issue #44 (anexo "Importar video a Clip") — TikTok no es un
  // marketplace que esta extensión investigue (sin precio/vendidos/
  // vendedor que mostrar) — panel mínimo, solo el botón de importar
  // video, mismo criterio que renderizarTienda (sin nada que copiar).
  function renderizarVideo(panel, resultadoVideo) {
    const cuerpo = renderizarEsqueleto(panel, "Zilonix · Investigación", lector.sitio);
    cuerpo.innerHTML = "";
    const botonCopiar = panel.querySelector(".zx-boton-copiar");
    if (botonCopiar) botonCopiar.remove(); // nada que copiar en una página de video
    agregarBotonImportarVideo(panel, resultadoVideo);
    if (!resultadoVideo || (!resultadoVideo.candidatos.length && !resultadoVideo.huboVideoNoDescargable)) {
      panel.querySelector(".zx-panel__pie").insertAdjacentHTML("afterbegin", '<p class="zx-vacio">No se encontró ningún video en esta página.</p>');
    }
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

  // Issue #273 (revisión de Pablo, punto 1 — HIGH) — `forzado` SOLO lo
  // pasa mostrarPanelPorIcono (abajo): un clic real en el ícono fuerza
  // a `dibujarPanel` a `true` aunque el interruptor esté apagado o la
  // persona haya cerrado el panel en esta pestaña.
  //
  // `dibujarPanel` es la ÚNICA cosa que el interruptor/el cerrado por
  // pestaña deciden acá — nunca si la página se lee, nunca si los
  // envíos silenciosos corren. Bug real corregido en esta revisión:
  // antes, reescanear() entero cortaba al principio si el panel no
  // tenía que dibujarse — con el interruptor apagado o la X apretada,
  // "Completar vendidos" (enviarVendidosAZilonix/enviarInventarioFichaAZilonix)
  // y el relevo de datos de Seguimiento (enviarPublicacionesTiendaAZilonix)
  // se perdían en silencio, nunca llegaban ni a leer la página. Ahora
  // `tipo`/`lector.leerX(document)`/los `enviarXAZilonix` corren
  // SIEMPRE que haya una página reconocida — `panel` queda en `null`
  // cuando no corresponde dibujar, y cada llamada de dibujo
  // (`obtenerOCrearPanel`, `renderizarProducto`/`renderizarTienda`,
  // `manejarListadoFlotante`) se salta explícitamente con `if (panel)`
  // — nunca toca el DOM cuando no corresponde (punto 3 de la revisión,
  // MED: el MutationObserver/intervalo pueden seguir disparando
  // reescanear() todo lo que quieran, nunca hacen trabajo de dibujo
  // mientras dibujarPanel sea false).
  function reescanear(forzado) {
    let tipo;
    try {
      tipo = lector.tipoDePagina(location.href, document);
    } catch {
      tipo = null;
    }
    if (!tipo) return; // ni producto ni listado reconocido — nada que leer ni dibujar

    const dibujarPanel = Boolean(forzado) || debeDibujarPanel(interruptorEncendido, leerPanelCerrado(storageDeSesion()));
    const panel = dibujarPanel ? obtenerOCrearPanel() : null;

    try {
      if (tipo === "producto") {
        const datos = lector.leerProducto(document);
        // Issue #44 (anexo "Importar video a Clip") — opcional, igual
        // que lector.leerResenas más abajo: solo las 7 plataformas de
        // este anexo exponen lector.leerVideo (ver video-comun.js).
        // Nunca puede tirar abajo el resto de esta función si revienta.
        let resultadoVideo = null;
        if (typeof lector.leerVideo === "function") {
          try {
            resultadoVideo = lector.leerVideo(document);
          } catch {
            resultadoVideo = null;
          }
        }
        // Issue #273 (revisión de Pablo, punto 1) — try/catch PROPIO
        // para el dibujo: si renderizarProducto revienta (un selector
        // roto, mismo caso que ya cubre el catch de afuera), nunca
        // puede tirarse abajo los envíos de las líneas de abajo —
        // esos tienen que correr SIEMPRE que haya datos, sin importar
        // si el panel se pudo dibujar bien o no.
        if (panel) {
          try {
            renderizarProducto(panel, datos, resultadoVideo);
          } catch (errorDibujo) {
            console.warn("[Zilonix Investigación] no se pudo dibujar el panel:", errorDibujo);
          }
        }
        enviarVendidosAZilonix(datos);
        // Issue #251 (revisión de Pablo, punto 4) — nunca en una
        // pestaña que la propia extensión abrió para "Analizar" o
        // "Top 8 reseñas" (ver esPaginaDeEscaneoAutomatico/
        // esPaginaDeLecturaResenas, arriba). Sí se manda en cualquier
        // otra, incluidas las que abre el botón "Actualizar todo" del
        // panel de Seguimiento (window.open desde la página, nunca
        // marcadas por background.js — un clic real, igual que abrir
        // la ficha a mano) — y, desde esta revisión, también con el
        // panel sin dibujarse (interruptor apagado o pestaña cerrada):
        // "Completar vendidos" nunca depende de que el panel esté a
        // la vista.
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
        // arriba. Issue #273 — solo se llama si hay panel que dibujar;
        // `manejarListadoFlotante` SIEMPRE necesita un `panel` real
        // (termina en `renderizarListado(panel, ...)`), nunca tiene
        // sentido invocarla con `panel === null`.
        if (panel) void manejarListadoFlotante(panel);
        // Issue #231 — ya no se decide acá mismo con esta UNA lectura
        // sincrónica (ver manejarEscaneoAutomatico/esperarListadoEstable
        // arriba: el bug real era mandar 0 candidatos antes de que el
        // sitio terminara de renderizar). Esto sigue dependiendo del
        // mismo marcador de siempre (`_zilonix_escaneo=1`) y del mismo
        // flag de un solo envío — solo que la decisión de QUÉ mandar
        // ahora espera a que el listado se estabilice. Issue #273 —
        // SIEMPRE independiente de `dibujarPanel`: estas son pestañas
        // que la propia extensión abrió tras un clic real en
        // "Analizar" — el interruptor de ESTA pestaña nunca puede
        // cancelar un escaneo que la persona ya autorizó desde el panel.
        if (esPaginaDeEscaneoAutomatico() && !yaEnviadoEscaneoAutomatico) {
          void manejarEscaneoAutomatico();
        }
      } else if (tipo === "tienda" && lector.leerTienda) {
        const datosTienda = lector.leerTienda(document);
        // Issue #273 — mismo try/catch propio que el bloque "producto".
        if (panel) {
          try {
            renderizarTienda(panel, datosTienda);
          } catch (errorDibujo) {
            console.warn("[Zilonix Investigación] no se pudo dibujar el panel:", errorDibujo);
          }
        }
        // Issue #251 (revisión de Pablo, punto 4) — mismo criterio que
        // el bloque "producto", arriba — y, desde esta revisión,
        // también independiente de `dibujarPanel`.
        if (!esPaginaDeEscaneoAutomatico() && !esPaginaDeLecturaResenas()) {
          enviarPublicacionesTiendaAZilonix(datosTienda);
        }
      } else if (tipo === "video" && typeof lector.leerVideo === "function") {
        // Issue #44 (anexo "Importar video a Clip") — TikTok, hoy la
        // única plataforma con este `tipo` (ver lectores/tiktok.js).
        // Nunca lee/envía nada más acá: TikTok no es un marketplace
        // que esta extensión investigue, este tipo existe SOLO para
        // ofrecer el botón de importar video.
        const resultadoVideo = lector.leerVideo(document);
        if (panel) {
          try {
            renderizarVideo(panel, resultadoVideo);
          } catch (errorDibujo) {
            console.warn("[Zilonix Investigación] no se pudo dibujar el panel:", errorDibujo);
          }
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

  // Issue #273 — clic real en el ícono de la extensión
  // (chrome.action.onClicked, background.js) -> "zilonix:mostrar-panel"
  // acá. SIEMPRE muestra el panel en ESTA pestaña, aunque el
  // interruptor global esté apagado o la persona lo haya cerrado antes
  // en esta misma pestaña: es la forma explícita de "quiero usarlo
  // ahora", un clic real de la persona (nunca automático). Limpia los
  // 2 estados por pestaña (cerrado/minimizado) antes de forzar el
  // reescaneo, para que quede abierto Y desplegado, nunca minimizado
  // de una vez anterior.
  function mostrarPanelPorIcono() {
    const storage = storageDeSesion();
    escribirPanelCerrado(storage, false);
    escribirPanelMinimizado(storage, false);
    reescanear(true);
  }

  // Issue #273 (revisión de Pablo, punto 4 — LOW) — puro, separado a
  // propósito para poder probarlo sin chrome real. `chrome.runtime.onMessage`
  // puede, en teoría, recibir un mensaje de OTRA extensión instalada
  // (Chrome permite mensajería entre extensiones con `externally_connectable`/
  // `chrome.runtime.sendMessage(idDeOtraExtension, ...)`) — nunca confiar
  // en el `tipo` del mensaje solo. `remitente.id` lo pone Chrome mismo
  // (nunca se puede falsificar desde quien manda el mensaje) — mismo
  // criterio que ya usa background.js con `remitente.tab.url` para
  // "zilonix:abrir-seguimientos".
  function esMensajeDePropiaExtension(remitente, idPropio) {
    return Boolean(remitente) && remitente.id === idPropio;
  }

  // Issue #44 (anexo, "Importar publicación desde un link") —
  // background.js abre esta pestaña (chrome.tabs.create, siempre
  // active:false) solo para LEER y cerrarla — el panel NUNCA se
  // dibuja acá, la persona nunca la ve. Si reescanear() (el arranque
  // normal de esta misma página) ya alcanzó a dibujar un panel antes
  // de que llegue este mensaje — carrera posible, nunca garantizada —
  // se saca del DOM antes de leer, para que "el panel no se dibuja en
  // esa pestaña" sea cierto sin importar el orden real de los eventos.
  function sacarPanelSiExiste() {
    if (typeof document === "undefined" || typeof document.getElementById !== "function") return;
    const host = document.getElementById(PANEL_ID);
    if (host && typeof host.remove === "function") host.remove();
  }

  function enviarResultadoLeerParaImportar(payload) {
    if (typeof chrome === "undefined" || !chrome.runtime || !chrome.runtime.sendMessage) return;
    try {
      chrome.runtime.sendMessage({ tipo: "zilonix:resultado-leer-para-importar", payload }, () => {
        void chrome.runtime.lastError; // la pestaña solicitante pudo cerrarse justo antes — nunca un error real
      });
    } catch {
      // Contexto de la extensión invalidado — nunca rompe nada.
    }
  }

  // Issue #44 — único marcador CONFIRMABLE de "Mercado Libre pide
  // iniciar sesión/verificar" sin poder confirmar en vivo contra
  // Mercado Libre hoy (a diferencia de Alibaba, "Captcha Interception",
  // confirmado por Cowork — ver detectarFullEnHtmlFicha/el resto de
  // este archivo): el subdominio REAL de cuentas de Mercado Libre
  // (accounts.mercadolibre.*/accounts.mercadolivre.*, el mismo
  // criterio "accounts.<dominio>" que usan Google y la mayoría de
  // sitios grandes) — si la pestaña de lectura termina ahí, NUNCA se
  // intenta pasar el login/captcha, se avisa como tal. Cualquier OTRO
  // fallo de lectura (tipoDePagina no reconoce nada, leerProducto no
  // trae título) se reporta como un fallo genérico — nunca se inventa
  // que fue específicamente un captcha sin poder confirmarlo.
  function esPaginaDeCuentasMl() {
    return typeof location !== "undefined" && typeof location.hostname === "string" && /(^|\.)accounts\.mercado(libre|livre)\.com/i.test(location.hostname);
  }

  // Issue #44 — la lectura real para "Importar publicación desde un
  // link": mismo par de funciones que ya usa el botón "Importar a
  // Publicar" (leerProducto + leerGaleriaYDescripcion, issue #44
  // original) — nunca duplicadas, solo reunidas en el MISMO payload
  // {titulo, descripcion, precio, imagenes} que ya entiende
  // itemImportadoDesdeMensajeExtension del lado de la página (el
  // resultado viaja de vuelta como "zilonix:importar-publicar", el
  // MISMO tipo de mensaje de siempre — background.js, no esta
  // función, decide eso). Con un pequeño retardo (RETARDO_REESCANEO_MS,
  // el mismo que usa reescanearConRetardo) antes de leer: "complete"
  // (lo que espera background.js antes de mandar este mensaje) no
  // garantiza que Mercado Libre ya terminó de hidratar el precio/título
  // si la ficha los arma con JS después de cargar.
  function leerParaImportar() {
    sacarPanelSiExiste();

    if (esPaginaDeCuentasMl()) {
      enviarResultadoLeerParaImportar({ captcha: true });
      return;
    }

    let tipo;
    try {
      tipo = lector.tipoDePagina(location.href, document);
    } catch {
      tipo = null;
    }
    // tipoDePagina ya reconoce producto/articulo/p//up/ por igual (ver
    // issue #251) — un link de catálogo o /up/ llega acá exactamente
    // igual que uno de publicación puntual, sin ningún caso aparte.
    if (tipo !== "producto") {
      enviarResultadoLeerParaImportar({});
      return;
    }

    let datos;
    try {
      datos = lector.leerProducto(document);
    } catch {
      datos = null;
    }
    if (!datos || !datos.titulo) {
      enviarResultadoLeerParaImportar({});
      return;
    }

    let extra = { descripcion: null, imagenes: [] };
    if (typeof lector.leerGaleriaYDescripcion === "function") {
      try {
        extra = lector.leerGaleriaYDescripcion(document) || extra;
      } catch {
        // se sigue con lo que sí se pudo leer — nunca revienta
      }
    }

    enviarResultadoLeerParaImportar({
      datos: {
        titulo: datos.titulo,
        descripcion: (extra && extra.descripcion) || null,
        precio: typeof datos.precio === "number" ? datos.precio : null,
        imagenes: (extra && extra.imagenes) || [],
      },
    });
  }

  // Issue #273 — registrados ANTES de leerInterruptorInicial (abajo) a
  // propósito: un clic en el ícono, o un cambio del interruptor desde
  // OTRA pestaña, tienen que funcionar aunque la lectura inicial de
  // chrome.storage.local todavía no haya vuelto (interruptorEncendido
  // sigue en su default `true` hasta entonces, un valor razonable).
  // typeof chrome !== "undefined" — mismo criterio que
  // enviarVendidosAZilonix y el resto de este archivo: en vitest
  // (content.test.ts) `chrome` es `undefined`, nunca revienta el import.
  if (typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.onMessage) {
    chrome.runtime.onMessage.addListener((mensaje, remitente, sendResponse) => {
      if (!esMensajeDePropiaExtension(remitente, chrome.runtime.id)) return;
      if (mensaje && mensaje.tipo === "zilonix:mostrar-panel") mostrarPanelPorIcono();
      if (mensaje && mensaje.tipo === "zilonix:leer-para-importar") setTimeout(leerParaImportar, RETARDO_REESCANEO_MS);
      // Issue #44 (fix real, confirmado en staging) — background.js
      // NUNCA puede leer `tab.url` sin el permiso "tabs" ni
      // host_permissions (que esta extensión NO tiene, a propósito —
      // ver extension/LEEME.md): hasta este arreglo, "Traer datos de
      // ese link" cortaba con "no_es_mercadolibre" para TODO link,
      // porque `tabActualizada.url` llegaba siempre vacío. En vez de
      // ese permiso nuevo, background.js le pide la URL real a ESTA
      // pestaña con un mensaje — síncrono, `location.href` siempre
      // está disponible apenas el content script corre.
      if (mensaje && mensaje.tipo === "zilonix:sonar-url-importar") {
        if (typeof sendResponse === "function") sendResponse({ href: location.href });
        return;
      }
    });
  }
  if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.onChanged) {
    chrome.storage.onChanged.addListener((cambios, area) => {
      if (area !== "local" || !cambios[CLAVE_INTERRUPTOR]) return;
      interruptorEncendido = valorInterruptorDesdeStorage(cambios[CLAVE_INTERRUPTOR].newValue);
      // Se prendió desde OTRA pestaña (o desde el propio switch de
      // esta, ver cablearEncabezado) -> no esperar al próximo tick del
      // MutationObserver/intervalo para que se note acá también.
      if (interruptorEncendido) reescanearConRetardo();
    });
  }

  // Issue #273 — lee el interruptor UNA vez al cargar esta página, y
  // recién AHÍ arranca reescanear()/el MutationObserver/el intervalo —
  // nunca antes: evitar un parpadeo real (panel dibujado y sacado de
  // encima medio segundo después si el interruptor resulta estar
  // apagado). Sin chrome.storage.local disponible (vitest, o la
  // extensión con el contexto invalidado), sigue con el default `true`
  // de siempre — comportamiento idéntico al de antes de esta tarea.
  function leerInterruptorInicial(continuar) {
    const storage = storageExtension();
    if (!storage) {
      continuar();
      return;
    }
    try {
      storage.get({ [CLAVE_INTERRUPTOR]: true }, (datos) => {
        interruptorEncendido = valorInterruptorDesdeStorage(datos[CLAVE_INTERRUPTOR]);
        continuar();
      });
    } catch {
      continuar();
    }
  }

  leerInterruptorInicial(() => {
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
  });

  // Issue #251 (fix "aproximados siempre visibles") — mismo patrón
  // dual que extension/lectores/aproximados.js: en el navegador real
  // no existe `module`, así que esto nunca corre ahí; en Node
  // (vitest, content.test.ts) permite probar bloqueAnalisisAproximado
  // (la función pura detrás del bloque "Análisis aprox.") sin un DOM
  // real — nunca se exporta nada que dependa de document/chrome.
  // Issue #273 — suma las funciones puras del interruptor/cerrado-por-
  // pestaña/minimizado-por-pestaña, mismo criterio (reciben el storage
  // como parámetro, nunca leen sessionStorage/chrome.storage directo).
  if (typeof module !== "undefined" && module.exports) {
    module.exports = {
      bloqueAnalisisAproximado,
      tipoIdDePagina,
      valorInterruptorDesdeStorage,
      debeDibujarPanel,
      leerPanelCerrado,
      escribirPanelCerrado,
      leerPanelMinimizado,
      escribirPanelMinimizado,
      esMensajeDePropiaExtension,
      etiquetaAmbienteDeUrlApp,
      esPaginaDeCuentasMl,
    };
  }
})();
