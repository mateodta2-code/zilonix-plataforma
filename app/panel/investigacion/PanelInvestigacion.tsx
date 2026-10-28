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
  calcularResumenLocalBloque,
  cargarBloques,
  clasificarSenalVentas,
  estimarAproximadosListado,
  facturacionEstimadaListado,
  generarEstrategiaListado,
  generarVeredictoListado,
  guardarBloques,
  linkHttpSeguro,
  mejorOpcionParaImportar,
  ordenarProductos,
  type Bloque,
  type CriterioOrden,
  type ProductoListado,
} from "@/lib/ml/listadoCliente";
import { ETIQUETA_APROXIMADO } from "@/lib/seguimiento/aproximados";
import { generarVariantesBusqueda } from "@/lib/ml/variantesBusqueda";
import { consumirClicAnalizarReciente, type PlataformaAnalizar } from "./analizarClic";
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
// Issue #231 — el botón secundario "Analizar también en: Mercado
// Libre" (ver abajo) no tiene su propio selector de país — usa
// Colombia siempre, documentado acá. Para otro país hay que usar el
// selector del formulario de Analizar (arriba de la página) y volver
// a analizar con ese país — eso ya agrega su propio bloque al stack,
// sin pisar ninguno existente.
const PAIS_ML_SECUNDARIO = "CO";

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
  esPrime?: boolean | null;
  esEnvioGratis?: boolean | null;
  vendedor?: string | null;
  itemId?: string | null;
  // Issue #251 (fix "aproximados siempre visibles") — id de catálogo
  // (/p/MCO…), ver el comentario de ProductoListado.productId en
  // listadoCliente.ts.
  productId?: string | null;
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
    productId: typeof p.productId === "string" && p.productId ? p.productId : null,
    titulo: p.titulo,
    precio: p.precio,
    foto: linkHttpSeguro(p.foto ?? null),
    senalVentas: clasificarSenalVentas(plataforma, typeof p.vendidos === "number" && Number.isFinite(p.vendidos) ? p.vendidos : null),
    esFull: typeof p.esFull === "boolean" ? p.esFull : null,
    esPrime: typeof p.esPrime === "boolean" ? p.esPrime : null,
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
  // Issue #262, punto 2 — "ahora" para antiguedadDias (vendidos
  // estimados/ventas-mes/facturación-mes aprox., y el volumen que usa
  // mejorOpcionParaImportar) — fijo durante todo este montaje del
  // componente (useMemo con deps vacías), nunca un `new Date()` distinto
  // en cada fila ni en cada re-render, para que todas las filas de la
  // misma pantalla midan la antigüedad contra el mismo instante.
  const ahora = useMemo(() => new Date(), []);
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
  const [fotoAmpliada, setFotoAmpliada] = useState<string | null>(null);
  const [yaAbrioCompletar, setYaAbrioCompletar] = useState<Record<string, boolean>>({});
  // Issue #231 — "ordenar/filtrar por cada bloque, no un sort único
  // global": antes había un solo `criterioOrden` que ordenaba TODOS
  // los bloques igual — ahora cada bloque guarda el suyo, por id.
  const [ordenPorBloque, setOrdenPorBloque] = useState<Record<string, CriterioOrden>>({});
  // "Cada bloque colapsable" — por default expandido (sin entrada acá
  // = expandido); colapsado solo después de un clic real.
  const [colapsados, setColapsados] = useState<Record<string, boolean>>({});
  // "Thumbnails reales + preview al hover, sigue fallando" — causa
  // real confirmada: el preview viejo (CSS puro, position:absolute)
  // quedaba recortado por `overflow-x: auto` del contenedor de
  // <Tabla> (components/marco/Tabla.module.css) — un position:absolute
  // nunca escapa el overflow de su ancestro, un position:fixed sí.
  // Se mueve a un único preview "flotante" controlado por JS,
  // posicionado con coordenadas reales del mouse/la miniatura.
  const [previewFoto, setPreviewFoto] = useState<{ src: string; x: number; y: number } | null>(null);
  // Si una URL de foto realmente no carga (404, bloqueo de hotlink,
  // etc.) se muestra "—" en vez de un ícono de imagen rota — mismo
  // criterio de honestidad que el resto del panel: sin dato real,
  // nunca algo roto a medias.
  const [fotosFallidas, setFotosFallidas] = useState<Set<string>>(new Set());

  // Refs (nunca disparan un render por sí solas): los timeouts de
  // seguridad de cada tipo de escaneo, y las queries que de verdad se
  // usaron en ESE escaneo (para etiquetar el bloque cuando el
  // resultado llegue — el mensaje de background.js no las repite).
  const limiteMlRef = useRef<ReturnType<typeof setTimeout> | null>(null);
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
  // Issue #231 — la lógica de escanear Mercado Libre se sacó a
  // `escanearMercadoLibre` (abajo), reutilizable: el botón secundario
  // "Analizar también en: Mercado Libre" (issue #231, punto D — antes
  // esa fila nunca incluía ML) la llama igual que este efecto.
  useEffect(() => {
    if (conExtension !== true) return;
    const marca = consumirClicAnalizarReciente();
    if (!marca) return;
    if (marca.plataforma === "ml") {
      void escanearMercadoLibre(marca.pais);
    } else {
      void analizarEnPlataforma(marca.plataforma);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- escanearMercadoLibre/analizarEnPlataforma son estables (misma identidad por render)
  }, [conExtension, termino]);

  // Issue #231 — extraído del efecto de arriba para poder llamarlo
  // también desde el botón secundario (ver PLATAFORMAS_SECUNDARIAS,
  // más abajo). `limiteMlRef` reemplaza al `cancelado`/`limite` locales
  // de la versión anterior (que solo vivían dentro del efecto) — mismo
  // criterio que ya usa `limitePlataformaRef` para el escaneo
  // multiplataforma.
  async function escanearMercadoLibre(pais: string) {
    if (limiteMlRef.current) clearTimeout(limiteMlRef.current);
    let queries: string[];
    try {
      queries = await generarQueriesAnalizarAction(termino);
    } catch {
      queries = generarVariantesBusqueda(termino);
    }
    if (!queries.length) return;
    setQueriesUsadas(queries);
    window.postMessage({ fuente: "zilonix-panel", tipo: "iniciar-escaneo", payload: { terminos: queries, pais } }, window.location.origin);
    setEscaneoEnCurso(true);
    limiteMlRef.current = setTimeout(() => setEscaneoEnCurso(false), calcularTimeoutEscaneoMs(queries.length));
  }

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

  // Issue #231, punto D — "Analizar también en…" tiene que listar
  // TODAS las plataformas sin bloque para este término, Mercado Libre
  // incluido (antes quedaba afuera siempre). `bloques` ya está
  // filtrado al término actual (se recarga por término — ver el
  // efecto de `cargarBloques` arriba), así que alcanza con mirar
  // `plataforma` de lo que ya existe.
  const yaTieneBloqueMl = useMemo(() => bloques.some((b) => b.plataforma.startsWith("Mercado Libre")), [bloques]);
  const algoEnCurso = escaneoEnCurso || escaneoPlataformaEnCurso != null;
  const plataformasPendientes = useMemo(() => {
    const lista: { tipo: PlataformaAnalizar; nombre: string }[] = [];
    if (!yaTieneBloqueMl) lista.push({ tipo: "ml", nombre: "Mercado Libre" });
    for (const p of PLATAFORMAS_MULTIPLATAFORMA) {
      if (!bloques.some((b) => b.plataforma === p.nombre)) lista.push({ tipo: p.clave, nombre: p.nombre });
    }
    return lista;
  }, [bloques, yaTieneBloqueMl]);

  function analizarSecundaria(tipo: PlataformaAnalizar) {
    if (tipo === "ml") {
      void escanearMercadoLibre(PAIS_ML_SECUNDARIO);
    } else {
      void analizarEnPlataforma(tipo);
    }
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

  // Issue #231, punto C — sort/colapso/borrado por bloque.
  function ordenDeBloque(id: string): CriterioOrden {
    return ordenPorBloque[id] ?? "facturacion";
  }
  function cambiarOrdenBloque(id: string, criterio: CriterioOrden) {
    setOrdenPorBloque((actual) => ({ ...actual, [id]: criterio }));
  }
  function toggleColapso(id: string) {
    setColapsados((actual) => ({ ...actual, [id]: !actual[id] }));
  }
  function eliminarBloque(id: string) {
    setBloques((actuales) => actuales.filter((b) => b.id !== id));
  }

  // Issue #231, punto B — preview real al pasar el mouse. Posición en
  // coordenadas de VIEWPORT (no del documento) porque el preview usa
  // position:fixed (ver nota en el estado `previewFoto`, arriba, y en
  // page.module.css) — escapa el overflow-x:auto de <Tabla> que
  // recortaba el preview viejo. Clampeado para nunca salirse de la
  // ventana visible (a la izquierda de la miniatura si no entra a la
  // derecha; nunca más abajo del borde inferior).
  const ANCHO_PREVIEW = 220;
  const ALTO_PREVIEW = 220;
  function mostrarPreview(e: React.MouseEvent<HTMLImageElement>, src: string) {
    const r = e.currentTarget.getBoundingClientRect();
    const margen = 10;
    let x = r.right + margen;
    if (x + ANCHO_PREVIEW > window.innerWidth) x = Math.max(8, r.left - ANCHO_PREVIEW - margen);
    let y = r.top;
    if (y + ALTO_PREVIEW > window.innerHeight) y = Math.max(8, window.innerHeight - ALTO_PREVIEW - 8);
    setPreviewFoto({ src, x, y });
  }
  function ocultarPreview() {
    setPreviewFoto(null);
  }
  function marcarFotoFallida(src: string) {
    setFotosFallidas((actual) => {
      const copia = new Set(actual);
      copia.add(src);
      return copia;
    });
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
          <img src={fotoAmpliada} alt="" referrerPolicy="no-referrer" className={styles.lightboxImagen} />
        </div>
      ) : null}

      {previewFoto ? (
        // Issue #231 — preview único, controlado por JS (ver
        // mostrarPreview arriba): position:fixed con coordenadas reales
        // del viewport, nunca recortado por el overflow-x:auto de
        // <Tabla> (causa real confirmada de por qué el preview de #229
        // nunca se veía). pointer-events:none en el CSS — el mouse
        // sigue interactuando con la miniatura de abajo, nunca con esto.
        // eslint-disable-next-line @next/next/no-img-element
        <img src={previewFoto.src} alt="" referrerPolicy="no-referrer" className={styles.fotoPreviewFija} style={{ left: previewFoto.x, top: previewFoto.y }} />
      ) : null}

      <div className={styles.insignia}>
        <InsigniaExtension />
        <span className={styles.notaInsignia}>
          Analizar (con extensión) escanea el listado real de Mercado Libre — ya no depende de la API de catálogo. Cada búsqueda agrega un bloque
          nuevo abajo, que queda guardado hasta 1h.
        </span>
      </div>

      {/* Issue #231, punto E — banner tipo Selltrix/Zilonix OS, solo
          cuando hay datos reales de Mercado Libre (cualquier país/
          bloque, combinados) — nunca una cifra de visitas ni "/mes"
          para esto: calcularKpisMercado es la misma función ya
          probada de la pestaña Mercado, pensada para poder sumar otra
          plataforma más adelante (ej. Amazon) sin rehacerla. */}
      {productosMl.length > 0 ? (
        <div className={styles.bloque}>
          <p className={styles.tituloSeccion}>Demanda — Mercado Libre</p>
          <div className={styles.kpis}>
            <TarjetaKpi titulo="PUBLICACIONES" valor={kpisMercado.publicacionesEncontradas || undefined} textoVacio="Sin dato" />
            <TarjetaKpi titulo="VENDEDORES DISTINTOS" valor={kpisMercado.vendedoresDistintos || undefined} textoVacio="Sin dato" />
            <TarjetaKpi titulo="PRECIO MÍNIMO" valor={kpisMercado.precioMinimo != null ? money(kpisMercado.precioMinimo) : undefined} textoVacio="Sin dato" />
            <TarjetaKpi titulo="PRECIO MÁXIMO" valor={kpisMercado.precioMaximo != null ? money(kpisMercado.precioMaximo) : undefined} textoVacio="Sin dato" />
            <TarjetaKpi titulo="% FULL" valor={kpisMercado.porcentajeFull != null ? `${kpisMercado.porcentajeFull}%` : undefined} textoVacio="Sin dato" />
          </div>
          <p className={styles.notaInsignia}>
            Resumen de todos los bloques de Mercado Libre juntos (cualquier país) — nunca una venta/mes estimada acá; ver &quot;Vendidos&quot; y
            &quot;Fact. est.&quot; por fila, con la etiqueta &quot;{ETIQUETA_APROXIMADO}&quot; cuando es una estimación (requiere antigüedad real o
            calibrada de la publicación — puede faltar todavía, ver docs/ESTADO.md).
          </p>
        </div>
      ) : null}

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

      {conExtension && plataformasPendientes.length > 0 ? (
        <div className={styles.insignia}>
          <span className={styles.notaInsignia}>Analizar también en (un clic por plataforma, agrega su propio bloque):</span>
          {plataformasPendientes.map(({ tipo, nombre }) => {
            const enCursoEsta = (tipo === "ml" && escaneoEnCurso) || escaneoPlataformaEnCurso === tipo;
            return (
              <Boton key={tipo} type="button" variante="secundario" chico disabled={algoEnCurso} onClick={() => analizarSecundaria(tipo)}>
                {enCursoEsta ? `Analizando ${nombre}…` : nombre}
              </Boton>
            );
          })}
        </div>
      ) : null}

      {conExtension ? (
        <p className={styles.notaInsignia}>
          Amazon: &quot;comprados el mes pasado&quot; es la única cifra real mensual. Mercado Libre: &quot;vendidos&quot; es un acumulado histórico
          sin período real — la fila SÍ puede sumar vendidos estimados/ventas por mes/facturación por mes, siempre con la etiqueta &quot;
          {ETIQUETA_APROXIMADO}&quot;, nunca mezclados con el acumulado como si fueran lo mismo. Temu/AliExpress/Shein/Alibaba: &quot;vendidos&quot;
          sigue siendo acumulado sin período, sin ninguna estimación todavía. Alibaba es mayorista (precio por cantidad) y puede pedir resolver un
          captcha a mano.
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

      {conExtension && top8ParaResenas.length > 0 ? (
        <div className={styles.insignia}>
          <Boton type="button" variante="secundario" chico onClick={verResenas} disabled={resenasEnCurso}>
            {resenasEnCurso ? "Leyendo reseñas…" : `Ver reseñas (Top ${top8ParaResenas.length} ML)`}
          </Boton>
        </div>
      ) : null}

      {!bloques.length ? <p className={styles.notaInsignia}>Todavía no hay ningún bloque — analizá un término para empezar.</p> : null}

      {bloques.map((bloque) => {
        const esMl = bloque.plataforma.startsWith("Mercado Libre");
        const criterioBloque = ordenDeBloque(bloque.id);
        const resumen = calcularResumenBloque(bloque.productos);
        const ordenados = ordenarProductos(bloque.productos, criterioBloque);
        const hayAusentesMl = esMl && bloque.productos.some((p) => p.itemId && p.senalVentas.tipo === "ausente");
        const colapsado = Boolean(colapsados[bloque.id]);
        // Issue #231, punto B — "Full" solo tiene sentido como sort en
        // bloques de Mercado Libre: en el resto la columna siempre
        // muestra "N/A" (ver celda de abajo), así que ordenar por ese
        // criterio ahí no cambiaría nada — se saca de la lista.
        const criteriosBloque = esMl ? CRITERIOS_ORDEN : CRITERIOS_ORDEN.filter((c) => c.clave !== "full");
        // Issue #235, punto 8 — "Resumen OS por bloque/desplegable":
        // KPIs locales + Mejor opción, calculados por bloque (nunca un
        // solo resumen global) — referencia visual del pedido: el
        // banner de Amazon de Zilonix OS (PRODUCTOS ANALIZADOS, PRECIO
        // PROM, RANGO, ESTRELLAS, COMPRADOS/MES, % PRIME, DEMANDA
        // VALIDADA, Mejor opción).
        const esAmazon = bloque.plataforma === "Amazon";
        const resumenLocal = calcularResumenLocalBloque(bloque.productos);
        const mejorOpcion = mejorOpcionParaImportar(bloque.productos, termino, ahora);
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
              <select className="zx-control" value={criterioBloque} onChange={(e) => cambiarOrdenBloque(bloque.id, e.target.value as CriterioOrden)}>
                {criteriosBloque.map((c) => (
                  <option key={c.clave} value={c.clave}>
                    {c.etiqueta}
                  </option>
                ))}
              </select>
              {hayAusentesMl ? (
                <Boton type="button" variante="secundario" chico onClick={() => completarVendidosBloque(bloque)}>
                  {yaAbrioCompletar[bloque.id] ? "Completar vendidos de nuevo" : "Completar vendidos"}
                </Boton>
              ) : null}
              <Boton type="button" variante="fantasma" chico onClick={() => toggleColapso(bloque.id)}>
                {colapsado ? "Mostrar" : "Ocultar"}
              </Boton>
              <Boton type="button" variante="fantasma" chico onClick={() => eliminarBloque(bloque.id)}>
                Eliminar
              </Boton>
            </div>
            {!colapsado ? (
              <>
                {/* Issue #235, punto 8 — KPIs locales del bloque (nunca el
                    resumen combinado de todos los bloques de arriba —
                    ese sigue siendo solo para Mercado Libre, ver el
                    banner de Demanda más arriba). Genérico: el % que se
                    muestra (Full o Prime) depende de la plataforma de
                    ESTE bloque puntual. */}
                <div className={styles.kpis}>
                  <TarjetaKpi titulo="PRODUCTOS ANALIZADOS" valor={resumenLocal.productosAnalizados || undefined} textoVacio="Sin dato" />
                  <TarjetaKpi titulo="PRECIO PROM." valor={resumenLocal.precioPromedio != null ? money(resumenLocal.precioPromedio) : undefined} textoVacio="Sin dato" />
                  <TarjetaKpi
                    titulo="RANGO"
                    valor={resumenLocal.precioMinimo != null && resumenLocal.precioMaximo != null ? `${money(resumenLocal.precioMinimo)} – ${money(resumenLocal.precioMaximo)}` : undefined}
                    textoVacio="Sin dato"
                  />
                  <TarjetaKpi titulo="ESTRELLAS PROM." valor={resumenLocal.estrellasPromedio != null ? `${resumenLocal.estrellasPromedio.toFixed(1)}★` : undefined} textoVacio="Sin dato" />
                  <TarjetaKpi titulo={resumenLocal.volumenEtiqueta.toUpperCase()} valor={resumenLocal.volumenValor != null ? numero(resumenLocal.volumenValor) : undefined} textoVacio="Sin dato" />
                  {esMl ? (
                    <TarjetaKpi titulo="% FULL" valor={resumenLocal.porcentajeFull != null ? `${resumenLocal.porcentajeFull}%` : undefined} textoVacio="Sin dato" />
                  ) : esAmazon ? (
                    <TarjetaKpi titulo="% PRIME" valor={resumenLocal.porcentajePrime != null ? `${resumenLocal.porcentajePrime}%` : undefined} textoVacio="Sin dato" />
                  ) : null}
                </div>
                {/* "Demanda validada" — solo cuando hay evidencia real
                    (>=5 productos + un volumen de compras confirmado,
                    ver calcularResumenLocalBloque) — nunca una visita
                    inventada ni un histórico tratado como "/mes". */}
                {resumenLocal.demandaValidada ? (
                  <div className={styles.insignia}>
                    <Chip estado="exito">Demanda validada</Chip>
                    <span className={styles.notaInsignia}>
                      {resumenLocal.productosAnalizados} publicaciones reales analizadas, con {resumenLocal.volumenEtiqueta.toLowerCase()} confirmado en al menos una.
                    </span>
                  </div>
                ) : null}
                {mejorOpcion ? (
                  <div className={styles.insignia}>
                    <Chip estado="exito">Mejor opción para importar</Chip>
                    {mejorOpcion.producto.link ? (
                      <a href={mejorOpcion.producto.link} target="_blank" rel="noreferrer" className={styles.enlaceSeguir}>
                        {mejorOpcion.producto.titulo}
                      </a>
                    ) : (
                      <span>{mejorOpcion.producto.titulo}</span>
                    )}
                    <span className={styles.notaInsignia}>{money(mejorOpcion.producto.precio)} — {mejorOpcion.razon}</span>
                  </div>
                ) : null}
                <Tabla
                  encabezados={["Foto", "Producto", "Vendidos", "Precio", "Fact. est.", esMl ? "Full" : "Comprados/mes", "Calif.", "Enlace", ""]}
                >
                {ordenados.map((p, i) => (
                  <FilaTabla key={`${bloque.id}-${p.link ?? p.titulo}-${i}`}>
                    <CeldaTabla>
                      {p.foto && !fotosFallidas.has(p.foto) ? (
                        <span className={styles.fotoContenedor}>
                          {/* eslint-disable-next-line @next/next/no-img-element -- foto de un marketplace ajeno, mismo criterio que BarraSuperior/BarraLateral */}
                          <img
                            src={p.foto}
                            alt=""
                            width={36}
                            height={36}
                            referrerPolicy="no-referrer"
                            className={`${styles.foto} ${styles.fotoClicable}`}
                            onClick={() => setFotoAmpliada(p.foto)}
                            onMouseEnter={(e) => mostrarPreview(e, p.foto as string)}
                            onMouseLeave={ocultarPreview}
                            onError={() => marcarFotoFallida(p.foto as string)}
                          />
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
                          <div className={styles.subdato}>
                            {p.senalVentas.tipo === "mensual_piso" ? "comprados el mes pasado" : "acumulado histórico (sin período real)"}
                          </div>
                          {/* Issue #251 (fix "aproximados siempre visibles")
                              — bug real probado en staging: antes, sin
                              vendidosEst (ej. un resultado de catálogo
                              /p/, sin itemId) esta fila desaparecía
                              entera — ahora SIEMPRE se dibuja: con
                              acumulado presente, vendidosEst casi
                              siempre existe (issue #262, punto 2 —
                              vendidos estimados/ventas-mes aprox.,
                              Mercado Libre, con itemId/productId +
                              antigüedad real o calibrada, puede faltar
                              todavía, ver docs/ESTADO.md); "/mes" cae a
                              "Sin dato (falta antigüedad)" en vez de
                              desaparecer en silencio cuando no hay con
                              qué interpolar. Nunca mezclado sin la
                              etiqueta "aprox." al lado. */}
                          <div className={styles.subdato}>
                            {(() => {
                              const est = estimarAproximadosListado(p, ahora);
                              if (est.vendidosEst == null) {
                                return <Chip title="No hay vendidos confirmados que ajustar">Sin dato</Chip>;
                              }
                              return (
                                <>
                                  {numero(Math.round(est.vendidosEst))} vendidos ·{" "}
                                  {est.ventasMesEst != null ? (
                                    `${numero(Math.round(est.ventasMesEst))} /mes`
                                  ) : (
                                    <Chip title="Falta antigüedad (real o calibrada) para proyectar un ritmo mensual">Sin dato (falta antigüedad)</Chip>
                                  )}{" "}
                                  <Chip>{ETIQUETA_APROXIMADO}</Chip>
                                </>
                              );
                            })()}
                          </div>
                        </>
                      ) : (
                        <Chip>Sin dato</Chip>
                      )}
                    </CeldaTabla>
                    <CeldaTabla>{money(p.precio)}</CeldaTabla>
                    <CeldaTabla>
                      {(() => {
                        const facturacionReal = facturacionEstimadaListado(p);
                        if (facturacionReal != null) return money(facturacionReal); // Amazon, mensual_piso real
                        const facturacionAprox = estimarAproximadosListado(p, ahora).facturacionMesEst;
                        if (facturacionAprox != null) {
                          return (
                            <>
                              {money(facturacionAprox)} <Chip>{ETIQUETA_APROXIMADO}</Chip>
                            </>
                          );
                        }
                        // Issue #251 (fix "aproximados siempre visibles")
                        // — "—" solo cuando de verdad no hay NINGUNA
                        // señal de vendidos (ausente); con acumulado
                        // presente pero sin antigüedad para proyectar
                        // /mes, "Sin dato (falta antigüedad)" explica
                        // POR QUÉ falta, nunca un "—" indistinguible de
                        // "nunca va a haber dato acá".
                        if (p.senalVentas.tipo === "acumulado_sin_periodo" && p.senalVentas.valor != null) {
                          return <Chip title="Falta antigüedad (real o calibrada) para proyectar la facturación mensual">Sin dato (falta antigüedad)</Chip>;
                        }
                        return "—";
                      })()}
                    </CeldaTabla>
                    {/* Issue #231, punto B — "Full aparece en Amazon (Amazon
                        no tiene Full)": "Full" solo tiene sentido en
                        Mercado Libre. Issue #235, punto 4 — fuera de ML
                        esta misma columna se reaprovecha como
                        "Comprados/mes" (mismo valor que ya se ve en
                        Vendidos cuando senalVentas.tipo === "mensual_piso",
                        acá en su propia columna): el número real para
                        Amazon cuando lo confirma, "N/A" para cualquier
                        plataforma que nunca expone una tasa mensual real
                        (Temu/AliExpress/Shein/Alibaba — senalVentas nunca
                        las clasifica como mensual_piso, issue #227), y
                        "—" para Amazon puntual sin ese dato en esta fila
                        (el sitio no siempre lo muestra). Nunca se
                        confunde con el acumulado — ese sigue solo en
                        Vendidos, con su propio label "acumulado — nunca
                        /mes". */}
                    <CeldaTabla>
                      {esMl ? (
                        p.esFull == null ? (
                          "—"
                        ) : p.esFull ? (
                          <Chip estado="exito">Full</Chip>
                        ) : (
                          <Chip>No</Chip>
                        )
                      ) : p.senalVentas.tipo === "mensual_piso" ? (
                        p.senalVentas.valor != null ? (
                          numero(p.senalVentas.valor)
                        ) : (
                          "—"
                        )
                      ) : bloque.plataforma === "Amazon" ? (
                        "—"
                      ) : (
                        "N/A"
                      )}
                    </CeldaTabla>
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
              </>
            ) : null}
          </div>
        );
      })}
    </>
  );
}
