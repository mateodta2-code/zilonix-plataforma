"use client";

import { useCallback, useEffect, useState } from "react";
import { Boton } from "@/components/marco/Boton";
import { Campo } from "@/components/marco/Campo";
import { Chip } from "@/components/marco/Chip";
import { Tarjeta } from "@/components/marco/Tarjeta";
import { Tabla, FilaTabla, CeldaTabla } from "@/components/marco/Tabla";
import { datosSitioMl, formatearMoneda, SITE_ID_DEFECTO } from "@/lib/ml/sitios";
import type { AccionHistorialCliente, TandaBitacoraCliente } from "./tipos-cliente";
import styles from "./promociones.module.css";

type CuentaBitacora = { id: string; nickname: string; siteId: string };

type DetalleBitacora = AccionHistorialCliente["detalle"];

const ETIQUETA_LIMITE: Record<string, string> = { piso: "Piso de Finanzas", tope: "Tope %", ml: "Límite de Mercado Libre", ninguno: "Ninguno" };

export function etiquetaRegla(d: DetalleBitacora): string {
  if (!d.regla) return "—";
  if (d.regla === "todas") return "Participar en todas";
  if (d.regla === "maximo") return d.maximoPct != null ? `Máximo ${d.maximoPct} %` : "Máximo";
  if (d.regla === "tabla-maestra") return "Tabla maestra";
  if (d.regla === "salir") return "Dejar de participar";
  return "Manual";
}

export function etiquetaAccionFila(h: Pick<AccionHistorialCliente, "accion" | "estado" | "detalle">): string {
  if (h.estado === "fallida") return "Error";
  if (h.estado === "rechazada") return h.detalle.regla === "salir" ? "No se puede por API" : "Omitida";
  if (h.accion === "participar") return "Participó";
  if (h.accion === "modificar") return "Modificó";
  return "Dejó de participar";
}

function precio(valor: string | null, siteId: string): string {
  if (valor == null || valor === "" || Number.isNaN(Number(valor))) return "—";
  return formatearMoneda(Number(valor), siteId);
}

// Auditar solo trae lo que hay que revisar: los conteos suman el total
// (las «ejecutadas» que llegan son únicamente las que quedaron bajo el piso).
function resumenTanda(t: TandaBitacoraCliente): string {
  const partes: string[] = [];
  if (t.conError) partes.push(`${t.conError} con error`);
  if (t.omitidas) partes.push(`${t.omitidas} omitidas`);
  if (t.noApi) partes.push(`${t.noApi} no se pueden por API`);
  if (t.bajoPiso) partes.push(`${t.bajoPiso} por debajo del piso`);
  if (t.pendientes) partes.push(`${t.pendientes} sin aplicar`);
  return `${t.total} por revisar${partes.length ? `: ${partes.join(", ")}` : ""}`;
}

function motivoBajoPiso(b: NonNullable<AccionHistorialCliente["bajoPiso"]>, siteId: string): string {
  return `Quedó por debajo del piso actual (piso ${formatearMoneda(b.piso, siteId)}, precio ${formatearMoneda(b.precio, siteId)}, diferencia ${formatearMoneda(b.diferencia, siteId)})`;
}

// «Auditar» (antes «Bitácora»; Promo-B / Promo-E): solo lo que hay que revisar
// a mano — no aplicadas, fallidas, omitidas y las que quedaron por debajo del
// piso. Agrupada por tanda (una ejecución = un lote); al desplegar una tanda
// salen sus filas, una por producto y promoción. Las simuladas se marcan aparte.
export function BitacoraPromociones({ cuentas }: { cuentas: CuentaBitacora[] }) {
  const [tandas, setTandas] = useState<TandaBitacoraCliente[]>([]);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pagina, setPagina] = useState(1);
  const [hayMas, setHayMas] = useState(false);
  const [cuentaId, setCuentaId] = useState("todas");
  const [accion, setAccion] = useState("todas");
  const [resultado, setResultado] = useState("todos");
  const [desde, setDesde] = useState("");
  const [hasta, setHasta] = useState("");

  const paramsFiltro = useCallback(() => {
    const params = new URLSearchParams();
    if (cuentaId !== "todas") params.set("cuentaId", cuentaId);
    if (accion !== "todas") params.set("accion", accion);
    if (resultado !== "todos") params.set("resultado", resultado);
    if (desde) params.set("desde", desde);
    if (hasta) params.set("hasta", hasta);
    return params;
  }, [cuentaId, accion, resultado, desde, hasta]);

  const cargar = useCallback(async () => {
    setCargando(true);
    setError(null);
    const params = paramsFiltro();
    params.set("vista", "auditar");
    params.set("pagina", String(pagina));
    const res = await fetch(`/api/ml/promociones/historial?${params.toString()}`);
    if (res.ok) {
      const cuerpo = await res.json();
      setTandas(cuerpo.tandas ?? []);
      setHayMas(Boolean(cuerpo.hayMas));
    } else {
      setError("No se pudo cargar la auditoría.");
    }
    setCargando(false);
  }, [pagina, paramsFiltro]);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  // Cambiar un filtro siempre vuelve a la primera página.
  function filtro<T>(setter: (v: T) => void) {
    return (valor: T) => {
      setter(valor);
      setPagina(1);
    };
  }

  return (
    <Tarjeta className={styles.seccion}>
      <p className="zx-etiqueta">AUDITAR</p>
      <div className={styles.filtrosBitacora}>
        <Campo etiqueta="Tienda">
          <select className="zx-control" aria-label="Tienda" value={cuentaId} onChange={(e) => filtro(setCuentaId)(e.target.value)}>
            <option value="todas">Todas las tiendas</option>
            {cuentas.map((c) => (
              <option key={c.id} value={c.id}>
                {c.nickname}
              </option>
            ))}
          </select>
        </Campo>
        <Campo etiqueta="Acción">
          <select className="zx-control" aria-label="Acción" value={accion} onChange={(e) => filtro(setAccion)(e.target.value)}>
            <option value="todas">Todas</option>
            <option value="participar">Participó</option>
            <option value="salir">Dejó de participar</option>
            <option value="modificar">Modificó</option>
          </select>
        </Campo>
        <Campo etiqueta="Resultado">
          <select className="zx-control" aria-label="Resultado" value={resultado} onChange={(e) => filtro(setResultado)(e.target.value)}>
            <option value="todos">Todos</option>
            <option value="no-aplicada">No aplicada</option>
            <option value="error">Error</option>
            <option value="bajo-piso">Por debajo del piso</option>
          </select>
        </Campo>
        <Campo etiqueta="Desde">
          <input className="zx-control" type="date" aria-label="Desde" value={desde} onChange={(e) => filtro(setDesde)(e.target.value)} />
        </Campo>
        <Campo etiqueta="Hasta">
          <input className="zx-control" type="date" aria-label="Hasta" value={hasta} onChange={(e) => filtro(setHasta)(e.target.value)} />
        </Campo>
      </div>

      {error && <p style={{ fontSize: 13, color: "var(--text-faint)", marginTop: 10 }}>{error}</p>}
      {!error && !cargando && tandas.length === 0 ? (
        <p style={{ fontSize: 13, color: "var(--text-faint)", marginTop: 10 }}>No hay nada que auditar con estos filtros: todo lo registrado se aplicó bien.</p>
      ) : (
        <div style={{ marginTop: 10 }}>
          {tandas.map((t) => (
            <TandaFilas key={t.clave} tanda={t} cuentas={cuentas} paramsFiltro={paramsFiltro} />
          ))}
          <div className={styles.paginacionBitacora}>
            <Boton type="button" variante="secundario" disabled={pagina <= 1 || cargando} onClick={() => setPagina((p) => p - 1)}>
              Anterior
            </Boton>
            <span style={{ fontSize: 13 }}>Página {pagina}</span>
            <Boton type="button" variante="secundario" disabled={!hayMas || cargando} onClick={() => setPagina((p) => p + 1)}>
              Siguiente
            </Boton>
          </div>
        </div>
      )}
    </Tarjeta>
  );
}

function TandaFilas({ tanda, cuentas, paramsFiltro }: { tanda: TandaBitacoraCliente; cuentas: CuentaBitacora[]; paramsFiltro: () => URLSearchParams }) {
  const [abierta, setAbierta] = useState(false);
  const [filas, setFilas] = useState<AccionHistorialCliente[]>([]);
  const [paginaFilas, setPaginaFilas] = useState(0);
  const [hayMas, setHayMas] = useState(false);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const siteIdDe = (cuentaMlId: string) => cuentas.find((c) => c.id === cuentaMlId)?.siteId ?? SITE_ID_DEFECTO;
  const idioma = datosSitioMl(siteIdDe(tanda.cuentaMlId)).idioma;

  async function cargarFilas(pagina: number) {
    setCargando(true);
    setError(null);
    const params = paramsFiltro();
    params.set("vista", "auditar");
    params.set("lote", tanda.clave);
    params.set("pagina", String(pagina));
    const res = await fetch(`/api/ml/promociones/historial?${params.toString()}`);
    if (res.ok) {
      const cuerpo = await res.json();
      setFilas((prev) => (pagina === 1 ? cuerpo.filas : [...prev, ...cuerpo.filas]));
      setPaginaFilas(pagina);
      setHayMas(Boolean(cuerpo.hayMas));
    } else {
      setError("No se pudieron cargar las filas de esta tanda.");
    }
    setCargando(false);
  }

  function alternar() {
    const siguiente = !abierta;
    setAbierta(siguiente);
    if (siguiente && paginaFilas === 0) void cargarFilas(1);
  }

  return (
    <div className={tanda.simulada ? styles.filaSimulada : undefined} style={{ marginBottom: 8 }}>
      <button type="button" aria-expanded={abierta} onClick={alternar} style={{ width: "100%", textAlign: "left", background: "none", border: "none", color: "inherit", cursor: "pointer", padding: "8px 0" }}>
        <strong>{new Date(tanda.fecha).toLocaleString(idioma, { timeZone: "America/Bogota" })}</strong> · {tanda.usuarioNombre ?? "—"} · {tanda.nicknameCuenta} ·{" "}
        {etiquetaRegla({ ...VACIO_DETALLE, regla: (tanda.regla as DetalleBitacora["regla"]) ?? null })}
        {tanda.simulada && (
          <>
            {" "}
            <Chip estado="aviso">Simulado</Chip>
          </>
        )}
        <br />
        <small>{resumenTanda(tanda)}</small>
      </button>
      {abierta && (
        <div>
          {error && <p style={{ fontSize: 13, color: "var(--text-faint)" }}>{error}</p>}
          <Tabla encabezados={["Fecha", "Quién", "Tienda", "Acción", "Promoción", "Producto", "Regla", "Límite", "Precio antes", "Precio quedó", "Resultado"]}>
            {filas.map((h) => {
              const siteId = siteIdDe(h.cuentaMlId);
              const mensaje = h.error ?? h.detalle.motivo ?? h.detalle.respuesta;
              const bajoPiso = h.bajoPiso ?? null;
              const ok = h.estado === "ejecutada" && !bajoPiso;
              const mensajeFila = bajoPiso ? motivoBajoPiso(bajoPiso, siteId) : mensaje;
              return (
                <FilaTabla key={h.id} className={h.modoSimulacion ? styles.filaSimulada : undefined}>
                  <CeldaTabla>{new Date(h.ejecutadoTs ?? h.creadoTs).toLocaleString(datosSitioMl(siteId).idioma, { timeZone: "America/Bogota" })}</CeldaTabla>
                  <CeldaTabla>{h.ejecutadoPorNombre ?? "—"}</CeldaTabla>
                  <CeldaTabla>{h.nicknameCuenta}</CeldaTabla>
                  <CeldaTabla>{etiquetaAccionFila(h)}</CeldaTabla>
                  <CeldaTabla>
                    {h.detalle.nombrePromocion ?? h.promotionIdMl ?? "—"}
                    {h.tipoPromocion ? <small> · {h.tipoPromocion}</small> : null}
                  </CeldaTabla>
                  <CeldaTabla>
                    {h.tituloProducto ?? h.itemId}
                    <br />
                    <small>
                      {h.itemId}
                      {h.detalle.sku ? ` · ${h.detalle.sku}` : ""}
                    </small>
                  </CeldaTabla>
                  <CeldaTabla>{etiquetaRegla(h.detalle)}</CeldaTabla>
                  <CeldaTabla>{h.detalle.limite ? ETIQUETA_LIMITE[h.detalle.limite] : "—"}</CeldaTabla>
                  <CeldaTabla>{precio(h.precioAntes, siteId)}</CeldaTabla>
                  <CeldaTabla>{precio(h.precioDespues, siteId)}</CeldaTabla>
                  <CeldaTabla>
                    <Chip estado={ok ? "exito" : h.estado === "fallida" ? "peligro" : "aviso"} title={mensajeFila ?? undefined}>
                      {ok ? "OK" : bajoPiso ? "Por debajo del piso" : h.estado === "fallida" ? "Error" : h.estado === "rechazada" || h.estado === "pendiente" || h.estado === "aceptada" ? "No aplicada" : h.estado}
                    </Chip>
                    {!ok && mensajeFila && <small> {mensajeFila}</small>}
                  </CeldaTabla>
                </FilaTabla>
              );
            })}
          </Tabla>
          {hayMas && (
            <Boton type="button" variante="secundario" disabled={cargando} onClick={() => void cargarFilas(paginaFilas + 1)}>
              Ver más filas
            </Boton>
          )}
        </div>
      )}
    </div>
  );
}

const VACIO_DETALLE: DetalleBitacora = { regla: null, origen: null, ok: null, status: null, respuesta: null, lote: null, maximoPct: null, limite: null, sku: null, nombrePromocion: null, motivo: null };
