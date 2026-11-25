"use client";

import { useEffect, useRef, useState } from "react";
import { Boton, BotonLink } from "@/components/marco/Boton";
import { BarraCarga } from "@/components/marco/BarraCarga";
import { Campo } from "@/components/marco/Campo";
import { Chip, type EstadoChip } from "@/components/marco/Chip";
import { Tarjeta } from "@/components/marco/Tarjeta";
import { Toast, type ItemToast } from "@/components/marco/Toast";
import { datosSitioMl, formatearMoneda, formatearNumero, SITE_ID_DEFECTO } from "@/lib/ml/sitios";
import type { ConteosPublicaciones, FiltroPublicaciones, PromocionParaUi, PublicacionConEstado, ResumenAplicarRegla } from "@/lib/ml/promocionesPublicaciones";
import type { ResumenSalirTodas, VistaPreviaSalirTodas } from "@/lib/ml/promocionesSalirTodas";
import { LARGO_MAXIMO_REGLAS_TEXTO } from "@/lib/ml/promocionesReglasTexto";
import { TOPE_ITEMS_SELECCION, type ItemSeleccionado } from "@/lib/ml/promocionesSeleccion";
import { accionDePromocion, calcularDesdePorcentaje, calcularDesdePrecioFinal, claveMarcaPromocion, formatoEnteroInput, motivoNoMarcable, motivoSinPrecioParaParticipar, parsearNumeroLocal, planAplicarPromociones, quedaBajoPrecioMinimo, superaMaximoConfigurado } from "./calculosPublicaciones";
import { BitacoraPromociones } from "./BitacoraPromociones";
import styles from "./promocionesReal.module.css";
import { SkuCopiable } from "@/components/marco/SkuCopiable";

type Cuenta = { id: string; nickname: string; siteId: string };
type ReglaUi = "todas" | "maximo" | "tabla-maestra" | "salir-todas";
type TipoAjuste = "porcentaje" | "valor";

const ETIQUETA_FILTRO: Record<FiltroPublicaciones, string> = {
  todas: "Todas",
  "en-promocion": "En promoción",
  "sin-promocion": "Sin promoción",
  "con-error": "Con error",
};

// Nombres reales de Mercado Libre — se muestran igual, acá solo se
// traduce el rótulo visible; el tipo real (ej. "DEAL") siempre se ve
// también, chico, al lado.
//
// Tarea "Promociones-Ajustes-1" — bug real confirmado en staging
// (Mateo, cuenta sharel): DEAL es la "Campaña tradicional" de Mercado
// Libre, NO la Oferta del día real (que es DOD/Daily Deal) — estaban
// cambiados. Esta confusión fue justo la causa de que "Dejar de
// participar" no apareciera en una DEAL ya aplicada (ver
// TIPOS_SALIR_API, lib/ml/promociones.ts).
const ETIQUETA_TIPO_PROMOCION: Record<string, string> = {
  DEAL: "Campaña tradicional",
  DOD: "Oferta del día",
  LIGHTNING: "Oferta relámpago",
  PRICE_DISCOUNT: "Descuento por porcentaje",
  SMART: "Precio inteligente",
  UNHEALTHY_STOCK: "Liquidación de stock",
  PRE_NEGOTIATED: "Descuento pre-negociado",
  PRICE_MATCHING: "Igualar precio",
  VOLUME: "Descuento por volumen",
  MARKETPLACE_CAMPAIGN: "Campaña de Mercado Libre",
  SELLER_COUPON_CAMPAIGN: "Cupón del vendedor",
  SELLER_CAMPAIGN: "Campaña propia",
};

function nombrePromocion(tipoPromocion: string): string {
  return ETIQUETA_TIPO_PROMOCION[tipoPromocion] ?? tipoPromocion;
}

// Título de una promo: el nombre real de ML si vino; si no, el tipo legible.
export function tituloPromocion(promocion: { tipoPromocion: string; nombreMl?: string | null }): string {
  return promocion.nombreMl?.trim() ? promocion.nombreMl : nombrePromocion(promocion.tipoPromocion);
}

export function estadoPromocionEs(estadoMl: string): { texto: string; estado: "exito" | "aviso" | "neutro" } {
  if (estadoMl === "started") return { texto: "Activa", estado: "exito" };
  if (estadoMl === "pending") return { texto: "Programada", estado: "aviso" };
  if (estadoMl === "candidate") return { texto: "Disponible", estado: "neutro" };
  if (estadoMl === "finished") return { texto: "Finalizada", estado: "neutro" };
  return { texto: estadoMl, estado: "neutro" };
}

// «5 nov – 2 dic»: toma el YYYY-MM-DD que manda ML (ya en la fecha local del
// sitio) y lo formatea en UTC para que el navegador no lo corra un día.
export function rangoFechasPromocion(inicio: string | null | undefined, fin: string | null | undefined, idioma: string): string | null {
  const ymd = (v: string | null | undefined) => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : null);
  const a = ymd(inicio);
  const b = ymd(fin);
  if (!a && !b) return null;
  const anioActual = new Date().getFullYear();
  const dar = (v: string) => {
    const anio = Number(v.slice(0, 4));
    const opciones: Intl.DateTimeFormatOptions = anio === anioActual ? { day: "numeric", month: "short", timeZone: "UTC" } : { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" };
    return new Intl.DateTimeFormat(idioma, opciones).format(new Date(`${v}T00:00:00Z`));
  };
  if (a && b) return `${dar(a)} – ${dar(b)}`;
  return dar((a ?? b) as string);
}

function sumarConteos(a: ConteosPublicaciones, b: ConteosPublicaciones): ConteosPublicaciones {
  return { todas: a.todas + b.todas, enPromocion: a.enPromocion + b.enPromocion, sinPromocion: a.sinPromocion + b.sinPromocion, conError: a.conError + b.conError };
}

function claveSeleccion(cuentaMlId: string, itemId: string): string {
  return `${cuentaMlId}:${itemId}`;
}

function bloquearScroll(bloquear: boolean) {
  document.body.style.overflow = bloquear ? "hidden" : "";
}

function formatoFecha(iso: string): string {
  return new Intl.DateTimeFormat("es", { dateStyle: "medium", timeStyle: "short" }).format(new Date(iso));
}

function simboloMoneda(siteId: string): string {
  const sitio = datosSitioMl(siteId);
  return new Intl.NumberFormat(sitio.idioma, { style: "currency", currency: sitio.moneda, maximumFractionDigits: 0 })
    .formatToParts(0)
    .filter((p) => p.type === "currency")
    .map((p) => p.value)
    .join("");
}

function FotoPlaceholder() {
  return (
    <div className={styles.foto} aria-hidden="true">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="5" width="18" height="14" rx="2" />
        <circle cx="9" cy="10.5" r="1.6" />
        <path d="m4 17 5-5 4 4 3-3 4 4" />
      </svg>
    </div>
  );
}

export function PaginaPromocionesReal({
  cuentas,
  puedeEjecutar,
  puedeAprobar = false,
  reglasAdicionalesIniciales = [],
  resumenMaestraSku,
}: {
  cuentas: Cuenta[];
  puedeEjecutar: boolean;
  puedeAprobar?: boolean;
  reglasAdicionalesIniciales?: { cuentaId: string; texto: string }[];
  resumenMaestraSku: { total: number; actualizadoTs: string | null };
}) {
  const cuentaPorId = new Map(cuentas.map((c) => [c.id, c]));
  function idiomaDeCuenta(cuentaMlId: string): string {
    return datosSitioMl(cuentaPorId.get(cuentaMlId)?.siteId ?? SITE_ID_DEFECTO).idioma;
  }

  // Promo-B: pestañas. La vista de publicaciones solo se oculta (no se desmonta) para conservar lista, filtros y selección de Promo-A.
  const [pestana, setPestana] = useState<"publicaciones" | "bitacora">("publicaciones");
  const [bitacoraAbierta, setBitacoraAbierta] = useState(false);
  const [cuentaSeleccionada, setCuentaSeleccionada] = useState<string>("todas");
  const [filtro, setFiltro] = useState<FiltroPublicaciones>("todas");
  const [buscarTexto, setBuscarTexto] = useState("");
  const [buscarAplicado, setBuscarAplicado] = useState("");

  // Promo-D: la regla elegida viaja al cargar la lista y al participar por producto («todas» no aplica piso ni tope nuestro).
  const [regla, setRegla] = useState<ReglaUi>("todas");
  // Promo-F: «máximo X %» = solo el tope de % (sin piso de Finanzas); el X viaja al listar y al participar.
  // Promo-G: el input se actualiza al instante (`maximoPctInput`); el valor que dispara la recarga
  // y viaja al servidor (`maximoPct`) espera ~600 ms a que se deje de escribir (escribir «12» = UNA recarga).
  const [maximoPctInput, setMaximoPctInput] = useState(15);
  const [maximoPct, setMaximoPct] = useState(15);
  useEffect(() => {
    if (maximoPctInput === maximoPct) return;
    const id = setTimeout(() => setMaximoPct(maximoPctInput), 600);
    return () => clearTimeout(id);
  }, [maximoPctInput, maximoPct]);
  const maximoPctValido = Number.isFinite(maximoPct) && maximoPct >= 1 && maximoPct <= 80;
  const modoCarga = regla === "todas" ? "todas" : regla === "maximo" && maximoPctValido ? `maximo-${maximoPct}` : "tabla-maestra";
  const reglaParaServidor = (): { regla?: string; maximoPct?: number } => (regla === "todas" ? { regla: "todas" } : regla === "maximo" && maximoPctValido ? { regla: "maximo", maximoPct } : {});
  const [filas, setFilas] = useState<PublicacionConEstado[]>([]);
  const [conteos, setConteos] = useState<ConteosPublicaciones>({ todas: 0, enPromocion: 0, sinPromocion: 0, conError: 0 });
  const [cursor, setCursor] = useState<string | null>(null);
  const [cargandoAuto, setCargandoAuto] = useState(false);
  const [topeAlcanzado, setTopeAlcanzado] = useState(false);
  // Promo-G: total del listado (solo si ML lo dio) y estado del cartel «Carga completa» / «Carga detenida».
  const [totalEstimado, setTotalEstimado] = useState<number | null>(null);
  const [cierreCarga, setCierreCarga] = useState<"completa" | "detenida" | null>(null);
  const [expandidaId, setExpandidaId] = useState<string | null>(null);
  // Promo-A (Refs #571): la regla se aplica SOLO a lo que se marca acá.
  const [seleccionadas, setSeleccionadas] = useState<Set<string>>(new Set());

  const [toasts, setToasts] = useState<ItemToast[]>([]);
  function mostrarToast(texto: string, estado: EstadoChip) {
    const id = `${Date.now()}-${Math.random()}`;
    setToasts((actual) => [...actual, { id, texto, estado }]);
    setTimeout(() => setToasts((actual) => actual.filter((t) => t.id !== id)), 6000);
  }

  // Búsqueda con un pequeño retraso — nunca una petición por cada tecla.
  useEffect(() => {
    const id = setTimeout(() => setBuscarAplicado(buscarTexto), 300);
    return () => clearTimeout(id);
  }, [buscarTexto]);

  // Tarea "Promociones-Ajustes-1" — antes había que ir clickeando
  // "Cargar más publicaciones" a mano, página por página (pedido
  // explícito de Mateo: que cargue todo sola). Ahora pide página tras
  // página en segundo plano, sin que la persona haga nada, con un tope
  // de seguridad (nunca escanea un catálogo gigante sin límite de
  // una), una pausa chica entre páginas, y un botón para detenerla.
  const TOPE_CARGA_AUTOMATICA = 500;
  const PAUSA_ENTRE_PAGINAS_MS = 150;

  // Id de la carga en curso — cada cambio de cuenta/filtro/búsqueda
  // arranca una carga NUEVA con un id distinto; si una respuesta
  // tardía de la carga VIEJA llega después, se descarta (nunca pisa
  // la vista con resultados que ya no corresponden a lo que se está
  // mirando).
  const idCargaRef = useRef(0);
  const detenerRef = useRef(false);

  function esperar(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async function pedirPagina(cursorParaUsar: string | null): Promise<{ filas: PublicacionConEstado[]; conteosLote: ConteosPublicaciones; cursorSiguiente: string | null; totalEstimado?: number } | null> {
    // «todas» y «máximo» relajan el piso en el servidor; las otras dos piden lo mismo (con piso).
    const params = new URLSearchParams({ filtro, buscar: buscarAplicado, regla: regla === "todas" ? "todas" : regla === "maximo" && maximoPctValido ? "maximo" : "tabla-maestra" });
    if (regla === "maximo" && maximoPctValido) params.set("maximoPct", String(maximoPct));
    if (cuentaSeleccionada !== "todas") params.set("cuentaId", cuentaSeleccionada);
    if (cursorParaUsar) params.set("cursor", cursorParaUsar);
    try {
      const res = await fetch(`/api/ml/promociones/publicaciones?${params.toString()}`);
      if (!res.ok) {
        mostrarToast("No se pudo cargar la lista de publicaciones — probar de nuevo.", "peligro");
        return null;
      }
      return await res.json();
    } catch {
      mostrarToast("No se pudo conectar con el servidor — revisar la conexión e intentar de nuevo.", "peligro");
      return null;
    }
  }

  // `reiniciar=true` limpia lo ya cargado y arranca de cero (cambio de
  // cuenta/filtro/búsqueda); `reiniciar=false` sigue desde el cursor
  // actual (botón "Seguir cargando", después del tope o de detener).
  // `suave`: recarga por cambio de regla — la lista y la selección se quedan a la vista
  // hasta que llega la primera página nueva (que las reemplaza), sin parpadeo ni perder marcas.
  async function cargarTodoAutomatico(reiniciar: boolean, suave = false) {
    const miId = ++idCargaRef.current;
    detenerRef.current = false;
    if (reiniciar && !suave) {
      setFilas([]);
      setConteos({ todas: 0, enPromocion: 0, sinPromocion: 0, conError: 0 });
      setCursor(null);
      setExpandidaId(null);
      // Una lista nueva (otra cuenta/filtro/búsqueda, o recarga tras aplicar)
      // nunca arrastra marcas de filas que ya no se ven.
      setSeleccionadas(new Set());
    }
    setTopeAlcanzado(false);
    setCierreCarga(null);
    if (reiniciar) setTotalEstimado(null);
    setCargandoAuto(true);

    let cursorActual: string | null = reiniciar ? null : cursor;
    let totalRevisado = reiniciar ? 0 : conteos.todas;
    let primeraPagina = true;

    while (true) {
      const resultado = await pedirPagina(cursorActual);
      if (idCargaRef.current !== miId) return; // esta carga ya no es la vigente
      if (!resultado) break;

      const reemplaza = suave && primeraPagina;
      primeraPagina = false;
      if (reemplaza) setExpandidaId(null);
      setFilas((actual) => (reemplaza ? resultado.filas : [...actual, ...resultado.filas]));
      setConteos((actual) => (reemplaza ? resultado.conteosLote : sumarConteos(actual, resultado.conteosLote)));
      totalRevisado += resultado.conteosLote.todas;
      if (typeof resultado.totalEstimado === "number" && resultado.totalEstimado > 0) setTotalEstimado(resultado.totalEstimado);
      cursorActual = resultado.cursorSiguiente;
      setCursor(cursorActual);

      if (!cursorActual || detenerRef.current) break;
      if (totalRevisado >= TOPE_CARGA_AUTOMATICA) {
        setTopeAlcanzado(true);
        break;
      }
      await esperar(PAUSA_ENTRE_PAGINAS_MS);
    }
    if (idCargaRef.current === miId) {
      setCargandoAuto(false);
      setCierreCarga(detenerRef.current || cursorActual ? "detenida" : "completa");
    }
  }

  // Promo-D: cambiar entre «todas» (sin piso) y cualquier otra regla recalcula
  // las filas en el servidor; la selección de Promo-A se conserva (mismos productos).
  const sinPisoPrevioRef = useRef(modoCarga);
  useEffect(() => {
    const cambioModoPiso = sinPisoPrevioRef.current !== modoCarga;
    sinPisoPrevioRef.current = modoCarga;
    void cargarTodoAutomatico(true, cambioModoPiso);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- cargarTodoAutomatico se recrea cada render; solo importa reaccionar a estos 3 (cancela la carga vieja por idCargaRef)
  }, [cuentaSeleccionada, filtro, buscarAplicado, modoCarga]);

  function parcharPromo(itemId: string, cuentaMlId: string, tipoPromocion: string, promotionIdMl: string | null, mutar: (p: PromocionParaUi) => PromocionParaUi | null) {
    setFilas((actual) =>
      actual.map((fila) => {
        if (fila.itemId !== itemId || fila.cuentaMlId !== cuentaMlId) return fila;
        const promociones = fila.promociones
          .map((p) => (p.tipoPromocion === tipoPromocion && p.promotionIdMl === promotionIdMl ? mutar(p) : p))
          .filter((p): p is PromocionParaUi => p !== null);
        const estado = promociones.some((p) => p.estadoMl === "started" || p.estadoMl === "pending") ? "en_promocion" : "sin_promocion";
        return { ...fila, promociones, estado };
      })
    );
  }

  // ---------- Modal "Participar" ----------
  const dialogParticiparRef = useRef<HTMLDialogElement>(null);
  const [seleccion, setSeleccion] = useState<{ fila: PublicacionConEstado; promocion: PromocionParaUi } | null>(null);
  const [tipoAjuste, setTipoAjuste] = useState<TipoAjuste>("porcentaje");
  const [valorTexto, setValorTexto] = useState("");
  const [enviandoParticipar, setEnviandoParticipar] = useState(false);
  const [errorParticipar, setErrorParticipar] = useState<string | null>(null);

  function abrirModalParticipar(fila: PublicacionConEstado, promocion: PromocionParaUi) {
    setSeleccion({ fila, promocion });
    setTipoAjuste("porcentaje");
    const original = promocion.precioOriginal ?? fila.precioOriginal ?? 0;
    const sugerido = promocion.precioSugerido ?? original;
    const { descuentoVendedorPct } = calcularDesdePrecioFinal(original, sugerido);
    setValorTexto(formatearNumero(Math.round(descuentoVendedorPct * 10) / 10, idiomaDeCuenta(fila.cuentaMlId)));
    setErrorParticipar(null);
    bloquearScroll(true);
    dialogParticiparRef.current?.showModal();
  }

  function cerrarModalParticipar() {
    dialogParticiparRef.current?.close();
    bloquearScroll(false);
    setSeleccion(null);
  }

  let calculoModal: { precioOriginal: number; precioFinal: number; descuentoVendedorPct: number; quedaBajoMinimo: boolean } | null = null;
  if (seleccion) {
    const { fila, promocion } = seleccion;
    const idioma = idiomaDeCuenta(fila.cuentaMlId);
    const precioOriginal = promocion.precioOriginal ?? fila.precioOriginal ?? 0;
    const valorNumerico = parsearNumeroLocal(valorTexto, idioma) ?? 0;
    const resultado = tipoAjuste === "porcentaje" ? calcularDesdePorcentaje(precioOriginal, valorNumerico) : calcularDesdePrecioFinal(precioOriginal, valorNumerico);
    calculoModal = {
      precioOriginal,
      precioFinal: Math.round(resultado.precioFinal),
      descuentoVendedorPct: resultado.descuentoVendedorPct,
      quedaBajoMinimo: promocion.precioMinimo != null && resultado.precioFinal < promocion.precioMinimo,
    };
  }

  async function confirmarParticipar() {
    if (!seleccion || !calculoModal) return;
    setEnviandoParticipar(true);
    setErrorParticipar(null);
    const { fila, promocion } = seleccion;
    let body: { ok?: boolean; estado?: string; error?: string | null; accionId?: string | null } = {};
    try {
      const res = await fetch("/api/ml/promociones/publicaciones/participar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          cuentaId: fila.cuentaMlId,
          itemId: fila.itemId,
          promotionIdMl: promocion.promotionIdMl,
          tipoPromocion: promocion.tipoPromocion,
          precioElegido: calculoModal.precioFinal,
          ...reglaParaServidor(),
        }),
      });
      body = await res.json().catch(() => ({}));
    } catch {
      setEnviandoParticipar(false);
      setErrorParticipar("No se pudo conectar con el servidor — revisar la conexión e intentar de nuevo.");
      return;
    }
    setEnviandoParticipar(false);
    if (body.ok) {
      parcharPromo(fila.itemId, fila.cuentaMlId, promocion.tipoPromocion, promocion.promotionIdMl, (p) => ({
        ...p,
        estadoMl: "started",
        precioActual: calculoModal!.precioFinal,
        cumpleReglas: true,
        accionSugerida: null,
      }));
      mostrarToast("Listo — se participa en la promoción.", "exito");
      cerrarModalParticipar();
    } else {
      setErrorParticipar(body.error ?? "No se pudo participar en esta promoción.");
    }
  }

  // ---------- Confirmación "Dejar de participar" ----------
  const dialogSalirRef = useRef<HTMLDialogElement>(null);
  const [confirmandoSalir, setConfirmandoSalir] = useState<{ fila: PublicacionConEstado; promocion: PromocionParaUi } | null>(null);
  const [enviandoSalir, setEnviandoSalir] = useState(false);
  const [errorSalir, setErrorSalir] = useState<string | null>(null);

  function abrirConfirmarSalir(fila: PublicacionConEstado, promocion: PromocionParaUi) {
    setConfirmandoSalir({ fila, promocion });
    setErrorSalir(null);
    bloquearScroll(true);
    dialogSalirRef.current?.showModal();
  }

  function cerrarConfirmarSalir() {
    dialogSalirRef.current?.close();
    bloquearScroll(false);
    setConfirmandoSalir(null);
  }

  async function confirmarSalir() {
    if (!confirmandoSalir) return;
    const { fila, promocion } = confirmandoSalir;
    setEnviandoSalir(true);
    setErrorSalir(null);
    let body: { ok?: boolean; yaNoParticipaba?: boolean; error?: string } = {};
    let res: Response;
    try {
      res = await fetch("/api/ml/promociones/participando/salir", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cuentaId: fila.cuentaMlId, itemId: fila.itemId, promotionIdMl: promocion.promotionIdMl, tipoPromocion: promocion.tipoPromocion }),
      });
      body = await res.json().catch(() => ({}));
    } catch {
      setEnviandoSalir(false);
      setErrorSalir("No se pudo conectar con el servidor — revisar la conexión e intentar de nuevo.");
      return;
    }
    setEnviandoSalir(false);
    if (res.ok) {
      parcharPromo(fila.itemId, fila.cuentaMlId, promocion.tipoPromocion, promocion.promotionIdMl, () => null);
      mostrarToast(body.yaNoParticipaba ? "Ya no se participaba en esta promoción." : "Listo — se dejó de participar.", body.yaNoParticipaba ? "neutro" : "exito");
      cerrarConfirmarSalir();
    } else {
      setErrorSalir(body.error ?? "No se pudo dejar de participar en esta promoción.");
    }
  }

  // ---------- Promo-C (Refs #573): aplicar solo las promociones marcadas de UN producto ----------
  const [marcasPromo, setMarcasPromo] = useState<Record<string, Set<string>>>({});
  const [resultadosPromo, setResultadosPromo] = useState<Record<string, { ok: boolean; texto: string }>>({});
  const [aplicandoFila, setAplicandoFila] = useState<string | null>(null);

  function alternarMarcaPromo(fila: PublicacionConEstado, promocion: PromocionParaUi) {
    const claveFila = claveSeleccion(fila.cuentaMlId, fila.itemId);
    setMarcasPromo((actual) => {
      const nuevo = new Set(actual[claveFila] ?? []);
      const clave = claveMarcaPromocion(promocion);
      if (nuevo.has(clave)) nuevo.delete(clave);
      else nuevo.add(clave);
      return { ...actual, [claveFila]: nuevo };
    });
  }

  // Una llamada por promoción marcada, en serie (rate limiting: el reintento
  // 429 ya vive en el servidor). Cada llamada queda registrada en
  // promociones_acciones por las rutas de siempre.
  async function aplicarAEsteProducto(fila: PublicacionConEstado) {
    const claveFila = claveSeleccion(fila.cuentaMlId, fila.itemId);
    const plan = planAplicarPromociones(fila.promociones, marcasPromo[claveFila] ?? new Set());
    if (plan.length === 0) return;
    const salidas = plan.filter((x) => x.accion === "salir").length;
    if (salidas > 0 && !window.confirm(`Vas a dejar de participar en ${salidas} promoción(es) de este producto. ¿Continuar?`)) return;
    setAplicandoFila(claveFila);
    for (const { promocion, accion } of plan) {
      const claveResultado = `${claveFila}|${claveMarcaPromocion(promocion)}`;
      let resultado: { ok: boolean; texto: string };
      try {
        const esSalir = accion === "salir";
        const res = await fetch(esSalir ? "/api/ml/promociones/participando/salir" : "/api/ml/promociones/publicaciones/participar", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            cuentaId: fila.cuentaMlId,
            itemId: fila.itemId,
            promotionIdMl: promocion.promotionIdMl,
            tipoPromocion: promocion.tipoPromocion,
            ...(esSalir ? {} : { precioElegido: promocion.precioSugerido, ...reglaParaServidor() }),
          }),
        });
        const body = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string | null };
        const exito = esSalir ? res.ok : body.ok === true;
        resultado = exito ? { ok: true, texto: esSalir ? "Listo — se dejó de participar." : "Listo — se participa." } : { ok: false, texto: body.error ?? "No se pudo aplicar." };
        if (exito) {
          parcharPromo(
            fila.itemId,
            fila.cuentaMlId,
            promocion.tipoPromocion,
            promocion.promotionIdMl,
            esSalir ? () => null : (p) => ({ ...p, estadoMl: "started", precioActual: promocion.precioSugerido, cumpleReglas: true, accionSugerida: null })
          );
        }
      } catch {
        resultado = { ok: false, texto: "No se pudo conectar con el servidor." };
      }
      setResultadosPromo((actual) => ({ ...actual, [claveResultado]: resultado }));
    }
    setMarcasPromo((actual) => ({ ...actual, [claveFila]: new Set() }));
    setAplicandoFila(null);
  }

  // ---------- Selección de publicaciones ----------
  // Solo cuentan las marcadas que siguen en la lista cargada.
  const seleccionActual: ItemSeleccionado[] = filas.filter((f) => seleccionadas.has(claveSeleccion(f.cuentaMlId, f.itemId))).map((f) => ({ cuentaId: f.cuentaMlId, itemId: f.itemId }));
  const cantidadSeleccionada = seleccionActual.length;
  const todasMarcadas = filas.length > 0 && cantidadSeleccionada === Math.min(filas.length, TOPE_ITEMS_SELECCION);

  function alternarSeleccion(fila: PublicacionConEstado) {
    const clave = claveSeleccion(fila.cuentaMlId, fila.itemId);
    setSeleccionadas((actual) => {
      const nuevo = new Set(actual);
      if (nuevo.has(clave)) nuevo.delete(clave);
      else if (nuevo.size < TOPE_ITEMS_SELECCION) nuevo.add(clave);
      return nuevo;
    });
  }

  function alternarTodas() {
    if (todasMarcadas) {
      setSeleccionadas(new Set());
      return;
    }
    // Las cargadas del filtro/pestaña/búsqueda actual, hasta el tope por vez.
    setSeleccionadas(new Set(filas.slice(0, TOPE_ITEMS_SELECCION).map((f) => claveSeleccion(f.cuentaMlId, f.itemId))));
  }

  // ---------- Reglas (lote) ----------
  const dialogReglaRef = useRef<HTMLDialogElement>(null);
  const [pasoRegla, setPasoRegla] = useState<"confirmar" | "resultado">("confirmar");
  const [aplicandoRegla, setAplicandoRegla] = useState(false);
  const [resultadoRegla, setResultadoRegla] = useState<ResumenAplicarRegla | null>(null);
  const [errorRegla, setErrorRegla] = useState<string | null>(null);

  function abrirAplicarRegla() {
    if (cantidadSeleccionada === 0) return;
    setPasoRegla("confirmar");
    setResultadoRegla(null);
    setErrorRegla(null);
    bloquearScroll(true);
    dialogReglaRef.current?.showModal();
  }

  function cerrarDialogoRegla() {
    dialogReglaRef.current?.close();
    bloquearScroll(false);
  }

  async function confirmarAplicarRegla() {
    setAplicandoRegla(true);
    setErrorRegla(null);
    let body: ResumenAplicarRegla | { error?: string } = {} as ResumenAplicarRegla;
    try {
      const res = await fetch("/api/ml/promociones/publicaciones/reglas-aplicar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ seleccion: seleccionActual, regla, maximoPct: regla === "maximo" ? maximoPctInput : undefined }),
      });
      body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error("error");
    } catch {
      setAplicandoRegla(false);
      setErrorRegla("No se pudo aplicar la regla — revisar la conexión e intentar de nuevo.");
      return;
    }
    setAplicandoRegla(false);
    setResultadoRegla(body as ResumenAplicarRegla);
    setPasoRegla("resultado");
    setSeleccionadas(new Set());
    void cargarTodoAutomatico(true);
  }

  // ---------- «Dejar de participar en todas» (vista previa → confirmar → resultado) ----------
  const dialogSalirTodasRef = useRef<HTMLDialogElement>(null);
  const [pasoSalirTodas, setPasoSalirTodas] = useState<"cargando" | "confirmar" | "ejecutando" | "resultado">("cargando");
  const [vistaPreviaSalir, setVistaPreviaSalir] = useState<VistaPreviaSalirTodas | null>(null);
  const [resultadoSalirTodas, setResultadoSalirTodas] = useState<ResumenSalirTodas | null>(null);
  const [errorSalirTodas, setErrorSalirTodas] = useState<string | null>(null);

  async function pedirReglaSalirTodas(extra: { vistaPrevia?: true; confirmado?: true }): Promise<{ ok: boolean; body: unknown }> {
    try {
      const res = await fetch("/api/ml/promociones/publicaciones/reglas-aplicar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ seleccion: seleccionActual, regla: "salir-todas", ...extra }),
      });
      return { ok: res.ok, body: await res.json().catch(() => ({})) };
    } catch {
      return { ok: false, body: {} };
    }
  }

  async function abrirSalirTodas() {
    if (cantidadSeleccionada === 0) return;
    setPasoSalirTodas("cargando");
    setVistaPreviaSalir(null);
    setResultadoSalirTodas(null);
    setErrorSalirTodas(null);
    bloquearScroll(true);
    dialogSalirTodasRef.current?.showModal();
    const { ok, body } = await pedirReglaSalirTodas({ vistaPrevia: true });
    if (!ok) {
      setErrorSalirTodas((body as { error?: string }).error ?? "No se pudo revisar las publicaciones — revisar la conexión e intentar de nuevo.");
      return;
    }
    setVistaPreviaSalir(body as VistaPreviaSalirTodas);
    setPasoSalirTodas("confirmar");
  }

  function cerrarSalirTodas() {
    dialogSalirTodasRef.current?.close();
    bloquearScroll(false);
  }

  async function confirmarSalirTodas() {
    setPasoSalirTodas("ejecutando");
    setErrorSalirTodas(null);
    const { ok, body } = await pedirReglaSalirTodas({ confirmado: true });
    if (!ok) {
      setPasoSalirTodas("confirmar");
      setErrorSalirTodas((body as { error?: string }).error ?? "No se pudo completar — revisar la conexión e intentar de nuevo.");
      return;
    }
    setResultadoSalirTodas(body as ResumenSalirTodas);
    setPasoSalirTodas("resultado");
    setSeleccionadas(new Set());
    void cargarTodoAutomatico(true);
  }

  // ---------- «Reglas adicionales» (texto libre, solo con «tabla-maestra») ----------
  // Interpretar (IA, una vez) → «Entendí esto / No entendí» → confirmar →
  // recién ahí se guarda. Sin confirmar no se guarda nada.
  const [textosGuardados, setTextosGuardados] = useState<Record<string, string>>(() => Object.fromEntries(reglasAdicionalesIniciales.map((r) => [r.cuentaId, r.texto])));
  const [textoReglas, setTextoReglas] = useState("");
  const [interpretacion, setInterpretacion] = useState<{ entendido: string[]; noEntendido: string[]; json: unknown; textoInterpretado: string } | null>(null);
  const [interpretando, setInterpretando] = useState(false);
  const [guardandoReglas, setGuardandoReglas] = useState(false);
  const [errorReglasTexto, setErrorReglasTexto] = useState<string | null>(null);
  const [faltaIA, setFaltaIA] = useState(false);

  // Texto guardado de lo que se está mirando: el de la cuenta, o —con «todas
  // las tiendas»— el común si todas guardaron el mismo.
  function textoGuardadoActual(): string {
    if (cuentaSeleccionada !== "todas") return textosGuardados[cuentaSeleccionada] ?? "";
    const distintos = new Set(cuentas.map((c) => textosGuardados[c.id] ?? ""));
    return distintos.size === 1 ? [...distintos][0] : "";
  }
  const textoGuardado = textoGuardadoActual();

  useEffect(() => {
    setTextoReglas(textoGuardadoActual());
    setInterpretacion(null);
    setErrorReglasTexto(null);
    setFaltaIA(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- solo al cambiar de cuenta
  }, [cuentaSeleccionada]);

  async function interpretarReglas() {
    setInterpretando(true);
    setErrorReglasTexto(null);
    setFaltaIA(false);
    setInterpretacion(null);
    try {
      const res = await fetch("/api/ml/promociones/reglas-adicionales/interpretar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ texto: textoReglas }),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string; codigo?: string; entendido?: string[]; noEntendido?: string[]; json?: unknown };
      if (!res.ok) {
        if (body.codigo === "sin_ia") setFaltaIA(true);
        else setErrorReglasTexto(body.error ?? "No se pudo interpretar el texto.");
      } else {
        setInterpretacion({ entendido: body.entendido ?? [], noEntendido: body.noEntendido ?? [], json: body.json, textoInterpretado: textoReglas });
      }
    } catch {
      setErrorReglasTexto("No se pudo conectar con el servidor — revisar la conexión e intentar de nuevo.");
    }
    setInterpretando(false);
  }

  async function guardarReglasAdicionales(borrar: boolean) {
    if (!borrar && !interpretacion) return;
    setGuardandoReglas(true);
    setErrorReglasTexto(null);
    try {
      const res = await fetch("/api/ml/promociones/reglas-adicionales", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cuentaId: cuentaSeleccionada, texto: borrar ? "" : interpretacion!.textoInterpretado, json: borrar ? undefined : interpretacion!.json, confirmado: true }),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setErrorReglasTexto(body.error ?? "No se pudieron guardar las reglas adicionales.");
      } else {
        const nuevo = borrar ? "" : interpretacion!.textoInterpretado.trim();
        const destino = cuentaSeleccionada === "todas" ? cuentas.map((c) => c.id) : [cuentaSeleccionada];
        setTextosGuardados((actual) => ({ ...actual, ...Object.fromEntries(destino.map((id) => [id, nuevo])) }));
        setTextoReglas(nuevo);
        setInterpretacion(null);
        mostrarToast(borrar ? "Se quitaron las reglas adicionales." : "Reglas adicionales guardadas.", "exito");
      }
    } catch {
      setErrorReglasTexto("No se pudo conectar con el servidor — revisar la conexión e intentar de nuevo.");
    }
    setGuardandoReglas(false);
  }

  const nombreCuentaSeleccionada = cuentaSeleccionada === "todas" ? "todas las cuentas" : cuentaPorId.get(cuentaSeleccionada)?.nickname ?? "esta cuenta";

  return (
    <>
      <Toast items={toasts} onCerrar={(id) => setToasts((actual) => actual.filter((t) => t.id !== id))} />

      <div className={styles.pestanas} role="tablist">
        <Boton
          type="button"
          role="tab"
          aria-selected={pestana === "publicaciones"}
          variante={pestana === "publicaciones" ? "primario" : "secundario"}
          onClick={() => setPestana("publicaciones")}
        >
          Publicaciones
        </Boton>
        <Boton
          type="button"
          role="tab"
          aria-selected={pestana === "bitacora"}
          variante={pestana === "bitacora" ? "primario" : "secundario"}
          onClick={() => {
            setBitacoraAbierta(true);
            setPestana("bitacora");
          }}
        >
          Auditar
        </Boton>
      </div>

      {bitacoraAbierta && (
        <div hidden={pestana !== "bitacora"}>
          <BitacoraPromociones cuentas={cuentas} />
        </div>
      )}

      <div hidden={pestana !== "publicaciones"}>
      <Tarjeta className={styles.seccion}>
        <Campo etiqueta="Tienda">
          <select className="zx-control" value={cuentaSeleccionada} onChange={(e) => setCuentaSeleccionada(e.target.value)}>
            <option value="todas">Todas las tiendas</option>
            {cuentas.map((c) => (
              <option key={c.id} value={c.id}>
                {c.nickname}
              </option>
            ))}
          </select>
        </Campo>

        <div className={styles.filtrosFila}>
          <div className={styles.buscador}>
            <Campo etiqueta="Buscar por título o SKU">
              <input type="text" className="zx-control" value={buscarTexto} onChange={(e) => setBuscarTexto(e.target.value)} placeholder="Ej. camisa azul, SKU-123" />
            </Campo>
          </div>
        </div>

        <div className={styles.chipsFiltro}>
          {(Object.keys(ETIQUETA_FILTRO) as FiltroPublicaciones[]).map((f) => (
            <Boton key={f} type="button" variante={filtro === f ? "primario" : "secundario"} onClick={() => setFiltro(f)}>
              {ETIQUETA_FILTRO[f]} ({conteos[f === "todas" ? "todas" : f === "en-promocion" ? "enPromocion" : f === "sin-promocion" ? "sinPromocion" : "conError"]})
            </Boton>
          ))}
        </div>
        <p style={{ fontSize: 11.5, color: "var(--texto-suave)", marginTop: 6 }}>Los contadores son de las publicaciones ya revisadas en esta pantalla, no del catálogo completo.</p>

        <BarraCarga
          estado={cargandoAuto ? "cargando" : cierreCarga === "completa" ? "completa" : cursor ? "detenida" : "inactiva"}
          titulo={`Cargando publicaciones… ${formatearNumero(conteos.todas, "es")} revisadas`}
          avance={totalEstimado !== null && totalEstimado > 0 ? { hechos: conteos.todas, total: totalEstimado } : null}
          unidad="revisadas"
          ariaLabel="Progreso de la carga de publicaciones"
          accion={{
            texto: "Detener carga",
            onClick: () => {
              detenerRef.current = true;
            },
          }}
          textoDetenida={
            topeAlcanzado
              ? `Se llegó al tope de ${formatearNumero(TOPE_CARGA_AUTOMATICA, "es")} publicaciones revisadas por carga. ${formatearNumero(conteos.todas, "es")} revisadas hasta ahora.`
              : `Carga detenida · ${formatearNumero(conteos.todas, "es")} revisadas.`
          }
          alSeguir={() => void cargarTodoAutomatico(false)}
          textoInactiva={`Listo — ${formatearNumero(conteos.todas, "es")} publicaciones revisadas.`}
        />
      </Tarjeta>

      <Tarjeta className={styles.seccion}>
        <p className="zx-etiqueta">Reglas de participación</p>
        {resumenMaestraSku.total === 0 ? (
          <div className={`${styles.bannerMaestra} ${styles.bannerMaestraFalta}`}>
            <span>El módulo de SKU todavía no tiene ninguna tabla maestra de precios mínimos cargada — sin esto, la regla «Respetar la tabla maestra» no puede participar en ninguna publicación («Participar en todas» y «máximo» no la necesitan).</span>
            <BotonLink href="/panel/finanzas/maestra-sku/importar" variante="primario">
              Subir un archivo
            </BotonLink>
          </div>
        ) : (
          <div className={styles.bannerMaestra}>
            <span>
              Tabla maestra tomada del módulo SKU: {formatearNumero(resumenMaestraSku.total, "es")} SKU
              {resumenMaestraSku.actualizadoTs ? `, actualizada el ${formatoFecha(resumenMaestraSku.actualizadoTs)}` : ""}.
            </span>
            <span style={{ display: "flex", gap: 8 }}>
              <a href="/panel/finanzas/maestra-sku" className="zx-link">
                Ver en SKU
              </a>
              <a href="/panel/finanzas/maestra-sku/importar" className="zx-link">
                Subir un archivo nuevo
              </a>
            </span>
          </div>
        )}

        <div className={styles.reglas}>
          <label className={styles.filaRegla}>
            <input type="radio" name="regla" checked={regla === "todas"} onChange={() => setRegla("todas")} />
            Participar en todas las promociones disponibles
          </label>
          <label className={styles.filaRegla}>
            <input type="radio" name="regla" checked={regla === "maximo"} onChange={() => setRegla("maximo")} />
            Participar solo hasta un máximo de
            <input
              type="number"
              className="zx-control"
              style={{ width: 70 }}
              min={1}
              max={100}
              value={maximoPctInput}
              disabled={regla !== "maximo"}
              onChange={(e) => setMaximoPctInput(Number(e.target.value))}
            />
            % de descuento a cargo del vendedor
          </label>
          <label className={styles.filaRegla}>
            <input type="radio" name="regla" checked={regla === "tabla-maestra"} onChange={() => setRegla("tabla-maestra")} />
            Respetar siempre la tabla maestra de SKU con precios mínimos
          </label>
          {regla === "tabla-maestra" && (
            <div className={styles.reglasAdicionales}>
              <Campo etiqueta="Reglas adicionales">
                <textarea
                  className={`zx-control ${styles.textareaReglas}`}
                  value={textoReglas}
                  maxLength={LARGO_MAXIMO_REGLAS_TEXTO}
                  disabled={!puedeAprobar}
                  onChange={(e) => {
                    setTextoReglas(e.target.value);
                    setInterpretacion(null);
                  }}
                  placeholder="Ej. no entrar en Black Friday; máximo 20% en el SKU X; no entrar en promociones compartidas"
                />
              </Campo>
              <span className={styles.contadorReglas}>
                {formatearNumero(textoReglas.length, "es")} / {formatearNumero(LARGO_MAXIMO_REGLAS_TEXTO, "es")} caracteres. Solo aplican a «Respetar siempre la tabla maestra»; el precio mínimo de Finanzas siempre manda.
              </span>
              {textoGuardado && <span className={styles.contadorReglas}>Guardadas para {nombreCuentaSeleccionada}: «{textoGuardado}»</span>}
              {puedeAprobar && (
                <div className={styles.accionesInterpretacion}>
                  <Boton type="button" variante="primario" disabled={interpretando || textoReglas.trim() === ""} onClick={() => void interpretarReglas()}>
                    {interpretando ? "Interpretando…" : "Interpretar"}
                  </Boton>
                  {textoGuardado && (
                    <Boton type="button" variante="fantasma" disabled={guardandoReglas} onClick={() => void guardarReglasAdicionales(true)}>
                      Quitar reglas adicionales
                    </Boton>
                  )}
                </div>
              )}
              {faltaIA && (
                <p className={styles.errorModal}>
                  <a href="/panel/conectar-ia" className="zx-link">
                    Conecta tu IA en Administración → Conectar IA
                  </a>{" "}
                  para interpretar reglas.
                </p>
              )}
              {errorReglasTexto && <p className={styles.errorModal}>{errorReglasTexto}</p>}
              {interpretacion && (
                <div className={styles.interpretacion}>
                  {interpretacion.entendido.length > 0 ? (
                    <>
                      <strong>Entendí esto:</strong>
                      <ul>
                        {interpretacion.entendido.map((linea, i) => (
                          <li key={i}>{linea}</li>
                        ))}
                      </ul>
                    </>
                  ) : (
                    <strong>No entendí ninguna regla de ese texto.</strong>
                  )}
                  {interpretacion.noEntendido.length > 0 && (
                    <>
                      <strong className={styles.noEntendidoLista}>No entendí:</strong>
                      <ul className={styles.noEntendidoLista}>
                        {interpretacion.noEntendido.map((linea, i) => (
                          <li key={i}>{linea}</li>
                        ))}
                      </ul>
                    </>
                  )}
                  <div className={styles.accionesInterpretacion}>
                    <Boton type="button" variante="primario" disabled={guardandoReglas || interpretacion.entendido.length === 0} onClick={() => void guardarReglasAdicionales(false)}>
                      {guardandoReglas ? "Guardando…" : "Confirmar y guardar"}
                    </Boton>
                    <Boton type="button" variante="secundario" disabled={guardandoReglas} onClick={() => setInterpretacion(null)}>
                      Descartar
                    </Boton>
                  </div>
                </div>
              )}
            </div>
          )}
          <label className={styles.filaRegla}>
            <input type="radio" name="regla" checked={regla === "salir-todas"} onChange={() => setRegla("salir-todas")} />
            Dejar de participar en todas las promociones
          </label>
        </div>
        <p style={{ fontSize: 11.5, color: "var(--texto-suave)", marginTop: 4 }}>
          &quot;Participar en todas&quot; entra en todas las promociones disponibles SIN precio mínimo — puede dejar productos vendiéndose bajo su costo. Solo &quot;Respetar siempre la tabla
          maestra&quot; aplica el precio mínimo de Finanzas (&quot;máximo&quot; solo aplica su tope de porcentaje a cargo del vendedor, sin precio mínimo). &quot;Dejar de participar en todas&quot; quita las publicaciones
          activas de sus promociones, con confirmación previa.
        </p>

        {puedeEjecutar && (
          <div className={styles.accionesRegla}>
            <Boton
              type="button"
              variante="primario"
              onClick={regla === "salir-todas" ? () => void abrirSalirTodas() : abrirAplicarRegla}
              disabled={cantidadSeleccionada === 0 || (resumenMaestraSku.total === 0 && regla === "tabla-maestra") || (regla === "maximo" && !maximoPctValido)}
            >
              {regla === "salir-todas" ? "Revisar y dejar de participar…" : "Aplicar regla a las publicaciones"}
            </Boton>
            <span style={{ fontSize: 12, color: "var(--texto-suave)" }}>
              Se aplica a {formatearNumero(cantidadSeleccionada, "es")} publicaciones seleccionadas
              {cantidadSeleccionada === 0 ? " — marca las publicaciones de la lista para poder aplicar" : ""}.
            </span>
          </div>
        )}
      </Tarjeta>

      {filas.length > 0 && (
        <div className={styles.controlSeleccion}>
          <label className={styles.filaCheck}>
            <input type="checkbox" checked={todasMarcadas} onChange={alternarTodas} />
            Seleccionar todas ({formatearNumero(Math.min(filas.length, TOPE_ITEMS_SELECCION), "es")} cargadas en esta vista)
          </label>
          <span className={styles.notaSeleccion}>
            {formatearNumero(cantidadSeleccionada, "es")} seleccionadas
            {cursor ? " · todavía hay más publicaciones sin cargar: «Seleccionar todas» solo marca las que ya están en la lista" : ""}
            {filas.length > TOPE_ITEMS_SELECCION ? ` · máximo ${formatearNumero(TOPE_ITEMS_SELECCION, "es")} por vez` : ""}
          </span>
        </div>
      )}

      <div className={styles.listaPublicaciones}>
        {filas.length === 0 ? (
          <p style={{ fontSize: 13, color: "var(--texto-suave)" }}>{cargandoAuto ? "Cargando…" : "No hay publicaciones que coincidan con este filtro o búsqueda."}</p>
        ) : (
          filas.map((fila) => {
            const expandida = expandidaId === fila.itemId;
            // «pending» = programada en ML, todavía no empieza: no se muestra como aplicada.
            const hayAplicada = fila.promociones.some((p) => p.estadoMl === "started");
            const chipEstado: { texto: string; estado: EstadoChip } =
              fila.estado === "en_promocion"
                ? hayAplicada
                  ? { texto: "En promoción aplicada", estado: "exito" }
                  : { texto: "Promoción programada", estado: "aviso" }
                : fila.estado === "error"
                  ? { texto: "Error", estado: "peligro" }
                  : { texto: "Sin promoción", estado: "neutro" };
            const idioma = idiomaDeCuenta(fila.cuentaMlId);
            return (
              <Tarjeta key={`${fila.cuentaMlId}-${fila.itemId}`} className={styles.tarjetaPublicacion}>
                <div className={styles.filaConCheck}>
                <input
                  type="checkbox"
                  className={styles.checkFila}
                  checked={seleccionadas.has(claveSeleccion(fila.cuentaMlId, fila.itemId))}
                  disabled={!seleccionadas.has(claveSeleccion(fila.cuentaMlId, fila.itemId)) && seleccionadas.size >= TOPE_ITEMS_SELECCION}
                  onChange={() => alternarSeleccion(fila)}
                  aria-label={`Seleccionar ${fila.tituloProducto ?? fila.itemId}`}
                />
                <button type="button" className={styles.filaResumen} onClick={() => setExpandidaId(expandida ? null : fila.itemId)} aria-expanded={expandida}>
                  {fila.thumbnail ? <img src={fila.thumbnail} alt="" className={styles.foto} width={44} height={44} /> : <FotoPlaceholder />}
                  <div className={styles.infoPublicacion}>
                    <span className={styles.titulo}>{fila.tituloProducto ?? fila.itemId}</span>
                    <span className={styles.subtitulo}>
                      {fila.nicknameCuenta}
                      {fila.skuCodigo ? <SkuCopiable sku={fila.skuCodigo} comoSpan prefijo=" · SKU " /> : ""}
                      {fila.precioOriginal != null ? ` · ${formatearMoneda(fila.precioOriginal, fila.siteId)}` : ""}
                      {fila.stock != null ? ` · Stock ${formatearNumero(fila.stock, idioma)}` : ""}
                    </span>
                  </div>
                  <Chip estado={chipEstado.estado} title={fila.motivoError ?? undefined}>
                    {chipEstado.texto}
                  </Chip>
                  <span className={styles.chevron} data-abierto={expandida}>
                    ⌄
                  </span>
                </button>
                </div>

                {fila.estado === "error" && fila.motivoError && <p className={styles.avisoError}>{fila.motivoError}</p>}

                {expandida && (
                  <div className={styles.detalle}>
                    {fila.tieneVariantes && (
                      <p className={styles.sinPromociones}>Esta publicación tiene variantes — el ajuste automático de precio no está disponible, se revisa desde Mercado Libre.</p>
                    )}
                    {fila.promociones.length === 0 ? (
                      <p className={styles.sinPromociones}>No hay ninguna promoción disponible para esta publicación en este momento.</p>
                    ) : (
                      fila.promociones.map((promocion) => {
                        const activa = promocion.estadoMl === "started" || promocion.estadoMl === "pending";
                        const precioOriginal = promocion.precioOriginal ?? fila.precioOriginal;
                        const descuentoPct = precioOriginal != null && promocion.precioActual != null ? calcularDesdePrecioFinal(precioOriginal, promocion.precioActual).descuentoVendedorPct : null;
                        const superaMaximoRegla = regla === "maximo" && !activa && superaMaximoConfigurado(precioOriginal, promocion.precioSugerido, maximoPct);
                        return (
                          <div key={`${promocion.tipoPromocion}-${promocion.promotionIdMl ?? "sin-id"}`} className={styles.filaPromocion}>
                            <div className={styles.encabezadoPromocion}>
                              {puedeEjecutar && (
                                <input
                                  type="checkbox"
                                  aria-label={`${accionDePromocion(promocion) === "salir" ? "Salir de" : "Participar en"} ${tituloPromocion(promocion)}`}
                                  checked={marcasPromo[claveSeleccion(fila.cuentaMlId, fila.itemId)]?.has(claveMarcaPromocion(promocion)) ?? false}
                                  disabled={motivoNoMarcable(promocion) != null || motivoSinPrecioParaParticipar(promocion) != null || aplicandoFila != null}
                                  onChange={() => alternarMarcaPromo(fila, promocion)}
                                />
                              )}
                              <span className={styles.nombrePromocion}>{tituloPromocion(promocion)}</span>
                              <span style={{ fontSize: 11, color: "var(--texto-suave)", fontWeight: 400 }}>
                                {promocion.nombreMl ? `${nombrePromocion(promocion.tipoPromocion)} (${promocion.tipoPromocion})` : `(${promocion.tipoPromocion})`}
                              </span>
                              {rangoFechasPromocion(promocion.fechaInicioMl, promocion.fechaFinMl, idioma) && (
                                <span style={{ fontSize: 11, color: "var(--texto-suave)", fontWeight: 400 }}>{rangoFechasPromocion(promocion.fechaInicioMl, promocion.fechaFinMl, idioma)}</span>
                              )}
                              <Chip estado={estadoPromocionEs(promocion.estadoMl).estado}>{estadoPromocionEs(promocion.estadoMl).texto}</Chip>
                              {promocion.esCompartida && <Chip estado="neutro">Compartida con Mercado Libre (+Meli)</Chip>}
                              {superaMaximoRegla && <Chip estado="aviso">Supera el máximo configurado</Chip>}
                              {regla === "tabla-maestra" && promocion.reglaAdicionalMotivo && <Chip estado="aviso">{promocion.reglaAdicionalMotivo}</Chip>}
                            </div>
                            <div className={styles.datosPromocion}>
                              {activa ? (
                                <>
                                  <span>Precio actual: {promocion.precioActual != null ? formatearMoneda(promocion.precioActual, fila.siteId) : "—"}</span>
                                  {descuentoPct != null && <span>Descuento actual: {formatearNumero(Math.round(descuentoPct * 10) / 10, idioma)}%</span>}
                                </>
                              ) : (
                                <>
                                  <span>Precio sugerido: {promocion.precioSugerido != null ? formatearMoneda(promocion.precioSugerido, fila.siteId) : "A elegir al participar"}</span>
                                  {promocion.precioMinimo != null && <span>Precio mínimo (Finanzas): {formatearMoneda(promocion.precioMinimo, fila.siteId)}</span>}
                                </>
                              )}
                              <span>Precio original: {precioOriginal != null ? formatearMoneda(precioOriginal, fila.siteId) : "—"}</span>
                              {!activa && promocion.precioSugerido != null && precioOriginal != null && (
                                <span>Descuento sugerido: {formatearNumero(Math.round(calcularDesdePrecioFinal(precioOriginal, promocion.precioSugerido).descuentoVendedorPct * 10) / 10, idioma)}%</span>
                              )}
                              <span>Quién paga: {promocion.esCompartida ? "Compartida con Mercado Libre" : "Vendedor"}</span>
                              {!activa && quedaBajoPrecioMinimo(promocion) && <span style={{ color: "var(--kpi-peligro-texto)" }}>El precio sugerido queda por debajo del mínimo (Finanzas).</span>}
                              {puedeEjecutar && motivoNoMarcable(promocion) != null && <span style={{ color: "var(--texto-suave)" }}>{motivoNoMarcable(promocion)}</span>}
                              {resultadosPromo[`${claveSeleccion(fila.cuentaMlId, fila.itemId)}|${claveMarcaPromocion(promocion)}`] && (
                                <span role="status" style={{ color: resultadosPromo[`${claveSeleccion(fila.cuentaMlId, fila.itemId)}|${claveMarcaPromocion(promocion)}`].ok ? "var(--kpi-exito-texto, inherit)" : "var(--kpi-peligro-texto)" }}>
                                  {resultadosPromo[`${claveSeleccion(fila.cuentaMlId, fila.itemId)}|${claveMarcaPromocion(promocion)}`].texto}
                                </span>
                              )}
                              {!promocion.cumpleReglas && promocion.motivoRevisarManual && !(puedeEjecutar && motivoNoMarcable(promocion) === promocion.motivoRevisarManual) && <span style={{ color: "var(--kpi-peligro-texto)" }}>{promocion.motivoRevisarManual}</span>}
                            </div>
                            <div className={styles.accionesPromocion}>
                              {activa ? (
                                puedeEjecutar &&
                                (promocion.puedeSalirApi ? (
                                  <Boton type="button" variante="peligro" onClick={() => abrirConfirmarSalir(fila, promocion)}>
                                    Dejar de participar
                                  </Boton>
                                ) : (
                                  <span style={{ fontSize: 11.5, color: "var(--texto-suave)" }}>Solo se puede dejar desde Mercado Libre.</span>
                                ))
                              ) : (
                                puedeEjecutar && (
                                  <Boton type="button" variante="primario" disabled={!promocion.cumpleReglas} onClick={() => abrirModalParticipar(fila, promocion)}>
                                    Participar
                                  </Boton>
                                )
                              )}
                            </div>
                          </div>
                        );
                      })
                    )}
                    {puedeEjecutar && fila.promociones.length > 0 && (
                      <div className={styles.accionesPromocion}>
                        <Boton
                          type="button"
                          variante="primario"
                          disabled={aplicandoFila != null || planAplicarPromociones(fila.promociones, marcasPromo[claveSeleccion(fila.cuentaMlId, fila.itemId)] ?? new Set()).length === 0}
                          onClick={() => void aplicarAEsteProducto(fila)}
                        >
                          {aplicandoFila === claveSeleccion(fila.cuentaMlId, fila.itemId) ? "Aplicando…" : "Aplicar a este producto"}
                        </Boton>
                      </div>
                    )}
                  </div>
                )}
              </Tarjeta>
            );
          })
        )}
      </div>

      {/* Modal "Participar" */}
      <dialog
        ref={dialogParticiparRef}
        className={styles.dialogo}
        onClose={() => {
          bloquearScroll(false);
          setSeleccion(null);
        }}
        onClick={(e) => e.target === e.currentTarget && cerrarModalParticipar()}
      >
        {seleccion && calculoModal && (
          <Tarjeta className={styles.panelModal}>
            <p className={styles.tituloModal}>Confirma los detalles de la promoción</p>
            <p className={styles.resumenProducto}>
              {seleccion.fila.tituloProducto ?? seleccion.fila.itemId}
              {seleccion.fila.skuCodigo ? <SkuCopiable sku={seleccion.fila.skuCodigo} prefijo=" — SKU " /> : ""}
            </p>
            <p className={styles.filaDato}>
              <span>Promoción</span>
              <span>{tituloPromocion(seleccion.promocion)}</span>
            </p>
            <p className={styles.filaDato}>
              <span>Estado</span>
              <span>
                {estadoPromocionEs(seleccion.promocion.estadoMl).texto}
                {rangoFechasPromocion(seleccion.promocion.fechaInicioMl, seleccion.promocion.fechaFinMl, idiomaDeCuenta(seleccion.fila.cuentaMlId)) ? ` · ${rangoFechasPromocion(seleccion.promocion.fechaInicioMl, seleccion.promocion.fechaFinMl, idiomaDeCuenta(seleccion.fila.cuentaMlId))}` : ""}
              </span>
            </p>
            <p className={styles.filaDato}>
              <span>Precio original</span>
              <span>{formatearMoneda(calculoModal.precioOriginal, seleccion.fila.siteId)}</span>
            </p>

            <div className={styles.bloqueAjuste}>
              <div className={styles.tipoAjuste}>
                <label>
                  <input type="radio" name="tipoAjuste" checked={tipoAjuste === "porcentaje"} onChange={() => setTipoAjuste("porcentaje")} />
                  Porcentaje
                </label>
                <label>
                  <input type="radio" name="tipoAjuste" checked={tipoAjuste === "valor"} onChange={() => setTipoAjuste("valor")} />
                  Precio final
                </label>
              </div>
              <div className={styles.filaValor}>
                <input type="text" inputMode="decimal" className="zx-control" style={{ width: 140 }} value={valorTexto} onChange={(e) => setValorTexto(e.target.value)} />
                <span className={styles.unidad}>{tipoAjuste === "porcentaje" ? "% a cargo del vendedor" : simboloMoneda(seleccion.fila.siteId)}</span>
              </div>
            </div>

            <p className={styles.filaDato}>
              <span>Descuento a cargo del vendedor</span>
              <span>{formatearNumero(Math.round(calculoModal.descuentoVendedorPct * 10) / 10, idiomaDeCuenta(seleccion.fila.cuentaMlId))}%</span>
            </p>
            {seleccion.promocion.esCompartida && <p className={styles.avisoCompartida}>Promoción compartida con Mercado Libre (+Meli) — el aporte exacto de Mercado Libre no lo confirma esta API.</p>}
            {seleccion.promocion.tipoPromocion === "PRICE_DISCOUNT" && (
              <p className={styles.avisoCompartida}>Descuento de precio exige entre 5% y 80% de descuento, con una vigencia máxima de 14 días.</p>
            )}
            <p className={styles.filaDatoFinal}>
              <span>Precio final</span>
              <span>{formatearMoneda(calculoModal.precioFinal, seleccion.fila.siteId)}</span>
            </p>
            {calculoModal.quedaBajoMinimo && (
              <p className={styles.avisoMinimo}>Este precio queda bajo el precio mínimo de Finanzas ({formatearMoneda(seleccion.promocion.precioMinimo as number, seleccion.fila.siteId)}).</p>
            )}
            {errorParticipar && <p className={styles.errorModal}>{errorParticipar}</p>}

            <div className={styles.accionesModal}>
              <Boton type="button" variante="primario" disabled={enviandoParticipar || calculoModal.quedaBajoMinimo || calculoModal.precioFinal <= 0} onClick={confirmarParticipar}>
                {enviandoParticipar ? "Enviando…" : "Confirmar"}
              </Boton>
              <Boton type="button" variante="secundario" onClick={cerrarModalParticipar}>
                Cancelar
              </Boton>
            </div>
          </Tarjeta>
        )}
      </dialog>

      {/* Confirmación "Dejar de participar" */}
      <dialog
        ref={dialogSalirRef}
        className={styles.dialogo}
        onClose={() => {
          bloquearScroll(false);
          setConfirmandoSalir(null);
        }}
        onClick={(e) => e.target === e.currentTarget && cerrarConfirmarSalir()}
      >
        {confirmandoSalir && (
          <Tarjeta className={styles.panelModal}>
            <p className={styles.tituloModal}>Dejar de participar</p>
            <p style={{ fontSize: 13.5 }}>
              Se dejará de participar en &quot;{tituloPromocion(confirmandoSalir.promocion)}&quot; para &quot;{confirmandoSalir.fila.tituloProducto ?? confirmandoSalir.fila.itemId}
              &quot;. Esto se manda de una vez a Mercado Libre y no se puede deshacer desde esta pantalla. ¿Confirmas?
            </p>
            {errorSalir && <p className={styles.errorModal}>{errorSalir}</p>}
            <div className={styles.accionesModal}>
              <Boton type="button" variante="primario" disabled={enviandoSalir} onClick={confirmarSalir}>
                {enviandoSalir ? "Enviando…" : "Confirmar"}
              </Boton>
              <Boton type="button" variante="secundario" onClick={cerrarConfirmarSalir}>
                Cancelar
              </Boton>
            </div>
          </Tarjeta>
        )}
      </dialog>

      {/* "Aplicar regla a las publicaciones" */}
      <dialog ref={dialogReglaRef} className={styles.dialogo} onClose={() => bloquearScroll(false)} onClick={(e) => e.target === e.currentTarget && cerrarDialogoRegla()}>
        <Tarjeta className={styles.panelModal}>
          {pasoRegla === "confirmar" ? (
            <>
              <p className={styles.tituloModal}>Aplicar regla a las publicaciones</p>
              <div className={styles.resumenAplicar}>
                <p>
                  Se revisarán las <strong>{formatearNumero(cantidadSeleccionada, "es")}</strong> publicaciones seleccionadas y se participará de una vez en las que cumplan la regla elegida (
                  {regla === "todas" ? "todas las promociones disponibles" : regla === "maximo" ? `máximo ${maximoPct}% de descuento a cargo del vendedor` : "la tabla maestra de SKU"}
                  ), sin un paso de confirmación por producto.
                </p>
                <p>
                  {regla === "todas"
                    ? "Sin precio mínimo: se entra a todas aunque quede bajo el costo."
                    : regla === "maximo"
                      ? "Solo manda el tope de porcentaje: no se usa el precio mínimo de Finanzas, así que puede quedar bajo el costo."
                      : "El precio mínimo de Finanzas nunca se salta."}
                </p>
                {regla === "tabla-maestra" && textoGuardado && <p>Se aplicarán también tus reglas adicionales guardadas: «{textoGuardado}».</p>}
              </div>
              {errorRegla && <p className={styles.errorModal}>{errorRegla}</p>}
              <div className={styles.accionesModal}>
                <Boton type="button" variante="primario" disabled={aplicandoRegla} onClick={confirmarAplicarRegla}>
                  {aplicandoRegla ? "Aplicando…" : "Aplicar"}
                </Boton>
                <Boton type="button" variante="secundario" onClick={cerrarDialogoRegla}>
                  Cancelar
                </Boton>
              </div>
            </>
          ) : (
            <>
              <p className={styles.tituloModal}>Resultado</p>
              {resultadoRegla && (
                <div className={styles.resumenAplicar}>
                  <p>
                    Revisadas: {resultadoRegla.revisadas} · Participaron: {resultadoRegla.participadas} · Fallaron: {resultadoRegla.fallidas} · Omitidas: {resultadoRegla.omitidas}
                  </p>
                  {resultadoRegla.filas.length > 0 && (
                    <div className={styles.tablaResumen}>
                      {resultadoRegla.filas.map((f, i) => (
                        <p key={`${f.itemId}-${i}`} style={{ fontSize: 12.5, color: f.estado === "ejecutada" ? "var(--kpi-exito-texto)" : "var(--kpi-peligro-texto)" }}>
                          {f.tituloProducto ?? f.itemId} — {f.estado}
                          {f.error ? `: ${f.error}` : ""}
                        </p>
                      ))}
                    </div>
                  )}
                </div>
              )}
              <div className={styles.accionesModal}>
                <Boton type="button" variante="primario" onClick={cerrarDialogoRegla}>
                  Cerrar
                </Boton>
              </div>
            </>
          )}
        </Tarjeta>
      </dialog>

      {/* «Dejar de participar en todas las promociones» */}
      <dialog ref={dialogSalirTodasRef} className={styles.dialogo} onClose={() => bloquearScroll(false)} onClick={(e) => e.target === e.currentTarget && pasoSalirTodas !== "ejecutando" && cerrarSalirTodas()}>
        <Tarjeta className={styles.panelModal}>
          {pasoSalirTodas === "resultado" && resultadoSalirTodas ? (
            <>
              <p className={styles.tituloModal}>Resultado</p>
              <div className={styles.resumenAplicar}>
                <p>
                  {formatearNumero(resultadoSalirTodas.salieron, "es")} salieron · {formatearNumero(resultadoSalirTodas.errores, "es")} con error · {formatearNumero(resultadoSalirTodas.noPermitidas, "es")} no se pueden
                  por API
                </p>
                {resultadoSalirTodas.filas.length > 0 && (
                  <div className={styles.tablaResumen}>
                    {resultadoSalirTodas.filas.map((f, i) => (
                      <p key={`${f.itemId}-${f.tipoPromocion}-${i}`} style={{ fontSize: 12.5, color: f.estado === "salio" ? "var(--kpi-exito-texto)" : f.estado === "error" ? "var(--kpi-peligro-texto)" : "var(--texto-suave)" }}>
                        {f.itemId} · {f.tituloProducto ?? "—"} · {nombrePromocion(f.tipoPromocion)} —{" "}
                        {f.estado === "salio" ? "Salió" : f.estado === "error" ? `Error: ${f.error ?? "sin detalle"}` : "No se puede por API, hay que hacerlo en la Central de Promociones de Mercado Libre"}
                      </p>
                    ))}
                  </div>
                )}
              </div>
              <div className={styles.accionesModal}>
                <Boton type="button" variante="primario" onClick={cerrarSalirTodas}>
                  Cerrar
                </Boton>
              </div>
            </>
          ) : (
            <>
              <p className={styles.tituloModal}>Dejar de participar en todas las promociones</p>
              {pasoSalirTodas === "cargando" && !errorSalirTodas && <p style={{ fontSize: 13.5 }}>Revisando las {formatearNumero(cantidadSeleccionada, "es")} publicaciones seleccionadas… (no se cambia nada todavía)</p>}
              {vistaPreviaSalir && (pasoSalirTodas === "confirmar" || pasoSalirTodas === "ejecutando") && (
                <div className={styles.resumenAplicar}>
                  <p>
                    Saldrán <strong>{formatearNumero(vistaPreviaSalir.publicaciones, "es")}</strong> publicaciones de <strong>{formatearNumero(vistaPreviaSalir.promociones, "es")}</strong> promociones en total (entre las {formatearNumero(cantidadSeleccionada, "es")} seleccionadas).
                  </p>
                  {vistaPreviaSalir.noPermitidas > 0 && (
                    <p>
                      De esas, {formatearNumero(vistaPreviaSalir.noPermitidas, "es")} no se pueden dejar por la API de Mercado Libre y se reportarán aparte (hay que hacerlo en la Central de Promociones).
                    </p>
                  )}
                  {vistaPreviaSalir.lecturasConError > 0 && <p>{formatearNumero(vistaPreviaSalir.lecturasConError, "es")} publicaciones no se pudieron leer y no están en este conteo.</p>}
                  <p>Esto quita las publicaciones seleccionadas de sus promociones activas. No se puede deshacer desde Seller.</p>
                </div>
              )}
              {errorSalirTodas && <p className={styles.errorModal}>{errorSalirTodas}</p>}
              <div className={styles.accionesModal}>
                {vistaPreviaSalir && (pasoSalirTodas === "confirmar" || pasoSalirTodas === "ejecutando") && (
                  <Boton
                    type="button"
                    variante="primario"
                    style={{ background: "var(--kpi-peligro-texto)", borderColor: "var(--kpi-peligro-texto)", color: "#fff" }}
                    disabled={pasoSalirTodas === "ejecutando" || vistaPreviaSalir.promociones === 0}
                    onClick={() => void confirmarSalirTodas()}
                  >
                    {pasoSalirTodas === "ejecutando" ? "Saliendo…" : "Sí, dejar de participar"}
                  </Boton>
                )}
                <Boton type="button" variante="secundario" disabled={pasoSalirTodas === "ejecutando"} onClick={cerrarSalirTodas}>
                  Cancelar
                </Boton>
              </div>
            </>
          )}
        </Tarjeta>
      </dialog>
      </div>
    </>
  );
}
