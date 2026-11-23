"use client";

import { useCallback, useEffect, useState } from "react";
import { Boton } from "@/components/marco/Boton";
import { Campo } from "@/components/marco/Campo";
import { Chip } from "@/components/marco/Chip";
import { Tarjeta } from "@/components/marco/Tarjeta";
import { Tabla, FilaTabla, CeldaTabla } from "@/components/marco/Tabla";
import { datosSitioMl, formatearMoneda, SITE_ID_DEFECTO } from "@/lib/ml/sitios";
import type { AccionHistorialCliente } from "./tipos-cliente";
import styles from "./promociones.module.css";

type CuentaBitacora = { id: string; nickname: string; siteId: string };

const ETIQUETA_ACCION: Record<AccionHistorialCliente["accion"], string> = { participar: "Entró", modificar: "Modificó", salir: "Salió" };
const ETIQUETA_REGLA: Record<string, string> = { todas: "Todas", maximo: "Máximo", "tabla-maestra": "Tabla maestra", salir: "Salir", manual: "Manual" };

function precio(valor: string | null, siteId: string): string {
  if (valor == null || valor === "" || Number.isNaN(Number(valor))) return "—";
  return formatearMoneda(Number(valor), siteId);
}

// Bitácora de cambios aplicados (Promo-B). Lee GET .../historial; cada
// fila de promociones_acciones es una entrada. Las simuladas se marcan
// aparte para no confundirlas con cambios reales en Mercado Libre.
export function BitacoraPromociones({ cuentas }: { cuentas: CuentaBitacora[] }) {
  const [filas, setFilas] = useState<AccionHistorialCliente[]>([]);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pagina, setPagina] = useState(1);
  const [hayMas, setHayMas] = useState(false);
  const [cuentaId, setCuentaId] = useState("todas");
  const [accion, setAccion] = useState("todas");
  const [resultado, setResultado] = useState("todos");
  const [desde, setDesde] = useState("");
  const [hasta, setHasta] = useState("");

  const cargar = useCallback(async () => {
    setCargando(true);
    setError(null);
    const params = new URLSearchParams({ pagina: String(pagina) });
    if (cuentaId !== "todas") params.set("cuentaId", cuentaId);
    if (accion !== "todas") params.set("accion", accion);
    if (resultado !== "todos") params.set("resultado", resultado);
    if (desde) params.set("desde", desde);
    if (hasta) params.set("hasta", hasta);
    const res = await fetch(`/api/ml/promociones/historial?${params.toString()}`);
    if (res.ok) {
      const cuerpo = await res.json();
      setFilas(cuerpo.filas);
      setHayMas(Boolean(cuerpo.hayMas));
    } else {
      setError("No se pudo cargar la bitácora.");
    }
    setCargando(false);
  }, [pagina, cuentaId, accion, resultado, desde, hasta]);

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

  const siteIdDe = (cuentaMlId: string) => cuentas.find((c) => c.id === cuentaMlId)?.siteId ?? SITE_ID_DEFECTO;

  return (
    <Tarjeta className={styles.seccion}>
      <p className="zx-etiqueta">BITÁCORA</p>
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
            <option value="participar">Entró</option>
            <option value="salir">Salió</option>
            <option value="modificar">Modificó</option>
          </select>
        </Campo>
        <Campo etiqueta="Resultado">
          <select className="zx-control" aria-label="Resultado" value={resultado} onChange={(e) => filtro(setResultado)(e.target.value)}>
            <option value="todos">Todos</option>
            <option value="ok">OK</option>
            <option value="error">Error</option>
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
      {!error && !cargando && filas.length === 0 ? (
        <p style={{ fontSize: 13, color: "var(--text-faint)", marginTop: 10 }}>No hay acciones registradas con estos filtros.</p>
      ) : (
        <div style={{ marginTop: 10 }}>
          <Tabla encabezados={["Fecha", "Quién", "Tienda", "Publicación", "Promoción", "Regla", "Acción", "Precio original", "Precio en promoción", "Resultado"]}>
            {filas.map((h) => {
              const siteId = siteIdDe(h.cuentaMlId);
              const idioma = datosSitioMl(siteId).idioma;
              const ok = h.estado === "ejecutada";
              const mensaje = h.error ?? h.detalle.respuesta;
              return (
                <FilaTabla key={h.id} className={h.modoSimulacion ? styles.filaSimulada : undefined}>
                  <CeldaTabla>{new Date(h.ejecutadoTs ?? h.creadoTs).toLocaleString(idioma, { timeZone: "America/Bogota" })}</CeldaTabla>
                  <CeldaTabla>{h.ejecutadoPorNombre ?? "—"}</CeldaTabla>
                  <CeldaTabla>{h.nicknameCuenta}</CeldaTabla>
                  <CeldaTabla>
                    {h.tituloProducto ?? h.itemId}
                    <br />
                    <small>{h.itemId}</small>
                  </CeldaTabla>
                  <CeldaTabla>
                    {h.tipoPromocion}
                    {h.promotionIdMl ? <small> · {h.promotionIdMl}</small> : null}
                  </CeldaTabla>
                  <CeldaTabla>{h.detalle.regla ? ETIQUETA_REGLA[h.detalle.regla] : "—"}</CeldaTabla>
                  <CeldaTabla>
                    {ETIQUETA_ACCION[h.accion]}
                    {h.modoSimulacion && (
                      <>
                        {" "}
                        <Chip estado="aviso">Simulado</Chip>
                      </>
                    )}
                  </CeldaTabla>
                  <CeldaTabla>{precio(h.precioAntes, siteId)}</CeldaTabla>
                  <CeldaTabla>{precio(h.precioDespues, siteId)}</CeldaTabla>
                  <CeldaTabla>
                    <Chip estado={ok ? "exito" : h.estado === "fallida" || h.estado === "rechazada" ? "peligro" : "aviso"} title={mensaje ?? undefined}>
                      {ok ? "OK" : h.estado === "fallida" ? "Error" : h.estado}
                    </Chip>
                    {!ok && h.error && <small> {h.error}</small>}
                  </CeldaTabla>
                </FilaTabla>
              );
            })}
          </Tabla>
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
