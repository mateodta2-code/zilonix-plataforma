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
// Largo del título que Mercado Libre muestra completo (el mismo que usa Publicar).
const LARGO_TITULO_ACTUAL = 60;

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
  // «Mejorar título» con la IA: estado aparte del guardado (su propia barra).
  const [generando, setGenerando] = useState(false);
  const [sugerencias, setSugerencias] = useState<Extract<ResultadoMejorarTitulo, { ok: true }> | null>(null);
  const [avisoIA, setAvisoIA] = useState<{ texto: string; conectarIA?: boolean } | null>(null);

  async function mejorarTitulo() {
    setGenerando(true);
    setAvisoIA(null);
    setAvisoTitulo(null);
    try {
      const r = await mejorarTituloIAAction({ cuentaMlId: datos.cuentaMlId, itemId: datos.itemId });
      if (r.ok) setSugerencias(r);
      else setAvisoIA({ texto: r.aviso, conectarIA: r.conectarIA });
    } catch {
      setAvisoIA({ texto: "No se pudo generar los títulos. Intenta de nuevo." });
    } finally {
      setGenerando(false);
    }
  }

  async function copiar(texto: string) {
    try {
      await navigator.clipboard.writeText(texto);
      setAvisoTitulo({ ok: true, texto: "Copiado" });
    } catch {
      setAvisoTitulo({ ok: false, texto: "No se pudo copiar. Selecciona el texto y cópialo a mano." });
    }
  }

  // Fotos: la misma galería de Publicar (portada marcada, subir desde el
  // equipo, arrastrar para ordenar). Trabaja con URLs; al guardar, las
  // que ya tenía la publicación vuelven a su id de Mercado Libre.
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
          {"Título actual: "}
          <strong>{datos.titulo ?? "—"}</strong>
        </p>
        <span className={styles.notaNeutra}>{`${(datos.titulo ?? "").length}/${LARGO_TITULO_ACTUAL} caracteres`}</span>
        <div>
          <Boton type="button" variante="secundario" disabled={generando || enviando} onClick={mejorarTitulo}>
            Mejorar título
          </Boton>
        </div>
        <BarraCarga sticky={false} estado={generando ? "cargando" : "inactiva"} titulo="Generando títulos con IA…" ariaLabel="Progreso de la IA" />
        {avisoIA ? (
          <p className={styles.avisoError} role="alert">
            {avisoIA.texto}
            {avisoIA.conectarIA ? (
              <>
                {" "}
                <Link href={RUTA_CONECTAR_IA}>Ir a Conectar IA</Link>
              </>
            ) : null}
          </p>
        ) : null}
        {sugerencias ? (
          <>
            <ul className={styles.sugerenciasTitulo} aria-label="Títulos sugeridos">
              {[...sugerencias.titulos.map((t) => ({ t, max: sugerencias.largoMaximo, etiqueta: null as string | null })), ...(sugerencias.catalogo ? [{ t: sugerencias.catalogo, max: sugerencias.largoMaximoCatalogo, etiqueta: "Para catálogo" }] : [])].map(
                ({ t, max, etiqueta }) => (
                  <li key={t} className={styles.sugerenciaTitulo}>
                    <span className={styles.sugerenciaTexto}>
                      {etiqueta ? <span className={styles.sugerenciaLargo}>{etiqueta}</span> : null}
                      <span>{t}</span>
                      <span className={styles.sugerenciaLargo}>{`${t.length}/${max} caracteres`}</span>
                    </span>
                    {sugerencias.puedeGuardar ? (
                      <Boton type="button" variante="secundario" chico onClick={() => setTitulo(t)}>
                        Usar este título
                      </Boton>
                    ) : (
                      <Boton type="button" variante="secundario" chico onClick={() => copiar(t)}>
                        Copiar
                      </Boton>
                    )}
                  </li>
                )
              )}
            </ul>
          </>
        ) : null}
        {datos.vendidas > 0 ? (
          <p className={styles.nota}>
            {`Mercado Libre no deja cambiar el título de publicaciones con ventas (esta lleva ${datos.vendidas}). Copia la sugerencia si la quieres usar en otra publicación.`}
          </p>
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
            onAgregar={(url, comoPortada) => setFotos((actuales) => (comoPortada ? [url, ...actuales] : [...actuales, url]))}
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
