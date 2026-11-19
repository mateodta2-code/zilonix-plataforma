"use client";

import { useEffect, useRef, useState } from "react";
import { Boton } from "@/components/marco/Boton";
import {
  COMPOSICIONES,
  faltaParaCrear,
  limpiarContenido,
  palabrasProhibidas,
  promptImagenContenido,
  tipoContenido,
  tipoLoEscribeLaIA,
  TIPOS_CONTENIDO,
  type Composicion,
  type ContenidoImagen,
  type TipoContenido,
} from "@/lib/ia/contenidoReglas";
import { generarImagenIAAction, proponerContenidoIAAction } from "../actions";
import styles from "../page.module.css";

// "lista" = la empresa tiene OpenAI o Google conectado.
export type EstadoIAImagen = "lista" | "sin_conexion" | "sin_imagenes";

// Mismo número que COMPOSICIONES_PORTADA (lib/ia/imagen.ts): no se importa
// para no meter ese módulo de servidor en el bundle del navegador.
const COMPOSICIONES_PORTADA = 10;
const CANTIDADES = [1, 4, 10] as const;
const REFERENCIAS_EXTRA = 2;

type Creada = { url: string; rotulo: string };
// Lo que la persona edita antes de aprobar (una línea por texto).
type Borrador = { tipo: TipoContenido; titulo: string; lineas: string; composicion: Composicion };

function contenidoDe(b: Borrador): ContenidoImagen | null {
  return limpiarContenido({ tipo: b.tipo, titulo: b.titulo, bullets: b.lineas.split("\n"), composicion: b.composicion });
}

// Crea fotos con la IA de la empresa a partir de fotos reales de la
// galería. Nada entra a la galería hasta que la persona lo agrega, y
// solo llega a Mercado Libre con «Guardar fotos».
// - Portada de venta: cada una con otra composición (hasta 10 por tanda).
// - Informativa: flujo de aprobación. La IA de texto propone título,
//   copy y composición; la persona lo revisa/edita y solo con «CREAR»
//   se genera la imagen. Las palabras prohibidas bloquean el botón (y el
//   servidor lo vuelve a revisar).
export function CrearImagenIA({
  cuentaMlId,
  itemId,
  fotos,
  tituloProducto,
  estado,
  onAgregar,
}: {
  cuentaMlId: string;
  itemId: string;
  fotos: string[];
  tituloProducto: string | null;
  estado: EstadoIAImagen;
  onAgregar: (url: string, comoPortada: boolean) => void;
}) {
  const [base, setBase] = useState(fotos[0] ?? "");
  const [tipo, setTipo] = useState<"portada" | "informativa">("portada");
  const [cantidad, setCantidad] = useState<(typeof CANTIDADES)[number]>(4);
  const [ficha, setFicha] = useState("");
  const [tipoC, setTipoC] = useState<TipoContenido>("modo_uso");
  const [borrador, setBorrador] = useState<Borrador | null>(null);
  const [proponiendo, setProponiendo] = useState(false);
  const [creadas, setCreadas] = useState<Creada[]>([]);
  const [aviso, setAviso] = useState<{ ok: boolean; texto: string } | null>(null);
  const [progreso, setProgreso] = useState<{ hecho: number; total: number } | null>(null);
  const [copiado, setCopiado] = useState(false);
  const detener = useRef(false);
  // La siguiente composición: «crear 4» dos veces da 8 distintas.
  const siguiente = useRef(0);

  // Si la foto elegida se quita de la galería, vuelve a la primera.
  useEffect(() => {
    if (!fotos.includes(base)) setBase(fotos[0] ?? "");
  }, [fotos, base]);

  if (estado !== "lista") {
    return (
      <p className={styles.notaNeutra}>
        {estado === "sin_conexion"
          ? "Para crear imágenes con IA, conecta OpenAI o Google en Configuración → IA (lo paga la cuenta de IA de tu empresa)."
          : "La IA conectada en Configuración → IA no crea imágenes. Conecta OpenAI o Google para usar esto."}
      </p>
    );
  }

  const ocupado = progreso !== null || proponiendo;
  const referencias = fotos.filter((u) => u !== base).slice(0, REFERENCIAS_EXTRA);
  const infoTipo = tipoContenido(tipoC);
  const contenido = borrador ? contenidoDe(borrador) : null;
  const falta = contenido ? faltaParaCrear(contenido) : null;
  const prohibidas = contenido ? palabrasProhibidas([contenido.titulo, ...contenido.bullets]) : [];

  async function crearPortadas() {
    if (!base || ocupado) return;
    detener.current = false;
    setAviso(null);
    let fallidas = 0;
    let ultimoError = "";
    for (let i = 0; i < cantidad; i++) {
      if (detener.current) break;
      setProgreso({ hecho: i, total: cantidad });
      const variante = siguiente.current % COMPOSICIONES_PORTADA;
      siguiente.current += 1;
      try {
        const r = await generarImagenIAAction({ cuentaMlId, itemId, fotoUrl: base, referencias, tipo: "portada", indicaciones: ficha, variante });
        if (r.ok) {
          setCreadas((previas) => [...previas, { url: r.url, rotulo: `Portada, composición ${variante + 1}` }]);
        } else {
          fallidas += 1;
          ultimoError = r.aviso;
          // Clave rechazada, sin saldo o sin permiso: las demás fallarían igual.
          if (i === 0) break;
        }
      } catch {
        fallidas += 1;
        ultimoError = "No se pudo crear la imagen. Intenta de nuevo.";
      }
    }
    setProgreso(null);
    if (fallidas === 0) {
      setAviso({ ok: true, texto: "Listo. Revisa cada imagen: si una no se entiende o se ve genérica, descártala y crea otra." });
    } else {
      setAviso({ ok: false, texto: fallidas === cantidad ? ultimoError : `${fallidas} no se pudieron crear. ${ultimoError}` });
    }
  }

  async function proponer() {
    if (ocupado) return;
    setAviso(null);
    setCopiado(false);
    if (!tipoLoEscribeLaIA(tipoC)) {
      setBorrador({ tipo: tipoC, titulo: "Lo que dicen nuestros compradores", lineas: "", composicion: "izquierda" });
      return;
    }
    setProponiendo(true);
    try {
      const r = await proponerContenidoIAAction({ cuentaMlId, itemId, tipoContenido: tipoC, ficha });
      if (r.ok) {
        setBorrador({ tipo: r.contenido.tipo, titulo: r.contenido.titulo, lineas: r.contenido.bullets.join("\n"), composicion: r.contenido.composicion });
        if (r.prohibidas.length > 0) setAviso({ ok: false, texto: "La propuesta trae palabras que Mercado Libre no permite: corrígelas antes de crear." });
      } else {
        setAviso({ ok: false, texto: r.aviso });
      }
    } catch {
      setAviso({ ok: false, texto: "No se pudo proponer el contenido. Intenta de nuevo." });
    }
    setProponiendo(false);
  }

  async function crearInformativa() {
    if (!base || ocupado || !contenido || falta) return;
    setAviso(null);
    setProgreso({ hecho: 0, total: 1 });
    try {
      const r = await generarImagenIAAction({ cuentaMlId, itemId, fotoUrl: base, referencias, tipo: "informativa", contenido });
      if (r.ok) {
        setCreadas((previas) => [...previas, { url: r.url, rotulo: infoTipo?.nombre ?? "Informativa" }]);
        setAviso({ ok: true, texto: "Imagen creada. Revísala: si el texto salió con errores, ajusta y créala otra vez." });
      } else {
        setAviso({ ok: false, texto: r.aviso });
      }
    } catch {
      setAviso({ ok: false, texto: "No se pudo crear la imagen. Intenta de nuevo." });
    }
    setProgreso(null);
  }

  function cambiarTipoContenido(t: TipoContenido) {
    setTipoC(t);
    setBorrador(null);
    setAviso(null);
  }

  async function copiarPrompt() {
    if (!contenido) return;
    try {
      await navigator.clipboard.writeText(promptImagenContenido(contenido, tituloProducto));
      setCopiado(true);
    } catch {
      setCopiado(false);
    }
  }

  function agregar(creada: Creada, comoPortada: boolean) {
    onAgregar(creada.url, comoPortada);
    setCreadas((previas) => previas.filter((c) => c.url !== creada.url));
    setAviso({ ok: true, texto: "Agregada a la galería. Recuerda «Guardar fotos»." });
  }

  return (
    <div className={styles.iaImagen}>
      <p className={styles.seccion}>Crear imagen con IA</p>
      <p className={styles.notaNeutra}>
        Elige la foto real principal; la IA usa también {referencias.length > 0 ? `otras ${referencias.length} de la galería` : "solo esa"} como referencia. Cada
        imagen tarda hasta un minuto y la cobra la cuenta de IA de tu empresa.
      </p>
      <div className={styles.iaBases} role="radiogroup" aria-label="Foto base">
        {fotos.map((url, i) => (
          <button
            key={url}
            type="button"
            role="radio"
            aria-checked={url === base}
            aria-label={`Usar la foto ${i + 1} como base`}
            className={url === base ? `${styles.iaBase} ${styles.iaBaseElegida}` : styles.iaBase}
            onClick={() => setBase(url)}
            disabled={ocupado}
          >
            <img src={url} alt="" width={56} height={56} loading="lazy" />
          </button>
        ))}
      </div>
      <span className={styles.filtro} role="radiogroup" aria-label="Tipo de imagen">
        {(["portada", "informativa"] as const).map((t) => (
          <button key={t} type="button" role="radio" aria-checked={tipo === t} className={styles.iaTipo} onClick={() => setTipo(t)} disabled={ocupado}>
            {t === "portada" ? "Portada de venta" : "Informativa (con textos)"}
          </button>
        ))}
      </span>

      <textarea
        className="zx-control"
        rows={4}
        maxLength={1500}
        value={ficha}
        onChange={(e) => setFicha(e.target.value)}
        placeholder="Ficha técnica del producto: qué es, para qué sirve, modo de uso, qué incluye, ingredientes o materiales, presentación. La IA solo usa lo que escribas aquí, el título y la descripción de la publicación."
        aria-label="Ficha técnica del producto para la IA"
        disabled={ocupado}
      />

      {tipo === "portada" ? (
        <>
          <p className={styles.notaNeutra}>
            Portada sobre fondo blanco que muestra, sin textos, para qué sirve, cómo se usa y qué incluye; cada una sale con otra composición.
          </p>
          <span className={styles.filtro} role="radiogroup" aria-label="Cuántas portadas">
            {CANTIDADES.map((n) => (
              <button key={n} type="button" role="radio" aria-checked={cantidad === n} className={styles.iaTipo} onClick={() => setCantidad(n)} disabled={ocupado}>
                {n === 1 ? "1 portada" : `${n} portadas`}
              </button>
            ))}
          </span>
          <div className={styles.iaAcciones}>
            {progreso ? (
              <Boton type="button" chico variante="secundario" onClick={() => (detener.current = true)}>
                Detener después de esta
              </Boton>
            ) : (
              <Boton type="button" chico onClick={crearPortadas} disabled={!base || ocupado}>
                {cantidad === 1 ? "Crear portada" : `Crear ${cantidad} portadas`}
              </Boton>
            )}
          </div>
        </>
      ) : (
        <>
          <span className={styles.filtro} role="radiogroup" aria-label="Qué imagen informativa">
            {TIPOS_CONTENIDO.map((t, i) => (
              <button key={t.id} type="button" role="radio" aria-checked={tipoC === t.id} className={styles.iaTipo} onClick={() => cambiarTipoContenido(t.id)} disabled={ocupado}>
                {i + 1}. {t.nombre}
              </button>
            ))}
          </span>
          <p className={styles.notaNeutra}>{infoTipo?.guia}</p>
          <div className={styles.iaAcciones}>
            <Boton type="button" chico variante={borrador ? "secundario" : "primario"} onClick={proponer} disabled={ocupado}>
              {proponiendo
                ? "Proponiendo…"
                : !tipoLoEscribeLaIA(tipoC)
                  ? "Escribir las opiniones"
                  : borrador
                    ? "Proponer de nuevo"
                    : "Proponer contenido"}
            </Boton>
          </div>

          {borrador ? (
            <div className={styles.iaPropuesta}>
              <p className={styles.seccion}>Revisa antes de crear</p>
              {!tipoLoEscribeLaIA(borrador.tipo) ? (
                <p className={styles.notaNeutra}>
                  Pega opiniones REALES de tus compradores (una por línea), copiadas de tus calificaciones en Mercado Libre. Nunca inventes opiniones: es publicidad
                  engañosa. Elige las que no hablen de resultados.
                </p>
              ) : null}
              <label className={styles.iaCampo}>
                <span>Título de la imagen</span>
                <input
                  className="zx-control"
                  value={borrador.titulo}
                  maxLength={60}
                  onChange={(e) => setBorrador({ ...borrador, titulo: e.target.value })}
                  disabled={ocupado}
                />
              </label>
              <label className={styles.iaCampo}>
                <span>Copy (una línea por texto, {infoTipo ? `${infoTipo.min} a ${infoTipo.max}` : ""})</span>
                <textarea
                  className="zx-control"
                  rows={Math.max(3, borrador.lineas.split("\n").length)}
                  value={borrador.lineas}
                  onChange={(e) => setBorrador({ ...borrador, lineas: e.target.value })}
                  disabled={ocupado}
                />
              </label>
              <span className={styles.filtro} role="radiogroup" aria-label="Composición">
                {COMPOSICIONES.map((c) => (
                  <button
                    key={c}
                    type="button"
                    role="radio"
                    aria-checked={borrador.composicion === c}
                    className={styles.iaTipo}
                    onClick={() => setBorrador({ ...borrador, composicion: c })}
                    disabled={ocupado}
                  >
                    Producto a la {c === "centro" ? "mitad" : c}
                  </button>
                ))}
              </span>
              {prohibidas.length > 0 ? (
                <p className={styles.avisoError} role="alert">
                  Mercado Libre no permite: {prohibidas.join(", ")}. Cámbialas por lenguaje neutro (apoya, contribuye, sensación de…).
                </p>
              ) : null}
              {contenido ? (
                <details className={styles.iaPrompt}>
                  <summary>Ver el prompt final</summary>
                  <p>{promptImagenContenido(contenido, tituloProducto)}</p>
                  <Boton type="button" chico variante="fantasma" onClick={copiarPrompt}>
                    {copiado ? "Copiado ✓" : "Copiar prompt"}
                  </Boton>
                </details>
              ) : null}
              <p className={styles.notaNeutra}>
                {falta ?? "¿Confirmas que cree la imagen? Si quieres cambiar algo, edítalo arriba o pide otra propuesta."}
              </p>
              <div className={styles.iaAcciones}>
                <Boton type="button" chico onClick={crearInformativa} disabled={ocupado || !!falta || !base}>
                  {progreso ? "Creando imagen…" : "CREAR imagen"}
                </Boton>
                <Boton type="button" chico variante="fantasma" onClick={() => setBorrador(null)} disabled={ocupado}>
                  Descartar propuesta
                </Boton>
              </div>
            </div>
          ) : null}
        </>
      )}

      {progreso && tipo === "portada" ? (
        <p className={styles.notaNeutra} role="status">
          Creando imagen {progreso.hecho + 1} de {progreso.total}…
        </p>
      ) : null}
      {aviso ? (
        <p className={aviso.ok ? styles.avisoOk : styles.avisoError} role="status">
          {aviso.texto}
        </p>
      ) : null}
      {creadas.length > 0 ? (
        <div className={styles.iaResultados}>
          {creadas.map((c) => (
            <div key={c.url} className={styles.iaResultado}>
              <img src={c.url} alt={`Imagen creada con IA: ${c.rotulo}`} width={200} height={200} />
              <div className={styles.iaAcciones}>
                <span className={styles.notaNeutra}>{c.rotulo}</span>
                <Boton type="button" chico onClick={() => agregar(c, true)}>
                  Agregar como portada
                </Boton>
                <Boton type="button" chico variante="secundario" onClick={() => agregar(c, false)}>
                  Agregar al final
                </Boton>
                <Boton type="button" chico variante="fantasma" onClick={() => setCreadas((previas) => previas.filter((x) => x.url !== c.url))}>
                  Descartar
                </Boton>
              </div>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
