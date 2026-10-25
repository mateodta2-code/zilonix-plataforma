"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Chip } from "@/components/marco/Chip";
import { Boton } from "@/components/marco/Boton";
import { CeldaTabla, FilaTabla, Tabla } from "@/components/marco/Tabla";
import { InsigniaExtension } from "@/components/marco/InsigniaExtension";
import { TarjetaKpi } from "@/components/marco/TarjetaKpi";
import {
  aplicarVendidosConfirmados,
  calcularKpisMercado,
  calcularResumenBloque,
  cargarBloques,
  clasificarSenalVentas,
  facturacionEstimadaListado,
  fusionarProductos,
  generarEstrategiaListado,
  generarVeredictoListado,
  guardarBloques,
  linkHttpSeguro,
  ordenarProductos,
  type Bloque,
  type CriterioOrden,
  type ProductoListado,
} from "@/lib/ml/listadoCliente";
import { generarVariantesBusqueda } from "@/lib/ml/variantesBusqueda";
import { consumirClicAnalizarReciente } from "./analizarClic";
import { generarQueriesAnalizarAction, generarQueriesPlataformaAction } from "./actions";
import styles from "./page.module.css";

// Issue #227 — "quitar API de Investigación": Demanda/Mercado/Estrategia
// ya no dependen de buscarInvestigacionProducto (la API de catálogo,
// borrada — el smoke de Sharel con "calzado" mostró ~6 publicaciones
// casi todas "Sin dato" contra ~24-40 reales de Selltrix/Zilonix OS).
// Las 3 pestañas se calculan ACÁ, del lado del cliente, a partir de
// bloques de listados reales escaneados por la extensión (issue
// #221/#225) — nunca más un solo "resultado" que venía del servidor.
// Client Component a propósito: depende de window/postMessage/
// localStorage, que no existen en el servidor.
//
// /panel/investigacion/seguimiento NO usa nada de esto — sigue 100%
// con la API de Mercado Libre, sin tocar (issue #227, explícito).
const MAX_CANDIDATOS_COMPLETAR = 5;
const TOPE_ITEMS_RESENAS = 8;

function money(n: number): string {
  return `$${Math.round(n).toLocaleString("es-CO")}`;
}

function numero(n: number): string {
  return Math.round(n).toLocaleString("es-CO");
}

// Issue #227 — bug real de Zilonix OS que esto evita: su panel tenía
// un timeout fijo de 90s sin importar cuántos términos hubiera — con
// 5 términos a 23s cada uno eran 115s reales en el peor caso. Acá el
// margen siempre depende de cuántas queries se escanean de verdad.
function calcularTimeoutEscaneoMs(nTerminos: number): number {
  return nTerminos * 25_000 + 10_000;
}

const PLATAFORMAS_MULTIPLATAFORMA: { clave: "amazon" | "temu" | "aliexpress" | "shein" | "alibaba"; nombre: string }[] = [
  { clave: "amazon", nombre: "Amazon" },
  { clave: "temu", nombre: "Temu" },
  { clave: "aliexpress", nombre: "AliExpress" },
  { clave: "shein", nombre: "Shein" },
  { clave: "alibaba", nombre: "Alibaba" },
];

const CRITERIOS_ORDEN: { clave: CriterioOrden; etiqueta: string }[] = [
  { clave: "facturacion", etiqueta: "Facturación est." },
  { clave: "vendidos", etiqueta: "Más vendidos" },
  { clave: "calificacion", etiqueta: "Más calificación" },
  { clave: "full", etiqueta: "Full" },
  { clave: "precioAsc", etiqueta: "Más económico" },
  { clave: "precioDesc", etiqueta: "Más caro" },
];

type ProductoWire = {
  titulo: string;
  precio: number;
  vendidos: number | null;
  foto?: string | null;
  calificacion?: number | null;
  esFull?: boolean | null;
  esEnvioGratis?: boolean | null;
  vendedor?: string | null;
  itemId?: string | null;
  link: string | null;
};

function esProductoWireValido(valor: unknown): valor is ProductoWire {
  if (!valor || typeof valor !== "object") return false;
  const p = valor as Record<string, unknown>;
  return typeof p.titulo === "string" && typeof p.precio === "number" && Number.isFinite(p.precio);
}

function construirProductoListado(plataforma: string, p: ProductoWire): ProductoListado {
  return {
    plataforma,
    itemId: typeof p.itemId === "string" && p.itemId ? p.itemId : null,
    titulo: p.titulo,
    precio: p.precio,
    foto: linkHttpSeguro(p.foto ?? null),
    senalVentas: clasificarSenalVentas(plataforma, typeof p.vendidos === "number" && Number.isFinite(p.vendidos) ? p.vendidos : null),
    esFull: typeof p.esFull === "boolean" ? p.esFull : null,
    esEnvioGratis: typeof p.esEnvioGratis === "boolean" ? p.esEnvioGratis : null,
    calificacion: typeof p.calificacion === "number" && Number.isFinite(p.calificacion) ? p.calificacion : null,
    vendedor: typeof p.vendedor === "string" && p.vendedor ? p.vendedor : null,
    link: linkHttpSeguro(p.link),
  };
}

type MensajeListadoExtension = { plataforma: string; productos: ProductoWire[]; origen?: string };

function esMensajeListadoValido(valor: unknown): valor is MensajeListadoExtension {
  if (!valor || typeof valor !== "object") return false;
  const m = valor as Record<string, unknown>;
  if (typeof m.plataforma !== "string" || !Array.isArray(m.productos)) return false;
  return m.productos.every(esProductoWireValido);
}

type MensajeVendidosExtension = { itemId: string; sold_quantity: number; date_created?: string | null; esFull?: boolean; etiquetaMasN?: boolean };

function esMensajeVendidosValido(valor: unknown): valor is MensajeVendidosExtension {
  if (!valor || typeof valor !== "object") return false;
  const m = valor as Record<string, unknown>;
  return typeof m.itemId === "string" && typeof m.sold_quantity === "number" && Number.isFinite(m.sold_quantity);
}

type ResenaProducto = {
  resenasTotales: number | null;
  promedio: number | null;
  positivas: number;
  negativas: number;
  resenasVisibles: number;
  recientes30: number;
  recientes90: number;
};

function esResenaValida(valor: unknown): valor is ResenaProducto {
  if (!valor || typeof valor !== "object") return false;
  const r = valor as Record<string, unknown>;
  return (
    (r.resenasTotales === null || typeof r.resenasTotales === "number") &&
    (r.promedio === null || typeof r.promedio === "number") &&
    typeof r.positivas === "number" &&
    typeof r.negativas === "number" &&
    typeof r.resenasVisibles === "number"
  );
}

function esMensajeResenasValido(valor: unknown): valor is { resenasPorItemId: Record<string, ResenaProducto> } {
  if (!valor || typeof valor !== "object") return false;
  const m = valor as Record<string, unknown>;
  if (!m.resenasPorItemId || typeof m.resenasPorItemId !== "object") return false;
  return Object.values(m.resenasPorItemId).every(esResenaValida);
}

function idBloque(): string {
  return `b${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function PanelInvestigacion({ termino, tab }: { termino: string; tab: "demanda" | "mercado" | "estrategia" }) {
  const [conExtension, setConExtension] = useState<boolean | null>(null);
  const [bloques, setBloques] = useState<Bloque[]>([]);
  const [cargado, setCargado] = useState(false);

  const [escaneoEnCurso, setEscaneoEnCurso] = useState(false);
  const [queriesUsadas, setQueriesUsadas] = useState<string[]>([]);
  const [escaneoPlataformaEnCurso, setEscaneoPlataformaEnCurso] = useState<string | null>(null);
  const [captchaPlataforma, setCaptchaPlataforma] = useState<string | null>(null);
  const [avisoBloqueado, setAvisoBloqueado] = useState(false);
  const [pendiente, setPendiente] = useState<{ plataforma: string; productos: ProductoListado[] } | null>(null);
  const [resenas, setResenas] = useState<Record<string, ResenaProducto>>({});
  const [resenasEnCurso, setResenasEnCurso] = useState(false);
  const [criterioOrden, setCriterioOrden] = useState<CriterioOrden>("facturacion");
  const [fotoAmpliada, setFotoAmpliada] = useState<string | null>(null);
  const [yaAbrioCompletar, setYaAbrioCompletar] = useState<Record<string, boolean>>({});

  // Refs (nunca disparan un render por sí solas): el timeout de
  // seguridad del escaneo por plataforma, y las queries que de verdad
  // se usaron en ESE escaneo (para etiquetar el bloque cuando el
  // resultado llegue — el mensaje de background.js no las repite).
  const limitePlataformaRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const queriesUsadasPlataformaRef = useRef<string[]>([]);

  // Issue #227 — "persistencia ≥1h, sobrevive refresh": se carga UNA
  // vez por término (localStorage, TTL 1h — lib/ml/listadoCliente.ts)
  // y se vuelve a guardar cada vez que cambian los bloques.
  useEffect(() => {
    setBloques(cargarBloques(termino));
    setCargado(true);
  }, [termino]);

  useEffect(() => {
    if (!cargado) return;
    guardarBloques(termino, bloques);
  }, [termino, bloques, cargado]);

  useEffect(() => {
    setConExtension(document.documentElement.hasAttribute("data-zilonix-extension"));
  }, []);

  // Issue #221/#227 — un clic real y reciente en "Analizar" (con el
  // país elegido) dispara el escaneo de Mercado Libre.
  //
  // Issue #229 — "Selector de plataforma de inicio antes de Analizar":
  // hasta esta tarea, este efecto SIEMPRE escaneaba Mercado Libre — la
  // marca ahora trae también la plataforma elegida en el formulario
  // (`marca.plataforma`, default "ml" si viene de una marca vieja).
  // Para cualquiera de las otras 5, se delega directo en
  // `analizarEnPlataforma` (definida más abajo en este mismo
  // componente — un clic real distinto, "Analizar también en…", ya
  // usaba exactamente esa función para agregar un bloque extra; acá es
  // el MISMO mecanismo, solo que autorizado por el clic de Analizar en
  // vez de un botón secundario) — nunca se duplica la lógica de
  // armar queries/mandar el mensaje/timeout, que ya maneja sus propios
  // refs (limitePlataformaRef/queriesUsadasPlataformaRef).
  useEffect(() => {
    if (conExtension !== true) return;
    const marca = consumirClicAnalizarReciente();
    if (!marca) return;

    if (marca.plataforma !== "ml") {
      void analizarEnPlataforma(marca.plataforma);
      return;
    }

    let cancelado = false;
    let limite: ReturnType<typeof setTimeout> | null = null;

    (async () => {
      let queries: string[];
      try {
        queries = await generarQueriesAnalizarAction(termino);
      } catch {
        queries = generarVariantesBusqueda(termino);
      }
      if (cancelado || !queries.length) return;
      setQueriesUsadas(queries);
      window.postMessage({ fuente: "zilonix-panel", tipo: "iniciar-escaneo", payload: { terminos: queries, pais: marca.pais } }, window.location.origin);
      setEscaneoEnCurso(true);
      limite = setTimeout(() => setEscaneoEnCurso(false), calcularTimeoutEscaneoMs(queries.length));
    })();

    return () => {
      cancelado = true;
      if (limite) clearTimeout(limite);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- analizarEnPlataforma es estable (misma identidad por render, no un valor que cambie por sí solo entre renders relevantes acá)
  }, [conExtension, termino]);

  function agregarBloque(plataforma: string, queriesUsadasBloque: string[], productos: ProductoListado[]) {
    if (!productos.length) return;
    setBloques((actuales) => [...actuales, { id: idBloque(), plataforma, termino, queriesUsadas: queriesUsadasBloque, creadoTs: Date.now(), productos }]);
  }

  useEffect(() => {
    function alRecibirMensaje(evento: MessageEvent) {
      if (evento.origin !== window.location.origin || evento.source !== window) return;
      const datos = evento.data as { fuente?: string; tipo?: string; payload?: unknown } | null;
      if (!datos || datos.fuente !== "zilonix-extension") return;

      if (datos.tipo === "vendidos-completados") {
        if (!esMensajeVendidosValido(datos.payload)) return;
        const payload = datos.payload;
        setBloques((actuales) =>
          actuales.map((b) => ({
            ...b,
            productos: aplicarVendidosConfirmados(b.productos, {
              itemId: payload.itemId,
              sold_quantity: payload.sold_quantity,
              date_created: payload.date_created ?? null,
              esFull: payload.esFull === true,
              etiquetaMasN: payload.etiquetaMasN === true,
            }),
          }))
        );
        return;
      }

      if (datos.tipo === "listado-importado") {
        if (!esMensajeListadoValido(datos.payload)) return;
        const payload = datos.payload;
        const productos = payload.productos.map((p) => construirProductoListado(payload.plataforma, p));
        if (!productos.length) return;
        if (payload.origen === "escaneo-analizar") {
          // Issue #221/#227 — la persona ya autorizó esto con el clic
          // de Analizar: se agrega el bloque directo, sin confirmar.
          setEscaneoEnCurso(false);
          agregarBloque(payload.plataforma, queriesUsadas, productos);
          return;
        }
        // "Enviar a Zilonix" manual — sí pide confirmación, nunca se
        // agrega solo con recibir el mensaje.
        setPendiente({ plataforma: payload.plataforma, productos });
        return;
      }

      if (datos.tipo === "escaneo-plataforma-captcha") {
        const payload = datos.payload as { plataforma?: string } | null;
        if (payload?.plataforma) setCaptchaPlataforma(payload.plataforma);
        return;
      }

      if (datos.tipo === "escaneo-plataforma-importado") {
        setEscaneoPlataformaEnCurso(null);
        setCaptchaPlataforma(null);
        if (!esMensajeListadoValido(datos.payload)) return;
        const payload = datos.payload;
        const config = PLATAFORMAS_MULTIPLATAFORMA.find((p) => p.clave === payload.plataforma);
        const nombrePlataforma = config?.nombre ?? payload.plataforma;
        const productos = payload.productos.map((p) => construirProductoListado(nombrePlataforma, p));
        agregarBloque(nombrePlataforma, queriesUsadasPlataformaRef.current, productos);
        return;
      }

      if (datos.tipo === "resenas-leidas") {
        setResenasEnCurso(false);
        if (!esMensajeResenasValido(datos.payload)) return;
        const payload = datos.payload;
        setResenas((actual) => ({ ...actual, ...payload.resenasPorItemId }));
      }
    }

    window.addEventListener("message", alRecibirMensaje);
    return () => window.removeEventListener("message", alRecibirMensaje);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queriesUsadas]);

  // Issue #213, adaptado — "Enviar a Zilonix" manual: la persona elige
  // agregar el bloque (stack) o descartarlo.
  function confirmarPendiente() {
    if (!pendiente) return;
    agregarBloque(pendiente.plataforma, [], pendiente.productos);
    setPendiente(null);
  }
  function descartarPendiente() {
    setPendiente(null);
  }

  // Issue #227 (parte B, adaptado) — un clic por plataforma autoriza
  // el escaneo (hasta 5 queries de IA) en Amazon/Temu/AliExpress/Shein/Alibaba.
  async function analizarEnPlataforma(clave: "amazon" | "temu" | "aliexpress" | "shein" | "alibaba") {
    if (limitePlataformaRef.current) clearTimeout(limitePlataformaRef.current);
    setEscaneoPlataformaEnCurso(clave);
    setCaptchaPlataforma(null);
    let queries: string[];
    try {
      queries = await generarQueriesPlataformaAction(termino, clave);
    } catch {
      queries = [termino];
    }
    if (!queries.length) {
      setEscaneoPlataformaEnCurso(null);
      return;
    }
    queriesUsadasPlataformaRef.current = queries;
    window.postMessage({ fuente: "zilonix-panel", tipo: "iniciar-escaneo-plataforma", payload: { plataforma: clave, terminos: queries } }, window.location.origin);
    limitePlataformaRef.current = setTimeout(() => setEscaneoPlataformaEnCurso(null), calcularTimeoutEscaneoMs(queries.length) + 120_000);
  }

  // Issue #227 (parte Top 8 reseñas) — Top 8 de TODOS los bloques de
  // Mercado Libre juntos (el único lugar donde hay itemId real),
  // ordenados por la señal de ventas.
  const productosMl = useMemo(() => bloques.filter((b) => b.plataforma.startsWith("Mercado Libre")).flatMap((b) => b.productos), [bloques]);
  const top8ParaResenas = useMemo(
    () => ordenarProductos(productosMl.filter((p) => p.itemId && p.link), "vendidos").slice(0, TOPE_ITEMS_RESENAS),
    [productosMl]
  );

  function verResenas() {
    const items = top8ParaResenas.map((p) => ({ itemId: p.itemId as string, link: p.link as string }));
    if (!items.length) return;
    window.postMessage({ fuente: "zilonix-panel", tipo: "iniciar-resenas", payload: { items } }, window.location.origin);
    setResenasEnCurso(true);
  }

  // Issue #210, adaptado (#227) — "Completar vendidos" por bloque de
  // Mercado Libre: solo tiene sentido ahí (itemId real).
  function completarVendidosBloque(bloque: Bloque) {
    const candidatos = bloque.productos.filter((p) => p.itemId && p.link && p.senalVentas.tipo === "ausente").slice(0, MAX_CANDIDATOS_COMPLETAR);
    let abiertas = 0;
    for (const candidato of candidatos) {
      // Corrección de Pablo (PR #211) — nunca "noopener"/"noreferrer"
      // en window.open: por estándar de HTML, con esas features el
      // navegador SIEMPRE devuelve null, sin importar si se abrió de
      // verdad — se abre sin ninguna y se le quita `opener` a mano.
      const ventana = window.open(candidato.link as string, "_blank");
      if (ventana) {
        ventana.opener = null;
        abiertas++;
      }
    }
    setYaAbrioCompletar((actual) => ({ ...actual, [bloque.id]: true }));
    setAvisoBloqueado(abiertas < candidatos.length);
  }

  const kpisMercado = useMemo(() => calcularKpisMercado(productosMl), [productosMl]);
  const estrategiaListado = useMemo(
    () => generarEstrategiaListado({ publicacionesEncontradas: kpisMercado.publicacionesEncontradas, vendedoresDistintos: kpisMercado.vendedoresDistintos, precioPromedio: kpisMercado.precioPromedio, porcentajeFull: kpisMercado.porcentajeFull }),
    [kpisMercado]
  );
  const veredictoListado = useMemo(
    () => generarVeredictoListado({ publicacionesEncontradas: kpisMercado.publicacionesEncontradas, vendedoresDistintos: kpisMercado.vendedoresDistintos }),
    [kpisMercado]
  );

  if (tab === "mercado") {
    return (
      <div className={styles.kpis}>
        <TarjetaKpi titulo="PUBLICACIONES ENCONTRADAS" valor={kpisMercado.publicacionesEncontradas || undefined} textoVacio="Sin dato" />
        <TarjetaKpi titulo="VENDEDORES DISTINTOS" valor={kpisMercado.vendedoresDistintos || undefined} textoVacio="Sin dato" />
        <TarjetaKpi titulo="PRECIO MÍNIMO" valor={kpisMercado.precioMinimo != null ? money(kpisMercado.precioMinimo) : undefined} textoVacio="Sin dato" />
        <TarjetaKpi titulo="PRECIO PROMEDIO (TICKET)" valor={kpisMercado.precioPromedio != null ? money(kpisMercado.precioPromedio) : undefined} textoVacio="Sin dato" />
        <TarjetaKpi titulo="PRECIO MÁXIMO" valor={kpisMercado.precioMaximo != null ? money(kpisMercado.precioMaximo) : undefined} textoVacio="Sin dato" />
        <TarjetaKpi titulo="% FULL" valor={kpisMercado.porcentajeFull != null ? `${kpisMercado.porcentajeFull}%` : undefined} textoVacio="Sin dato" />
        <TarjetaKpi titulo="% ENVÍO GRATIS" valor={kpisMercado.porcentajeEnvioGratis != null ? `${kpisMercado.porcentajeEnvioGratis}%` : undefined} textoVacio="Sin dato" />
      </div>
    );
  }

  if (tab === "estrategia") {
    return (
      <>
        <div className={styles.bloque}>
          <p className={styles.tituloSeccion}>Veredicto</p>
          {veredictoListado ? <p className={styles.veredicto}>{veredictoListado}</p> : <p className={styles.notaInsignia}>Sin suficientes datos todavía para un veredicto.</p>}
        </div>
        <div className={styles.bloque}>
          <p className={styles.tituloSeccion}>Plan de ataque</p>
          {estrategiaListado.length ? (
            <ul className={styles.listaEstrategia}>
              {estrategiaListado.map((regla, i) => (
                <li key={i}>{regla.texto}</li>
              ))}
            </ul>
          ) : (
            <p className={styles.notaInsignia}>No hay suficientes datos reales todavía para sugerir un plan.</p>
          )}
        </div>
      </>
    );
  }

  // --- Demanda ---
  return (
    <>
      {fotoAmpliada ? (
        <div className={styles.lightbox} onClick={() => setFotoAmpliada(null)}>
          {/* eslint-disable-next-line @next/next/no-img-element -- foto de un marketplace ajeno, mismo criterio que el resto del panel */}
          <img src={fotoAmpliada} alt="" className={styles.lightboxImagen} />
        </div>
      ) : null}

      <div className={styles.insignia}>
        <InsigniaExtension />
        <span className={styles.notaInsignia}>
          Analizar (con extensión) escanea el listado real de Mercado Libre — ya no depende de la API de catálogo. Cada búsqueda agrega un bloque
          nuevo abajo, que queda guardado hasta 1h.
        </span>
      </div>

      {escaneoEnCurso ? (
        <div className={styles.insignia}>
          <Chip estado="aviso">Escaneando Mercado Libre…</Chip>
          <span className={styles.notaInsignia}>La extensión está abriendo y cerrando el listado real — no cierres esta pestaña, ya vuelve sola.</span>
        </div>
      ) : null}

      {queriesUsadas.length > 1 ? (
        <div className={styles.insignia}>
          <span className={styles.notaInsignia}>Búsquedas usadas en el último escaneo de ML:</span>
          {queriesUsadas.map((q, i) => (
            <Chip key={`${q}-${i}`} estado={i === 0 ? "exito" : "neutro"}>
              {q}
            </Chip>
          ))}
        </div>
      ) : null}

      {conExtension ? (
        <div className={styles.insignia}>
          <span className={styles.notaInsignia}>Analizar también en (un clic por plataforma, agrega su propio bloque):</span>
          {PLATAFORMAS_MULTIPLATAFORMA.map(({ clave, nombre }) => (
            <Boton key={clave} type="button" variante="secundario" chico disabled={escaneoPlataformaEnCurso != null} onClick={() => analizarEnPlataforma(clave)}>
              {escaneoPlataformaEnCurso === clave ? `Analizando ${nombre}…` : nombre}
            </Boton>
          ))}
        </div>
      ) : null}

      {conExtension ? (
        <p className={styles.notaInsignia}>
          Amazon: &quot;comprados el mes pasado&quot; es la única cifra real mensual. Mercado Libre/Temu/AliExpress/Shein/Alibaba: &quot;vendidos&quot;
          es un acumulado histórico sin período — nunca se muestra como tasa mensual. Alibaba es mayorista (precio por cantidad) y puede pedir
          resolver un captcha a mano.
        </p>
      ) : null}

      {captchaPlataforma ? (
        <div className={styles.insignia}>
          <Chip estado="peligro">Captcha en {PLATAFORMAS_MULTIPLATAFORMA.find((p) => p.clave === captchaPlataforma)?.nombre ?? captchaPlataforma}</Chip>
          <span className={styles.notaInsignia}>Abrí la pestaña que se abrió sola y resolvela a mano — nunca se evade. El escaneo sigue solo en cuanto la resuelvas.</span>
        </div>
      ) : null}

      {avisoBloqueado ? (
        <p className={styles.notaInsignia}>El navegador bloqueó alguna pestaña — permití ventanas emergentes para este sitio e intentá de nuevo.</p>
      ) : null}

      {pendiente ? (
        <div className={styles.insignia}>
          <Chip estado="aviso">
            {pendiente.plataforma}: {pendiente.productos.length} candidatos recibidos
          </Chip>
          <Boton type="button" variante="secundario" chico onClick={confirmarPendiente}>
            Agregar como bloque nuevo
          </Boton>
          <Boton type="button" variante="fantasma" chico onClick={descartarPendiente}>
            Descartar
          </Boton>
        </div>
      ) : null}

      {bloques.length > 0 ? (
        <div className={styles.insignia}>
          <span className={styles.notaInsignia}>Ordenar cada bloque por:</span>
          <select className="zx-control" value={criterioOrden} onChange={(e) => setCriterioOrden(e.target.value as CriterioOrden)}>
            {CRITERIOS_ORDEN.map((c) => (
              <option key={c.clave} value={c.clave}>
                {c.etiqueta}
              </option>
            ))}
          </select>
        </div>
      ) : null}

      {conExtension && top8ParaResenas.length > 0 ? (
        <div className={styles.insignia}>
          <Boton type="button" variante="secundario" chico onClick={verResenas} disabled={resenasEnCurso}>
            {resenasEnCurso ? "Leyendo reseñas…" : `Ver reseñas (Top ${top8ParaResenas.length} ML)`}
          </Boton>
        </div>
      ) : null}

      {!bloques.length ? <p className={styles.notaInsignia}>Todavía no hay ningún bloque — analizá un término para empezar.</p> : null}

      {bloques.map((bloque) => {
        const resumen = calcularResumenBloque(bloque.productos);
        const ordenados = ordenarProductos(bloque.productos, criterioOrden);
        const esMl = bloque.plataforma.startsWith("Mercado Libre");
        const hayAusentesMl = esMl && bloque.productos.some((p) => p.itemId && p.senalVentas.tipo === "ausente");
        return (
          <div key={bloque.id} className={styles.bloque}>
            <div className={styles.encabezadoBloque}>
              <p className={styles.tituloSeccion} style={{ margin: 0 }}>
                {bloque.plataforma} — &quot;{bloque.termino}&quot; ({resumen.total})
              </p>
              <span className={styles.notaInsignia}>
                Precio {resumen.precioMinimo != null ? money(resumen.precioMinimo) : "—"} a {resumen.precioMaximo != null ? money(resumen.precioMaximo) : "—"} · acumulado:{" "}
                {resumen.sumaAcumuladaSinPeriodo != null ? numero(resumen.sumaAcumuladaSinPeriodo) : "Sin dato"} · mensual (Amazon):{" "}
                {resumen.sumaMensualPiso != null ? numero(resumen.sumaMensualPiso) : "Sin dato"}
              </span>
              {hayAusentesMl ? (
                <Boton type="button" variante="secundario" chico onClick={() => completarVendidosBloque(bloque)}>
                  {yaAbrioCompletar[bloque.id] ? "Completar vendidos de nuevo" : "Completar vendidos"}
                </Boton>
              ) : null}
            </div>
            <Tabla encabezados={["Foto", "Producto", "Vendidos", "Precio", "Fact. est.", "Full", "Calif.", "Enlace", ""]}>
              {ordenados.map((p, i) => (
                <FilaTabla key={`${bloque.id}-${p.link ?? p.titulo}-${i}`}>
                  <CeldaTabla>
                    {p.foto ? (
                      // Issue #229 — "preview al hover (no solo lightbox
                      // con clic)": el lightbox de #227 (clic -> modal)
                      // sigue existiendo tal cual; esto suma un preview
                      // más grande que aparece solo con pasar el mouse,
                      // sin ningún clic. Misma URL real (p.foto) en los
                      // dos <img> — el preview no es la miniatura
                      // escalada con CSS (eso se ve pixelado), es la
                      // imagen real pedida a un tamaño más grande.
                      <span className={styles.fotoContenedor}>
                        {/* eslint-disable-next-line @next/next/no-img-element -- foto de un marketplace ajeno, mismo criterio que BarraSuperior/BarraLateral */}
                        <img src={p.foto} alt="" width={36} height={36} className={`${styles.foto} ${styles.fotoClicable}`} onClick={() => setFotoAmpliada(p.foto)} />
                        {/* eslint-disable-next-line @next/next/no-img-element -- idem arriba */}
                        <img src={p.foto} alt="" className={styles.fotoPreview} />
                      </span>
                    ) : (
                      "—"
                    )}
                  </CeldaTabla>
                  <CeldaTabla>{p.titulo}</CeldaTabla>
                  <CeldaTabla>
                    {p.senalVentas.valor != null ? (
                      <>
                        {numero(p.senalVentas.valor)}
                        <div className={styles.subdato}>{p.senalVentas.tipo === "mensual_piso" ? "comprados el mes pasado" : "acumulado — nunca /mes"}</div>
                      </>
                    ) : (
                      <Chip>Sin dato</Chip>
                    )}
                  </CeldaTabla>
                  <CeldaTabla>{money(p.precio)}</CeldaTabla>
                  <CeldaTabla>{facturacionEstimadaListado(p) != null ? money(facturacionEstimadaListado(p) as number) : "—"}</CeldaTabla>
                  <CeldaTabla>{p.esFull == null ? "—" : p.esFull ? <Chip estado="exito">Full</Chip> : <Chip>No</Chip>}</CeldaTabla>
                  <CeldaTabla>{p.calificacion != null ? `${p.calificacion.toFixed(1)}★` : "—"}</CeldaTabla>
                  <CeldaTabla>
                    {p.link ? (
                      <a href={p.link} target="_blank" rel="noreferrer">
                        Ver
                      </a>
                    ) : (
                      "—"
                    )}
                  </CeldaTabla>
                  <CeldaTabla>
                    {/* Issue #227, punto 9 — "Seguir solo ML": sin itemId (toda plataforma no-ML, o ML sin publicación identificable) no hay link de Seguir. */}
                    {p.itemId ? (
                      <Link href={`/panel/investigacion/seguimiento?agregar=${encodeURIComponent(p.itemId)}`} className={styles.enlaceSeguir}>
                        Seguir
                      </Link>
                    ) : (
                      "—"
                    )}
                  </CeldaTabla>
                </FilaTabla>
              ))}
            </Tabla>
          </div>
        );
      })}
    </>
  );
}
