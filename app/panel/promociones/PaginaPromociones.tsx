"use client";

import { useEffect, useState } from "react";
import { Boton } from "@/components/marco/Boton";
import { Campo } from "@/components/marco/Campo";
import { Chip, type EstadoChip } from "@/components/marco/Chip";
import { Tarjeta } from "@/components/marco/Tarjeta";
import { Tabla, FilaTabla, CeldaTabla } from "@/components/marco/Tabla";
import type {
  AccionHistorialCliente,
  CandidatoClienteCliente,
  ReglasCuentaCliente,
  TrabajoBusquedaCliente,
} from "./tipos-cliente";
import styles from "./promociones.module.css";

type Cuenta = { id: string; nickname: string };
type Pestana = "buscar" | "historial" | "reglas";
type Filtro = "todas" | "cumplen" | "revisar" | "sin-minimo" | "solo-ml";

const ETIQUETA_FILTRO: Record<Filtro, string> = {
  todas: "Todas",
  cumplen: "Cumplen",
  revisar: "Revisar a mano",
  "sin-minimo": "Sin precio mínimo",
  "solo-ml": "Solo en ML",
};

const ETIQUETA_ESTADO_CUENTA: Record<string, string> = { en_cola: "En cola", buscando: "Buscando…", listo: "Listo", error: "Error" };

function numero(valor: string | null): number | null {
  if (valor == null) return null;
  const n = Number(valor);
  return Number.isFinite(n) ? n : null;
}

function formatoPesos(valor: string | null): string {
  const n = numero(valor);
  return n == null ? "—" : `$${n.toLocaleString("es-CO")}`;
}

// Rama feat-promociones, punto 3 — la pantalla completa. Mismo diseño
// de marca que /panel (Tarjeta, zx-control, Boton, Chip, Tabla) en los
// dos temas, sin paleta nueva.
export function PaginaPromociones({ cuentas, puedeAprobar, puedeEjecutar }: { cuentas: Cuenta[]; puedeAprobar: boolean; puedeEjecutar: boolean }) {
  const [pestana, setPestana] = useState<Pestana>("buscar");
  const [cuentaSeleccionada, setCuentaSeleccionada] = useState<string>("todas");
  const [filtro, setFiltro] = useState<Filtro>("todas");

  const [buscando, setBuscando] = useState(false);
  const [jobId, setJobId] = useState<string | null>(null);
  const [trabajo, setTrabajo] = useState<TrabajoBusquedaCliente | null>(null);
  const [errorBusqueda, setErrorBusqueda] = useState<string | null>(null);

  const [candidatos, setCandidatos] = useState<CandidatoClienteCliente[]>([]);
  const [cargandoCandidatos, setCargandoCandidatos] = useState(false);
  const [seleccionados, setSeleccionados] = useState<Record<string, boolean>>({});

  const [modoSimulacion, setModoSimulacion] = useState(false);
  const [vistaPrevia, setVistaPrevia] = useState<{ decisiones: { candidatoId: string; accion: "participar" | "modificar" | "salir" }[]; cantidad: number; cuentasAfectadas: string[]; gananciaTotal: number } | null>(null);
  const [aplicando, setAplicando] = useState(false);
  const [resultadoAplicar, setResultadoAplicar] = useState<string | null>(null);

  const [historial, setHistorial] = useState<AccionHistorialCliente[]>([]);
  const [reglas, setReglas] = useState<ReglasCuentaCliente[]>([]);

  // MED 7 — paso separado de ejecutar (/api/ml/promociones/acciones/ejecutar):
  // dispara TODAS las acciones "aceptada" pendientes de la empresa que no
  // estén en modo simulación.
  const [ejecutandoPendientes, setEjecutandoPendientes] = useState(false);
  const [resultadoEjecutarPendientes, setResultadoEjecutarPendientes] = useState<string | null>(null);

  async function cargarCandidatos() {
    setCargandoCandidatos(true);
    const params = new URLSearchParams({ filtro });
    if (cuentaSeleccionada !== "todas") params.set("cuentaId", cuentaSeleccionada);
    const res = await fetch(`/api/ml/promociones/candidatos?${params.toString()}`);
    if (res.ok) {
      const body = await res.json();
      setCandidatos(body.filas);
    }
    setCargandoCandidatos(false);
  }

  useEffect(() => {
    void cargarCandidatos();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- cargarCandidatos se recrea cada render; solo nos importa reaccionar a cuentaSeleccionada/filtro
  }, [cuentaSeleccionada, filtro]);

  async function buscar() {
    setBuscando(true);
    setErrorBusqueda(null);
    setTrabajo(null);
    const res = await fetch("/api/ml/promociones/buscar", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(cuentaSeleccionada === "todas" ? {} : { cuentaId: cuentaSeleccionada }),
    });
    const body = await res.json().catch(() => ({}));
    setBuscando(false);
    if (res.ok) setJobId(body.jobId);
    else setErrorBusqueda(body.error || "No se pudo buscar.");
  }

  useEffect(() => {
    if (!jobId) return;
    let activo = true;
    async function consultar() {
      const res = await fetch(`/api/ml/promociones/trabajo/${jobId}`);
      if (!activo || !res.ok) return;
      const body = await res.json();
      setTrabajo(body.trabajo);
      if (body.trabajo.terminadoTs != null) void cargarCandidatos();
    }
    void consultar();
    const id = setInterval(() => void consultar(), 2000);
    return () => {
      activo = false;
      clearInterval(id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- consultar se recrea cada render; solo nos importa reaccionar a jobId
  }, [jobId]);

  async function cargarHistorial() {
    const params = new URLSearchParams();
    if (cuentaSeleccionada !== "todas") params.set("cuentaId", cuentaSeleccionada);
    const res = await fetch(`/api/ml/promociones/historial?${params.toString()}`);
    if (res.ok) setHistorial((await res.json()).filas);
  }

  async function cargarReglas() {
    const res = await fetch("/api/ml/promociones/reglas");
    if (res.ok) setReglas((await res.json()).filas);
  }

  useEffect(() => {
    if (pestana === "historial") void cargarHistorial();
    if (pestana === "reglas") void cargarReglas();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- solo nos importa reaccionar al cambio de pestaña
  }, [pestana]);

  function chipEstado(candidato: CandidatoClienteCliente): { texto: string; estado: EstadoChip; title?: string } {
    if (candidato.soloEnMl) return { texto: "Solo en ML", estado: "neutro", title: candidato.motivoRevisarManual ?? undefined };
    if (candidato.cumpleReglas) return { texto: "Cumple", estado: "exito" };
    return { texto: "Revisar a mano", estado: "aviso", title: candidato.motivoRevisarManual ?? undefined };
  }

  function abrirVistaPrevia(decisiones: { candidatoId: string; accion: "participar" | "modificar" | "salir" }[]) {
    const porId = new Map(candidatos.map((c) => [c.id, c]));
    const cuentasAfectadas = [...new Set(decisiones.map((d) => porId.get(d.candidatoId)?.nicknameCuenta).filter((n): n is string => !!n))];
    const gananciaTotal = decisiones.reduce((acc, d) => {
      if (d.accion === "salir") return acc;
      return acc + (numero(porId.get(d.candidatoId)?.gananciaEstimada ?? null) ?? 0);
    }, 0);
    setVistaPrevia({ decisiones, cantidad: decisiones.length, cuentasAfectadas, gananciaTotal });
    setResultadoAplicar(null);
  }

  function aceptarLasQueCumplen() {
    const candidatosQueCumplen = candidatos.filter((c) => c.cumpleReglas);
    abrirVistaPrevia(
      candidatosQueCumplen.map((c) => ({ candidatoId: c.id, accion: (c.estadoMl === "candidate" ? "participar" : "modificar") as "participar" | "modificar" }))
    );
  }

  async function ejecutarPendientes() {
    setEjecutandoPendientes(true);
    setResultadoEjecutarPendientes(null);
    const res = await fetch("/api/ml/promociones/acciones/ejecutar", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({}) });
    const body = await res.json().catch(() => ({}));
    setEjecutandoPendientes(false);
    if (res.ok) {
      setResultadoEjecutarPendientes(`Se procesaron ${body.acciones.length} acción(es) pendiente(s).`);
      void cargarCandidatos();
      void cargarHistorial();
    } else {
      setResultadoEjecutarPendientes(body.error || "No se pudo ejecutar.");
    }
  }

  async function confirmarVistaPrevia() {
    if (!vistaPrevia) return;
    setAplicando(true);
    const res = await fetch("/api/ml/promociones/acciones", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ decisiones: vistaPrevia.decisiones, modoSimulacion }),
    });
    const body = await res.json().catch(() => ({}));
    setAplicando(false);
    if (res.ok) {
      setResultadoAplicar(
        modoSimulacion
          ? `Simulación: ${body.acciones.length} acción(es) calculadas, nada se envió a Mercado Libre.`
          : body.ejecutado
            ? `Listo: ${body.acciones.length} acción(es) procesadas.`
            : `Guardado como pendiente de aprobación/ejecución (${body.acciones.length} acción(es)) — todavía no se tocó Mercado Libre.`
      );
      setVistaPrevia(null);
      setSeleccionados({});
      void cargarCandidatos();
    } else {
      setResultadoAplicar(body.error || "No se pudo aplicar.");
    }
  }

  return (
    <>
      <div className={styles.pestanas}>
        {(["buscar", "historial", "reglas"] as Pestana[]).map((p) => (
          <Boton key={p} type="button" variante={pestana === p ? "primario" : "secundario"} chico onClick={() => setPestana(p)}>
            {p === "buscar" ? "Buscar / Resultados" : p === "historial" ? "Historial" : "Reglas"}
          </Boton>
        ))}
      </div>

      {pestana === "buscar" && (
        <Tarjeta className={styles.seccion}>
          <div className={styles.filaBuscar}>
            <Campo etiqueta="Cuenta">
              <select className="zx-control" value={cuentaSeleccionada} onChange={(e) => setCuentaSeleccionada(e.target.value)}>
                <option value="todas">Todas las cuentas</option>
                {cuentas.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.nickname}
                  </option>
                ))}
              </select>
            </Campo>
            <Boton type="button" variante="primario" chico disabled={buscando} onClick={buscar}>
              {buscando ? "Buscando…" : cuentaSeleccionada === "todas" ? "Buscar promociones en todas" : "Buscar promociones en esta cuenta"}
            </Boton>
          </div>
          {errorBusqueda && <p style={{ color: "var(--kpi-peligro-texto)", fontSize: 13, marginTop: 8 }}>{errorBusqueda}</p>}

          {trabajo && (
            <div className={styles.progreso}>
              {trabajo.cuentas.map((c) => (
                <Chip
                  key={c.cuentaId}
                  estado={c.estado === "error" ? "peligro" : c.catalogoIncompleto ? "aviso" : c.estado === "listo" ? "exito" : "aviso"}
                  title={c.error ?? (c.catalogoIncompleto ? "El catálogo de esta cuenta tiene más publicaciones de las que se pudieron leer en esta búsqueda — probá de nuevo más tarde." : undefined)}
                >
                  {c.nickname}: {ETIQUETA_ESTADO_CUENTA[c.estado]} {c.estado === "listo" ? `(${c.itemsConPromociones}/${c.productosRevisados})` : ""}
                  {c.catalogoIncompleto ? " ⚠ catálogo incompleto" : ""}
                </Chip>
              ))}
            </div>
          )}

          <div className={styles.filtros}>
            {(Object.keys(ETIQUETA_FILTRO) as Filtro[]).map((f) => (
              <Boton key={f} type="button" variante={filtro === f ? "primario" : "secundario"} chico onClick={() => setFiltro(f)}>
                {ETIQUETA_FILTRO[f]}
              </Boton>
            ))}
          </div>

          <div className={styles.accionesLote}>
            <Boton type="button" variante="primario" chico disabled={!candidatos.some((c) => c.cumpleReglas)} onClick={aceptarLasQueCumplen}>
              Aceptar todas las que cumplen
            </Boton>
            {/* MED 4 (review de Pablo) — apagado a propósito: "salir de
                la promo" (DELETE) todavía no se confirmó contra una
                cuenta real de Mercado Libre (lib/ml/cliente.ts,
                salirDePromocionMl) y la ruta la rechaza con 501. Se
                reactiva el día que se confirme en vivo. */}
            <Boton type="button" variante="secundario" chico disabled title="Todavía no confirmado contra Mercado Libre real — deshabilitado a propósito.">
              Salir de la promo
            </Boton>
            {puedeEjecutar && (
              <Boton type="button" variante="secundario" chico disabled={ejecutandoPendientes} onClick={ejecutarPendientes} title="Ejecuta contra Mercado Libre todas las acciones aceptadas y pendientes de esta empresa (fuera de modo simulación).">
                {ejecutandoPendientes ? "Ejecutando…" : "Ejecutar pendientes"}
              </Boton>
            )}
          </div>
          {resultadoEjecutarPendientes && <p style={{ fontSize: 13, marginTop: 8 }}>{resultadoEjecutarPendientes}</p>}

          {cargandoCandidatos ? (
            <p style={{ fontSize: 13, color: "var(--text-faint)", marginTop: 12 }}>Cargando…</p>
          ) : candidatos.length === 0 ? (
            <p style={{ fontSize: 13, color: "var(--text-faint)", marginTop: 12 }}>Todavía no hay resultados — dale &quot;Buscar&quot; arriba.</p>
          ) : (
            <div style={{ marginTop: 12 }}>
              <Tabla encabezados={["", "Cuenta", "Producto", "SKU", "Precio hoy", "Precio mínimo", "Promoción"]}>
                {candidatos.map((c) => {
                  const chip = chipEstado(c);
                  return (
                    <FilaTabla key={c.id}>
                      <CeldaTabla>
                        <input
                          type="checkbox"
                          checked={!!seleccionados[c.id]}
                          onChange={(e) => setSeleccionados((actual) => ({ ...actual, [c.id]: e.target.checked }))}
                        />
                      </CeldaTabla>
                      <CeldaTabla>{c.nicknameCuenta}</CeldaTabla>
                      <CeldaTabla>
                        {c.thumbnail && <img src={c.thumbnail} alt="" width={28} height={28} style={{ objectFit: "cover", borderRadius: 4, marginRight: 6, verticalAlign: "middle" }} />}
                        {c.tituloProducto ?? c.itemId}
                      </CeldaTabla>
                      <CeldaTabla>{c.skuCodigo ?? "—"}</CeldaTabla>
                      <CeldaTabla>{formatoPesos(c.precioActual)}</CeldaTabla>
                      <CeldaTabla>{c.precioMinimo ? formatoPesos(c.precioMinimo) : <span style={{ color: "var(--kpi-peligro-texto)" }}>Falta precio mínimo</span>}</CeldaTabla>
                      <CeldaTabla>
                        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                          <Chip estado={chip.estado} title={chip.title}>
                            {chip.texto}
                          </Chip>
                          <span style={{ fontSize: 11, color: "var(--text-faint)" }}>
                            {c.tipoPromocion} — sugerido {formatoPesos(c.precioSugerido)}
                            {c.gananciaEstimada ? ` · ganancia ${formatoPesos(c.gananciaEstimada)}` : ""}
                          </span>
                        </div>
                      </CeldaTabla>
                    </FilaTabla>
                  );
                })}
              </Tabla>
            </div>
          )}

          {vistaPrevia && (
            <Tarjeta className={styles.vistaPrevia}>
              <p className="zx-etiqueta">VISTA PREVIA</p>
              <p style={{ fontSize: 13, marginTop: 8 }}>
                {vistaPrevia.cantidad} producto(s), en {vistaPrevia.cuentasAfectadas.length} cuenta(s) ({vistaPrevia.cuentasAfectadas.join(", ")}) — ganancia total estimada{" "}
                <strong>${vistaPrevia.gananciaTotal.toLocaleString("es-CO")}</strong>.
              </p>
              <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, marginTop: 8 }}>
                <input type="checkbox" checked={modoSimulacion} onChange={(e) => setModoSimulacion(e.target.checked)} />
                Modo simulación (calcula y muestra todo, nunca escribe en Mercado Libre)
              </label>
              {!puedeEjecutar && !modoSimulacion && (
                <p style={{ fontSize: 12, color: "var(--text-faint)", marginTop: 6 }}>
                  Tu rol puede aprobar pero no ejecutar — esto va a quedar pendiente de que alguien con permiso de ejecutar lo dispare.
                </p>
              )}
              <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                <Boton type="button" variante="primario" chico disabled={aplicando} onClick={confirmarVistaPrevia}>
                  {aplicando ? "Aplicando…" : "Confirmar"}
                </Boton>
                <Boton type="button" variante="secundario" chico disabled={aplicando} onClick={() => setVistaPrevia(null)}>
                  Cancelar
                </Boton>
              </div>
              {resultadoAplicar && <p style={{ fontSize: 13, marginTop: 8 }}>{resultadoAplicar}</p>}
            </Tarjeta>
          )}
          {!vistaPrevia && resultadoAplicar && <p style={{ fontSize: 13, marginTop: 10 }}>{resultadoAplicar}</p>}
          {!puedeAprobar && <p style={{ fontSize: 12, color: "var(--text-faint)", marginTop: 10 }}>Tu rol solo puede consultar — no puede aceptar ni ejecutar acciones.</p>}
        </Tarjeta>
      )}

      {pestana === "historial" && (
        <Tarjeta className={styles.seccion}>
          <p className="zx-etiqueta">HISTORIAL</p>
          {historial.length === 0 ? (
            <p style={{ fontSize: 13, color: "var(--text-faint)", marginTop: 10 }}>Todavía no hay ninguna acción registrada.</p>
          ) : (
            <div style={{ marginTop: 10 }}>
              <Tabla encabezados={["Cuenta", "Producto", "Acción", "Antes", "Después", "Estado", "Cuándo"]}>
                {historial.map((h) => (
                  <FilaTabla key={h.id}>
                    <CeldaTabla>{h.nicknameCuenta}</CeldaTabla>
                    <CeldaTabla>{h.tituloProducto ?? h.itemId}</CeldaTabla>
                    <CeldaTabla>{h.accion}</CeldaTabla>
                    <CeldaTabla>{formatoPesos(h.precioAntes)}</CeldaTabla>
                    <CeldaTabla>{formatoPesos(h.precioDespues)}</CeldaTabla>
                    <CeldaTabla>
                      <Chip estado={h.estado === "ejecutada" ? "exito" : h.estado === "fallida" || h.estado === "rechazada" ? "peligro" : "aviso"} title={h.error ?? undefined}>
                        {h.modoSimulacion ? "Simulado" : h.estado}
                      </Chip>
                    </CeldaTabla>
                    <CeldaTabla>{new Date(h.creadoTs).toLocaleString("es-CO")}</CeldaTabla>
                  </FilaTabla>
                ))}
              </Tabla>
            </div>
          )}
        </Tarjeta>
      )}

      {pestana === "reglas" && <PestanaReglas reglas={reglas} puedeAprobar={puedeAprobar} onGuardado={cargarReglas} />}
    </>
  );
}

function PestanaReglas({ reglas, puedeAprobar, onGuardado }: { reglas: ReglasCuentaCliente[]; puedeAprobar: boolean; onGuardado: () => void }) {
  // Copia local editable — nunca se muta `reglas` (la prop) directo:
  // bug real evitado acá mismo mientras se escribía esto, cada tecla
  // escrita disparaba un refetch del servidor que pisaba el cambio a
  // medio escribir. `reglas` solo se vuelve a leer cuando de verdad
  // cambia desde afuera (onGuardado ya refrescó con el valor guardado).
  const [filasLocal, setFilasLocal] = useState<ReglasCuentaCliente[]>(reglas);
  useEffect(() => setFilasLocal(reglas), [reglas]);
  const [guardandoId, setGuardandoId] = useState<string | null>(null);

  function editarFila(indice: number, cambios: Partial<ReglasCuentaCliente>) {
    setFilasLocal((actual) => actual.map((f, i) => (i === indice ? { ...f, ...cambios } : f)));
  }

  async function guardar(fila: ReglasCuentaCliente, copiarATodas: boolean) {
    setGuardandoId(fila.cuentaId);
    await fetch("/api/ml/promociones/reglas", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        cuentaId: fila.cuentaId,
        descuentoMaximoPct: fila.descuentoMaximoPct,
        participarCompartidas: fila.participarCompartidas,
        igualarAlPiso: fila.igualarAlPiso,
        busquedaAutomaticaHora: fila.busquedaAutomaticaHora,
        copiarATodas,
      }),
    });
    setGuardandoId(null);
    onGuardado();
  }

  return (
    <Tarjeta className={styles.seccion}>
      <p className="zx-etiqueta">REGLAS POR CUENTA</p>
      <p style={{ fontSize: 13, color: "var(--text-muted)", marginTop: 8 }}>
        El precio mínimo de Finanzas siempre manda — este freno no se puede apagar acá.
      </p>
      {filasLocal.map((fila, indice) => (
        <div key={fila.cuentaId} className={styles.filaRegla}>
          <p style={{ fontWeight: 600 }}>{fila.nickname}</p>
          <label className={styles.campoRegla}>
            Descuento máximo (%)
            <input
              type="number"
              min={1}
              max={100}
              className="zx-control"
              value={fila.descuentoMaximoPct}
              disabled={!puedeAprobar}
              onChange={(e) => editarFila(indice, { descuentoMaximoPct: Number(e.target.value) })}
            />
          </label>
          <label className={styles.campoRegla}>
            <input type="checkbox" checked={fila.participarCompartidas} disabled={!puedeAprobar} onChange={(e) => editarFila(indice, { participarCompartidas: e.target.checked })} />
            Participar en promos compartidas con +Meli
          </label>
          <label className={styles.campoRegla}>
            <input type="checkbox" checked={fila.igualarAlPiso} disabled={!puedeAprobar} onChange={(e) => editarFila(indice, { igualarAlPiso: e.target.checked })} />
            Igualar al piso
          </label>
          <label className={styles.campoRegla}>
            Búsqueda automática (hora, vacío = apagada)
            <input
              type="time"
              className="zx-control"
              value={fila.busquedaAutomaticaHora ?? ""}
              disabled={!puedeAprobar}
              onChange={(e) => editarFila(indice, { busquedaAutomaticaHora: e.target.value || null })}
            />
          </label>
          {puedeAprobar && (
            <div style={{ display: "flex", gap: 8 }}>
              <Boton type="button" variante="primario" chico disabled={guardandoId === fila.cuentaId} onClick={() => guardar(fila, false)}>
                Guardar
              </Boton>
              <Boton type="button" variante="secundario" chico disabled={guardandoId === fila.cuentaId} onClick={() => guardar(fila, true)} title="Copia estas reglas a todas las cuentas conectadas">
                Usar las mismas reglas para todas las cuentas
              </Boton>
            </div>
          )}
        </div>
      ))}
    </Tarjeta>
  );
}
