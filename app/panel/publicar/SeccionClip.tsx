"use client";

import { useEffect, useRef, useState } from "react";
import { Boton } from "@/components/marco/Boton";
import { Campo } from "@/components/marco/Campo";
import { Chip, type EstadoChip } from "@/components/marco/Chip";
import { Tarjeta } from "@/components/marco/Tarjeta";
import { Tabla, FilaTabla, CeldaTabla } from "@/components/marco/Tabla";
import { msDeReintento429 } from "@/lib/ml/reintento-429";
import { etiquetaModeracionClip, INTERVALO_ESPACIADO_MODERACION_MS, proximoIntervaloModeracionMs, sigueConsultandoModeracion } from "./clip/estado-moderacion";
import { leerMetadatosDeVideoElement } from "./clip/leerMetadatosVideo";
import { mensajeErrorClip } from "./clip/mensajes-error";
import { advertenciaNoPuedeSubirClip, MENSAJE_LEYENDO_VIDEO_CLIP, razonesNoPuedeSubirClip } from "./clip/razon-no-subir";
import { urlDeMensajeExtensionVideo } from "./clip/recibir-mensaje-extension";
import type { ClipMlCliente, EstadoCuentaClipCliente, FilaBusquedaClipCliente, FilaEstadoClipCliente, TrabajoClipCliente } from "./clip/tipos-cliente";
import { formatoTamanoClip } from "./clip/validacion-video-cliente";
import type { Cuenta } from "./CuentasDestino";
import styles from "./publicar.module.css";

// Rama mateo/clip-estado-automatico (Alcance A) — ritmo de polling
// automático del estado de moderación, ver app/panel/publicar/clip/estado-moderacion.ts
// para los números elegidos y por qué. CONCURRENCIA no aplica acá: cada
// cuenta en moderación programa su propio setTimeout independiente.

type OrigenVideo = "computador" | "link" | "sku-propio" | "extension" | "canva";

type VideoListo = { contentType: string; tamanoBytes: number } & ({ tipo: "archivo"; archivo: File } | { tipo: "temporal"; tempVideoId: string; streamUrl: string });

const TIPOS_VIDEO_ACEPTADOS = "video/mp4,video/quicktime,video/mpeg,video/x-msvideo";

const ETIQUETA_ESTADO_TRABAJO: Record<EstadoCuentaClipCliente, string> = {
  en_cola: "En cola",
  subiendo: "Subiendo",
  en_moderacion: "En moderación",
  publicado: "Publicado",
  rechazado: "Rechazado",
  error: "Error",
};

const CHIP_ESTADO_TRABAJO: Record<EstadoCuentaClipCliente, EstadoChip> = {
  en_cola: "neutro",
  subiendo: "aviso",
  en_moderacion: "aviso",
  publicado: "exito",
  rechazado: "peligro",
  error: "peligro",
};

// Punto 1 del pedido — "Desde un link"/"por SKU propio"/"desde la
// extensión" terminan todas en el mismo archivo intermedio del lado
// del servidor (POST /api/ml/clip/traer-video); solo cambia QUIÉN
// escribió la URL (el campo "Traer", o un mensaje de la extensión).
async function traerVideoDesdeLinkReal(url: string): Promise<VideoListo | { error: string }> {
  const res = await fetch("/api/ml/clip/traer-video", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url }) });
  const body = await res.json();
  if (!res.ok) return { error: body.error ?? "error_desconocido" };
  return { tipo: "temporal", tempVideoId: body.tempVideoId, streamUrl: body.streamUrl, contentType: body.contentType, tamanoBytes: body.byteLength };
}

// Rama feat-publicar-clip — reemplaza por completo la versión de la
// tarea 2.11 (una cuenta, un <form> que posteaba directo a
// app/api/ml/clip/route.ts y volvía con un redirect). Ahora todo el
// flujo vive en el cliente: busca por SKU en TODAS las cuentas,
// revisa el video antes de subir, sube a varias cuentas a la vez y
// consulta el progreso con polling — ver los 6 endpoints nuevos bajo
// app/api/ml/clip/.
export function SeccionClip({ cuentas }: { cuentas: Cuenta[] }) {
  const [origen, setOrigen] = useState<OrigenVideo>("computador");
  const [video, setVideo] = useState<VideoListo | null>(null);
  const previewUrlRef = useRef<string | null>(null);
  const [previewSrc, setPreviewSrc] = useState<string | null>(null);
  const [metadatos, setMetadatos] = useState<{ duracionSegundos: number; ancho: number; alto: number } | null>(null);
  // El navegador no pudo decodificar este video (onError del <video>,
  // o pasó el timeout sin loadedmetadata) — metadatos queda en null
  // PARA SIEMPRE en ese caso. Caso real (staging, cuenta de Débora): un
  // MP4 de 11MB que Mercado Libre SÍ acepta pero Chrome no decodifica
  // (códec ilegible) — esto ya NO bloquea subir (era un fallo nuestro,
  // no de Mercado Libre); solo dispara un aviso informativo, ver
  // advertenciaNoPuedeSubirClip.
  const [errorCodec, setErrorCodec] = useState(false);
  const metadatosRef = useRef(metadatos);
  useEffect(() => {
    metadatosRef.current = metadatos;
  }, [metadatos]);
  const [errorOrigen, setErrorOrigen] = useState<string | null>(null);
  const [linkUrl, setLinkUrl] = useState("");
  const [trayendo, setTrayendo] = useState(false);

  const [sku, setSku] = useState("");
  const [buscando, setBuscando] = useState(false);
  const [filas, setFilas] = useState<FilaBusquedaClipCliente[]>([]);
  const [erroBusqueda, setErrorBusqueda] = useState<string | null>(null);
  const [marcadas, setMarcadas] = useState<Record<string, boolean>>({});
  const [overridesAbiertos, setOverridesAbiertos] = useState<Record<string, boolean>>({});
  const [overrideArchivos, setOverrideArchivos] = useState<Record<string, File>>({});

  const [subiendo, setSubiendo] = useState(false);
  const [errorSubida, setErrorSubida] = useState<string | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const [trabajo, setTrabajo] = useState<TrabajoClipCliente | null>(null);
  const [actualizandoEstado, setActualizandoEstado] = useState(false);
  // Alcance A — último clip conocido de Mercado Libre por item
  // (cuentaId:itemId), o null mientras no se sabe nada todavía (nunca
  // se inventa "Publicado" para ese caso, ver etiquetaModeracionClip).
  const [moderacionPorItem, setModeracionPorItem] = useState<Record<string, ClipMlCliente | null>>({});
  // Cuándo entró cada item a "en_moderacion" (para el ritmo de
  // polling) y el setTimeout en vuelo de cada uno — en refs porque solo
  // los lee el propio efecto de polling, nunca el render.
  const entradaModeracionTsRef = useRef<Record<string, number>>({});
  const timersModeracionRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  // El video de "desde el computador" se previsualiza con un Object
  // URL local — se revoca siempre al reemplazarlo (otro origen, otro
  // archivo) o al desmontar, para no dejar memoria del navegador
  // pisada entre un video de 280MB y el siguiente.
  function fijarVideo(nuevo: VideoListo | null, nuevoPreviewSrc: string | null) {
    if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
    previewUrlRef.current = nuevo?.tipo === "archivo" && nuevoPreviewSrc ? nuevoPreviewSrc : null;
    setVideo(nuevo);
    setPreviewSrc(nuevoPreviewSrc);
    setMetadatos(null);
    setErrorCodec(false);
  }

  // Alcance B — si el <video> no dispara "loadedmetadata" en este
  // tiempo (preview negra, códec que Chrome no decodifica — caso real
  // confirmado por captura), se avisa en vez de dejar el botón apagado
  // en silencio para siempre. Se reinicia cada vez que cambia el video
  // (otro archivo, otro origen); si llega a cargar después, el propio
  // onLoadedMetadata limpia errorCodec.
  const TIMEOUT_CODEC_MS = 5000;
  useEffect(() => {
    if (!previewSrc) return;
    const id = setTimeout(() => {
      if (metadatosRef.current === null) setErrorCodec(true);
    }, TIMEOUT_CODEC_MS);
    return () => clearTimeout(id);
  }, [previewSrc]);

  useEffect(
    () => () => {
      if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
    },
    []
  );

  async function traer(url: string) {
    setErrorOrigen(null);
    setTrayendo(true);
    try {
      const resultado = await traerVideoDesdeLinkReal(url);
      if ("error" in resultado) {
        setErrorOrigen(mensajeErrorClip(resultado.error));
        return;
      }
      fijarVideo(resultado, resultado.tipo === "temporal" ? resultado.streamUrl : null);
    } finally {
      setTrayendo(false);
    }
  }

  // Punto 1 — "desde la extensión": un receptor de postMessage listo,
  // nunca confía en el payload a ciegas (mismo criterio que ya usa
  // PaginaPublicar.tsx para "importar-publicar") y pasa por el MISMO
  // flujo de "Traer" que el campo de link manual.
  useEffect(() => {
    function alRecibirMensaje(evento: MessageEvent) {
      // `evento.source !== window` es identidad de objeto del DOM —
      // no se puede probar sin un navegador real, queda inline (mismo
      // criterio que el receptor de "importar-publicar" en
      // PaginaPublicar.tsx). El resto (origin ya resuelto a texto,
      // forma del payload) es urlDeMensajeExtensionVideo, puro y
      // probado en recibir-mensaje-extension.test.ts.
      if (evento.source !== window) return;
      const url = urlDeMensajeExtensionVideo(evento.origin, window.location.origin, evento.data);
      if (!url) return;
      setOrigen("extension");
      setLinkUrl(url);
      void traer(url);
    }
    window.addEventListener("message", alRecibirMensaje);
    return () => window.removeEventListener("message", alRecibirMensaje);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- el listener se monta una sola vez; traer() se lee por clausura, no como dependencia
  }, []);

  function alElegirOrigen(nuevo: OrigenVideo) {
    setOrigen(nuevo);
    setErrorOrigen(null);
    fijarVideo(null, null);
  }

  function alElegirArchivoComputador(archivo: File | undefined) {
    if (!archivo) return;
    const url = URL.createObjectURL(archivo);
    fijarVideo({ tipo: "archivo", archivo, contentType: archivo.type, tamanoBytes: archivo.size }, url);
  }

  async function buscarSku() {
    if (!sku.trim()) return;
    setBuscando(true);
    setErrorBusqueda(null);
    try {
      const res = await fetch("/api/ml/clip/buscar-sku", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sku: sku.trim() }) });
      const body = await res.json();
      if (!res.ok) {
        setErrorBusqueda(body.error ?? "No se pudo buscar el SKU.");
        setFilas([]);
        return;
      }
      setFilas(body.filas);
      // Por defecto quedan marcadas solo las cuentas con match activo
      // (punto 3 del pedido) — nunca todas, nunca ninguna a ciegas.
      const nuevasMarcadas: Record<string, boolean> = {};
      for (const fila of body.filas as FilaBusquedaClipCliente[]) nuevasMarcadas[fila.cuentaId] = fila.activo;
      setMarcadas(nuevasMarcadas);
    } finally {
      setBuscando(false);
    }
  }

  function marcarTodas(valor: boolean) {
    const nuevo: Record<string, boolean> = {};
    for (const fila of filas) nuevo[fila.cuentaId] = valor && fila.activo;
    setMarcadas(nuevo);
  }

  const filasElegidas = filas.filter((f) => f.activo && marcadas[f.cuentaId]);

  // Alcance B — una sola lista de razones por las que el botón sigue
  // apagado (nunca en silencio, ver razon-no-subir.ts). `puedeSubir`
  // sigue siendo su propio booleano explícito (no solo "razones.length
  // === 0"): mientras `subiendo` es true, razonesNoPuedeSubirClip
  // devuelve [] a propósito (el botón ya dice "Subiendo…", no hace
  // falta otra razón) — pero el botón tiene que seguir deshabilitado.
  // metadatos del estado no trae tamanoBytes (viene del <video>, nunca
  // de File.size) — se completa acá con el del video elegido, mismo
  // criterio que ya usaba el `problemas` original de esta pantalla.
  const metadatosCompletos = metadatos && video ? { ...metadatos, tamanoBytes: video.tamanoBytes } : null;
  const razonesNoPuedeSubir = razonesNoPuedeSubirClip({
    tieneVideo: Boolean(video),
    tamanoBytes: video?.tamanoBytes ?? null,
    metadatos: metadatosCompletos,
    errorCodec,
    hayCuentaMarcada: filasElegidas.length > 0,
    subiendo,
  });
  // metadatos !== null || errorCodec: un códec ilegible nunca va a
  // disparar loadedmetadata — no esperarlo para siempre (ver
  // razonesNoPuedeSubirClip, que ya deja de bloquear en ese caso).
  const puedeSubir = !subiendo && Boolean(video) && (metadatos !== null || errorCodec) && filasElegidas.length > 0 && razonesNoPuedeSubir.length === 0;
  const advertenciaCodec = advertenciaNoPuedeSubirClip({ errorCodec, metadatos: metadatosCompletos });

  async function subir() {
    if (!video) return;
    setSubiendo(true);
    setErrorSubida(null);
    try {
      const form = new FormData();
      form.append("cuentas", JSON.stringify(filasElegidas.map((f) => ({ cuentaId: f.cuentaId, itemId: f.itemId }))));
      if (video.tipo === "archivo") form.append("archivo", video.archivo);
      else form.append("tempVideoId", video.tempVideoId);
      for (const fila of filasElegidas) {
        const override = overrideArchivos[fila.cuentaId];
        if (override) form.append(`archivo_${fila.cuentaId}`, override);
      }

      const res = await fetch("/api/ml/clip", { method: "POST", body: form });
      const body = await res.json();
      if (!res.ok) {
        setErrorSubida(body.error ?? "error_desconocido");
        return;
      }
      setJobId(body.jobId);
    } finally {
      setSubiendo(false);
    }
  }

  // Polling (punto 4 del pedido) — consulta apenas arranca el trabajo
  // y después cada 3s, hasta que termine (terminadoTs ya no es null).
  useEffect(() => {
    if (!jobId) return;
    let activo = true;
    async function consultar() {
      const res = await fetch(`/api/ml/clip/trabajo/${jobId}`);
      if (!activo || !res.ok) return;
      const body = await res.json();
      setTrabajo(body.trabajo);
    }
    void consultar();
    const id = setInterval(() => {
      void consultar();
    }, 3000);
    return () => {
      activo = false;
      clearInterval(id);
    };
  }, [jobId]);

  // Alcance A — una sola cuenta, una sola consulta a POST
  // /api/ml/clip/estado. 429 real de Mercado Libre (limiteMl, ver
  // app/api/ml/clip/estado/route.ts): nunca se reintenta a ciegas —
  // msDeReintento429 combina el Retry-After real (si vino) con el
  // backoff espaciado de siempre. PUBLISHED/REJECTED (sigueConsultandoModeracion
  // en false): no se vuelve a programar nada, la cuenta queda quieta
  // para siempre — así se cumple "detener el polling entero" en cuanto
  // todas las cuentas de la sesión llegan a un estado final: ninguna
  // vuelve a tener un timer pendiente.
  function key(cuentaId: string, itemId: string): string {
    return `${cuentaId}:${itemId}`;
  }

  function programarProximaConsultaModeracion(cuentaId: string, itemId: string, esperaMs: number) {
    const k = key(cuentaId, itemId);
    if (timersModeracionRef.current[k]) clearTimeout(timersModeracionRef.current[k]);
    timersModeracionRef.current[k] = setTimeout(() => void consultarEstadoModeracion(cuentaId, itemId), esperaMs);
  }

  async function consultarEstadoModeracion(cuentaId: string, itemId: string) {
    const k = key(cuentaId, itemId);
    delete timersModeracionRef.current[k];
    let res: Response;
    try {
      res = await fetch("/api/ml/clip/estado", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items: [{ cuentaId, itemId }] }),
      });
    } catch {
      programarProximaConsultaModeracion(cuentaId, itemId, INTERVALO_ESPACIADO_MODERACION_MS);
      return;
    }
    if (res.status === 429) {
      const body = (await res.json().catch(() => ({}))) as { retryAfterMs?: number | null };
      programarProximaConsultaModeracion(cuentaId, itemId, msDeReintento429(INTERVALO_ESPACIADO_MODERACION_MS, body.retryAfterMs ?? null));
      return;
    }
    if (!res.ok) {
      programarProximaConsultaModeracion(cuentaId, itemId, INTERVALO_ESPACIADO_MODERACION_MS);
      return;
    }
    const body = await res.json();
    const fila = (body.filas as FilaEstadoClipCliente[] | undefined)?.[0];
    if (fila?.limiteMl) {
      programarProximaConsultaModeracion(cuentaId, itemId, msDeReintento429(INTERVALO_ESPACIADO_MODERACION_MS, fila.retryAfterMs ?? null));
      return;
    }
    const clip = fila?.clips?.[0] ?? null;
    setModeracionPorItem((actual) => ({ ...actual, [k]: clip }));
    if (!sigueConsultandoModeracion(clip?.moderationStatus ?? null)) return; // PUBLISHED/REJECTED — se para de consultar esta cuenta

    const entrada = entradaModeracionTsRef.current[k] ?? Date.now();
    const proximo = proximoIntervaloModeracionMs(Date.now() - entrada);
    if (proximo == null) return; // tope de 48h alcanzado — se deja de consultar esta cuenta
    programarProximaConsultaModeracion(cuentaId, itemId, proximo);
  }

  // Apenas el polling de progreso (arriba) ve una cuenta nueva en
  // "en_moderacion", arranca su seguimiento — primera consulta
  // inmediata, nunca espera los primeros 60s. `entradaModeracionTsRef`
  // evita re-arrancar una cuenta que ya se está siguiendo (el objeto
  // `trabajo` llega nuevo cada 3s, aunque nada haya cambiado).
  useEffect(() => {
    if (!trabajo) return;
    for (const c of trabajo.cuentas) {
      if (c.estado !== "en_moderacion") continue;
      const k = key(c.cuentaId, c.itemId);
      if (entradaModeracionTsRef.current[k] != null) continue;
      entradaModeracionTsRef.current[k] = Date.now();
      void consultarEstadoModeracion(c.cuentaId, c.itemId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- consultarEstadoModeracion se recrea cada render; solo nos importa reaccionar a trabajo
  }, [trabajo]);

  // Limpia todo timer en vuelo al desmontar — nunca un setTimeout
  // disparando fetch() sobre un componente que ya no existe.
  useEffect(
    () => () => {
      for (const id of Object.values(timersModeracionRef.current)) clearTimeout(id);
    },
    []
  );

  // "Consultar ahora" (antes "Actualizar estado") — manual, opcional:
  // el flujo normal ya no depende de este botón. Reusa la misma
  // consultarEstadoModeracion (mismo manejo de 429), solo que la
  // dispara ya mismo en vez de esperar su próximo horario.
  async function consultarAhora() {
    if (!trabajo) return;
    const candidatos = trabajo.cuentas.filter((c) => c.estado === "en_moderacion" || c.estado === "publicado" || c.estado === "rechazado");
    if (candidatos.length === 0) return;
    setActualizandoEstado(true);
    try {
      await Promise.all(
        candidatos.map((c) => {
          const k = key(c.cuentaId, c.itemId);
          if (entradaModeracionTsRef.current[k] == null) entradaModeracionTsRef.current[k] = Date.now();
          return consultarEstadoModeracion(c.cuentaId, c.itemId);
        })
      );
    } finally {
      setActualizandoEstado(false);
    }
  }

  return (
    <Tarjeta className={styles.seccion}>
      <div id="clip" />
      <p className="zx-etiqueta">Publicar clip (video)</p>
      <p style={{ fontSize: 13, color: "var(--texto-suave)", marginTop: 8 }}>
        Requisitos reales de Mercado Libre: 10–61 segundos, vertical, mínimo 360×640, máx. 280MB, formato MP4/MOV/MPEG/AVI. Mercado Libre
        modera el video (24–48h) antes de que quede visible — esto solo confirma que quedó recibido.
      </p>

      {/* --- Origen del video (punto 1) --- */}
      <div style={{ display: "flex", gap: 8, marginTop: 14, flexWrap: "wrap" }}>
        {([
          ["computador", "Desde el computador"],
          ["link", "Desde un link"],
          ["sku-propio", "Reusar de mis cuentas"],
          ["extension", "Desde la extensión"],
        ] as [OrigenVideo, string][]).map(([valor, etiqueta]) => (
          <Boton key={valor} type="button" variante={origen === valor ? "primario" : "secundario"} chico onClick={() => alElegirOrigen(valor)}>
            {etiqueta}
          </Boton>
        ))}
        <Boton type="button" variante="secundario" chico disabled title="Todavía no hay conexión con Canva">
          Desde Canva (próximamente)
        </Boton>
      </div>

      {origen === "computador" && (
        <Campo etiqueta="Video (MP4/MOV/MPEG/AVI, 10-61 segundos, vertical, mín. 360×640, máx. 280MB)">
          <input
            type="file"
            accept={TIPOS_VIDEO_ACEPTADOS}
            className="zx-control"
            onChange={(e) => alElegirArchivoComputador(e.target.files?.[0])}
          />
        </Campo>
      )}

      {origen === "link" && (
        <div style={{ display: "flex", gap: 8, marginTop: 10, alignItems: "flex-end" }}>
          <Campo etiqueta="Link del video (Mercado Libre, Amazon, Temu, AliExpress, Alibaba, Shein o Canva)">
            <input value={linkUrl} onChange={(e) => setLinkUrl(e.target.value)} className="zx-control" placeholder="https://..." />
          </Campo>
          <Boton type="button" variante="secundario" chico disabled={!linkUrl.trim() || trayendo} onClick={() => traer(linkUrl.trim())}>
            {trayendo ? "Trayendo…" : "Traer"}
          </Boton>
        </div>
      )}

      {origen === "sku-propio" && (
        <p style={{ marginTop: 10, fontSize: 13, color: "var(--texto-suave)" }}>
          Busca el SKU abajo. Si alguna de tus cuentas ya tiene un Clip subido para esa publicación, la fila lo va a decir — Mercado Libre no
          entrega el archivo del video para reutilizarlo automáticamente, así que de todas formas hay que subirlo desde el computador o un
          link.
        </p>
      )}

      {origen === "extension" && !video && (
        <p style={{ marginTop: 10, fontSize: 13, color: "var(--texto-suave)" }}>Esperando que la extensión envíe un video…</p>
      )}

      {errorOrigen && <p style={{ marginTop: 10, color: "var(--kpi-peligro-texto)", fontSize: 14 }}>{errorOrigen}</p>}

      {/* Alcance B — siempre visible apenas hay un video elegido, sin
          esperar metadatos: File.size (tamanoBytes) ya está disponible
          de una. */}
      {video && <p style={{ marginTop: 10, fontSize: 13, color: "var(--texto-suave)" }}>{formatoTamanoClip(video.tamanoBytes)}</p>}

      {previewSrc && (
        <div style={{ marginTop: 14 }}>
          <video
            src={previewSrc}
            controls
            style={{ maxWidth: 220, maxHeight: 390, display: "block" }}
            onError={() => setErrorCodec(true)}
            onLoadedMetadata={(e) => {
              if (!video) return;
              setErrorCodec(false);
              const m = leerMetadatosDeVideoElement(e.currentTarget, video.tamanoBytes);
              setMetadatos({ duracionSegundos: m.duracionSegundos, ancho: m.ancho, alto: m.alto });
            }}
          />
        </div>
      )}

      {/* Alcance B — la razón exacta por la que el botón de abajo sigue
          apagado (nunca en silencio). No se muestra mientras sube
          (razonesNoPuedeSubir ya vuelve [] en ese caso). */}
      {!subiendo && razonesNoPuedeSubir.length > 0 && razonesNoPuedeSubir[0] !== MENSAJE_LEYENDO_VIDEO_CLIP && (
        <ul style={{ marginTop: 8, color: "var(--kpi-peligro-texto)", fontSize: 13 }}>
          {razonesNoPuedeSubir.map((razon) => (
            <li key={razon}>{razon}</li>
          ))}
        </ul>
      )}
      {!subiendo && razonesNoPuedeSubir[0] === MENSAJE_LEYENDO_VIDEO_CLIP && (
        <p style={{ marginTop: 8, fontSize: 13, color: "var(--texto-suave)" }}>{MENSAJE_LEYENDO_VIDEO_CLIP}</p>
      )}
      {/* Aviso informativo, nunca bloqueante — ver advertenciaNoPuedeSubirClip */}
      {!subiendo && advertenciaCodec && <p style={{ marginTop: 8, fontSize: 13, color: "var(--texto-suave)" }}>{advertenciaCodec}</p>}

      {/* --- SKU y cuentas (punto 3) --- */}
      <div style={{ marginTop: 20, display: "flex", gap: 8, alignItems: "flex-end" }}>
        <Campo etiqueta="SKU de la publicación ya existente">
          <input value={sku} onChange={(e) => setSku(e.target.value)} className="zx-control" />
        </Campo>
        <Boton type="button" variante="secundario" chico disabled={!sku.trim() || buscando} onClick={buscarSku}>
          {buscando ? "Buscando…" : "Buscar en mis cuentas"}
        </Boton>
      </div>
      {erroBusqueda && <p style={{ marginTop: 8, color: "var(--kpi-peligro-texto)", fontSize: 14 }}>{erroBusqueda}</p>}

      {filas.length > 0 && (
        <div style={{ marginTop: 14 }}>
          <div style={{ display: "flex", gap: 8 }}>
            <Boton type="button" variante="secundario" chico onClick={() => marcarTodas(true)}>
              Marcar todas
            </Boton>
            <Boton type="button" variante="secundario" chico onClick={() => marcarTodas(false)}>
              Desmarcar todas
            </Boton>
          </div>
          <div style={{ marginTop: 10 }}>
            <Tabla encabezados={["", "Cuenta", "Título", "ID de la publicación", "Estado", "Subir"]}>
              {filas.map((fila) => {
                const estadoChip: { texto: string; estado: EstadoChip } = fila.activo
                  ? { texto: "Activa", estado: "exito" }
                  : fila.encontrado
                    ? { texto: "No disponible", estado: "aviso" }
                    : { texto: "Sin SKU", estado: "neutro" };
                return (
                  <FilaTabla key={fila.cuentaId}>
                    <CeldaTabla>
                      {fila.thumbnail ? <img src={fila.thumbnail} alt="" width={36} height={36} style={{ objectFit: "cover", borderRadius: 4 }} /> : null}
                    </CeldaTabla>
                    <CeldaTabla>{fila.nickname}</CeldaTabla>
                    <CeldaTabla>{fila.titulo ?? "—"}</CeldaTabla>
                    <CeldaTabla>{fila.itemId ?? "—"}</CeldaTabla>
                    <CeldaTabla>
                      <Chip estado={estadoChip.estado} title={fila.motivoNoDisponible ?? undefined}>
                        {estadoChip.texto}
                      </Chip>
                    </CeldaTabla>
                    <CeldaTabla>
                      <input
                        type="checkbox"
                        disabled={!fila.activo}
                        checked={Boolean(marcadas[fila.cuentaId])}
                        onChange={(e) => setMarcadas((actual) => ({ ...actual, [fila.cuentaId]: e.target.checked }))}
                      />
                      {fila.activo && marcadas[fila.cuentaId] && (
                        <div style={{ marginTop: 6 }}>
                          <label style={{ fontSize: 12, cursor: "pointer" }}>
                            <input
                              type="checkbox"
                              checked={Boolean(overridesAbiertos[fila.cuentaId])}
                              onChange={(e) => setOverridesAbiertos((actual) => ({ ...actual, [fila.cuentaId]: e.target.checked }))}
                            />{" "}
                            usar otro video para esta cuenta
                          </label>
                          {overridesAbiertos[fila.cuentaId] && (
                            <input
                              type="file"
                              accept={TIPOS_VIDEO_ACEPTADOS}
                              className="zx-control"
                              style={{ marginTop: 4, fontSize: 12 }}
                              onChange={(e) => {
                                const archivo = e.target.files?.[0];
                                if (archivo) setOverrideArchivos((actual) => ({ ...actual, [fila.cuentaId]: archivo }));
                              }}
                            />
                          )}
                        </div>
                      )}
                    </CeldaTabla>
                  </FilaTabla>
                );
              })}
            </Tabla>
          </div>
        </div>
      )}

      {/* --- Subida (punto 4) --- */}
      <Boton type="button" variante="primario" style={{ marginTop: 16 }} disabled={!puedeSubir} onClick={subir}>
        {subiendo ? "Subiendo…" : `Subir Clip a ${filasElegidas.length || ""} cuenta(s)`}
      </Boton>
      {errorSubida && <p style={{ marginTop: 10, color: "var(--kpi-peligro-texto)", fontSize: 14 }}>{mensajeErrorClip(errorSubida)}</p>}

      {/* --- Progreso + estado de moderación (puntos 4-5) --- */}
      {trabajo && (
        <div style={{ marginTop: 20 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <p className="zx-etiqueta">Progreso de la subida</p>
            <Boton type="button" variante="secundario" chico disabled={actualizandoEstado} onClick={consultarAhora}>
              {actualizandoEstado ? "Consultando…" : "Consultar ahora"}
            </Boton>
          </div>
          {/* Alcance A — el estado de moderación de cada cuenta ya se
              consulta solo (ver el useEffect de arriba); este aviso
              es sobre el SEGUIMIENTO en pantalla, no sobre el clip en
              sí (lib/trabajos/subirClipMultiCuenta.ts: Map en memoria,
              un solo proceso). */}
          <p style={{ fontSize: 12, color: "var(--texto-suave)", marginTop: 6 }}>
            El estado de cada cuenta se consulta solo mientras esta pantalla sigue abierta. Si el servidor se reinicia o hay más de una
            réplica corriendo, este seguimiento se pierde de vista — el clip que ya se subió a Mercado Libre no se pierde.
          </p>
          <Tabla encabezados={["Cuenta", "Estado", "Detalle"]}>
            {trabajo.cuentas.map((c) => {
              const clip = moderacionPorItem[key(c.cuentaId, c.itemId)];
              const chip =
                clip !== undefined
                  ? etiquetaModeracionClip(clip?.moderationStatus ?? null, clip?.motivoRechazo ?? null)
                  : c.estado === "en_moderacion"
                    ? etiquetaModeracionClip(null, null)
                    : { texto: ETIQUETA_ESTADO_TRABAJO[c.estado], estado: CHIP_ESTADO_TRABAJO[c.estado] };
              return (
                <FilaTabla key={c.cuentaId}>
                  <CeldaTabla>{c.nickname}</CeldaTabla>
                  <CeldaTabla>
                    <Chip estado={chip.estado}>{chip.texto}</Chip>
                  </CeldaTabla>
                  <CeldaTabla>{c.error ?? "—"}</CeldaTabla>
                </FilaTabla>
              );
            })}
          </Tabla>
        </div>
      )}
    </Tarjeta>
  );
}
