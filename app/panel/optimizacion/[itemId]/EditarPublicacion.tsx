"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Boton } from "@/components/marco/Boton";
import { formatearMoneda } from "@/lib/ml/sitios";
import { leerPrecioEscrito, simularPrecio, type BaseSimulacion } from "@/lib/optimizacion/simulador";
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

  // Fotos: orden de las actuales y enlaces nuevos.
  const [fotos, setFotos] = useState(datos.fotos);
  const [nuevaUrl, setNuevaUrl] = useState("");
  const [nuevas, setNuevas] = useState<string[]>([]);
  const [avisoFotos, setAvisoFotos] = useState<Aviso>(null);

  function guardar(accion: () => Promise<{ ok: boolean; aviso: string }>, setAviso: (a: Aviso) => void) {
    iniciar(async () => {
      const r = await accion();
      setAviso({ ok: r.ok, texto: r.aviso });
      if (r.ok) router.refresh();
    });
  }

  function mover(indice: number, hacia: number) {
    const destino = indice + hacia;
    if (destino < 0 || destino >= fotos.length) return;
    const copia = [...fotos];
    [copia[indice], copia[destino]] = [copia[destino], copia[indice]];
    setFotos(copia);
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
            <Boton type="submit" chico disabled={enviando || !precio}>
              Guardar precio
            </Boton>
          </form>
        )}
        {!precioBloqueado ? (
          <p className={styles.simulacion}>
            {!precio
              ? "Escribe un precio para simular."
              : sim?.ganancia === null || sim?.ganancia === undefined
                ? `Con ${plata(precio)}: no hay ventas con costos completos en este período para estimar la ganancia.`
                : `Si lo dejas en ${plata(precio)}, ganas ${plata(sim.ganancia)} por unidad (${Number(sim.margen).toLocaleString(datos.idioma, { maximumFractionDigits: 1 })} %)`}
            {precio && sim?.competencia ? ` y quedas ${sim.competencia === "ganando" ? "Ganando" : "Compitiendo"} en el catálogo` : ""}
            {precio ? "." : ""}
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
            <Boton type="submit" chico disabled={enviando || !titulo.trim()}>
              Guardar título
            </Boton>
          </form>
        )}
        <AvisoLinea aviso={avisoTitulo} />
      </section>

      <section className={styles.bloqueEdicion} aria-label="Fotos">
        <p className={styles.seccion}>Fotos</p>
        <p className={styles.notaNeutra}>La primera es la portada. Cambia el orden, quita o agrega por enlace (https) y guarda.</p>
        <ul className={styles.fotosEdicion}>
          {fotos.map((foto, i) => (
            <li key={foto.id}>
              <img src={foto.url} alt="" width={72} height={72} loading="lazy" className={styles.fotoEdicion} />
              <span className={styles.accionesFoto}>
                <button type="button" className={styles.expandir} aria-label="Mover antes" onClick={() => mover(i, -1)} disabled={i === 0}>
                  ←
                </button>
                <button type="button" className={styles.expandir} aria-label="Mover después" onClick={() => mover(i, 1)} disabled={i === fotos.length - 1}>
                  →
                </button>
                <button type="button" className={styles.expandir} aria-label="Quitar foto" onClick={() => setFotos(fotos.filter((f) => f.id !== foto.id))}>
                  ✕
                </button>
              </span>
            </li>
          ))}
          {nuevas.map((url) => (
            <li key={url}>
              <img src={url} alt="" width={72} height={72} loading="lazy" className={styles.fotoEdicion} />
              <span className={styles.accionesFoto}>
                <button type="button" className={styles.expandir} aria-label="Quitar foto nueva" onClick={() => setNuevas(nuevas.filter((u) => u !== url))}>
                  ✕
                </button>
              </span>
            </li>
          ))}
        </ul>
        <div className={styles.buscador}>
          <input className="zx-control" type="url" placeholder="https://…" value={nuevaUrl} onChange={(e) => setNuevaUrl(e.target.value)} aria-label="Enlace de una foto nueva" />
          <Boton
            type="button"
            variante="secundario"
            chico
            disabled={!nuevaUrl.trim().startsWith("https://")}
            onClick={() => {
              const url = nuevaUrl.trim();
              if (url.startsWith("https://") && !nuevas.includes(url)) setNuevas([...nuevas, url]);
              setNuevaUrl("");
            }}
          >
            Agregar
          </Boton>
        </div>
        <Boton
          type="button"
          chico
          disabled={enviando || fotos.length + nuevas.length === 0}
          onClick={() =>
            guardar(
              () => editarFotosAction({ cuentaMlId: datos.cuentaMlId, itemId: datos.itemId, orden: fotos.map((f) => f.id), nuevas }),
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
