"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Boton } from "@/components/marco/Boton";
import { BarraCarga } from "@/components/marco/BarraCarga";
import { formatearMoneda } from "@/lib/ml/sitios";
import { leerPrecioEscrito, simularPrecio, textoSimulacion, type BaseSimulacion } from "@/lib/optimizacion/simulador";
import { GaleriaFotos } from "../../publicar/GaleriaFotos";
import { CrearImagenIA, type EstadoIAImagen } from "./CrearImagenIA";
import { editarFotosAction, editarPrecioAction, editarTituloAction, mejorarTituloIAAction, type ResultadoMejorarTitulo } from "../actions";
import styles from "../page.module.css";

export type DatosEdicion = {
  itemId: string;
  cuentaMlId: string;
  siteId: string;
  idioma: string;
  precio: number | null;
  titulo: string | null;
  vendidas: number;
  tieneVariantes: boolean;
  // true = automatización de precios de ML activa; null = no se supo.
  automatizada: boolean | null;
  // Publicación «User Products»: el título se cambia por family_name.
  userProduct: boolean;
  // Promoción vigente (GET /items/{id}/prices): el comprador ve ese precio.
  promocion: { precio: number; precioRegular: number | null; hasta: string | null } | null;
  fotos: { id: string; url: string }[];
  // Sin Cloudinary, la galería vuelve a pedir enlaces (no hay dónde subir).
  cloudinaryConfigurado: boolean;
  // Crear imagen con IA: depende de la conexión de IA de la empresa.
  iaImagen: EstadoIAImagen;
  base: BaseSimulacion;
};

type Aviso = { ok: boolean; texto: string } | null;

const RUTA_CONECTAR_IA = "/panel/conectar-ia";
const LARGO_TITULO_ML = 60;
const LARGO_TITULO_CATALOGO_ML = 120;


function AvisoLinea({ aviso }: { aviso: Aviso }) {
  if (!aviso) return null;
  return (
    <p className={aviso.ok ? styles.avisoOk : styles.avisoError} role="status">
      {aviso.texto}
    </p>
  );
}

export function EditarPublicacion({ datos }: { datos: DatosEdicion }) {
  const router = useRouter();
  const [enviando, iniciar] = useTransition();
  // Qué se está guardando, para el título de la barra.
  const [guardando, setGuardando] = useState<"precio" | "título" | "fotos">("precio");
  const plata = (v: string | number | null) => (v === null ? "—" : formatearMoneda(Number(v), datos.siteId));

  // Precio + simulador.
  const [precioTexto, setPrecioTexto] = useState(datos.precio === null ? "" : String(datos.precio));
  const [avisoPrecio, setAvisoPrecio] = useState<Aviso>(null);
  const precio = leerPrecioEscrito(precioTexto, datos.siteId);
  const sim = precio ? simularPrecio(precio, datos.base) : null;
  const precioBloqueado = datos.tieneVariantes || datos.automatizada === true;

  // Título.
  const [titulo, setTitulo] = useState(datos.titulo ?? "");
  const [avisoTitulo, setAvisoTitulo] = useState<Aviso>(null);
  // «Mejorar título» con la IA (solo lectura: guardar sigue siendo «Guardar título»).
  const [generando, setGenerando] = useState(false);
  const [propuesta, setPropuesta] = useState<Extract<ResultadoMejorarTitulo, { ok: true }> | null>(null);
  const [falloIA, setFalloIA] = useState<{ aviso: string; conectarIA: boolean } | null>(null);
  const [copiado, setCopiado] = useState<string | null>(null);

  // Estado propio (no useTransition): la barra tiene que verse durante toda
  // la espera de la IA, que es una promesa y no un render.
  async function mejorarTitulo() {
    setFalloIA(null);
    setCopiado(null);
    setGenerando(true);
    try {
      const r = await mejorarTituloIAAction({ cuentaMlId: datos.cuentaMlId, itemId: datos.itemId });
      if (r.ok) setPropuesta(r);
      else {
        setPropuesta(null);
        setFalloIA({ aviso: r.aviso, conectarIA: r.conectarIA === true });
      }
    } catch {
      setPropuesta(null);
      setFalloIA({ aviso: "No se pudieron generar los títulos. Intenta de nuevo.", conectarIA: false });
    } finally {
      setGenerando(false);
    }
  }

  async function copiarTitulo(texto: string) {
    try {
      await navigator.clipboard.writeText(texto);
      setCopiado(texto);
    } catch {
      setFalloIA({ aviso: "No se pudo copiar. Selecciona el texto y cópialo a mano.", conectarIA: false });
    }
  }

  function filaSugerencia(texto: string, maximo: number, rotulo?: string) {
    return (
      <li key={`${rotulo ?? "t"}-${texto}`} className={styles.nota}>
        {rotulo ? <strong>{`${rotulo}: `}</strong> : null}
        {texto} <span className={styles.notaNeutra}>{`(${texto.length}/${maximo} caracteres)`}</span>{" "}
        {propuesta?.puedeGuardar ? (
          <Boton type="button" variante="fantasma" chico disabled={enviando} onClick={() => setTitulo(texto)}>
            Usar este título
          </Boton>
        ) : (
          <Boton type="button" variante="fantasma" chico onClick={() => void copiarTitulo(texto)}>
            {copiado === texto ? "Copiado ✓" : "Copiar"}
          </Boton>
        )}
      </li>
    );
  }

  // Fotos: la misma galería de Publicar (portada marcada, subir desde el
  // equipo, arrastrar para ordenar). Trabaja con URLs; al guardar, las
  // que ya tenía la publicación vuelven a su id de Mercado Libre.
  // Enlaces de la galería que salieron de «Crear imagen con IA» (el servidor
  // solo cuenta los que de verdad van entre las fotos nuevas).
  const [fotosIA, setFotosIA] = useState<string[]>([]);
  const [fotos, setFotos] = useState(() => datos.fotos.map((f) => f.url));
  const [avisoFotos, setAvisoFotos] = useState<Aviso>(null);
  const idPorUrl = new Map(datos.fotos.map((f) => [f.url, f.id]));

  function guardar(que: "precio" | "título" | "fotos", accion: () => Promise<{ ok: boolean; aviso: string }>, setAviso: (a: Aviso) => void) {
    setGuardando(que);
    iniciar(async () => {
      const r = await accion();
      setAviso({ ok: r.ok, texto: r.aviso });
      if (r.ok) router.refresh();
    });
  }

  return (
    <div className={styles.edicion}>
      <BarraCarga
        sticky={false}
        estado={enviando ? "cargando" : "inactiva"}
        titulo={
          guardando === "fotos" ? "Guardando fotos en Mercado Libre…" : guardando === "título" ? "Guardando el título en Mercado Libre…" : "Guardando el precio en Mercado Libre…"
        }
        ariaLabel="Progreso del guardado"
      />
      <section className={styles.bloqueEdicion} aria-label="Precio">
        <p className={styles.seccion}>Precio</p>
        {datos.promocion && !precioBloqueado ? (
          <p className={styles.nota}>
            {`Esta publicación tiene una promoción activa: el comprador ve ${plata(datos.promocion.precio)}${
              datos.promocion.precioRegular !== null ? ` (antes ${plata(datos.promocion.precioRegular)})` : ""
            }${
              datos.promocion.hasta
                ? ` hasta el ${new Date(datos.promocion.hasta).toLocaleDateString(datos.idioma, { day: "numeric", month: "long" })}`
                : ""
            }. El precio que guardes aquí es el normal y se verá cuando termine la promoción.`}
          </p>
        ) : null}
        {precioBloqueado ? (
          <p className={styles.nota}>
            {datos.tieneVariantes
              ? "Esta publicación tiene variantes: el precio se cambia por variante en Mercado Libre."
              : "Esta publicación tiene la automatización de precios de Mercado Libre activa: Mercado Libre no deja cambiar el precio a mano."}
          </p>
        ) : (
          <form
            className={styles.buscador}
            onSubmit={(e) => {
              e.preventDefault();
              guardar("precio", () => editarPrecioAction({ cuentaMlId: datos.cuentaMlId, itemId: datos.itemId, precio: precioTexto }), setAvisoPrecio);
            }}
          >
            <input className="zx-control" inputMode="decimal" value={precioTexto} onChange={(e) => setPrecioTexto(e.target.value)} aria-label="Precio nuevo" />
            <Boton type="submit" disabled={enviando || !precio}>
              Guardar precio
            </Boton>
          </form>
        )}
        {!precioBloqueado ? (
          <p className={styles.simulacion}>
            {textoSimulacion(precio, sim, datos.vendidas, (v) => plata(v), datos.idioma)}
          </p>
        ) : null}
        <p className={styles.notaNeutra}>
          Estimación con los costos del período elegido arriba. La comisión real depende del tipo de publicación, y la competencia también mira reputación y
          envío.
        </p>
        <AvisoLinea aviso={avisoPrecio} />
      </section>

      <section className={styles.bloqueEdicion} aria-label="Título">
        <p className={styles.seccion}>Título</p>
        <p className={styles.nota}>
          <strong>Título actual:</strong> {datos.titulo ?? "—"}
          {datos.titulo ? <span className={styles.notaNeutra}>{` (${datos.titulo.length}/${LARGO_TITULO_ML} caracteres)`}</span> : null}
        </p>
        <div>
          <Boton type="button" disabled={generando || enviando || !datos.titulo} onClick={() => void mejorarTitulo()}>
            Mejorar título
          </Boton>
        </div>
        <BarraCarga sticky={false} estado={generando ? "cargando" : "inactiva"} titulo="Generando títulos con IA…" ariaLabel="Progreso de la IA" />
        {falloIA ? (
          <p className={styles.avisoError} role="status">
            {falloIA.aviso}{" "}
            {falloIA.conectarIA ? <Link href={RUTA_CONECTAR_IA}>Ir a Conectar IA</Link> : null}
          </p>
        ) : null}
        {propuesta ? (
          <>
            <ul className={styles.listaTitulos} aria-label="Títulos sugeridos">
              {propuesta.titulos.map((t) => filaSugerencia(t, propuesta.largoMaximo || LARGO_TITULO_ML))}
              {propuesta.catalogo ? filaSugerencia(propuesta.catalogo, propuesta.largoMaximoCatalogo || LARGO_TITULO_CATALOGO_ML, "Catálogo") : null}
            </ul>
            {!propuesta.puedeGuardar ? (
              <p className={styles.nota}>
                {`Mercado Libre no deja cambiar el título de publicaciones con ventas (esta lleva ${propuesta.vendidas}). Copia la sugerencia si la quieres usar en otra publicación.`}
              </p>
            ) : null}
          </>
        ) : null}
        {datos.vendidas > 0 ? (
          propuesta ? null : <p className={styles.nota}>{`Mercado Libre solo deja cambiar el título de publicaciones sin ventas (esta lleva ${datos.vendidas}).`}</p>
        ) : (
          <>
            {datos.userProduct ? (
              <p className={styles.nota}>
                En esta publicación Mercado Libre cambia el título a través del nombre del producto: puede tardar unos minutos en verse y se aplica a todas las
                publicaciones de este mismo producto.
              </p>
            ) : null}
            <form
              className={styles.buscador}
              onSubmit={(e) => {
                e.preventDefault();
                if (!window.confirm(`¿Cambiar el título en Mercado Libre por: ${titulo.trim()}?`)) return;
                guardar("título", () => editarTituloAction({ cuentaMlId: datos.cuentaMlId, itemId: datos.itemId, titulo }), setAvisoTitulo);
              }}
            >
              <input className="zx-control" value={titulo} maxLength={100} onChange={(e) => setTitulo(e.target.value)} aria-label="Título nuevo" />
              <Boton type="submit" disabled={enviando || !titulo.trim()}>
                Guardar título
              </Boton>
            </form>
          </>
        )}
        <AvisoLinea aviso={avisoTitulo} />
      </section>

      <section className={styles.bloqueEdicion} aria-label="Fotos">
        <p className={styles.seccion}>Fotos</p>
        <p className={styles.notaNeutra}>
          La primera es la portada. Arrastra las fotos para cambiar el orden, quita con ×, y agrega con + (o soltando archivos de tu equipo). Después guarda.
        </p>
        <GaleriaFotos urls={fotos} onChange={setFotos} cloudinaryConfigurado={datos.cloudinaryConfigurado} limiteFotos={null} conCanva={false} />
        {datos.cloudinaryConfigurado && fotos.length > 0 ? (
          <CrearImagenIA
            cuentaMlId={datos.cuentaMlId}
            itemId={datos.itemId}
            fotos={fotos}
            tituloProducto={datos.titulo}
            estado={datos.iaImagen}
            onAgregar={(url, comoPortada) => {
              setFotosIA((a) => [...a, url]);
              setFotos((actuales) => (comoPortada ? [url, ...actuales] : [...actuales, url]));
            }}
          />
        ) : null}
        <Boton
          type="button"
          disabled={enviando || fotos.length === 0}
          onClick={() =>
            guardar(
              "fotos",
              () =>
                editarFotosAction({
                  cuentaMlId: datos.cuentaMlId,
                  itemId: datos.itemId,
                  fotosIA,
                  fotos: fotos.map((url) => {
                    const id = idPorUrl.get(url);
                    return id ? { id } : { url };
                  }),
                }),
              setAvisoFotos
            )
          }
        >
          Guardar fotos
        </Boton>
        <AvisoLinea aviso={avisoFotos} />
      </section>
    </div>
  );
}
