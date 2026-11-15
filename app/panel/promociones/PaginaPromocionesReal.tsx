"use client";

import { useEffect, useRef, useState } from "react";
import { Boton, BotonLink } from "@/components/marco/Boton";
import { Campo } from "@/components/marco/Campo";
import { Chip, type EstadoChip } from "@/components/marco/Chip";
import { Tarjeta } from "@/components/marco/Tarjeta";
import { Toast, type ItemToast } from "@/components/marco/Toast";
import { datosSitioMl, formatearMoneda, formatearNumero, SITE_ID_DEFECTO } from "@/lib/ml/sitios";
import type { ConteosPublicaciones, FiltroPublicaciones, PromocionParaUi, PublicacionConEstado, ResumenAplicarRegla } from "@/lib/ml/promocionesPublicaciones";
import { calcularDesdePorcentaje, calcularDesdePrecioFinal, formatoEnteroInput, parsearNumeroLocal, superaMaximoConfigurado } from "./calculosPublicaciones";
import styles from "./promocionesReal.module.css";

type Cuenta = { id: string; nickname: string; siteId: string };
type ReglaUi = "todas" | "maximo" | "tabla-maestra";
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
  PRICE_DISCOUNT: "Descuento de precio",
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

function sumarConteos(a: ConteosPublicaciones, b: ConteosPublicaciones): ConteosPublicaciones {
  return { todas: a.todas + b.todas, enPromocion: a.enPromocion + b.enPromocion, sinPromocion: a.sinPromocion + b.sinPromocion, conError: a.conError + b.conError };
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
  resumenMaestraSku,
}: {
  cuentas: Cuenta[];
  puedeEjecutar: boolean;
  resumenMaestraSku: { total: number; actualizadoTs: string | null };
}) {
  const cuentaPorId = new Map(cuentas.map((c) => [c.id, c]));
  function idiomaDeCuenta(cuentaMlId: string): string {
    return datosSitioMl(cuentaPorId.get(cuentaMlId)?.siteId ?? SITE_ID_DEFECTO).idioma;
  }

  const [cuentaSeleccionada, setCuentaSeleccionada] = useState<string>("todas");
  const [filtro, setFiltro] = useState<FiltroPublicaciones>("todas");
  const [buscarTexto, setBuscarTexto] = useState("");
  const [buscarAplicado, setBuscarAplicado] = useState("");

  const [filas, setFilas] = useState<PublicacionConEstado[]>([]);
  const [conteos, setConteos] = useState<ConteosPublicaciones>({ todas: 0, enPromocion: 0, sinPromocion: 0, conError: 0 });
  const [cursor, setCursor] = useState<string | null>(null);
  const [cargandoAuto, setCargandoAuto] = useState(false);
  const [topeAlcanzado, setTopeAlcanzado] = useState(false);
  const [expandidaId, setExpandidaId] = useState<string | null>(null);

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

  async function pedirPagina(cursorParaUsar: string | null): Promise<{ filas: PublicacionConEstado[]; conteosLote: ConteosPublicaciones; cursorSiguiente: string | null } | null> {
    const params = new URLSearchParams({ filtro, buscar: buscarAplicado });
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
  async function cargarTodoAutomatico(reiniciar: boolean) {
    const miId = ++idCargaRef.current;
    detenerRef.current = false;
    if (reiniciar) {
      setFilas([]);
      setConteos({ todas: 0, enPromocion: 0, sinPromocion: 0, conError: 0 });
      setCursor(null);
      setExpandidaId(null);
    }
    setTopeAlcanzado(false);
    setCargandoAuto(true);

    let cursorActual: string | null = reiniciar ? null : cursor;
    let totalRevisado = reiniciar ? 0 : conteos.todas;

    while (true) {
      const resultado = await pedirPagina(cursorActual);
      if (idCargaRef.current !== miId) return; // esta carga ya no es la vigente
      if (!resultado) break;

      setFilas((actual) => [...actual, ...resultado.filas]);
      setConteos((actual) => sumarConteos(actual, resultado.conteosLote));
      totalRevisado += resultado.conteosLote.todas;
      cursorActual = resultado.cursorSiguiente;
      setCursor(cursorActual);

      if (!cursorActual || detenerRef.current) break;
      if (totalRevisado >= TOPE_CARGA_AUTOMATICA) {
        setTopeAlcanzado(true);
        break;
      }
      await esperar(PAUSA_ENTRE_PAGINAS_MS);
    }
    if (idCargaRef.current === miId) setCargandoAuto(false);
  }

  useEffect(() => {
    void cargarTodoAutomatico(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- cargarTodoAutomatico se recrea cada render; solo importa reaccionar a estos 3 (cancela la carga vieja por idCargaRef)
  }, [cuentaSeleccionada, filtro, buscarAplicado]);

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

  // ---------- Reglas (lote) ----------
  const [regla, setRegla] = useState<ReglaUi>("todas");
  const [maximoPct, setMaximoPct] = useState(15);
  const dialogReglaRef = useRef<HTMLDialogElement>(null);
  const [pasoRegla, setPasoRegla] = useState<"confirmar" | "resultado">("confirmar");
  const [aplicandoRegla, setAplicandoRegla] = useState(false);
  const [resultadoRegla, setResultadoRegla] = useState<ResumenAplicarRegla | null>(null);
  const [errorRegla, setErrorRegla] = useState<string | null>(null);

  function abrirAplicarRegla() {
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
        body: JSON.stringify({ cuentaId: cuentaSeleccionada, regla, maximoPct: regla === "maximo" ? maximoPct : undefined }),
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
    void cargarTodoAutomatico(true);
  }

  const nombreCuentaSeleccionada = cuentaSeleccionada === "todas" ? "todas las cuentas" : cuentaPorId.get(cuentaSeleccionada)?.nickname ?? "esta cuenta";

  return (
    <>
      <Toast items={toasts} onCerrar={(id) => setToasts((actual) => actual.filter((t) => t.id !== id))} />

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
            <Boton key={f} type="button" variante={filtro === f ? "primario" : "secundario"} chico onClick={() => setFiltro(f)}>
              {ETIQUETA_FILTRO[f]} ({conteos[f === "todas" ? "todas" : f === "en-promocion" ? "enPromocion" : f === "sin-promocion" ? "sinPromocion" : "conError"]})
            </Boton>
          ))}
        </div>
        <p style={{ fontSize: 11.5, color: "var(--texto-suave)", marginTop: 6 }}>Los contadores son de las publicaciones ya revisadas en esta pantalla, no del catálogo completo.</p>

        <div className={styles.progresoCarga}>
          {cargandoAuto ? (
            <>
              <span>Cargando publicaciones… {formatearNumero(conteos.todas, "es")} revisadas hasta ahora.</span>
              <Boton
                type="button"
                variante="secundario"
                chico
                onClick={() => {
                  detenerRef.current = true;
                }}
              >
                Detener carga
              </Boton>
            </>
          ) : cursor ? (
            <>
              <span>
                {topeAlcanzado ? `Se llegó al tope de ${formatearNumero(TOPE_CARGA_AUTOMATICA, "es")} publicaciones revisadas por carga.` : "La carga se detuvo."}{" "}
                {formatearNumero(conteos.todas, "es")} revisadas hasta ahora.
              </span>
              <Boton type="button" variante="secundario" chico onClick={() => void cargarTodoAutomatico(false)}>
                Seguir cargando
              </Boton>
            </>
          ) : (
            <span>Listo — {formatearNumero(conteos.todas, "es")} publicaciones revisadas.</span>
          )}
        </div>
      </Tarjeta>

      <Tarjeta className={styles.seccion}>
        <p className="zx-etiqueta">Reglas de participación</p>
        {resumenMaestraSku.total === 0 ? (
          <div className={`${styles.bannerMaestra} ${styles.bannerMaestraFalta}`}>
            <span>El módulo de SKU todavía no tiene ninguna tabla maestra de precios mínimos cargada — sin esto, ninguna publicación puede participar.</span>
            <BotonLink href="/panel/finanzas/maestra-sku/importar" variante="secundario" chico>
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
              value={maximoPct}
              disabled={regla !== "maximo"}
              onChange={(e) => setMaximoPct(Number(e.target.value))}
            />
            % de descuento a cargo del vendedor
          </label>
          <label className={styles.filaRegla}>
            <input type="radio" name="regla" checked={regla === "tabla-maestra"} onChange={() => setRegla("tabla-maestra")} />
            Respetar siempre la tabla maestra de SKU con precios mínimos
          </label>
        </div>
        <p style={{ fontSize: 11.5, color: "var(--texto-suave)", marginTop: 4 }}>
          El precio mínimo de la tabla maestra nunca se puede saltar, sin importar la regla elegida — &quot;Respetar siempre la tabla maestra&quot; es el mismo comportamiento que
          &quot;Participar en todas&quot;, sin un tope de porcentaje adicional.
        </p>

        {puedeEjecutar && (
          <div className={styles.accionesRegla}>
            <Boton type="button" variante="primario" chico onClick={abrirAplicarRegla} disabled={resumenMaestraSku.total === 0}>
              Aplicar regla a las publicaciones
            </Boton>
            <span style={{ fontSize: 12, color: "var(--texto-suave)" }}>Se aplica sobre {nombreCuentaSeleccionada}.</span>
          </div>
        )}
      </Tarjeta>

      <div className={styles.listaPublicaciones}>
        {filas.length === 0 ? (
          <p style={{ fontSize: 13, color: "var(--texto-suave)" }}>{cargandoAuto ? "Cargando…" : "No hay publicaciones que coincidan con este filtro o búsqueda."}</p>
        ) : (
          filas.map((fila) => {
            const expandida = expandidaId === fila.itemId;
            const chipEstado: { texto: string; estado: EstadoChip } =
              fila.estado === "en_promocion"
                ? { texto: "En promoción aplicada", estado: "exito" }
                : fila.estado === "error"
                  ? { texto: "Error", estado: "peligro" }
                  : { texto: "Sin promoción", estado: "neutro" };
            const idioma = idiomaDeCuenta(fila.cuentaMlId);
            return (
              <Tarjeta key={`${fila.cuentaMlId}-${fila.itemId}`} className={styles.tarjetaPublicacion}>
                <button type="button" className={styles.filaResumen} onClick={() => setExpandidaId(expandida ? null : fila.itemId)} aria-expanded={expandida}>
                  {fila.thumbnail ? <img src={fila.thumbnail} alt="" className={styles.foto} width={44} height={44} /> : <FotoPlaceholder />}
                  <div className={styles.infoPublicacion}>
                    <span className={styles.titulo}>{fila.tituloProducto ?? fila.itemId}</span>
                    <span className={styles.subtitulo}>
                      {fila.nicknameCuenta}
                      {fila.skuCodigo ? ` · SKU ${fila.skuCodigo}` : ""}
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
                              <span className={styles.nombrePromocion}>{nombrePromocion(promocion.tipoPromocion)}</span>
                              <span style={{ fontSize: 11, color: "var(--texto-suave)", fontWeight: 400 }}>({promocion.tipoPromocion})</span>
                              {promocion.esCompartida && <Chip estado="neutro">Compartida con Mercado Libre (+Meli)</Chip>}
                              {superaMaximoRegla && <Chip estado="aviso">Supera el máximo configurado</Chip>}
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
                              {!promocion.cumpleReglas && promocion.motivoRevisarManual && <span style={{ color: "var(--kpi-peligro-texto)" }}>{promocion.motivoRevisarManual}</span>}
                            </div>
                            <div className={styles.accionesPromocion}>
                              {activa ? (
                                puedeEjecutar &&
                                (promocion.puedeSalirApi ? (
                                  <Boton type="button" variante="secundario" chico onClick={() => abrirConfirmarSalir(fila, promocion)}>
                                    Dejar de participar
                                  </Boton>
                                ) : (
                                  <span style={{ fontSize: 11.5, color: "var(--texto-suave)" }}>Solo se puede dejar desde Mercado Libre.</span>
                                ))
                              ) : (
                                puedeEjecutar && (
                                  <Boton type="button" variante="primario" chico disabled={!promocion.cumpleReglas} onClick={() => abrirModalParticipar(fila, promocion)}>
                                    Participar
                                  </Boton>
                                )
                              )}
                            </div>
                          </div>
                        );
                      })
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
              {seleccion.fila.skuCodigo ? ` — SKU ${seleccion.fila.skuCodigo}` : ""}
            </p>
            <p className={styles.filaDato}>
              <span>Promoción</span>
              <span>{nombrePromocion(seleccion.promocion.tipoPromocion)}</span>
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
              <Boton type="button" variante="primario" chico disabled={enviandoParticipar || calculoModal.quedaBajoMinimo || calculoModal.precioFinal <= 0} onClick={confirmarParticipar}>
                {enviandoParticipar ? "Enviando…" : "Confirmar"}
              </Boton>
              <Boton type="button" variante="secundario" chico onClick={cerrarModalParticipar}>
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
              Se dejará de participar en &quot;{nombrePromocion(confirmandoSalir.promocion.tipoPromocion)}&quot; para &quot;{confirmandoSalir.fila.tituloProducto ?? confirmandoSalir.fila.itemId}
              &quot;. Esto se manda de una vez a Mercado Libre y no se puede deshacer desde esta pantalla. ¿Confirmas?
            </p>
            {errorSalir && <p className={styles.errorModal}>{errorSalir}</p>}
            <div className={styles.accionesModal}>
              <Boton type="button" variante="primario" chico disabled={enviandoSalir} onClick={confirmarSalir}>
                {enviandoSalir ? "Enviando…" : "Confirmar"}
              </Boton>
              <Boton type="button" variante="secundario" chico onClick={cerrarConfirmarSalir}>
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
                  Se revisarán las publicaciones activas de <strong>{nombreCuentaSeleccionada}</strong> y se participará de una vez en las que cumplan la regla elegida (
                  {regla === "todas" ? "todas las promociones disponibles" : regla === "maximo" ? `máximo ${maximoPct}% de descuento a cargo del vendedor` : "la tabla maestra de SKU"}
                  ), sin un paso de confirmación por producto.
                </p>
                <p>El precio mínimo de Finanzas nunca se salta, sin importar la regla.</p>
              </div>
              {errorRegla && <p className={styles.errorModal}>{errorRegla}</p>}
              <div className={styles.accionesModal}>
                <Boton type="button" variante="primario" chico disabled={aplicandoRegla} onClick={confirmarAplicarRegla}>
                  {aplicandoRegla ? "Aplicando…" : "Aplicar"}
                </Boton>
                <Boton type="button" variante="secundario" chico onClick={cerrarDialogoRegla}>
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
                <Boton type="button" variante="primario" chico onClick={cerrarDialogoRegla}>
                  Cerrar
                </Boton>
              </div>
            </>
          )}
        </Tarjeta>
      </dialog>
    </>
  );
}
