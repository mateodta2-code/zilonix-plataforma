"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Boton } from "@/components/marco/Boton";
import { formatearMoneda } from "@/lib/ml/sitios";
import { leerPrecioEscrito, simularPrecio, textoSimulacion, type BaseSimulacion } from "@/lib/optimizacion/simulador";
import { GaleriaFotos } from "../../publicar/GaleriaFotos";
import { CrearImagenIA, type EstadoIAImagen } from "./CrearImagenIA";
import { editarFotosAction, editarPrecioAction, editarTituloAction } from "../actions";
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
  fotos: { id: string; url: string }[];
  // Sin Cloudinary, la galería vuelve a pedir enlaces (no hay dónde subir).
  cloudinaryConfigurado: boolean;
  // Crear imagen con IA: depende de la conexión de IA de la empresa.
  iaImagen: EstadoIAImagen;
  base: BaseSimulacion;
};

type Aviso = { ok: boolean; texto: string } | null;

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

  // Fotos: la misma galería de Publicar (portada marcada, subir desde el
  // equipo, arrastrar para ordenar). Trabaja con URLs; al guardar, las
  // que ya tenía la publicación vuelven a su id de Mercado Libre.
  const [fotos, setFotos] = useState(() => datos.fotos.map((f) => f.url));
  const [avisoFotos, setAvisoFotos] = useState<Aviso>(null);
  const idPorUrl = new Map(datos.fotos.map((f) => [f.url, f.id]));

  function guardar(accion: () => Promise<{ ok: boolean; aviso: string }>, setAviso: (a: Aviso) => void) {
    iniciar(async () => {
      const r = await accion();
      setAviso({ ok: r.ok, texto: r.aviso });
      if (r.ok) router.refresh();
    });
  }

  return (
    <div className={styles.edicion}>
      <section className={styles.bloqueEdicion} aria-label="Precio">
        <p className={styles.seccion}>Precio</p>
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
              guardar(() => editarPrecioAction({ cuentaMlId: datos.cuentaMlId, itemId: datos.itemId, precio: precioTexto }), setAvisoPrecio);
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
        {datos.vendidas > 0 ? (
          <p className={styles.nota}>{`Mercado Libre solo deja cambiar el título de publicaciones sin ventas (esta lleva ${datos.vendidas}).`}</p>
        ) : (
          <form
            className={styles.buscador}
            onSubmit={(e) => {
              e.preventDefault();
              guardar(() => editarTituloAction({ cuentaMlId: datos.cuentaMlId, itemId: datos.itemId, titulo }), setAvisoTitulo);
            }}
          >
            <input className="zx-control" value={titulo} maxLength={100} onChange={(e) => setTitulo(e.target.value)} aria-label="Título nuevo" />
            <Boton type="submit" disabled={enviando || !titulo.trim()}>
              Guardar título
            </Boton>
          </form>
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
