"use client";

import { useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { Boton } from "@/components/marco/Boton";
import { Campo } from "@/components/marco/Campo";
import { Chip } from "@/components/marco/Chip";
import type { Asignacion } from "@/lib/ia/prompts/composiciones";
import { TIPOS_EXPERTO_ML } from "@/lib/ia/prompts/estiloExpertoML";
import { NOTA_FOTO_UNO } from "@/lib/ia/prompts/fotoPrincipal";
import { CHECKLIST_CONTENIDO, revisarCopySeguro, TIPOS_CONTENIDO_ZILONIX } from "@/lib/ia/prompts/zilonix-contenido";
import type { Ficha } from "@/lib/publicaciones/ficha";
import { TIPO_PORTADA } from "@/lib/publicaciones/imagenesIA";
import type { Cuenta } from "./CuentasDestino";
import { TIPO_ARRASTRE_FOTO_URL, urlDescarga } from "./formulario-logica";
import { ajustarImagenAction, crearImagenAction, prepararImagenesAction, type PropuestaImagen } from "./ia/imagenes/actions";
import { CLAVES_BORRADOR_IA, useBorradorIA } from "./ia/borradorIA";
import styles from "./publicar.module.css";

type Estilo = "zilonix_portadas" | "zilonix_contenido" | "experto_ml";
type EstadoTarjeta = "propuesta" | "en_cola" | "generando" | "lista" | "error";
export type Tarjeta = PropuestaImagen & { estado: EstadoTarjeta; url?: string; avisos?: string[]; mensaje?: string; titulo: string; copy: string; ajuste: string };
// Una imagen ya creada, en la barra «Imágenes creadas» (24-nov). Vive
// aparte de las tarjetas: «Preparar de nuevo» o cambiar de estilo no la
// borra. Al regenerar, se reemplaza la de la misma tarjeta (mismo id).
export type Creada = { id: string; url: string; nombre: string; tipo: string; estilo: Estilo };

const ESTILOS: { id: Estilo; nombre: string; ayuda: string }[] = [
  { id: "zilonix_portadas", nombre: "Portadas Zilonix", ayuda: "1 o 2 portadas distintas; abajo eliges cuál es la portada de cada cuenta." },
  { id: "zilonix_contenido", nombre: "Contenido Zilonix", ayuda: "Las 10 imágenes de contenido; cada una se aprueba antes de crearla." },
  { id: "experto_ml", nombre: "Estilo experto ML", ayuda: "Imágenes de venta con titular y apoyos cortos." },
];
const NOMBRE_ESTILO: Record<Estilo, string> = { zilonix_portadas: "Portadas Zilonix", zilonix_contenido: "Contenido Zilonix", experto_ml: "Estilo experto ML" };
const SIN_TARJETAS: Record<Estilo, Tarjeta[]> = { zilonix_portadas: [], zilonix_contenido: [], experto_ml: [] };
const SIN_OMITIDAS: Record<Estilo, string[]> = { zilonix_portadas: [], zilonix_contenido: [], experto_ml: [] };
const RUTA_CONECTAR_IA = "/panel/conectar-ia";
const ESPERA_COLA_MS = 4_000;
const MAXIMO_A_LA_VEZ = 2;
const MENSAJE_GALERIA_LLENA = "No entró a la galería: ya está el máximo de fotos de la categoría. Quita una y vuelve a intentarlo.";
const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Lo que se guarda 2 horas (ia/borradorIA.ts) para no perder las
// propuestas ni las imágenes creadas al cambiar de sub pestaña o recargar.
type BorradorImagenes = {
  estilo: Estilo;
  tiposContenido: string[];
  tiposExperto: string[];
  opiniones: string;
  fotoBlanco: boolean;
  cantidadPortadas: 1 | 2;
  porEstilo: Record<Estilo, Tarjeta[]>;
  omitidasPorEstilo: Record<Estilo, string[]>;
  creadas: Creada[];
  asignadas: Record<string, Asignacion>;
};

// Una imagen que se estaba creando cuando se recargó la página ya no
// tiene quién espere su resultado: vuelve a «propuesta» con un aviso.
export function tarjetasRestauradas(tarjetas: Tarjeta[]): Tarjeta[] {
  return tarjetas.map((t) =>
    t.estado === "generando" || t.estado === "en_cola"
      ? { ...t, estado: "propuesta", mensaje: "Se interrumpió al recargar la página. Revisa «Imágenes creadas» antes de pulsar «Crear» de nuevo." }
      : t
  );
}

// Agrega una imagen recién creada a la barra, o reemplaza la de la misma
// tarjeta si se regeneró.
export function ponerEnCreadas(creadas: Creada[], nueva: Creada): Creada[] {
  return creadas.some((c) => c.id === nueva.id) ? creadas.map((c) => (c.id === nueva.id ? nueva : c)) : [...creadas, nueva];
}

// Publicar → «Generación de imágenes para Meli» → sub pestaña «Generar
// imágenes». Con la ficha confirmada arma propuestas (sin costo), la
// persona las revisa y solo «Crear» gasta. Cada estilo guarda sus propias
// tarjetas (cambiar de estilo no las borra) y nada entra solo a la
// galería (24-nov): lo creado queda en «Imágenes creadas», abajo. Desde
// ahí cada portada se asigna a una cuenta (nunca va a la galería) y las
// demás se agregan a la galería con un botón o arrastrándolas.
// Máximo 2 generándose a la vez; las demás esperan.
export function GenerarConIA({
  cuentas,
  ficha,
  categoriaId,
  fotos,
  espacioLibre,
  galeria,
  portadas,
  onAgregarAGaleria,
  onUsarPortada,
  onReemplazar,
}: {
  cuentas: Cuenta[];
  ficha: Ficha | null;
  categoriaId: string | null;
  fotos: string[];
  espacioLibre: number | null;
  // Fotos que hoy están en la galería de la publicación.
  galeria: string[];
  // Portada propia de cada cuenta («Título, descripción y portada por cuenta»).
  portadas: Record<string, string>;
  // false = la galería está llena según la categoría.
  onAgregarAGaleria: (url: string) => boolean;
  onUsarPortada: (cuentaId: string, url: string) => void;
  // Al regenerar: donde se usaba la anterior (galería o portada de una
  // cuenta) pasa a estar la nueva.
  onReemplazar: (anterior: string, nueva: string) => void;
}) {
  const [estilo, setEstilo] = useState<Estilo>("zilonix_portadas");
  const [tiposContenido, setTiposContenido] = useState<string[]>(TIPOS_CONTENIDO_ZILONIX.filter((t) => t.porDefecto).map((t) => t.id));
  const [tiposExperto, setTiposExperto] = useState<string[]>(TIPOS_EXPERTO_ML.filter((t) => t.porDefecto).map((t) => t.id));
  const [opiniones, setOpiniones] = useState("");
  const [fotoBlanco, setFotoBlanco] = useState(false);
  const [cantidadPortadas, setCantidadPortadas] = useState<1 | 2>(1);
  const [porEstilo, setPorEstilo] = useState<Record<Estilo, Tarjeta[]>>(SIN_TARJETAS);
  const [omitidasPorEstilo, setOmitidasPorEstilo] = useState<Record<Estilo, string[]>>(SIN_OMITIDAS);
  const [creadas, setCreadas] = useState<Creada[]>([]);
  const [avisoCreadas, setAvisoCreadas] = useState<string | null>(null);
  const [preparando, setPreparando] = useState(false);
  const [aviso, setAviso] = useState<{ texto: string; conectarIA?: boolean } | null>(null);
  const asignadas = useRef<Record<string, Asignacion>>({});
  // Llave de la composición de una portada («portada-N»), para que
  // «Otra composición» no repita la de la otra portada.
  const clavePortada = (propuesta: unknown) => (propuesta as { cuentaMlId?: unknown } | null)?.cuentaMlId;

  useBorradorIA<BorradorImagenes>(
    CLAVES_BORRADOR_IA.imagenes,
    { estilo, tiposContenido, tiposExperto, opiniones, fotoBlanco, cantidadPortadas, porEstilo, omitidasPorEstilo, creadas, asignadas: asignadas.current },
    (b) => {
      setEstilo(b.estilo);
      setTiposContenido(b.tiposContenido);
      setTiposExperto(b.tiposExperto);
      setOpiniones(b.opiniones);
      setFotoBlanco(b.fotoBlanco);
      setCantidadPortadas(b.cantidadPortadas);
      // Un borrador de antes de este cambio no trae estas partes: se empieza vacío.
      const guardadas = b.porEstilo ?? SIN_TARJETAS;
      setPorEstilo({
        zilonix_portadas: tarjetasRestauradas(guardadas.zilonix_portadas ?? []),
        zilonix_contenido: tarjetasRestauradas(guardadas.zilonix_contenido ?? []),
        experto_ml: tarjetasRestauradas(guardadas.experto_ml ?? []),
      });
      setOmitidasPorEstilo({ ...SIN_OMITIDAS, ...(b.omitidasPorEstilo ?? {}) });
      setCreadas(Array.isArray(b.creadas) ? b.creadas : []);
      asignadas.current = b.asignadas ?? {};
    }
  );

  const tarjetas = porEstilo[estilo];
  const omitidas = omitidasPorEstilo[estilo];
  // Los ids son únicos entre estilos: se busca la tarjeta en todos, así
  // una imagen que se está creando sigue bien aunque se cambie de estilo.
  const cambiar = (id: string, cambios: Partial<Tarjeta>) =>
    setPorEstilo((pe) => ({
      zilonix_portadas: pe.zilonix_portadas.map((t) => (t.id === id ? { ...t, ...cambios } : t)),
      zilonix_contenido: pe.zilonix_contenido.map((t) => (t.id === id ? { ...t, ...cambios } : t)),
      experto_ml: pe.experto_ml.map((t) => (t.id === id ? { ...t, ...cambios } : t)),
    }));

  // ---- «Imágenes creadas» (barra de abajo) ----
  const enGaleria = (url: string) => galeria.includes(url);
  const pendientesGaleria = creadas.filter((c) => c.tipo !== TIPO_PORTADA && !enGaleria(c.url));

  function agregarAGaleria(c: Creada) {
    setAvisoCreadas(onAgregarAGaleria(c.url) ? null : MENSAJE_GALERIA_LLENA);
  }

  function agregarTodasAGaleria() {
    for (const c of pendientesGaleria) {
      if (!onAgregarAGaleria(c.url)) {
        setAvisoCreadas(MENSAJE_GALERIA_LLENA);
        return;
      }
    }
    setAvisoCreadas(null);
  }

  // «Descargar todas»: una tras otra (sin ZIP: no hay librería para eso).
  // El navegador puede preguntar si permite varias descargas.
  async function descargarTodas() {
    for (const c of creadas) {
      const a = document.createElement("a");
      a.href = urlDescarga(c.url);
      a.rel = "noopener";
      a.download = "";
      document.body.appendChild(a);
      a.click();
      a.remove();
      await esperar(400);
    }
  }

  const barraCreadas: ReactNode =
    creadas.length > 0 ? (
      <div className={styles.bloqueIA}>
        <p className="zx-etiqueta">{`Imágenes creadas (${creadas.length})`}</p>
        <p className={styles.ayudaIA}>
          Aquí quedan todas, de cualquier estilo. Las portadas no van a la galería: elige de qué cuenta es cada una. Las demás, agrégalas a la galería con
          el botón o arrástralas a un lugar de la galería de Fotos.
        </p>
        <div className={styles.accionesIA}>
          {pendientesGaleria.length > 1 ? (
            <Boton type="button" variante="primario" onClick={agregarTodasAGaleria}>
              {`Agregar todas a la galería (${pendientesGaleria.length})`}
            </Boton>
          ) : null}
          {creadas.length > 1 ? (
            <Boton type="button" variante="secundario" onClick={() => void descargarTodas()}>
              {`Descargar todas (${creadas.length})`}
            </Boton>
          ) : null}
          {espacioLibre !== null ? <span className={styles.ayudaIA}>Espacio en la galería: {espacioLibre} foto(s).</span> : null}
        </div>
        {avisoCreadas ? (
          <p className={styles.avisoIA} role="alert">
            {avisoCreadas}
          </p>
        ) : null}
        <div className={styles.tarjetasIA}>
          {creadas.map((c) => {
            const esPortada = c.tipo === TIPO_PORTADA;
            return (
              <div key={c.id} className={styles.tarjetaIA}>
                <img
                  src={c.url}
                  alt={`Imagen creada: ${c.nombre}`}
                  width={180}
                  height={180}
                  className={styles.miniaturaIA}
                  // Las portadas no se arrastran: van a una cuenta, no a la galería.
                  draggable={!esPortada}
                  onDragStart={
                    esPortada
                      ? undefined
                      : (e) => {
                          e.dataTransfer.setData(TIPO_ARRASTRE_FOTO_URL, c.url);
                        }
                  }
                  title={esPortada ? undefined : "Arrástrala a un lugar de la galería de Fotos."}
                />
                <p className="zx-etiqueta">{c.nombre}</p>
                <span className={styles.accionesIA}>
                  <Chip>{NOMBRE_ESTILO[c.estilo]}</Chip>
                </span>
                <span className={styles.accionesIA}>
                  {esPortada ? (
                    cuentas.map((cu) => {
                      const usada = portadas[cu.id] === c.url;
                      return (
                        <Boton
                          key={cu.id}
                          type="button"
                          variante={usada ? "primario" : "secundario"}
                          aria-pressed={usada}
                          onClick={() => onUsarPortada(cu.id, c.url)}
                          aria-label={`Usar ${c.nombre} como portada de ${cu.nickname}`}
                        >
                          {usada ? `✓ Portada de ${cu.nickname}` : `Portada de ${cu.nickname}`}
                        </Boton>
                      );
                    })
                  ) : enGaleria(c.url) ? (
                    <Chip estado="exito">En la galería</Chip>
                  ) : (
                    <Boton type="button" variante="primario" onClick={() => agregarAGaleria(c)}>
                      Agregar a la galería
                    </Boton>
                  )}
                </span>
                <span className={styles.accionesIA}>
                  <a href={urlDescarga(c.url)} target="_blank" rel="noopener noreferrer" download className={styles.enlaceIA}>
                    Descargar
                  </a>
                  <Boton type="button" variante="fantasma" onClick={() => setCreadas((cs) => cs.filter((x) => x.id !== c.id))} aria-label={`Quitar ${c.nombre} de Imágenes creadas`}>
                    Quitar
                  </Boton>
                </span>
              </div>
            );
          })}
        </div>
      </div>
    ) : null;

  // La barra se ve siempre (también si la ficha se desconfirma): lo creado no se pierde.
  if (!ficha) {
    return (
      <>
        <p className={styles.ayudaIA}>
          Primero arma y confirma la ficha del producto en los pasos de arriba («1. Ficha del producto»). Las imágenes usan solo los datos confirmados y tus fotos reales.
        </p>
        {barraCreadas}
      </>
    );
  }
  if (cuentas.length === 0) return <p className={styles.ayudaIA}>Marca al menos una cuenta destino.</p>;
  if (fotos.length === 0) {
    return (
      <>
        <p className={styles.ayudaIA}>Sube primero 1 o 2 imágenes de referencia del producto (arriba, antes de «Información del producto»): la IA las usa como referencia.</p>
        {barraCreadas}
      </>
    );
  }

  async function preparar() {
    if (!ficha) return;
    // Lo preparado va al estilo pedido, aunque la persona cambie de estilo mientras espera.
    const pedido = estilo;
    setPreparando(true);
    setAviso(null);
    try {
      const r = await prepararImagenesAction({
        estilo: pedido,
        cuentaMlIds: cuentas.map((c) => c.id),
        ficha,
        tipos: pedido === "zilonix_contenido" ? tiposContenido : tiposExperto,
        opiniones,
        incluirFotoBlanco: fotoBlanco,
        previas: pedido === "zilonix_portadas" ? asignadas.current : undefined,
        cantidadPortadas,
      });
      if (!r.ok) {
        setAviso({ texto: r.aviso, conectarIA: r.conectarIA });
      } else {
        for (const img of r.imagenes) {
          const a = (img.propuesta as { asignacion?: Asignacion }).asignacion;
          const clave = clavePortada(img.propuesta);
          if (typeof clave === "string" && a) asignadas.current[clave] = a;
        }
        setOmitidasPorEstilo((o) => ({ ...o, [pedido]: r.omitidas }));
        setPorEstilo((pe) => ({
          ...pe,
          [pedido]: r.imagenes.map((img) => {
            const p = img.propuesta as { titulo?: string; copy?: string[] };
            return { ...img, estado: "propuesta" as const, titulo: p.titulo ?? "", copy: (p.copy ?? []).join("\n"), ajuste: "" };
          }),
        }));
      }
    } catch {
      setAviso({ texto: "No se pudieron preparar las propuestas. Intenta de nuevo." });
    }
    setPreparando(false);
  }

  function prohibidasDe(t: Tarjeta): string[] {
    if (t.tipo === TIPO_PORTADA || t.tipo === "foto_principal") return [];
    return revisarCopySeguro([t.titulo, ...t.copy.split("\n")]);
  }

  // Crea una imagen; si la empresa ya tiene 2 generando, espera su turno.
  // Lista: va a «Imágenes creadas», nunca sola a la galería.
  async function crear(t: Tarjeta, estiloTarjeta: Estilo) {
    if (prohibidasDe(t).length > 0 || (t.tipo !== TIPO_PORTADA && t.tipo !== "foto_principal" && !t.titulo.trim())) return;
    cambiar(t.id, { estado: "generando", mensaje: undefined });
    const propuesta = t.tipo === TIPO_PORTADA || t.tipo === "foto_principal" ? undefined : { titulo: t.titulo, copy: t.copy.split("\n").filter(Boolean) };
    for (let intento = 0; intento < 150; intento++) {
      let r;
      try {
        r = await crearImagenAction({ imagenId: t.id, propuesta, fotos, categoriaId });
      } catch {
        cambiar(t.id, { estado: "error", mensaje: "No se pudo crear la imagen. Intenta de nuevo." });
        return;
      }
      if (!r.ok) {
        cambiar(t.id, { estado: "error", mensaje: r.aviso });
        if (r.conectarIA) setAviso({ texto: r.aviso, conectarIA: true });
        return;
      }
      if (r.estado === "lista") {
        const url = r.url;
        const avisos = r.validada ? r.avisos : ["No se pudo validar la imagen con Mercado Libre."];
        cambiar(t.id, { estado: "lista", url, avisos });
        setCreadas((cs) => ponerEnCreadas(cs, { id: t.id, url, nombre: t.nombre, tipo: t.tipo, estilo: estiloTarjeta }));
        if (t.url && t.url !== url) onReemplazar(t.url, url);
        return;
      }
      cambiar(t.id, { estado: "en_cola" });
      await esperar(ESPERA_COLA_MS);
      cambiar(t.id, { estado: "generando" });
    }
    cambiar(t.id, { estado: "error", mensaje: "La cola tardó demasiado. Intenta de nuevo." });
  }

  // «Crear todas»: de a 2 a la vez (la cola del servidor también lo cuida).
  async function crearTodas() {
    const deEsteEstilo = estilo;
    const pendientes = tarjetas.filter((t) => t.estado === "propuesta" || t.estado === "error");
    let i = 0;
    await Promise.all(
      Array.from({ length: MAXIMO_A_LA_VEZ }, async () => {
        while (i < pendientes.length) await crear(pendientes[i++], deEsteEstilo);
      })
    );
  }

  async function ajustar(t: Tarjeta) {
    cambiar(t.id, { estado: "generando", mensaje: undefined });
    try {
      const r = await ajustarImagenAction({ imagenId: t.id, ajuste: t.ajuste, asignadas: asignadas.current, opiniones });
      if (!r.ok) {
        cambiar(t.id, { estado: "propuesta", mensaje: r.aviso });
        return;
      }
      const p = r.propuesta as { titulo?: string; copy?: string[]; asignacion?: Asignacion };
      const clave = clavePortada(r.propuesta);
      if (typeof clave === "string" && p.asignacion) asignadas.current[clave] = p.asignacion;
      cambiar(t.id, { estado: "propuesta", propuesta: r.propuesta, prompt: r.prompt, titulo: p.titulo ?? t.titulo, copy: (p.copy ?? t.copy.split("\n")).join("\n"), ajuste: "" });
    } catch {
      cambiar(t.id, { estado: "propuesta", mensaje: "No se pudo ajustar. Intenta de nuevo." });
    }
  }

  const tipos = estilo === "zilonix_contenido" ? TIPOS_CONTENIDO_ZILONIX : estilo === "experto_ml" ? TIPOS_EXPERTO_ML : [];
  const marcados = estilo === "zilonix_contenido" ? tiposContenido : tiposExperto;
  const alternarTipo = (id: string) => (estilo === "zilonix_contenido" ? setTiposContenido : setTiposExperto)((ts) => (ts.includes(id) ? ts.filter((x) => x !== id) : [...ts, id]));

  return (
    <div className={styles.crearIA}>
      <span className={styles.filtroIA} role="radiogroup" aria-label="Estilo de imagen">
        {ESTILOS.map((e) => (
          <Boton key={e.id} type="button" variante={estilo === e.id ? "primario" : "secundario"} onClick={() => setEstilo(e.id)} disabled={preparando} role="radio" aria-checked={estilo === e.id}>
            {e.nombre}
            {porEstilo[e.id].length > 0 ? ` (${porEstilo[e.id].length})` : ""}
          </Boton>
        ))}
      </span>
      <p className={styles.ayudaIA}>{ESTILOS.find((e) => e.id === estilo)?.ayuda}</p>

      {estilo === "zilonix_portadas" ? (
        <>
          <span className={styles.filtroIA} role="radiogroup" aria-label="Cuántas portadas">
            {([1, 2] as const).map((n) => (
              <Boton key={n} type="button" variante={cantidadPortadas === n ? "primario" : "secundario"} onClick={() => setCantidadPortadas(n)} aria-checked={cantidadPortadas === n} role="radio" disabled={preparando}>
                {n === 1 ? "1 portada" : "2 portadas"}
              </Boton>
            ))}
          </span>
          <p className={styles.ayudaIA}>
            {cantidadPortadas === 2 ? "Se crean 2 portadas distintas: abajo, en «Imágenes creadas», eliges cuál es la portada de cada cuenta." : "Se crea 1 portada."} {NOTA_FOTO_UNO}
          </p>
        </>
      ) : (
        <div className={styles.tiposIA}>
          {tipos.map((t) => (
            <label key={t.id} className={styles.tipoIA}>
              <input type="checkbox" checked={marcados.includes(t.id)} onChange={() => alternarTipo(t.id)} disabled={preparando} /> {t.nombre}
            </label>
          ))}
        </div>
      )}
      {estilo === "zilonix_contenido" && tiposContenido.includes("opiniones_reales") ? (
        <Campo etiqueta="Opiniones reales de tus compradores (una por línea; si no tienes, déjalo vacío y esa imagen se salta)">
          <textarea className="zx-control" rows={3} value={opiniones} onChange={(e) => setOpiniones(e.target.value)} placeholder="Llegó rápido y bien empacado" disabled={preparando} />
        </Campo>
      ) : null}
      <label className={styles.tipoIA}>
        <input type="checkbox" checked={fotoBlanco} onChange={(e) => setFotoBlanco(e.target.checked)} disabled={preparando} /> Agregar también una foto del producto solo sobre blanco
      </label>
      <div>
        <Boton type="button" onClick={preparar} disabled={preparando}>
          {preparando ? "Preparando propuestas…" : tarjetas.length > 0 ? "Preparar de nuevo" : "Preparar propuestas (sin costo)"}
        </Boton>
      </div>
      {tarjetas.length > 0 ? <p className={styles.ayudaIA}>«Preparar de nuevo» cambia solo las propuestas de este estilo. Lo ya creado sigue abajo, en «Imágenes creadas».</p> : null}
      {aviso ? (
        <p className={styles.avisoIA} role="alert">
          {aviso.texto} {aviso.conectarIA ? <Link href={RUTA_CONECTAR_IA}>Ir a Conectar IA</Link> : null}
        </p>
      ) : null}
      {omitidas.length > 0 ? <p className={styles.ayudaIA}>No se prepararon: {omitidas.join(" · ")}</p> : null}

      {tarjetas.length > 0 ? (
        <>
          <div className={styles.accionesIA}>
            <Boton type="button" onClick={crearTodas} disabled={tarjetas.some((t) => t.estado === "generando" || t.estado === "en_cola")}>
              Crear todas las aprobadas
            </Boton>
          </div>
          <div className={styles.tarjetasIA}>
            {tarjetas.map((t) => {
              const prohibidas = prohibidasDe(t);
              const conTextos = t.tipo !== TIPO_PORTADA && t.tipo !== "foto_principal";
              const ocupada = t.estado === "generando" || t.estado === "en_cola";
              return (
                <div key={t.id} className={styles.tarjetaIA}>
                  <p className="zx-etiqueta">{t.nombre}</p>
                  {t.url ? <img src={t.url} alt={`Imagen creada: ${t.nombre}`} width={180} height={180} className={styles.miniaturaIA} draggable={false} /> : null}
                  {conTextos && t.estado !== "lista" ? (
                    <>
                      <Campo etiqueta="Título">
                        <input className="zx-control" maxLength={60} value={t.titulo} onChange={(e) => cambiar(t.id, { titulo: e.target.value })} disabled={ocupada} />
                      </Campo>
                      <Campo etiqueta="Copy (una línea por texto)">
                        <textarea className="zx-control" rows={3} value={t.copy} onChange={(e) => cambiar(t.id, { copy: e.target.value })} disabled={ocupada} />
                      </Campo>
                    </>
                  ) : null}
                  {estilo === "zilonix_contenido" && conTextos ? (
                    <span className={styles.accionesIA}>
                      {CHECKLIST_CONTENIDO.map((c) => (
                        <Chip key={c} estado={c === "Sin palabras prohibidas" && prohibidas.length > 0 ? "peligro" : c === "Aprobado (CREAR)" && t.estado !== "lista" ? "neutro" : "exito"}>
                          {c}
                        </Chip>
                      ))}
                    </span>
                  ) : null}
                  {prohibidas.length > 0 ? <p className={styles.avisoIA}>Mercado Libre no permite: {prohibidas.join(", ")}.</p> : null}
                  <details className={styles.promptIA}>
                    <summary>Ver el prompt final</summary>
                    <p>{t.prompt}</p>
                    <Boton type="button" variante="fantasma" onClick={() => void navigator.clipboard.writeText(t.prompt).catch(() => undefined)}>
                      Copiar prompt
                    </Boton>
                  </details>
                  {t.estado === "propuesta" || t.estado === "error" ? (
                    <Campo etiqueta="¿Qué cambio quieres? (para «Ajustar»)">
                      <input className="zx-control" maxLength={300} value={t.ajuste} onChange={(e) => cambiar(t.id, { ajuste: e.target.value })} />
                    </Campo>
                  ) : null}
                  <span className={styles.accionesIA}>
                    {t.estado === "lista" ? (
                      <>
                        <Chip estado="exito">Lista: abajo, en «Imágenes creadas»</Chip>
                        <Boton type="button" variante="primario" onClick={() => (t.tipo === TIPO_PORTADA ? void ajustar({ ...t, estado: "propuesta" }).then(() => undefined) : void crear(t, estilo))}>
                          {t.tipo === TIPO_PORTADA ? "Otra composición" : "Regenerar"}
                        </Boton>
                      </>
                    ) : (
                      <>
                        <Boton type="button" onClick={() => void crear(t, estilo)} disabled={ocupada || prohibidas.length > 0}>
                          {t.estado === "en_cola" ? "En cola…" : t.estado === "generando" ? "Creando…" : "Crear"}
                        </Boton>
                        {t.tipo !== "foto_principal" ? (
                          <Boton type="button" variante="fantasma" onClick={() => void ajustar(t)} disabled={ocupada}>
                            Ajustar
                          </Boton>
                        ) : null}
                      </>
                    )}
                  </span>
                  {t.estado === "lista" && t.avisos && t.avisos.length > 0 ? <p className={styles.ayudaIA}>Mercado Libre: {t.avisos.join(" · ")}</p> : null}
                  {t.mensaje ? <p className={styles.avisoIA}>{t.mensaje}</p> : null}
                </div>
              );
            })}
          </div>
        </>
      ) : null}

      {barraCreadas}
    </div>
  );
}
