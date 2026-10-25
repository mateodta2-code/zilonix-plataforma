"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Chip } from "@/components/marco/Chip";
import { Boton } from "@/components/marco/Boton";
import { CeldaTabla, FilaTabla, Tabla } from "@/components/marco/Tabla";
import { InsigniaExtension } from "@/components/marco/InsigniaExtension";
import { TarjetaKpi } from "@/components/marco/TarjetaKpi";
import { aplicarVendidosExtension, combinarKpisConCompletados, ordenarPorVendidos, type KpisDemanda } from "@/lib/ml/investigacionCliente";
import {
  calcularResumenImportado,
  fusionarProductosImportados,
  linkHttpSeguro,
  reemplazarProductosImportados,
  type ProductoImportado,
} from "@/lib/ml/importacionListadoCliente";
import { generarVariantesBusqueda } from "@/lib/ml/variantesBusqueda";
import type { PublicacionInvestigacion } from "@/lib/ml/investigacion";
import { consumirClicAnalizarReciente } from "./analizarClic";
import { generarQueriesAnalizarAction } from "./actions";
import styles from "./page.module.css";

// Issue #210 (Sharel, staging) — "Analizar" trae candidatos reales de
// la API de Mercado Libre, pero esa API no deja ver sold_quantity para
// todas las ofertas. La extensión de Zilonix SÍ lo confirma cuando la
// persona abre el producto en Mercado Libre — este componente es el
// puente completo: botón (un solo clic real, nunca sola) que abre
// hasta 5 candidatos sin vendidos, y el listener de postMessage que
// recibe lo que esas pestañas leyeron (vía extension/marcador-zilonix.js
// y extension/background.js, ver extension/LEEME.md § Completar
// vendidos). Client Component a propósito: todo lo de abajo depende de
// window/postMessage/document, que no existen en el servidor.
//
// Mercado/Estrategia (page.tsx) siguen 100% server-rendered — los
// datos de la extensión solo afectan Demanda (vendidos por candidato),
// nunca precio/Full/vendedor, que no cambian con este puente.
const MAX_CANDIDATOS_COMPLETAR = 5;

function money(n: number): string {
  return `$${Math.round(n).toLocaleString("es-CO")}`;
}

function numero(n: number): string {
  return Math.round(n).toLocaleString("es-CO");
}

type MensajeVendidosExtension = {
  itemId: string;
  sold_quantity: number;
  date_created?: string | null;
  esFull?: boolean;
  etiquetaMasN?: boolean;
};

function esMensajeVendidosValido(valor: unknown): valor is MensajeVendidosExtension {
  if (!valor || typeof valor !== "object") return false;
  const m = valor as Record<string, unknown>;
  return typeof m.itemId === "string" && typeof m.sold_quantity === "number" && Number.isFinite(m.sold_quantity);
}

// Issue #213 — "Importar listado": payload que manda extension/content.js
// (botón "Enviar a Zilonix" en una página de búsqueda/listado de
// cualquiera de los 6 sitios), reenviado por extension/background.js
// y extension/marcador-zilonix.js. Nunca se confía en la forma del
// mensaje sin revisarla acá — mismo criterio que esMensajeVendidosValido.
type MensajeListadoExtension = {
  plataforma: string;
  url: string;
  productos: { titulo: string; precio: number; vendidos: number | null; link: string | null }[];
  // Issue #221 — "escaneo-analizar" marca un listado que vino del
  // escaneo automático que arrancó el propio clic en "Analizar"
  // (nunca de un "Enviar a Zilonix" manual en una pestaña que la
  // persona ya tenía abierta) — ese caso se fusiona directo, sin el
  // paso extra de "Importar/Fusionar/Reemplazar" (que sigue existiendo
  // para el caso manual, ver abajo). Ausente o cualquier otro valor =
  // tratado como manual, mismo comportamiento de siempre (#213).
  origen?: string;
};

function esMensajeListadoValido(valor: unknown): valor is MensajeListadoExtension {
  if (!valor || typeof valor !== "object") return false;
  const m = valor as Record<string, unknown>;
  if (typeof m.plataforma !== "string" || typeof m.url !== "string" || !Array.isArray(m.productos)) return false;
  return m.productos.every((p) => {
    if (!p || typeof p !== "object") return false;
    const prod = p as Record<string, unknown>;
    return typeof prod.titulo === "string" && typeof prod.precio === "number" && Number.isFinite(prod.precio);
  });
}

// Issue #225 — "Top 8 reseñas": payload que manda extension/background.js
// al terminar de leer el Top 8 (una sola pestaña reutilizada, igual
// que zilonix-os-web). `resena` sigue EXACTAMENTE la forma de
// extension/lectores/mercadolibre.js (leerResenasDesdeScript) — nunca
// se confía en el mensaje sin revisar la forma, mismo criterio que los
// otros dos puentes.
type ResenaProducto = {
  resenasTotales: number | null;
  promedio: number | null;
  positivas: number;
  negativas: number;
  resenasVisibles: number;
  recientes30: number;
  recientes90: number;
};

type MensajeResenasExtension = { resenasPorItemId: Record<string, ResenaProducto> };

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

function esMensajeResenasValido(valor: unknown): valor is MensajeResenasExtension {
  if (!valor || typeof valor !== "object") return false;
  const m = valor as Record<string, unknown>;
  if (!m.resenasPorItemId || typeof m.resenasPorItemId !== "object") return false;
  return Object.values(m.resenasPorItemId).every(esResenaValida);
}

const TOPE_ITEMS_RESENAS = 8;

export function PanelDemanda({
  termino,
  publicacionesIniciales,
  kpisBase,
  publicacionesEncontradas,
}: {
  termino: string;
  publicacionesIniciales: PublicacionInvestigacion[];
  kpisBase: KpisDemanda;
  publicacionesEncontradas: number;
}) {
  const [estado, setEstado] = useState<{ publicaciones: PublicacionInvestigacion[]; completadasPorExtension: PublicacionInvestigacion[] }>({
    publicaciones: publicacionesIniciales,
    completadasPorExtension: [],
  });
  const [conExtension, setConExtension] = useState<boolean | null>(null);
  const [yaAbrioCompletar, setYaAbrioCompletar] = useState(false);
  const [avisoBloqueado, setAvisoBloqueado] = useState(false);
  // Issue #221 — "Analizar estilo OS": true mientras la extensión está
  // abriendo/leyendo/cerrando las variantes del listado real de ML.
  const [escaneoEnCurso, setEscaneoEnCurso] = useState(false);
  // Issue #225 — las hasta 5 queries que de verdad se usaron en el
  // escaneo (término + variantes de IA y/o de reglas) — para mostrar
  // los chips. [] mientras no corrió ningún escaneo todavía.
  const [queriesUsadas, setQueriesUsadas] = useState<string[]>([]);
  // Issue #225 — "Top 8 reseñas": resenas ya leídas por itemId, y si
  // la lectura (una sola pestaña reutilizada) está en curso.
  const [resenas, setResenas] = useState<Record<string, ResenaProducto>>({});
  const [resenasEnCurso, setResenasEnCurso] = useState(false);

  // Issue #213 — "Importar listado": `importado` es la sesión ya
  // confirmada (nunca se mezcla con `estado.publicaciones`, la tabla
  // de arriba con datos reales de la API de Mercado Libre — son
  // candidatos de OTRAS plataformas, o de un listado leído a mano).
  // `pendiente` es un listado recién recibido que todavía espera que
  // la persona elija "Importar"/"Fusionar"/"Reemplazar" o "Descartar"
  // — nunca se importa solo con recibir el mensaje.
  const [listado, setListado] = useState<{ importado: ProductoImportado[]; pendiente: { plataforma: string; productos: ProductoImportado[] } | null }>({
    importado: [],
    pendiente: null,
  });

  // Issue #197/#210 — mismo atributo que lee InsigniaExtension, puesto
  // por extension/marcador-zilonix.js SOLO cuando corre sobre esta app.
  useEffect(() => {
    setConExtension(document.documentElement.hasAttribute("data-zilonix-extension"));
  }, []);

  // Issue #221/#225 — "Analizar estilo OS": si este montaje viene de
  // un clic real y reciente en "Analizar" (consumirClicAnalizarReciente,
  // ver FormularioAnalizar.tsx/analizarClic.ts) Y hay extensión, se le
  // pide al Server Action (generarQueriesAnalizarAction) hasta 5
  // queries (término + 4 variantes de IA, completadas con la
  // heurística de reglas si la IA falla/viene vacía/repite — ver
  // lib/ml/variantesBusqueda.ts) y se le pide a la extensión escanear
  // esas queries — UN solo postMessage página->extensión, nunca
  // abierto directo por esta página (la extensión es quien abre/lee/
  // cierra las pestañas, ver extension/background.js). Sin extensión,
  // o sin la marca reciente (ej. solo cambiaste de pestaña
  // Mercado->Demanda), nunca se dispara nada — Analizar sigue
  // funcionando 100% igual que siempre, solo por API.
  useEffect(() => {
    if (conExtension !== true) return;
    if (!consumirClicAnalizarReciente()) return;
    let cancelado = false;

    (async () => {
      let queries: string[];
      try {
        // La Server Action ya intenta IA + respaldo de reglas — este
        // catch es solo por si la ACCIÓN MISMA falla (sin sesión, red
        // caída), para que Analizar nunca se quede sin escanear nada.
        queries = await generarQueriesAnalizarAction(termino);
      } catch {
        queries = generarVariantesBusqueda(termino);
      }
      if (cancelado || !queries.length) return;
      setQueriesUsadas(queries);
      window.postMessage({ fuente: "zilonix-panel", tipo: "iniciar-escaneo", payload: { terminos: queries } }, window.location.origin);
      setEscaneoEnCurso(true);
    })();

    // Red de seguridad del lado del cliente: si la extensión nunca
    // contesta (ej. el Service Worker se recicló a mitad de camino,
    // ver la nota en extension/background.js), esto nunca deja
    // "Escaneando..." para siempre en pantalla.
    const limite = setTimeout(() => setEscaneoEnCurso(false), 90_000);
    return () => {
      cancelado = true;
      clearTimeout(limite);
    };
  }, [conExtension, termino]);

  // Issue #210/#213 — puente extensión → panel. El mensaje real llega
  // por extension/marcador-zilonix.js (window.postMessage con origin =
  // esta misma página) — nunca se confía en un mensaje de otro origin
  // ni de otra window, y nunca se completa una fila que ya tenía
  // vendidos real de la API (aplicarVendidosExtension lo revisa). Un
  // solo listener para los dos tipos de mensaje (#210 "vendidos-completados"
  // y #213 "listado-importado") — mismo origin/fuente a validar.
  useEffect(() => {
    function alRecibirMensaje(evento: MessageEvent) {
      if (evento.origin !== window.location.origin || evento.source !== window) return;
      const datos = evento.data as { fuente?: string; tipo?: string; payload?: unknown } | null;
      if (!datos || datos.fuente !== "zilonix-extension") return;

      if (datos.tipo === "vendidos-completados") {
        if (!esMensajeVendidosValido(datos.payload)) return;
        const payload = datos.payload;

        setEstado((actual) => {
          const fila = actual.publicaciones.find((p) => p.itemId === payload.itemId);
          if (!fila || fila.vendidos != null) return actual; // no es un candidato nuestro, o ya tenía dato real — nada que completar
          const publicaciones = aplicarVendidosExtension(actual.publicaciones, {
            itemId: payload.itemId,
            sold_quantity: payload.sold_quantity,
            date_created: payload.date_created ?? null,
            esFull: payload.esFull === true,
            etiquetaMasN: payload.etiquetaMasN === true,
          });
          const filaCompletada = publicaciones.find((p) => p.itemId === payload.itemId);
          return { publicaciones, completadasPorExtension: filaCompletada ? [...actual.completadasPorExtension, filaCompletada] : actual.completadasPorExtension };
        });
        return;
      }

      if (datos.tipo === "listado-importado") {
        if (!esMensajeListadoValido(datos.payload)) return;
        const payload = datos.payload;
        const productos: ProductoImportado[] = payload.productos.map((p) => ({
          plataforma: payload.plataforma,
          titulo: p.titulo,
          precio: p.precio,
          vendidos: typeof p.vendidos === "number" && Number.isFinite(p.vendidos) ? p.vendidos : null,
          link: linkHttpSeguro(p.link),
        }));

        // Issue #221 — "escaneo-analizar": la persona YA autorizó todo
        // esto con el clic en Analizar (ver el efecto de arriba) — se
        // fusiona directo, sin el paso extra de "Importar/Fusionar/
        // Reemplazar" que sigue pidiéndose para un "Enviar a Zilonix"
        // manual (#213, rama de abajo). Vacío es un resultado válido
        // (ninguna variante encontró nada) — igual apaga el indicador.
        if (payload.origen === "escaneo-analizar") {
          setEscaneoEnCurso(false);
          if (!productos.length) return;
          setListado((actual) => ({ ...actual, importado: fusionarProductosImportados(actual.importado, productos) }));
          return;
        }

        if (!productos.length) return; // mensaje vacío — nada que ofrecer importar
        setListado((actual) => ({ ...actual, pendiente: { plataforma: payload.plataforma, productos } }));
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
  }, []);

  // Issue #213 — "Fusionar" agrega al listado ya importado (sin
  // duplicar); "Reemplazar" descarta la sesión anterior. Las dos
  // únicas formas de confirmar un `pendiente` — nunca se importa solo
  // con recibirlo.
  function importarPendiente(modo: "fusionar" | "reemplazar") {
    setListado((actual) => {
      if (!actual.pendiente) return actual;
      const importado = modo === "fusionar" ? fusionarProductosImportados(actual.importado, actual.pendiente.productos) : reemplazarProductosImportados(actual.pendiente.productos);
      return { importado, pendiente: null };
    });
  }

  function descartarPendiente() {
    setListado((actual) => ({ ...actual, pendiente: null }));
  }

  const resumenImportado = useMemo(() => calcularResumenImportado(listado.importado), [listado.importado]);

  const publicacionesOrdenadas = useMemo(() => ordenarPorVendidos(estado.publicaciones), [estado.publicaciones]);
  const kpis = useMemo(() => combinarKpisConCompletados(kpisBase, estado.completadasPorExtension), [kpisBase, estado.completadasPorExtension]);

  const candidatosPendientes = useMemo(() => estado.publicaciones.filter((p) => p.vendidos == null && p.link), [estado.publicaciones]);

  // Issue #225 — "Top 8 reseñas": automático a partir de lo que YA
  // está ordenado por vendidos real (publicacionesOrdenadas, más
  // abajo) — nunca una llamada aparte. Solo entran candidatos con
  // link real (sin eso no hay página que leer).
  const top8ParaResenas = useMemo(() => publicacionesOrdenadas.filter((p) => p.link).slice(0, TOPE_ITEMS_RESENAS), [publicacionesOrdenadas]);

  function verResenas() {
    const items = top8ParaResenas.map((p) => ({ itemId: p.itemId, link: p.link as string }));
    if (!items.length) return;
    window.postMessage({ fuente: "zilonix-panel", tipo: "iniciar-resenas", payload: { items } }, window.location.origin);
    setResenasEnCurso(true);
  }

  function completarVendidos() {
    const candidatos = candidatosPendientes.slice(0, MAX_CANDIDATOS_COMPLETAR);
    let abiertas = 0;
    // Issue #210 — "con UN clic del usuario, nunca sola": las pestañas
    // se abren todas acá, dentro del mismo manejador del clic real —
    // nunca en un efecto, nunca en una respuesta de red.
    //
    // Corrección de Pablo (revisión PR #211) — bug real: el estándar
    // de HTML define que "noopener" (y "noreferrer", que internamente
    // también activa noopener) hace que window.open() devuelva SIEMPRE
    // null — con esas features no queda ninguna referencia real a la
    // ventana para devolver, se haya abierto o no. Pasarlas acá hacía
    // que `abiertas` quedara en 0 sin importar cuántas pestañas se
    // hubieran abierto de verdad, y el aviso de "el navegador bloqueó
    // alguna pestaña" salía siempre, incluso cuando todo había
    // funcionado. Se abre SIN ninguna de las dos (para poder confirmar
    // de verdad si el navegador bloqueó el popup) y se le quita el
    // `opener` a mano después — mismo resultado de seguridad real (la
    // pestaña nueva nunca recibe acceso de vuelta a esta página), sin
    // perder la única señal confiable de "¿se abrió o no?".
    for (const candidato of candidatos) {
      const ventana = window.open(candidato.link as string, "_blank");
      if (ventana) {
        ventana.opener = null;
        abiertas++;
      }
    }
    setYaAbrioCompletar(true);
    setAvisoBloqueado(abiertas < candidatos.length);
  }

  return (
    <>
      <div className={styles.insignia}>
        <InsigniaExtension />
        <span className={styles.notaInsignia}>
          Con la extensión, Analizar también escanea el listado real de Mercado Libre (tu término y unas pocas variantes) — abre y cierra esas
          pestañas sola, sin tocar ninguna publicación individual. Desde una búsqueda en Amazon, Temu u otras plataformas, el botón
          &quot;Enviar a Zilonix&quot; del panel flotante importa esos candidatos acá abajo.
        </span>
      </div>

      {escaneoEnCurso ? (
        <div className={styles.insignia}>
          <Chip estado="aviso">Escaneando Mercado Libre…</Chip>
          <span className={styles.notaInsignia}>
            La extensión está abriendo y cerrando el listado real para tu término y sus variantes — no cierres esta pestaña, ya vuelve sola.
          </span>
        </div>
      ) : null}

      {queriesUsadas.length > 1 ? (
        <div className={styles.insignia}>
          <span className={styles.notaInsignia}>Búsquedas usadas en el escaneo:</span>
          {queriesUsadas.map((q, i) => (
            <Chip key={`${q}-${i}`} estado={i === 0 ? "exito" : "neutro"}>
              {q}
            </Chip>
          ))}
        </div>
      ) : null}

      {conExtension && estado.completadasPorExtension.length > 0 ? (
        <div className={styles.insignia}>
          <Chip estado="exito">Cobertura real: {estado.completadasPorExtension.length} confirmados por la extensión</Chip>
          {candidatosPendientes.length > 0 ? (
            <Boton type="button" variante="secundario" chico onClick={completarVendidos}>
              Completar vendidos (~{Math.min(MAX_CANDIDATOS_COMPLETAR, candidatosPendientes.length)})
            </Boton>
          ) : null}
        </div>
      ) : null}

      {conExtension && estado.completadasPorExtension.length === 0 && candidatosPendientes.length > 0 ? (
        <div className={styles.insignia}>
          <Boton type="button" variante="secundario" chico onClick={completarVendidos}>
            Completar vendidos (~{Math.min(MAX_CANDIDATOS_COMPLETAR, candidatosPendientes.length)})
          </Boton>
          <span className={styles.notaInsignia}>
            {yaAbrioCompletar
              ? "Abrimos los candidatos en pestañas nuevas — dejalas cargar, los datos llegan solos a esta pantalla."
              : `Abrí "Completar vendidos" para traer el dato real de hasta ${MAX_CANDIDATOS_COMPLETAR} candidatos desde Mercado Libre.`}
          </span>
        </div>
      ) : null}

      {avisoBloqueado ? (
        <p className={styles.notaInsignia}>
          El navegador bloqueó alguna pestaña — permití ventanas emergentes para este sitio e intentá de nuevo. Chrome suele dejar pasar solo UNA
          pestaña por clic salvo que el sitio esté permitido explícitamente.
        </p>
      ) : null}

      {listado.pendiente ? (
        <div className={styles.insignia}>
          <Chip estado="aviso">
            {listado.pendiente.plataforma}: {listado.pendiente.productos.length} candidatos recibidos
          </Chip>
          {listado.importado.length > 0 ? (
            <>
              <Boton type="button" variante="secundario" chico onClick={() => importarPendiente("fusionar")}>
                Fusionar con lo importado
              </Boton>
              <Boton type="button" variante="secundario" chico onClick={() => importarPendiente("reemplazar")}>
                Reemplazar lo importado
              </Boton>
            </>
          ) : (
            <Boton type="button" variante="secundario" chico onClick={() => importarPendiente("reemplazar")}>
              Importar listado
            </Boton>
          )}
          <Boton type="button" variante="fantasma" chico onClick={descartarPendiente}>
            Descartar
          </Boton>
        </div>
      ) : null}

      <div className={styles.kpis}>
        <TarjetaKpi
          titulo="VENDIDOS TOTALES (REAL)"
          valor={kpis.vendidosTotalesReales ?? undefined}
          textoVacio="Sin dato"
          detalle={[`${kpis.publicacionesConVendidosReal} de ${publicacionesEncontradas} publicaciones con dato real`]}
        />
        <TarjetaKpi titulo="PROM. VENDIDOS POR PUBLICACIÓN" valor={kpis.promedioVendidosPorPublicacion ?? undefined} textoVacio="Sin dato" />
        <TarjetaKpi
          titulo="FACTURACIÓN EST. COP / MES"
          valor={kpis.facturacionMesTotalEstimada != null ? money(kpis.facturacionMesTotalEstimada) : undefined}
          textoVacio="Sin dato"
          detalle={kpis.facturacionMesTotalEstimada != null ? ["Estimado (estilo Selltrix) — nunca confirmado por Mercado Libre"] : undefined}
        />
      </div>

      <div>
        <p className={styles.tituloSeccion}>
          Publicaciones encontradas (hasta 10 — ordenadas por vendidos real cuando hay dato, nunca por precio disfrazado de popularidad)
        </p>
        <Tabla encabezados={["Foto", "Producto", "Vendidos", "Precio", "Fact. est. COP/mes", "Catálogo", "Full", "Vendedor", "Enlace", ""]}>
          {publicacionesOrdenadas.map((p) => (
            <FilaTabla key={p.itemId}>
              <CeldaTabla>
                {/* app no usa next/image a propósito (mismo criterio que BarraSuperior/BarraLateral) — foto de Mercado Libre, dominio ajeno. */}
                {p.foto ? <img src={p.foto} alt="" width={36} height={36} className={styles.foto} /> : "—"}
              </CeldaTabla>
              <CeldaTabla>{p.titulo}</CeldaTabla>
              <CeldaTabla>
                {p.vendidos != null ? (
                  <>
                    {numero(p.vendidos)}
                    {p.ventasMesEstimadas != null ? <div className={styles.subdato}>~{numero(p.ventasMesEstimadas)}/mes (estimado)</div> : null}
                  </>
                ) : (
                  <Chip>Sin dato</Chip>
                )}
              </CeldaTabla>
              <CeldaTabla>{money(p.precio)}</CeldaTabla>
              <CeldaTabla>{p.facturacionMesEstimada != null ? money(p.facturacionMesEstimada) : "—"}</CeldaTabla>
              <CeldaTabla>{p.productId != null ? <Chip estado="exito">Sí</Chip> : <Chip>No</Chip>}</CeldaTabla>
              <CeldaTabla>{p.esFull ? <Chip estado="exito">Full</Chip> : <Chip>—</Chip>}</CeldaTabla>
              <CeldaTabla>{p.vendedor ?? "—"}</CeldaTabla>
              <CeldaTabla>
                {p.link ? (
                  <a href={p.link} target="_blank" rel="noreferrer">
                    Ver en Mercado Libre
                  </a>
                ) : (
                  "—"
                )}
              </CeldaTabla>
              <CeldaTabla>
                <Link href={`/panel/investigacion/seguimiento?agregar=${encodeURIComponent(p.itemId)}`} className={styles.enlaceSeguir}>
                  Seguir
                </Link>
              </CeldaTabla>
            </FilaTabla>
          ))}
        </Tabla>
      </div>

      {conExtension && top8ParaResenas.length > 0 ? (
        <div>
          <p className={styles.tituloSeccion}>
            Reseñas — Top {top8ParaResenas.length} por vendidos real (issue #225). La API de Mercado Libre no deja ver reseñas de publicaciones
            ajenas (403) — se leen abriendo cada PDP con la extensión, en una sola pestaña reutilizada.
          </p>
          <div className={styles.insignia}>
            <Boton type="button" variante="secundario" chico onClick={verResenas} disabled={resenasEnCurso}>
              {resenasEnCurso ? "Leyendo reseñas…" : "Ver reseñas"}
            </Boton>
            {resenasEnCurso ? (
              <span className={styles.notaInsignia}>
                La extensión está navegando una pestaña de fondo por cada publicación — no la cierres, vuelve sola.
              </span>
            ) : null}
          </div>
          {Object.keys(resenas).length > 0 ? (
            <>
              <p className={styles.notaInsignia}>
                Total y promedio son los que confirma Mercado Libre; positivas/negativas y recientes solo cuentan las reseñas VISIBLES en la
                página (nunca el histórico completo si hay más).
              </p>
              <Tabla encabezados={["Producto", "Total", "Promedio", "+", "-", "Visibles", "Recientes (30d)"]}>
                {top8ParaResenas
                  .filter((p) => resenas[p.itemId])
                  .map((p) => {
                    const r = resenas[p.itemId];
                    return (
                      <FilaTabla key={p.itemId}>
                        <CeldaTabla>{p.titulo}</CeldaTabla>
                        <CeldaTabla>{r.resenasTotales != null ? numero(r.resenasTotales) : "Sin dato"}</CeldaTabla>
                        <CeldaTabla>{r.promedio != null ? r.promedio.toFixed(1) : "Sin dato"}</CeldaTabla>
                        <CeldaTabla>{numero(r.positivas)}</CeldaTabla>
                        <CeldaTabla>{numero(r.negativas)}</CeldaTabla>
                        <CeldaTabla>{numero(r.resenasVisibles)}</CeldaTabla>
                        <CeldaTabla>{numero(r.recientes30)}</CeldaTabla>
                      </FilaTabla>
                    );
                  })}
              </Tabla>
            </>
          ) : null}
        </div>
      ) : null}

      {listado.importado.length > 0 ? (
        <div>
          <p className={styles.tituloSeccion}>
            Listados importados de la extensión ({listado.importado.length}) — del escaneo automático de Analizar, de un listado manual de
            Mercado Libre, o de Amazon/Temu/AliExpress/Shein/Alibaba; cobertura solo extensión, nunca mezclado con los datos reales de la API de
            Mercado Libre de arriba.
          </p>
          <p className={styles.notaInsignia}>
            Precio {resumenImportado.precioMinimo != null ? money(resumenImportado.precioMinimo) : "—"} a{" "}
            {resumenImportado.precioMaximo != null ? money(resumenImportado.precioMaximo) : "—"} (promedio{" "}
            {resumenImportado.precioPromedio != null ? money(resumenImportado.precioPromedio) : "—"}) — suma de vendidos visibles:{" "}
            {resumenImportado.sumaVendidos != null ? numero(resumenImportado.sumaVendidos) : "Sin dato"}.
          </p>
          <Tabla encabezados={["Plataforma", "Producto", "Vendidos", "Precio", "Enlace"]}>
            {listado.importado.map((p, i) => (
              <FilaTabla key={`${p.plataforma}-${p.link ?? p.titulo}-${i}`}>
                <CeldaTabla>
                  <Chip>{p.plataforma}</Chip>
                </CeldaTabla>
                <CeldaTabla>{p.titulo}</CeldaTabla>
                <CeldaTabla>{p.vendidos != null ? numero(p.vendidos) : <Chip>Sin dato</Chip>}</CeldaTabla>
                <CeldaTabla>{money(p.precio)}</CeldaTabla>
                <CeldaTabla>
                  {p.link ? (
                    <a href={p.link} target="_blank" rel="noreferrer">
                      Ver publicación
                    </a>
                  ) : (
                    "—"
                  )}
                </CeldaTabla>
              </FilaTabla>
            ))}
          </Tabla>
        </div>
      ) : null}
    </>
  );
}
