"use client";

import { useEffect, useState } from "react";
import { Boton } from "@/components/marco/Boton";
import { BarraCarga } from "@/components/marco/BarraCarga";
import { CeldaTabla, FilaTabla, Tabla } from "@/components/marco/Tabla";
import { formatearMoneda, formatearNumero } from "@/lib/ml/sitios";
import {
  alertasCompetidoresExtension,
  leerMensajeCompetidores,
  paisDeSitio,
  rotuloAntiguedad,
  terminoDesdeTitulo,
  textoRazonCompetidores,
  type CompetidorExtension,
} from "@/lib/optimizacion/competidoresExtension";
import styles from "./page.module.css";

export type PropiaCompetidores = {
  itemId: string;
  titulo: string | null;
  foto: string | null;
  enlace: string | null;
  precio: number | null;
  precioOriginal: number | null;
  envioGratis: boolean | null;
  full: boolean | null;
};

type Guardado = { ts: number; termino: string; candidatos: number; competidores: CompetidorExtension[] };

// La búsqueda tarda (listado + 10 fichas): se guarda 1 hora en este
// navegador para no repetirla al cerrar y abrir la fila. Mismo criterio
// que los bloques de Investigación (lib/ml/listadoCliente.ts).
const TTL_MS = 60 * 60 * 1000;
// Tope del lado de la página por si la extensión nunca contesta
// (Service Worker reciclado): 20 s de listado + 10 × (15 s + pausa).
const ESPERA_MAXIMA_MS = 4 * 60 * 1000;

const ENCABEZADOS = [
  "Publicación",
  { clave: "precio", contenido: "Precio", numerica: true },
  { clave: "vendidos", contenido: "Vendidos", numerica: true },
  "Calificación",
  "Full",
  "Envío gratis",
  "Catálogo",
  { clave: "fotos", contenido: "Fotos", numerica: true },
  "Antigüedad",
  { clave: "ventasMes", contenido: "Ventas/mes aprox.", numerica: true },
  { clave: "facturacion", contenido: "Facturación/mes aprox.", numerica: true },
];

function clave(itemId: string) {
  return `zx-optimizacion-competidores:${itemId}`;
}

function leerGuardado(itemId: string): Guardado | null {
  try {
    const crudo = window.localStorage.getItem(clave(itemId));
    if (!crudo) return null;
    const g = JSON.parse(crudo) as Guardado;
    if (typeof g?.ts !== "number" || Date.now() - g.ts > TTL_MS || !Array.isArray(g.competidores)) return null;
    // Se vuelve a validar como si llegara de la extensión.
    const revalidado = leerMensajeCompetidores(
      { fuente: "zilonix-extension", tipo: "competidores-leidos", payload: { excluirItemId: itemId, termino: g.termino, candidatos: g.candidatos, competidores: g.competidores } },
      itemId
    );
    return revalidado?.tipo === "ok" ? { ts: g.ts, termino: revalidado.termino, candidatos: revalidado.candidatos, competidores: revalidado.competidores } : null;
  } catch {
    return null;
  }
}

function guardar(itemId: string, g: Guardado) {
  try {
    window.localStorage.setItem(clave(itemId), JSON.stringify(g));
  } catch {
    // Sin almacenamiento (modo privado): solo no se recuerda.
  }
}

function siNo(valor: boolean | null): string {
  return valor === null ? "—" : valor ? "Sí" : "No";
}

// Fuera del catálogo: la extensión busca el producto en Mercado Libre,
// toma los 10 primeros resultados (sin esta publicación) y lee la ficha
// de cada uno — lo mismo que su panel muestra al analizar un producto.
export function CompetidoresExtension({ propia, siteId, idioma }: { propia: PropiaCompetidores; siteId: string; idioma: string }) {
  const [conExtension, setConExtension] = useState<boolean | null>(null);
  const [termino, setTermino] = useState(() => terminoDesdeTitulo(propia.titulo));
  const [buscando, setBuscando] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);
  const [resultado, setResultado] = useState<Guardado | null>(null);

  useEffect(() => {
    setConExtension(document.documentElement.getAttribute("data-zilonix-extension") === "1");
    setResultado(leerGuardado(propia.itemId));
  }, [propia.itemId]);

  useEffect(() => {
    if (!buscando) return;
    function alMensaje(evento: MessageEvent) {
      if (evento.source !== window || evento.origin !== window.location.origin) return;
      const m = leerMensajeCompetidores(evento.data, propia.itemId);
      if (!m) return;
      setBuscando(false);
      if (m.tipo === "error") {
        setAviso(textoRazonCompetidores(m.razon));
        return;
      }
      const nuevo = { ts: Date.now(), termino: m.termino, candidatos: m.candidatos, competidores: m.competidores };
      setResultado(nuevo);
      guardar(propia.itemId, nuevo);
    }
    window.addEventListener("message", alMensaje);
    const tope = setTimeout(() => {
      setBuscando(false);
      setAviso("La extensión no respondió. Revisa que esté actualizada y vuelve a buscar.");
    }, ESPERA_MAXIMA_MS);
    return () => {
      window.removeEventListener("message", alMensaje);
      clearTimeout(tope);
    };
  }, [buscando, propia.itemId]);

  function buscar() {
    const limpio = termino.trim();
    if (!limpio) {
      setAviso("Escribe qué buscar en Mercado Libre.");
      return;
    }
    setAviso(null);
    setBuscando(true);
    window.postMessage(
      { fuente: "zilonix-panel", tipo: "iniciar-competidores", payload: { termino: limpio, pais: paisDeSitio(siteId), excluirItemId: propia.itemId } },
      window.location.origin
    );
  }

  if (conExtension === null) return null;
  if (!conExtension) {
    return (
      <p className={styles.nota}>
        Esta publicación no está en el catálogo de Mercado Libre. Para compararla con otras del mismo producto, instala o actualiza la extensión de Zilonix (versión
        0.3.46 o más nueva) y recarga esta página.
      </p>
    );
  }

  const plata = (v: number | null) => (v === null ? "—" : formatearMoneda(v, siteId));
  const num = (v: number | null) => (v === null ? "—" : formatearNumero(v, idioma));
  const competidores = resultado?.competidores ?? [];
  const alertas = resultado ? alertasCompetidoresExtension(propia, competidores) : [];

  return (
    <div className={styles.desglose}>
      <p className={styles.nota}>
        No está en el catálogo. La extensión busca el producto en Mercado Libre, toma los 10 primeros resultados y lee la ficha de cada uno. Se abre una pestaña
        que se cierra sola al terminar (tarda 1 a 2 minutos).
      </p>
      <form
        className={styles.buscador}
        onSubmit={(e) => {
          e.preventDefault();
          buscar();
        }}
      >
        <input
          className="zx-control"
          type="search"
          value={termino}
          onChange={(e) => setTermino(e.target.value)}
          maxLength={120}
          placeholder="Qué buscar (marca, modelo…)"
          aria-label="Qué buscar en Mercado Libre"
          disabled={buscando}
        />
        <Boton type="submit" disabled={buscando}>
          {buscando ? "Buscando…" : resultado ? "Buscar de nuevo" : "Buscar 10 competidores"}
        </Boton>
      </form>
      {aviso ? <p className={styles.avisoError}>{aviso}</p> : null}
      <BarraCarga sticky={false} estado={buscando ? "cargando" : "inactiva"} titulo="Leyendo el listado y las fichas en Mercado Libre…" ariaLabel="Progreso de la búsqueda de competidores" />
      {buscando ? <p className={styles.nota}>No cierres la pestaña que se abrió.</p> : null}

      {resultado ? (
        competidores.length === 0 ? (
          <p className={styles.nota}>La búsqueda no trajo otras publicaciones.</p>
        ) : (
          <>
            {alertas.length > 0 ? (
              <ul className={styles.alertas}>
                {alertas.map((a) => (
                  <li key={a}>{a}</li>
                ))}
              </ul>
            ) : (
              <p className={styles.avisoOk}>No te falta nada frente a estas publicaciones.</p>
            )}
            <Tabla encabezados={ENCABEZADOS} scroll>
              <FilaTabla className={styles.filaPropia}>
                <CeldaTabla>
                  <div className={styles.publicacion}>
                    {propia.foto ? <img className={styles.foto} src={propia.foto} alt="" width={40} height={40} loading="lazy" /> : <span className={styles.foto} />}
                    <div>
                      <strong>Tú · </strong>
                      {propia.enlace ? (
                        <a href={propia.enlace} target="_blank" rel="noopener noreferrer" className={styles.enlace}>
                          {propia.titulo ?? propia.itemId}
                        </a>
                      ) : (
                        (propia.titulo ?? propia.itemId)
                      )}
                    </div>
                  </div>
                </CeldaTabla>
                <CeldaTabla numerica>
                  {plata(propia.precio)}
                  {propia.precioOriginal !== null ? <span className={styles.precioAntes}>{plata(propia.precioOriginal)}</span> : null}
                </CeldaTabla>
                <CeldaTabla numerica>—</CeldaTabla>
                <CeldaTabla>—</CeldaTabla>
                <CeldaTabla>{siNo(propia.full)}</CeldaTabla>
                <CeldaTabla>{siNo(propia.envioGratis)}</CeldaTabla>
                <CeldaTabla>No</CeldaTabla>
                <CeldaTabla numerica>—</CeldaTabla>
                <CeldaTabla>—</CeldaTabla>
                <CeldaTabla numerica>—</CeldaTabla>
                <CeldaTabla numerica>—</CeldaTabla>
              </FilaTabla>
              {competidores.map((c) => (
                <FilaTabla key={c.itemId ?? c.link}>
                  <CeldaTabla>
                    <div className={styles.publicacion}>
                      {c.foto ? <img className={styles.foto} src={c.foto} alt="" width={40} height={40} loading="lazy" /> : <span className={styles.foto} />}
                      <div>
                        <a href={c.link} target="_blank" rel="noopener noreferrer" className={styles.enlace}>
                          {c.titulo ?? c.itemId ?? "Publicación"}
                        </a>
                        <div className={styles.nota}>
                          {[c.vendedor, c.itemId, c.leidoDeFicha ? null : "solo datos del listado"].filter(Boolean).join(" · ")}
                        </div>
                      </div>
                    </div>
                  </CeldaTabla>
                  <CeldaTabla numerica>
                    {plata(c.precio)}
                    {c.precioAnterior !== null ? <span className={styles.precioAntes}>{plata(c.precioAnterior)}</span> : null}
                    {c.descuentoPorcentaje !== null ? <div className={styles.nota}>{`${c.descuentoPorcentaje}% OFF`}</div> : null}
                  </CeldaTabla>
                  <CeldaTabla numerica>
                    {c.vendidos === null ? "—" : c.vendidosExacto === false ? `+${num(c.vendidos)}` : num(c.vendidos)}
                  </CeldaTabla>
                  <CeldaTabla>
                    {c.calificacion === null ? "—" : `${c.calificacion} / 5`}
                    {c.numeroOpiniones !== null ? <div className={styles.nota}>{`${num(c.numeroOpiniones)} opiniones`}</div> : null}
                  </CeldaTabla>
                  <CeldaTabla>{siNo(c.full)}</CeldaTabla>
                  <CeldaTabla>{siNo(c.envioGratis)}</CeldaTabla>
                  <CeldaTabla>{siNo(c.esCatalogo)}</CeldaTabla>
                  <CeldaTabla numerica>{num(c.fotos)}</CeldaTabla>
                  <CeldaTabla>{rotuloAntiguedad(c.antiguedadDias) ?? "—"}</CeldaTabla>
                  <CeldaTabla numerica>{num(c.ventasMes)}</CeldaTabla>
                  <CeldaTabla numerica>{plata(c.facturacionMes)}</CeldaTabla>
                </FilaTabla>
              ))}
            </Tabla>
            <p className={styles.notaNeutra}>
              {`${competidores.length} publicaciones de la búsqueda «${resultado.termino}», en el orden de Mercado Libre. "—" = la ficha no lo mostró. "+N" = Mercado Libre solo muestra el rango. Ventas/mes y facturación son aproximados, igual que en la extensión: nunca un dato que Mercado Libre confirme.`}
            </p>
          </>
        )
      ) : null}
    </div>
  );
}
