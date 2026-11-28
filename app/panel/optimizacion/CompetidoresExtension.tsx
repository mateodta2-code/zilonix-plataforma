"use client";

import { useEffect, useRef, useState } from "react";
import { Boton } from "@/components/marco/Boton";
import { BarraCarga } from "@/components/marco/BarraCarga";
import { CeldaTabla, FilaTabla, Tabla } from "@/components/marco/Tabla";
import { formatearMoneda, formatearNumero } from "@/lib/ml/sitios";
import {
  alertasCompetidoresExtension,
  claveCompetidor,
  esLinkCompetidorValido,
  esperaMaximaMs,
  fusionarCompetidores,
  leerMensajeCompetidores,
  MAXIMO_COMPETIDORES_EXTENSION,
  nivelParecido,
  paisDeSitio,
  parecidoTitulos,
  quitarCompetidor,
  ROTULO_PARECIDO,
  rotuloAntiguedad,
  terminoDesdeTitulo,
  textoCambio,
  TERMINO_POR_LINK,
  textoRazonCompetidores,
  type CompetidorExtension,
} from "@/lib/optimizacion/competidoresExtension";
import { FotoAmpliable } from "./FotoAmpliable";
import { competidoresGuardadosAction, guardarCompetidoresAction } from "./actions";
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

// El background de la extensión ignora un segundo pedido en menos de 10 s.
const PAUSA_ENTRE_PEDIDOS_MS = 10_500;

type Pedido = { modo: "busqueda" | "links"; fichas: number };

const ENCABEZADOS = [
  "Publicación",
  "Tienda",
  { clave: "precio", contenido: "Precio", numerica: true },
  { clave: "vendidos", contenido: "Vendidos", numerica: true },
  { clave: "disponibles", contenido: "Disponibles", numerica: true },
  "Calificación",
  "Full",
  "Envío gratis",
  "Catálogo",
  { clave: "fotos", contenido: "Fotos", numerica: true },
  "Antigüedad",
  { clave: "ventasMes", contenido: "Ventas/mes aprox.", numerica: true },
  { clave: "facturacion", contenido: "Facturación/mes aprox.", numerica: true },
  "Actualizado",
  "Quitar",
];

function siNo(valor: boolean | null): string {
  return valor === null ? "—" : valor ? "Sí" : "No";
}

// Fuera del catálogo: la extensión busca el producto en Mercado Libre,
// toma los 10 resultados más parecidos (sin esta publicación) y lee la
// ficha de cada uno — lo mismo que su panel muestra al analizar un
// producto. La persona también puede agregar un competidor por su link,
// actualizar todos los guardados y quitar los que ya no quiere: todo
// queda guardado en Zilonix por publicación.
export function CompetidoresExtension({ propia, cuentaMlId, siteId, idioma, sinPermisoMl = false }: { propia: PropiaCompetidores; cuentaMlId: string; siteId: string; idioma: string; sinPermisoMl?: boolean }) {
  const motivo = sinPermisoMl ? "Mercado Libre no deja leer la competencia de esta publicación por API" : "Esta publicación no está en el catálogo de Mercado Libre";
  const [conExtension, setConExtension] = useState<boolean | null>(null);
  const [termino, setTermino] = useState(() => terminoDesdeTitulo(propia.titulo));
  const [linkNuevo, setLinkNuevo] = useState("");
  const [buscando, setBuscando] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);
  const [avisoOk, setAvisoOk] = useState<string | null>(null);
  const [resultado, setResultado] = useState<Guardado | null>(null);
  const resultadoRef = useRef<Guardado | null>(null);
  resultadoRef.current = resultado;
  const pedidoRef = useRef<Pedido>({ modo: "busqueda", fichas: 10 });
  const ultimoPedidoRef = useRef(0);

  useEffect(() => {
    setConExtension(document.documentElement.getAttribute("data-zilonix-extension") === "1");
    // Lo último que se leyó queda guardado en Zilonix, no en este navegador.
    let vigente = true;
    competidoresGuardadosAction({ cuentaMlId, itemId: propia.itemId }).then(
      (r) => {
        if (!vigente) return;
        if (r.ok && r.guardado) setResultado({ ts: Date.parse(r.guardado.leidoTs), termino: r.guardado.termino, candidatos: r.guardado.candidatos, competidores: r.guardado.competidores });
      },
      () => undefined
    );
    return () => {
      vigente = false;
    };
  }, [cuentaMlId, propia.itemId]);

  // Guarda en Zilonix la lista tal como quedó (también cuando queda vacía).
  function guardar(competidores: CompetidorExtension[], terminoGuardado: string, candidatos: number) {
    const nuevo: Guardado = { ts: Date.now(), termino: terminoGuardado, candidatos, competidores };
    setResultado(nuevo);
    guardarCompetidoresAction({ cuentaMlId, itemId: propia.itemId, termino: terminoGuardado, candidatos, competidores }).then(
      (g) => {
        if (!g.ok) setAviso(g.aviso);
      },
      () => setAviso("Se leyeron los competidores pero no se pudieron guardar. Intenta de nuevo.")
    );
  }

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
      // El modo es el que pidió esta página, no el que diga el mensaje.
      const modo = pedidoRef.current.modo;
      const actual = resultadoRef.current;
      const fusion = fusionarCompetidores(actual?.competidores ?? [], m.competidores, modo, new Date().toISOString());
      if (modo === "links") {
        setAvisoOk(
          fusion.leidos > 0
            ? `Se actualizaron los datos de ${fusion.leidos} ${fusion.leidos === 1 ? "competidor" : "competidores"}: ${fusion.conCambios === 0 ? "ninguno cambió" : `${fusion.conCambios} con cambios`}.`
            : null
        );
        if (fusion.noLeidos > 0) setAviso(`${fusion.noLeidos} no se pudo leer en Mercado Libre; se conservan los datos que ya tenías.`);
        if (fusion.leidos === 0) return;
      }
      guardar(fusion.lista, modo === "busqueda" ? m.termino : (actual?.termino ?? TERMINO_POR_LINK), modo === "busqueda" ? m.candidatos : (actual?.candidatos ?? fusion.lista.length));
    }
    window.addEventListener("message", alMensaje);
    const tope = setTimeout(() => {
      setBuscando(false);
      setAviso("La extensión no respondió. Revisa que esté actualizada y vuelve a intentar.");
    }, esperaMaximaMs(pedidoRef.current.fichas));
    return () => {
      window.removeEventListener("message", alMensaje);
      clearTimeout(tope);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [buscando, propia.itemId, cuentaMlId]);

  function pedir(pedido: Pedido, payload: Record<string, unknown>) {
    if (Date.now() - ultimoPedidoRef.current < PAUSA_ENTRE_PEDIDOS_MS) {
      setAviso("Espera unos segundos antes de pedir otra lectura.");
      return;
    }
    ultimoPedidoRef.current = Date.now();
    pedidoRef.current = pedido;
    setAviso(null);
    setAvisoOk(null);
    setBuscando(true);
    window.postMessage({ fuente: "zilonix-panel", tipo: "iniciar-competidores", payload: { ...payload, pais: paisDeSitio(siteId), excluirItemId: propia.itemId, tituloPropio: propia.titulo ?? "" } }, window.location.origin);
  }

  function buscar() {
    const limpio = termino.trim();
    if (!limpio) {
      setAviso("Escribe qué buscar en Mercado Libre.");
      return;
    }
    pedir({ modo: "busqueda", fichas: 10 }, { termino: limpio });
  }

  function agregarPorLink() {
    const link = linkNuevo.trim();
    if (!esLinkCompetidorValido(link)) {
      setAviso("Pega un link de una publicación de Mercado Libre (empieza con https://).");
      return;
    }
    const guardados = resultadoRef.current?.competidores ?? [];
    if (guardados.some((c) => c.link === link)) {
      setAviso("Ese competidor ya está en la lista. Usa «Actualizar datos» para volver a leerlo.");
      return;
    }
    if (guardados.length >= MAXIMO_COMPETIDORES_EXTENSION) {
      setAviso(`Ya hay ${MAXIMO_COMPETIDORES_EXTENSION} competidores guardados. Quita alguno para agregar otro.`);
      return;
    }
    pedir({ modo: "links", fichas: 1 }, { links: [link] });
    setLinkNuevo("");
  }

  function actualizarTodos() {
    const guardados = resultadoRef.current?.competidores ?? [];
    if (guardados.length === 0) return;
    pedir({ modo: "links", fichas: guardados.length }, { links: guardados.map((c) => ({ link: c.link, itemId: c.itemId })) });
  }

  function quitar(c: CompetidorExtension) {
    const actual = resultadoRef.current;
    if (!actual) return;
    setAviso(null);
    setAvisoOk(`Quitaste «${c.titulo ?? c.itemId ?? "la publicación"}» de la lista.`);
    guardar(quitarCompetidor(actual.competidores, claveCompetidor(c)), actual.termino, actual.candidatos);
  }

  if (conExtension === null) return null;
  if (!conExtension && !resultado) {
    return (
      <p className={styles.nota}>
        {motivo}. Para compararla con otras del mismo producto, instala o actualiza la extensión de Zilonix (versión
        0.3.49 o más nueva) y recarga esta página.
      </p>
    );
  }

  const plata = (v: number | null) => (v === null ? "—" : formatearMoneda(v, siteId));
  const num = (v: number | null) => (v === null ? "—" : formatearNumero(v, idioma));
  const competidores = resultado?.competidores ?? [];
  const alertas = resultado && competidores.length > 0 ? alertasCompetidoresExtension(propia, competidores) : [];
  const comparados = competidores.filter((c) => c.cambiosDesdeTs !== null);
  const conCambios = comparados.filter((c) => c.cambios.length > 0);
  const formatoFecha = (iso: string) => new Date(iso).toLocaleString(idioma || "es", { dateStyle: "short", timeStyle: "short" });

  return (
    <div className={styles.desglose}>
      <p className={styles.nota}>
        {sinPermisoMl ? "Mercado Libre no deja leer la competencia por API." : "No está en el catálogo."} La extensión busca el producto en Mercado Libre, lee la ficha de los 10 resultados más parecidos a tu publicación y los guarda aquí. También puedes agregar un competidor
        con su link. Se abre una pestaña que se cierra sola al terminar (tarda 1 a 2 minutos).
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
        <Boton type="submit" disabled={buscando || !conExtension}>
          {buscando ? "Leyendo…" : competidores.length > 0 ? "Buscar de nuevo" : "Buscar 10 competidores"}
        </Boton>
      </form>
      <form
        className={styles.buscador}
        onSubmit={(e) => {
          e.preventDefault();
          agregarPorLink();
        }}
      >
        <input
          className="zx-control"
          type="url"
          value={linkNuevo}
          onChange={(e) => setLinkNuevo(e.target.value)}
          maxLength={500}
          placeholder="Pega el link de un competidor para seguirlo"
          aria-label="Link de un competidor en Mercado Libre"
          disabled={buscando}
        />
        <Boton type="submit" variante="secundario" disabled={buscando || !conExtension || !linkNuevo.trim()}>
          Agregar competidor
        </Boton>
      </form>
      {aviso ? <p className={styles.avisoError}>{aviso}</p> : null}
      {avisoOk ? <p className={styles.avisoOk}>{avisoOk}</p> : null}
      <BarraCarga sticky={false} estado={buscando ? "cargando" : "inactiva"} titulo="Leyendo el listado y las fichas en Mercado Libre…" ariaLabel="Progreso de la lectura de competidores" />
      {buscando ? <p className={styles.nota}>No cierres la pestaña que se abrió.</p> : null}

      {resultado ? (
        competidores.length === 0 ? (
          <p className={styles.nota}>No hay competidores guardados. Busca los 10 más parecidos o agrega uno con su link.</p>
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
            <div className={styles.accionesCompetidor}>
              <Boton variante="secundario" chico onClick={actualizarTodos} disabled={buscando || !conExtension}>
                Actualizar datos de los {competidores.length}
              </Boton>
              <span className={styles.estadoCompetidor}>Vuelve a leer cada ficha en Mercado Libre; si una falla, se conservan los datos anteriores.</span>
            </div>
            {comparados.length > 0 ? (
              <div className={styles.resumenCambios} role="status">
                <strong>{conCambios.length === 0 ? "Ningún competidor cambió en la última actualización." : `Qué cambió en la última actualización (${conCambios.length} de ${comparados.length}):`}</strong>
                {conCambios.length > 0 ? (
                  <ul>
                    {conCambios.map((c) => (
                      <li key={claveCompetidor(c)}>
                        <span>{c.titulo ?? c.itemId ?? "Competidor"}</span>
                        <ul>
                          {c.cambios.map((cb) => {
                            const t = textoCambio(cb, { plata: (n) => plata(n), num: (n) => num(n) });
                            return <li key={cb.campo}>{`${t.icono} ${t.texto}`}</li>;
                          })}
                        </ul>
                      </li>
                    ))}
                  </ul>
                ) : null}
                <span className={styles.estadoCompetidor}>
                  Se compara con la lectura anterior de cada ficha{conCambios[0]?.cambiosDesdeTs ? ` (${formatoFecha(conCambios[0].cambiosDesdeTs)})` : ""}. Ventas y facturación aprox. solo avisan si cambian un 5 % o más.
                </span>
              </div>
            ) : null}
            <Tabla encabezados={ENCABEZADOS} scroll>
              <FilaTabla className={styles.filaPropia}>
                <CeldaTabla>
                  <div className={styles.publicacion}>
                    <FotoAmpliable src={propia.foto} alt={propia.titulo ?? propia.itemId} />
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
                <CeldaTabla>—</CeldaTabla>
                <CeldaTabla numerica>
                  {plata(propia.precio)}
                  {propia.precioOriginal !== null ? <span className={styles.precioAntes}>{plata(propia.precioOriginal)}</span> : null}
                </CeldaTabla>
                <CeldaTabla numerica>—</CeldaTabla>
                <CeldaTabla numerica>—</CeldaTabla>
                <CeldaTabla>—</CeldaTabla>
                <CeldaTabla>{siNo(propia.full)}</CeldaTabla>
                <CeldaTabla>{siNo(propia.envioGratis)}</CeldaTabla>
                <CeldaTabla>No</CeldaTabla>
                <CeldaTabla numerica>—</CeldaTabla>
                <CeldaTabla>—</CeldaTabla>
                <CeldaTabla numerica>—</CeldaTabla>
                <CeldaTabla numerica>—</CeldaTabla>
                <CeldaTabla>—</CeldaTabla>
                <CeldaTabla>—</CeldaTabla>
              </FilaTabla>
              {competidores.map((c) => {
                const nivel = nivelParecido(parecidoTitulos(propia.titulo, c.titulo));
                const clase = nivel === "alto" ? styles.parecidoAlto : nivel === "bajo" ? styles.parecidoBajo : styles.nota;
                return (
                  <FilaTabla key={claveCompetidor(c)}>
                    <CeldaTabla>
                      <div className={styles.publicacion}>
                        <FotoAmpliable src={c.foto} alt={c.titulo ?? c.itemId ?? "Competidor"} />
                        <div>
                          <a href={c.link} target="_blank" rel="noopener noreferrer" className={styles.enlace}>
                            {c.titulo ?? c.itemId ?? "Publicación"}
                          </a>
                          <div className={styles.nota}>{[c.itemId, c.manual ? "agregado por link" : null, c.leidoDeFicha ? null : "solo datos del listado"].filter(Boolean).join(" · ")}</div>
                          {nivel ? <div className={`${styles.estadoCompetidor} ${clase}`}>{ROTULO_PARECIDO[nivel]}</div> : null}
                          {c.cambios.length > 0 ? (
                            <ul className={styles.cambios} aria-label="Qué cambió en la última actualización">
                              {c.cambios.map((cb) => {
                                const t = textoCambio(cb, { plata: (n) => plata(n), num: (n) => num(n) });
                                return <li key={cb.campo}>{`${t.icono} ${t.texto}`}</li>;
                              })}
                            </ul>
                          ) : null}
                        </div>
                      </div>
                    </CeldaTabla>
                    <CeldaTabla>
                      {c.vendedorLink ? (
                        <a href={c.vendedorLink} target="_blank" rel="noopener noreferrer" className={styles.enlace}>
                          {c.vendedor ?? "Ver tienda"}
                        </a>
                      ) : (
                        (c.vendedor ?? "—")
                      )}
                    </CeldaTabla>
                    <CeldaTabla numerica>
                      {plata(c.precio)}
                      {c.precioAnterior !== null ? <span className={styles.precioAntes}>{plata(c.precioAnterior)}</span> : null}
                      {c.descuentoPorcentaje !== null ? <div className={styles.nota}>{`${c.descuentoPorcentaje}% OFF`}</div> : null}
                    </CeldaTabla>
                    <CeldaTabla numerica>{c.vendidos === null ? "—" : c.vendidosExacto === false ? `+${num(c.vendidos)}` : num(c.vendidos)}</CeldaTabla>
                    <CeldaTabla numerica>{c.inventario === null ? "—" : `${c.inventarioAproximado ? "+" : ""}${num(c.inventario)}`}</CeldaTabla>
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
                    <CeldaTabla>{c.actualizadoTs ? formatoFecha(c.actualizadoTs) : "—"}</CeldaTabla>
                    <CeldaTabla>
                      <Boton variante="fantasma" chico onClick={() => quitar(c)} disabled={buscando} aria-label={`Quitar ${c.titulo ?? c.itemId ?? "competidor"} de la lista`}>
                        Quitar
                      </Boton>
                    </CeldaTabla>
                  </FilaTabla>
                );
              })}
            </Tabla>
            <p className={styles.notaNeutra}>
              {resultado.ts ? `Último cambio: ${formatoFecha(new Date(resultado.ts).toISOString())}. La lista queda guardada para darle seguimiento. ` : ""}
              {`${competidores.length} ${competidores.length === 1 ? "publicación" : "publicaciones"}`}
              {resultado.termino !== TERMINO_POR_LINK ? ` de la búsqueda «${resultado.termino}», los más parecidos a tu título primero` : ""}
              {'. "—" = la ficha no lo mostró. "+N" = Mercado Libre solo muestra el rango (vendidos) o un mínimo (disponibles). Ventas/mes y facturación son aproximados, igual que en la extensión: nunca un dato que Mercado Libre confirme. "Parecido" compara las palabras del título, no las fotos: revisa que sea el mismo producto.'}
            </p>
          </>
        )
      ) : null}
    </div>
  );
}
