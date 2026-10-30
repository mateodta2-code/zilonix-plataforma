"use client";

import { useEffect, useState } from "react";
import { Boton } from "@/components/marco/Boton";
import { Campo } from "@/components/marco/Campo";
import { Chip, type EstadoChip } from "@/components/marco/Chip";
import { Tarjeta } from "@/components/marco/Tarjeta";
import { Tabla, FilaTabla, CeldaTabla } from "@/components/marco/Tabla";
import { Toast, type ItemToast } from "@/components/marco/Toast";
import {
  accionParaCandidato,
  descuentoDesdePrecio,
  formatoEnteroEsCo,
  formatoPorcentaje,
  formatoPorcentajeInput,
  fueraDeRango,
  gananciaEstimadaParaPrecio,
  numero,
  parsearNumeroEsCo,
  porcentajeDescuento,
  precioConPromo,
  precioDesdeDescuento,
  puedeEditarPrecio,
  rangoEdicion,
  sinMargen,
} from "./calculosFila";
import { debeMostrarResumenBusquedaVacia, lineasResumenBusquedaVacia } from "./resumenBusquedaVacia";
import type {
  AccionHistorialCliente,
  CandidatoClienteCliente,
  ConteosCandidatosCliente,
  FilaParticipandoCliente,
  ReglasCuentaCliente,
  TrabajoBusquedaCliente,
} from "./tipos-cliente";
import styles from "./promociones.module.css";

type Cuenta = { id: string; nickname: string };
type Pestana = "buscar" | "historial" | "reglas" | "participando";
// Rama feat-promociones-editar-precio, punto 2 — "todas" ya significaba
// "pendientes" del lado del servidor (GET .../candidatos solo devuelve
// filas sin decisión bajo este filtro); la etiqueta ahora lo dice.
type Filtro = "todas" | "cumplen" | "revisar" | "sin-minimo" | "solo-ml" | "aprobadas" | "rechazadas";
type TipoLote = "aprobar" | "rechazar";

const ETIQUETA_FILTRO: Record<Filtro, string> = {
  todas: "Pendientes",
  cumplen: "Cumplen",
  revisar: "Revisar a mano",
  "sin-minimo": "Sin precio mínimo",
  "solo-ml": "Solo en ML",
  aprobadas: "Aprobadas",
  rechazadas: "Rechazadas",
};

const ETIQUETA_ESTADO_CUENTA: Record<string, string> = { en_cola: "En cola", buscando: "Buscando…", listo: "Listo", error: "Error" };

function formatoPesos(valor: number | null): string {
  return valor == null ? "—" : `$${valor.toLocaleString("es-CO")}`;
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
  const [conteos, setConteos] = useState<ConteosCandidatosCliente | null>(null);
  const [cargandoCandidatos, setCargandoCandidatos] = useState(false);
  const [seleccionados, setSeleccionados] = useState<Record<string, boolean>>({});

  // Rama feat-promociones-editar-precio, punto 1 — precio con
  // promo/% desc. editados a mano, por candidatoId. Nunca se guarda
  // nada acá hasta que se aprueba esa fila (precioElegido viaja en el
  // POST a /acciones) — el servidor vuelve a validar todo fresco
  // igual, esto es solo para la pantalla. Ya NO se fuerza al rango acá
  // (ver `fueraDeRango`, rama fix-promociones-edicion) — puede guardar
  // un valor fuera de rango a propósito, para avisar en vez de pisarlo.
  const [preciosEditados, setPreciosEditados] = useState<Record<string, number>>({});
  // Bug real (rama fix-promociones-edicion, punto 1) — los inputs
  // clampeaban en CADA tecla (el onChange de antes llamaba de una al
  // mismo setPreciosEditados con el valor a medio escribir): borrar un
  // dígito o escribir algo más chico que el mínimo saltaba al instante
  // al piso, nunca dejaba terminar de escribir. Ahora se escribe
  // libre en un borrador de texto por campo/fila; el valor de verdad
  // (preciosEditados) solo se actualiza al confirmar (blur/Enter, ver
  // confirmarPrecioTexto/confirmarDescuentoTexto más abajo). `undefined`
  // = no se está editando ese campo ahora mismo, se muestra el valor
  // ya confirmado.
  const [borradores, setBorradores] = useState<Record<string, { precio?: string; descuento?: string }>>({});

  // Rama fix-promociones-edicion, punto 2 — "si el servidor rechaza,
  // muestra el motivo... con un toast": un mensaje chico al final de la
  // Tarjeta era fácil de no ver. Se auto-cierra solo.
  const [toasts, setToasts] = useState<ItemToast[]>([]);
  function mostrarToast(texto: string, estado: EstadoChip) {
    const id = `${Date.now()}-${Math.random()}`;
    setToasts((actual) => [...actual, { id, texto, estado }]);
    setTimeout(() => setToasts((actual) => actual.filter((t) => t.id !== id)), 6000);
  }
  function cerrarToast(id: string) {
    setToasts((actual) => actual.filter((t) => t.id !== id));
  }

  const [modoSimulacion, setModoSimulacion] = useState(false);
  const [vistaPrevia, setVistaPrevia] = useState<{
    tipo: TipoLote;
    decisiones: { candidatoId: string; accion: "participar" | "modificar"; precioElegido?: number }[];
    cantidad: number;
    cuentasAfectadas: string[];
    gananciaTotal: number;
  } | null>(null);
  const [aplicando, setAplicando] = useState(false);
  const [resultadoAplicar, setResultadoAplicar] = useState<string | null>(null);

  // Rama feat-promociones-aprobacion — "No"/"Volver a pendiente" en una
  // fila son decisiones directas, sin vista previa (nunca tocan
  // Mercado Libre, no hay nada que confirmar con el mismo peso que
  // aprobar/ejecutar). `decisionDirectaId` es el candidatoId en curso,
  // para deshabilitar solo ESE botón.
  const [decisionDirectaId, setDecisionDirectaId] = useState<string | null>(null);
  const [errorDecisionDirecta, setErrorDecisionDirecta] = useState<string | null>(null);

  const [historial, setHistorial] = useState<AccionHistorialCliente[]>([]);
  const [reglas, setReglas] = useState<ReglasCuentaCliente[]>([]);

  // Rama fix-promociones-aprobadas-participando, punto 3 — pestaña
  // "Participando". `salidaEnCursoKey` es `cuentaMlId:itemId:tipoPromocion`
  // (único por fila, igual que la clave que usa el servidor para
  // derivar decisiones) — deshabilita solo ESA fila mientras se manda
  // el DELETE real.
  const [participando, setParticipando] = useState<FilaParticipandoCliente[]>([]);
  const [cargandoParticipando, setCargandoParticipando] = useState(false);
  const [salidaEnCursoKey, setSalidaEnCursoKey] = useState<string | null>(null);

  // MED 7 / rama feat-promociones-aprobacion — "Lanzar aprobadas a
  // Mercado Libre (N)": N son las acciones "aceptada" pendientes de
  // TODA la empresa (nunca solo de la cuenta filtrada acá — el lote
  // que de verdad se va a lanzar es siempre el de la empresa entera),
  // fuera de modo simulación. Se confirma antes de llamar a ML.
  const [pendientesLanzar, setPendientesLanzar] = useState(0);
  // Rama fix-promociones-aprobar-no-ejecuta, punto 1 — bug real,
  // urgente (cuenta sharel): aprobar con permiso de ejecutar activo
  // mandaba la promoción real a Mercado Libre SIN este modal — ya se
  // corrigió del lado del servidor (POST .../acciones nunca más
  // ejecuta), pero el modal en sí también tenía que reforzarse: ahora
  // lista cada producto/precio/cuenta que se va a lanzar (nunca solo
  // un número) y exige escribir la palabra de confirmación a mano
  // antes de habilitar el botón — un clic de más nunca alcanza.
  const [pendientesLanzarFilas, setPendientesLanzarFilas] = useState<
    { id: string; cuentaMlId: string; nicknameCuenta: string; itemId: string; tituloProducto: string | null; tipoPromocion: string; precioAntes: string | null; precioDespues: string | null }[]
  >([]);
  const [confirmandoLanzar, setConfirmandoLanzar] = useState(false);
  const [textoConfirmacionLanzar, setTextoConfirmacionLanzar] = useState("");
  const [ejecutandoPendientes, setEjecutandoPendientes] = useState(false);
  const [resultadoEjecutarPendientes, setResultadoEjecutarPendientes] = useState<string | null>(null);
  const PALABRA_CONFIRMACION_LANZAR = "LANZAR";

  async function cargarCandidatos() {
    setCargandoCandidatos(true);
    const params = new URLSearchParams({ filtro });
    if (cuentaSeleccionada !== "todas") params.set("cuentaId", cuentaSeleccionada);
    const res = await fetch(`/api/ml/promociones/candidatos?${params.toString()}`);
    if (res.ok) {
      const body = await res.json();
      setCandidatos(body.filas);
      setConteos(body.conteos ?? null);
    }
    setCargandoCandidatos(false);
  }

  // Review de Pablo (PR #304) — N tiene que ser el total REAL de
  // aprobadas pendientes de la empresa entera, nunca una aproximación
  // con el .limit(200) de /historial (ese límite es para la pestaña
  // Historial, no para contar) — con más de 200 aprobadas, el botón
  // mostraba un N más chico que lo que "Lanzar" de verdad iba a
  // procesar. count(*) real en /acciones/pendientes-lanzar.
  async function cargarPendientesLanzar() {
    const res = await fetch("/api/ml/promociones/acciones/pendientes-lanzar");
    if (!res.ok) return;
    const body = await res.json();
    setPendientesLanzar(typeof body.total === "number" ? body.total : 0);
    setPendientesLanzarFilas(Array.isArray(body.filas) ? body.filas : []);
  }

  useEffect(() => {
    void cargarCandidatos();
    // Review de Pablo (PR #304) — una selección vieja podía apuntar a
    // candidatoIds que ya no están en la lista filtrada (de otra
    // cuenta, o de un filtro distinto) y "Seleccionar todo"/los
    // botones en lote terminaban operando sobre filas invisibles.
    setSeleccionados({});
    // eslint-disable-next-line react-hooks/exhaustive-deps -- cargarCandidatos se recrea cada render; solo nos importa reaccionar a cuentaSeleccionada/filtro
  }, [cuentaSeleccionada, filtro]);

  useEffect(() => {
    void cargarPendientesLanzar();
  }, []);

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
    // Bug real en staging (rama fix-promociones-buscar, Refs #44) —
    // este interval nunca se frenaba solo: seguía pidiendo
    // /trabajo/[jobId] cada 2s para siempre (confirmado: "polling
    // trabajo 200 varios minutos" en los logs de la empresa que
    // reportó el problema), aunque `terminadoTs` ya estuviera puesto
    // desde la primera consulta. `id` se declara ACÁ para poder
    // frenarlo desde dentro de `consultar()`, no solo al desmontar.
    let id: ReturnType<typeof setInterval> | undefined;
    async function consultar() {
      const res = await fetch(`/api/ml/promociones/trabajo/${jobId}`);
      if (!activo || !res.ok) return;
      const body = await res.json();
      setTrabajo(body.trabajo);
      if (body.trabajo.terminadoTs != null) {
        void cargarCandidatos();
        if (id != null) clearInterval(id);
      }
    }
    void consultar();
    id = setInterval(() => void consultar(), 2000);
    return () => {
      activo = false;
      if (id != null) clearInterval(id);
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

  async function cargarParticipando() {
    setCargandoParticipando(true);
    const params = new URLSearchParams();
    if (cuentaSeleccionada !== "todas") params.set("cuentaId", cuentaSeleccionada);
    const res = await fetch(`/api/ml/promociones/participando?${params.toString()}`);
    if (res.ok) setParticipando((await res.json()).filas);
    setCargandoParticipando(false);
  }

  useEffect(() => {
    if (pestana === "historial") void cargarHistorial();
    if (pestana === "reglas") void cargarReglas();
    if (pestana === "participando") void cargarParticipando();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- solo nos importa reaccionar al cambio de pestaña (y a la cuenta, para participando)
  }, [pestana, cuentaSeleccionada]);

  // Confirmación explícita antes de un DELETE real contra Mercado
  // Libre (pedido de Mateo) — mismo patrón ya usado en este repo
  // (marcarDespachado, app/panel/despachos) para acciones que no se
  // deshacen fácil. Solo se prueba contra ML real con 1 ítem que
  // Mateo elija — nunca en pruebas automáticas (route.test.ts, con
  // mocks).
  async function dejarDeParticipar(fila: FilaParticipandoCliente) {
    if (!confirm(`¿Dejar de participar en "${fila.tituloProducto ?? fila.itemId}" (${fila.tipoPromocion})? Esto se manda de una a Mercado Libre, no se puede deshacer desde acá.`)) return;
    const key = `${fila.cuentaMlId}:${fila.itemId}:${fila.tipoPromocion}`;
    setSalidaEnCursoKey(key);
    let res: Response;
    let body: { error?: string; yaNoParticipaba?: boolean } = {};
    try {
      res = await fetch("/api/ml/promociones/participando/salir", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cuentaId: fila.cuentaMlId, itemId: fila.itemId, promotionIdMl: fila.promotionIdMl, tipoPromocion: fila.tipoPromocion }),
      });
      body = await res.json().catch(() => ({}));
    } catch {
      setSalidaEnCursoKey(null);
      mostrarToast("No se pudo conectar con el servidor — revisá tu conexión e intentá de nuevo.", "peligro");
      return;
    }
    setSalidaEnCursoKey(null);
    if (res.ok) {
      setParticipando((actual) => actual.filter((f) => `${f.cuentaMlId}:${f.itemId}:${f.tipoPromocion}` !== key));
      mostrarToast(body.yaNoParticipaba ? "Ya no estaba participando — nada que mandar a Mercado Libre." : "Listo — se salió de la promoción.", "exito");
    } else {
      mostrarToast(body.error || "No se pudo salir de la promoción.", "peligro");
    }
  }

  function chipEstado(candidato: CandidatoClienteCliente): { texto: string; estado: EstadoChip; title?: string } {
    if (candidato.soloEnMl) return { texto: "Solo en ML", estado: "neutro", title: candidato.motivoRevisarManual ?? undefined };
    if (candidato.cumpleReglas) return { texto: "Cumple", estado: "exito" };
    return { texto: "Revisar a mano", estado: "aviso", title: candidato.motivoRevisarManual ?? undefined };
  }

  // Punto 1 — "Precio con promo" editado a mano para esta fila (o el
  // valor que ya traía el motor, si nadie lo tocó todavía).
  function precioEditado(candidato: CandidatoClienteCliente): number {
    const editado = preciosEditados[candidato.id];
    if (editado != null) return editado;
    return precioConPromo(candidato) ?? numero(candidato.precioOriginal) ?? 0;
  }

  // Confirma el borrador de "Precio con promo" — SOLO corre en
  // blur/Enter (nunca en cada tecla, ver el comentario de `borradores`
  // más arriba). Un valor fuera de rango se guarda TAL CUAL (nunca se
  // fuerza de vuelta al rango) — `fueraDeRango` más abajo es lo que
  // avisa y bloquea "Sí".
  function confirmarPrecioTexto(candidato: CandidatoClienteCliente) {
    const texto = borradores[candidato.id]?.precio;
    if (texto === undefined) return; // nunca se tocó este campo, nada que confirmar
    setBorradores((actual) => {
      const siguiente = { ...actual };
      if (siguiente[candidato.id]) siguiente[candidato.id] = { ...siguiente[candidato.id], precio: undefined };
      return siguiente;
    });
    const parsed = parsearNumeroEsCo(texto);
    if (parsed == null) return; // vacío/inválido: se descarta, vuelve a mostrar el último valor confirmado
    setPreciosEditados((actual) => ({ ...actual, [candidato.id]: Math.round(parsed) }));
  }

  // Mismo criterio para "% desc." — confirma convirtiendo a precio (la
  // única fuente de verdad real, ver `precioEditado`), nunca al revés.
  function confirmarDescuentoTexto(candidato: CandidatoClienteCliente) {
    const texto = borradores[candidato.id]?.descuento;
    if (texto === undefined) return;
    setBorradores((actual) => {
      const siguiente = { ...actual };
      if (siguiente[candidato.id]) siguiente[candidato.id] = { ...siguiente[candidato.id], descuento: undefined };
      return siguiente;
    });
    const original = numero(candidato.precioOriginal);
    const parsed = parsearNumeroEsCo(texto);
    if (parsed == null || original == null) return;
    setPreciosEditados((actual) => ({ ...actual, [candidato.id]: precioDesdeDescuento(original, parsed) }));
  }

  // Esc — "vuelve al valor anterior": descarta el borrador sin
  // confirmar nada, el input vuelve a mostrar el valor ya confirmado.
  function descartarBorrador(candidatoId: string, campo: "precio" | "descuento") {
    setBorradores((actual) => {
      const siguiente = { ...actual };
      if (siguiente[candidatoId]) siguiente[candidatoId] = { ...siguiente[candidatoId], [campo]: undefined };
      return siguiente;
    });
  }

  // El precio que de verdad se va a mandar si se aprueba esta fila
  // (editado a mano, o el que ya sugería el motor si nadie la tocó) —
  // usado para el chip del piso y la utilidad en vivo, y es lo que se
  // manda como precioElegido al aprobar.
  function precioParaValidar(candidato: CandidatoClienteCliente): number | null {
    return puedeEditarPrecio(candidato) ? precioEditado(candidato) : precioConPromo(candidato);
  }

  // Indicador dedicado al piso de Finanzas (punto 2) — distinto del
  // chip de "Cumple"/"Revisar a mano", que también exige el tope de
  // descuento y otros permisos de la cuenta (esos dependen de reglas
  // que viven solo en el servidor — nunca se duplican acá). Este sí se
  // recalcula en vivo contra el precio editado, porque es una
  // comparación simple contra un solo número (precioMinimo) que ya
  // tenemos en pantalla.
  function chipPrecioMinimoEnVivo(candidato: CandidatoClienteCliente): { texto: string; estado: EstadoChip } | null {
    const minimo = numero(candidato.precioMinimo);
    const precioMostrado = precioParaValidar(candidato);
    if (minimo == null || precioMostrado == null) return null;
    return precioMostrado >= minimo ? { texto: "Cumple precio mínimo", estado: "exito" } : { texto: "Queda por debajo", estado: "peligro" };
  }

  // Utilidad estimada en vivo — para una fila editable usa el precio
  // que el usuario puso; para una de solo lectura, la que ya vino del
  // motor (gananciaEstimadaParaPrecio necesita precioSugerido, que no
  // siempre está).
  function gananciaEnVivo(candidato: CandidatoClienteCliente): number | null {
    if (!puedeEditarPrecio(candidato)) return numero(candidato.gananciaEstimada);
    return gananciaEstimadaParaPrecio(candidato, precioEditado(candidato)) ?? numero(candidato.gananciaEstimada);
  }

  // Decisión lista para mandar al aprobar (fila a fila o en lote) —
  // precioElegido solo viaja cuando la fila es editable Y alguien la
  // tocó o puede tocarla; si no es editable, el servidor vuelve a
  // sugerir su propio precio (tipos con precio fijo de ML).
  function decisionParaAprobar(candidato: CandidatoClienteCliente): { candidatoId: string; accion: "participar" | "modificar"; precioElegido?: number } {
    const editable = puedeEditarPrecio(candidato);
    return { candidatoId: candidato.id, accion: accionParaCandidato(candidato), precioElegido: editable ? precioEditado(candidato) : undefined };
  }

  function abrirVistaPrevia(decisiones: { candidatoId: string; accion: "participar" | "modificar"; precioElegido?: number }[], tipo: TipoLote) {
    const porId = new Map(candidatos.map((c) => [c.id, c]));
    const cuentasAfectadas = [...new Set(decisiones.map((d) => porId.get(d.candidatoId)?.nicknameCuenta).filter((n): n is string => !!n))];
    const gananciaTotal = decisiones.reduce((acc, d) => acc + (numero(porId.get(d.candidatoId)?.gananciaEstimada ?? null) ?? 0), 0);
    setVistaPrevia({ tipo, decisiones, cantidad: decisiones.length, cuentasAfectadas, gananciaTotal });
    setResultadoAplicar(null);
  }

  function aceptarLasQueCumplen() {
    const candidatosQueCumplen = candidatos.filter((c) => c.cumpleReglas);
    abrirVistaPrevia(candidatosQueCumplen.map(decisionParaAprobar), "aprobar");
  }

  function aprobarSeleccionados() {
    const elegidos = candidatos.filter((c) => seleccionados[c.id]);
    abrirVistaPrevia(elegidos.map(decisionParaAprobar), "aprobar");
  }

  function rechazarSeleccionados() {
    const elegidos = candidatos.filter((c) => seleccionados[c.id]);
    abrirVistaPrevia(
      elegidos.map((c) => ({ candidatoId: c.id, accion: accionParaCandidato(c) })),
      "rechazar"
    );
  }

  // Rama fix-promociones-edicion, punto 2 — causa real del bug
  // reportado ("al dar Sí no pasa nada visible"): "Sí" en una fila
  // puntual abría la misma vista previa + Confirmar que el lote (un
  // producto, un botón más, una tarjeta nueva más abajo en la misma
  // página) — con una sola fila esa vista previa no agrega nada que no
  // se vea ya en la fila misma (precio, % y utilidad ya están ahí,
  // editables), así que el clic en "Sí" se sentía como que no hacía
  // nada: el cambio real pasaba en un cuadro aparte, fácil de no
  // notar. Ahora "Sí" es una decisión directa, igual que "No"/"Volver
  // a pendiente" — mismo botón, mismo estado de carga, un toast
  // confirma el resultado apenas responde el servidor. La vista previa
  // + Confirmar (con el detalle de cuántas cuentas/ganancia total)
  // sigue existiendo SOLO para el lote (aceptarLasQueCumplen,
  // aprobarSeleccionados, rechazarSeleccionados) — ahí sí vale la pena
  // ver el resumen antes de confirmar varios productos de una.
  async function enviarDecisionDirecta(candidato: CandidatoClienteCliente, decisionHumana: "aprobar" | "rechazar" | "volver_a_pendiente") {
    setDecisionDirectaId(candidato.id);
    setErrorDecisionDirecta(null);
    const decisionBase = decisionHumana === "aprobar" ? decisionParaAprobar(candidato) : { candidatoId: candidato.id, accion: accionParaCandidato(candidato) };
    let res: Response;
    let body: { error?: string; acciones?: { estado: string; error: string | null }[] } = {};
    try {
      res = await fetch("/api/ml/promociones/acciones", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          decisiones: [{ ...decisionBase, decision: decisionHumana }],
          modoSimulacion: decisionHumana === "aprobar" ? modoSimulacion : false,
        }),
      });
      body = await res.json().catch(() => ({}));
    } catch {
      setDecisionDirectaId(null);
      mostrarToast("No se pudo guardar — revisá tu conexión e intentá de nuevo.", "peligro");
      return;
    }
    setDecisionDirectaId(null);
    if (res.ok) {
      setSeleccionados((actual) => {
        const siguiente = { ...actual };
        delete siguiente[candidato.id];
        return siguiente;
      });
      if (decisionHumana === "aprobar") {
        // Punto 4 (PR #307) + este bug — un rechazo blando (HTTP 200,
        // la fila quedó "rechazada" al revalidar fresco) nunca puede
        // verse como un "listo" silencioso.
        const resultado = body.acciones?.[0];
        if (resultado?.estado === "rechazada") {
          mostrarToast(resultado.error || "El servidor rechazó este producto al revalidar — revisalo en Rechazadas.", "peligro");
        } else {
          mostrarToast("Aprobado — pasó a la pestaña Aprobadas.", "exito");
        }
      } else if (decisionHumana === "rechazar") {
        mostrarToast("Rechazado — nunca se tocó Mercado Libre.", "neutro");
      } else {
        mostrarToast("Vuelve a Pendientes.", "neutro");
      }
      void cargarCandidatos();
      void cargarPendientesLanzar();
    } else {
      // Review de Pablo (PR #304) — antes, un fallo acá no se veía en
      // ningún lado: el botón volvía a "No" y la fila seguía igual,
      // sin ninguna pista de qué pasó.
      const texto = body.error || "No se pudo guardar este cambio.";
      setErrorDecisionDirecta(texto);
      mostrarToast(texto, "peligro");
    }
  }

  const todosSeleccionados = candidatos.length > 0 && candidatos.every((c) => seleccionados[c.id]);
  const hayAlgunoSeleccionado = candidatos.some((c) => seleccionados[c.id]);

  function alternarSeleccionarTodo() {
    if (todosSeleccionados) {
      setSeleccionados({});
    } else {
      setSeleccionados((actual) => {
        const siguiente = { ...actual };
        for (const c of candidatos) siguiente[c.id] = true;
        return siguiente;
      });
    }
  }

  async function lanzarAprobadas() {
    setConfirmandoLanzar(false);
    setTextoConfirmacionLanzar("");
    setEjecutandoPendientes(true);
    setResultadoEjecutarPendientes(null);
    let res: Response;
    let body: { error?: string; acciones?: { estado: string; tituloProducto: string | null; error: string | null }[] } = {};
    try {
      res = await fetch("/api/ml/promociones/acciones/ejecutar", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({}) });
      body = await res.json().catch(() => ({}));
    } catch {
      setEjecutandoPendientes(false);
      mostrarToast("No se pudo conectar con el servidor — revisá tu conexión e intentá de nuevo.", "peligro");
      return;
    }
    setEjecutandoPendientes(false);
    if (res.ok) {
      const acciones = body.acciones ?? [];
      const ejecutadas = acciones.filter((a) => a.estado === "ejecutada");
      const fallidas = acciones.filter((a) => a.estado !== "ejecutada");
      const partes = [`${ejecutadas.length} de ${acciones.length} acción(es) se lanzaron bien.`];
      if (fallidas.length > 0) {
        const detalle = fallidas.map((f) => `${f.tituloProducto ?? "producto"}: ${f.error ?? "falló"}`).join(" / ");
        partes.push(`${fallidas.length} fallaron — ${detalle}`);
      }
      const texto = partes.join(" ");
      setResultadoEjecutarPendientes(texto);
      mostrarToast(texto, fallidas.length > 0 ? (ejecutadas.length > 0 ? "aviso" : "peligro") : "exito");
      void cargarCandidatos();
      void cargarPendientesLanzar();
    } else {
      const texto = body.error || "No se pudo ejecutar.";
      setResultadoEjecutarPendientes(texto);
      mostrarToast(texto, "peligro");
    }
  }

  async function confirmarVistaPrevia() {
    if (!vistaPrevia) return;
    setAplicando(true);
    const decision = vistaPrevia.tipo === "rechazar" ? "rechazar" : "aprobar";
    let res: Response;
    let body: { error?: string; ejecutado?: boolean; acciones?: { estado: string; error: string | null }[] } = {};
    try {
      res = await fetch("/api/ml/promociones/acciones", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          decisiones: vistaPrevia.decisiones.map((d) => ({ ...d, decision })),
          modoSimulacion: vistaPrevia.tipo === "aprobar" ? modoSimulacion : false,
        }),
      });
      body = await res.json().catch(() => ({}));
    } catch {
      // Bug real (rama fix-promociones-edicion, punto 2) — este fetch
      // nunca tuvo un try/catch: si se caía la conexión a mitad de
      // camino, `aplicando` se quedaba en true para siempre y nada se
      // mostraba — el botón "Confirmar" quedaba trabado en "Aplicando…"
      // sin ningún aviso, exactamente el síntoma de "no pasa nada
      // visible" que reportó Mateo.
      setAplicando(false);
      mostrarToast("No se pudo conectar con el servidor — revisá tu conexión e intentá de nuevo.", "peligro");
      return;
    }
    setAplicando(false);
    if (res.ok) {
      let texto: string;
      let estadoToast: EstadoChip;
      if (vistaPrevia.tipo === "rechazar") {
        texto = `Rechazado: ${body.acciones?.length ?? 0} producto(s) — nunca se tocó Mercado Libre.`;
        estadoToast = "neutro";
      } else {
        // Punto 4 (PR #307) — cuando el servidor rechaza alguna en
        // silencio al revalidar fresco (HTTP 200 con rechazo blando: el
        // piso cambió, el precio editado ya no entra en el rango de ML,
        // etc.), el motivo tiene que verse, no solo quedar perdido en
        // el historial.
        const acciones = body.acciones ?? [];
        const aceptadas = acciones.filter((a) => a.estado === "aceptada");
        const rechazadasAlValidar = acciones.filter((a) => a.estado === "rechazada");
        // BUG REAL, URGENTE (rama fix-promociones-aprobar-no-ejecuta) —
        // este endpoint YA NUNCA ejecuta nada contra Mercado Libre, sin
        // importar el permiso de quien aprueba (ver app/api/ml/promociones/acciones/route.ts).
        // El mensaje acá tiene que ser consistente con eso: "aprobar"
        // nunca es "listo, ya se mandó" — siempre queda pendiente de
        // "Lanzar aprobadas", un paso humano separado y explícito.
        const partes: string[] = [
          modoSimulacion
            ? `Simulación: ${acciones.length} acción(es) calculadas, nada se envió a Mercado Libre.`
            : `Aprobado: ${aceptadas.length} acción(es) — quedan pendientes de "Lanzar aprobadas a Mercado Libre", todavía no se tocó Mercado Libre.`,
        ];
        if (rechazadasAlValidar.length > 0) {
          const motivos = [...new Set(rechazadasAlValidar.map((a) => a.error).filter((m): m is string => !!m))];
          partes.push(`${rechazadasAlValidar.length} producto(s) se rechazaron solos al revalidar: ${motivos.join(" / ")}`);
        }
        texto = partes.join(" ");
        estadoToast = rechazadasAlValidar.length > 0 ? (aceptadas.length > 0 ? "aviso" : "peligro") : "exito";
      }
      setResultadoAplicar(texto);
      mostrarToast(texto, estadoToast);
      setVistaPrevia(null);
      setSeleccionados({});
      void cargarCandidatos();
      void cargarPendientesLanzar();
    } else {
      const texto = body.error || "No se pudo aplicar.";
      setResultadoAplicar(texto);
      mostrarToast(texto, "peligro");
    }
  }

  return (
    <>
      <div className={styles.pestanas}>
        {(["buscar", "participando", "historial", "reglas"] as Pestana[]).map((p) => (
          <Boton key={p} type="button" variante={pestana === p ? "primario" : "secundario"} chico onClick={() => setPestana(p)}>
            {p === "buscar" ? "Buscar / Resultados" : p === "participando" ? "Participando" : p === "historial" ? "Historial" : "Reglas"}
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
                {conteos ? ` (${conteos[f]})` : ""}
              </Boton>
            ))}
          </div>

          {puedeAprobar && (
            <div className={styles.accionesLote}>
              <Boton type="button" variante="primario" chico disabled={!candidatos.some((c) => c.cumpleReglas)} onClick={aceptarLasQueCumplen}>
                Aceptar todas las que cumplen
              </Boton>
              <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13 }}>
                <input type="checkbox" checked={todosSeleccionados} onChange={alternarSeleccionarTodo} disabled={candidatos.length === 0} />
                Seleccionar todo{candidatos.length > 0 ? ` (${candidatos.length})` : ""}
              </label>
              <Boton type="button" variante="primario" chico disabled={!hayAlgunoSeleccionado} onClick={aprobarSeleccionados}>
                Aprobar seleccionados
              </Boton>
              <Boton type="button" variante="secundario" chico disabled={!hayAlgunoSeleccionado} onClick={rechazarSeleccionados}>
                Rechazar seleccionados
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
                <Boton
                  type="button"
                  variante="secundario"
                  chico
                  disabled={ejecutandoPendientes || pendientesLanzar === 0}
                  onClick={() => {
                    void cargarPendientesLanzar(); // refresca la lista justo antes de mostrarla — nunca confirmar sobre algo desactualizado
                    setConfirmandoLanzar(true);
                  }}
                  title="Ejecuta contra Mercado Libre todas las acciones aceptadas y pendientes de esta empresa (fuera de modo simulación)."
                >
                  {ejecutandoPendientes ? "Lanzando…" : `Lanzar aprobadas a Mercado Libre (${pendientesLanzar})`}
                </Boton>
              )}
            </div>
          )}
          {confirmandoLanzar && (
            <Tarjeta className={styles.vistaPrevia}>
              <p style={{ fontSize: 13 }}>
                Vas a lanzar <strong>{pendientesLanzar}</strong> acción(es) aprobadas contra Mercado Libre DE VERDAD — no hay vuelta atrás una vez que se envían.
                {pendientesLanzar > pendientesLanzarFilas.length ? ` Mostrando las primeras ${pendientesLanzarFilas.length}.` : ""}
              </p>
              <div style={{ maxHeight: 240, overflowY: "auto", marginTop: 10 }}>
                <Tabla encabezados={["Cuenta", "Producto", "Tipo", "Precio antes", "Precio a lanzar"]}>
                  {pendientesLanzarFilas.map((f) => (
                    <FilaTabla key={f.id}>
                      <CeldaTabla>{f.nicknameCuenta}</CeldaTabla>
                      <CeldaTabla>{f.tituloProducto ?? f.itemId}</CeldaTabla>
                      <CeldaTabla>{f.tipoPromocion}</CeldaTabla>
                      <CeldaTabla>{formatoPesos(numero(f.precioAntes))}</CeldaTabla>
                      <CeldaTabla>{formatoPesos(numero(f.precioDespues))}</CeldaTabla>
                    </FilaTabla>
                  ))}
                </Tabla>
              </div>
              <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 13, marginTop: 10 }}>
                Escribí <strong>{PALABRA_CONFIRMACION_LANZAR}</strong> para confirmar que revisaste la lista de arriba:
                <input
                  type="text"
                  className="zx-control"
                  style={{ maxWidth: 200 }}
                  value={textoConfirmacionLanzar}
                  onChange={(e) => setTextoConfirmacionLanzar(e.target.value)}
                  autoComplete="off"
                />
              </label>
              <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                <Boton type="button" variante="primario" chico disabled={textoConfirmacionLanzar.trim().toUpperCase() !== PALABRA_CONFIRMACION_LANZAR} onClick={lanzarAprobadas}>
                  Confirmar y lanzar
                </Boton>
                <Boton
                  type="button"
                  variante="secundario"
                  chico
                  onClick={() => {
                    setConfirmandoLanzar(false);
                    setTextoConfirmacionLanzar("");
                  }}
                >
                  Cancelar
                </Boton>
              </div>
            </Tarjeta>
          )}
          {resultadoEjecutarPendientes && <p style={{ fontSize: 13, marginTop: 8 }}>{resultadoEjecutarPendientes}</p>}
          {errorDecisionDirecta && <p style={{ color: "var(--kpi-peligro-texto)", fontSize: 13, marginTop: 8 }}>{errorDecisionDirecta}</p>}

          {cargandoCandidatos ? (
            <p style={{ fontSize: 13, color: "var(--text-faint)", marginTop: 12 }}>Cargando…</p>
          ) : debeMostrarResumenBusquedaVacia(trabajo, candidatos.length) ? (
            <div style={{ marginTop: 12 }}>
              <p style={{ fontSize: 13, color: "var(--text-muted)" }}>La búsqueda terminó sin ningún candidato. Resumen por cuenta:</p>
              <ul style={{ marginTop: 8, paddingLeft: 18 }}>
                {lineasResumenBusquedaVacia(trabajo as TrabajoBusquedaCliente).map((linea) => (
                  <li key={linea.cuentaId} style={{ fontSize: 13, marginTop: 4, color: linea.tieneError ? "var(--kpi-peligro-texto)" : "var(--text-muted)" }}>
                    {linea.texto}
                  </li>
                ))}
              </ul>
            </div>
          ) : candidatos.length === 0 ? (
            <p style={{ fontSize: 13, color: "var(--text-faint)", marginTop: 12 }}>Todavía no hay resultados — dale &quot;Buscar&quot; arriba.</p>
          ) : (
            <div style={{ marginTop: 12 }}>
              <Tabla
                encabezados={[
                  "",
                  "Cuenta",
                  "Producto",
                  "SKU",
                  "Precio hoy",
                  "Precio con promo",
                  "% desc.",
                  "Precio mínimo",
                  "Utilidad est.",
                  "Promoción",
                  puedeAprobar ? "Aprobar" : "",
                ]}
              >
                {candidatos.map((c) => {
                  const chip = chipEstado(c);
                  const chipMinimo = chipPrecioMinimoEnVivo(c);
                  const precioHoy = numero(c.precioOriginal);
                  const editable = puedeEditarPrecio(c) && puedeAprobar;
                  const rango = rangoEdicion(c);
                  const precioMostrado = editable ? precioEditado(c) : precioConPromo(c);
                  const descuentoMostrado = editable
                    ? precioHoy != null
                      ? descuentoDesdePrecio(precioHoy, precioEditado(c))
                      : null
                    : porcentajeDescuento(c);
                  // Punto 1 (rama fix-promociones-edicion) — ya NO se
                  // fuerza de vuelta al rango (ese forzado automático
                  // en cada tecla era el bug real); acá solo se avisa y
                  // se bloquea "Sí" hasta que se corrija a mano.
                  const fueraDeRangoFila = editable && fueraDeRango(c, precioEditado(c));
                  // Punto 2 — "sin margen" manda sobre "fuera de rango" en el
                  // tooltip: distinto motivo, mensaje distinto (ver calculosFila.ts).
                  const sinMargenFila = sinMargen(c);
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
                      <CeldaTabla>{precioHoy == null ? "ML no envió precio" : formatoPesos(precioHoy)}</CeldaTabla>
                      <CeldaTabla>
                        {editable ? (
                          <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                            <input
                              type="text"
                              inputMode="decimal"
                              className="zx-control"
                              style={{ width: 120 }}
                              value={borradores[c.id]?.precio ?? formatoEnteroEsCo(precioEditado(c))}
                              onChange={(e) => setBorradores((actual) => ({ ...actual, [c.id]: { ...actual[c.id], precio: e.target.value } }))}
                              onBlur={() => confirmarPrecioTexto(c)}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") {
                                  confirmarPrecioTexto(c);
                                  e.currentTarget.blur();
                                } else if (e.key === "Escape") {
                                  descartarBorrador(c.id, "precio");
                                  e.currentTarget.blur();
                                }
                              }}
                            />
                            {sinMargenFila ? (
                              <span style={{ fontSize: 11, color: "var(--kpi-peligro-texto)" }}>
                                Sin margen: el mínimo ({formatoPesos(numero(c.precioMinimo))}) no deja descuento.
                              </span>
                            ) : (
                              rango && (
                                <span style={{ fontSize: 11, color: fueraDeRangoFila ? "var(--kpi-peligro-texto)" : "var(--text-faint)" }}>
                                  {fueraDeRangoFila
                                    ? `Tiene que estar entre ${formatoPesos(rango.min)} y ${formatoPesos(rango.max)}.`
                                    : `mín ${formatoPesos(rango.min)} – máx ${formatoPesos(rango.max)}`}
                                </span>
                              )
                            )}
                          </div>
                        ) : (
                          <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                            {formatoPesos(precioMostrado)}
                            {sinMargenFila ? (
                              <span style={{ fontSize: 11, color: "var(--kpi-peligro-texto)" }}>
                                Sin margen: el mínimo ({formatoPesos(numero(c.precioMinimo))}) no deja descuento.
                              </span>
                            ) : (
                              c.soloEnMl && (
                                <span
                                  style={{ fontSize: 11, color: "var(--text-faint)" }}
                                  title={`El tipo "${c.tipoPromocion}" no se puede escribir por la API de Mercado Libre — precio fijo de ML.`}
                                >
                                  precio fijo de ML
                                </span>
                              )
                            )}
                          </div>
                        )}
                      </CeldaTabla>
                      <CeldaTabla>
                        {editable ? (
                          <input
                            type="text"
                            inputMode="decimal"
                            className="zx-control"
                            style={{ width: 70 }}
                            value={borradores[c.id]?.descuento ?? (descuentoMostrado != null ? formatoPorcentajeInput(descuentoMostrado) : "")}
                            disabled={precioHoy == null}
                            onChange={(e) => setBorradores((actual) => ({ ...actual, [c.id]: { ...actual[c.id], descuento: e.target.value } }))}
                            onBlur={() => confirmarDescuentoTexto(c)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") {
                                confirmarDescuentoTexto(c);
                                e.currentTarget.blur();
                              } else if (e.key === "Escape") {
                                descartarBorrador(c.id, "descuento");
                                e.currentTarget.blur();
                              }
                            }}
                          />
                        ) : (
                          formatoPorcentaje(descuentoMostrado)
                        )}
                      </CeldaTabla>
                      <CeldaTabla>{c.precioMinimo ? formatoPesos(numero(c.precioMinimo)) : <span style={{ color: "var(--kpi-peligro-texto)" }}>Falta precio mínimo</span>}</CeldaTabla>
                      <CeldaTabla>
                        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                          {formatoPesos(gananciaEnVivo(c))}
                          {chipMinimo && <Chip estado={chipMinimo.estado}>{chipMinimo.texto}</Chip>}
                        </div>
                      </CeldaTabla>
                      <CeldaTabla>
                        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                          <Chip estado={chip.estado} title={chip.title}>
                            {chip.texto}
                          </Chip>
                          <span style={{ fontSize: 11, color: "var(--text-faint)" }}>{c.tipoPromocion}</span>
                          {filtro === "rechazadas" && c.motivoRechazo && (
                            <span style={{ fontSize: 11, color: "var(--kpi-peligro-texto)" }}>{c.motivoRechazo}</span>
                          )}
                          {filtro === "aprobadas" && c.motivoFalla && (
                            <span style={{ fontSize: 11, color: "var(--kpi-peligro-texto)" }}>{c.motivoFalla}</span>
                          )}
                        </div>
                      </CeldaTabla>
                      {puedeAprobar && (
                        <CeldaTabla>
                          {filtro === "rechazadas" ? (
                            <Boton
                              type="button"
                              variante="secundario"
                              chico
                              disabled={decisionDirectaId === c.id}
                              onClick={() => enviarDecisionDirecta(c, "volver_a_pendiente")}
                            >
                              {decisionDirectaId === c.id ? "…" : "Volver a pendiente"}
                            </Boton>
                          ) : filtro === "aprobadas" ? (
                            // Bug real (rama fix-promociones-aprobadas-participando) —
                            // antes esta celda era un "—" fijo sin importar qué pasó;
                            // con Dueño/Gerente (permiso "ejecutar" por default) una
                            // fila aprobada casi siempre pasa a "ejecutada"/"fallida"
                            // casi de una, nunca se queda en "aceptada" — mostrar el
                            // estado real acá es la única forma de que no parezca que
                            // "se perdió".
                            <Chip estado={c.estadoDecision === "ejecutada" ? "exito" : c.estadoDecision === "fallida" ? "peligro" : "aviso"}>
                              {c.estadoDecision === "ejecutada" ? "Ejecutada en ML" : c.estadoDecision === "fallida" ? "Falló al ejecutar" : "Aprobada, por lanzar"}
                            </Chip>
                          ) : (
                            <div style={{ display: "flex", gap: 4 }}>
                              <Boton
                                type="button"
                                variante="primario"
                                chico
                                disabled={decisionDirectaId === c.id || fueraDeRangoFila || sinMargenFila}
                                title={
                                  sinMargenFila
                                    ? `Sin margen: el precio mínimo de Finanzas (${formatoPesos(numero(c.precioMinimo))}) no deja descuento.`
                                    : fueraDeRangoFila
                                      ? "El precio editado quedó fuera del rango permitido — corregilo para poder aprobar."
                                      : undefined
                                }
                                onClick={() => enviarDecisionDirecta(c, "aprobar")}
                              >
                                {decisionDirectaId === c.id ? "…" : "Sí"}
                              </Boton>
                              <Boton type="button" variante="secundario" chico disabled={decisionDirectaId === c.id} onClick={() => enviarDecisionDirecta(c, "rechazar")}>
                                {decisionDirectaId === c.id ? "…" : "No"}
                              </Boton>
                            </div>
                          )}
                        </CeldaTabla>
                      )}
                    </FilaTabla>
                  );
                })}
              </Tabla>
            </div>
          )}

          {vistaPrevia && (
            <Tarjeta className={styles.vistaPrevia}>
              <p className="zx-etiqueta">{vistaPrevia.tipo === "rechazar" ? "RECHAZAR" : "VISTA PREVIA"}</p>
              {vistaPrevia.tipo === "rechazar" ? (
                <p style={{ fontSize: 13, marginTop: 8 }}>
                  {vistaPrevia.cantidad} producto(s), en {vistaPrevia.cuentasAfectadas.length} cuenta(s) ({vistaPrevia.cuentasAfectadas.join(", ")}) se van a marcar como{" "}
                  <strong>rechazados</strong> — nunca se toca Mercado Libre.
                </p>
              ) : (
                <>
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
                </>
              )}
              <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                <Boton type="button" variante="primario" chico disabled={aplicando} onClick={confirmarVistaPrevia}>
                  {aplicando ? "Aplicando…" : vistaPrevia.tipo === "rechazar" ? "Confirmar rechazo" : "Confirmar"}
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

      {pestana === "participando" && (
        <Tarjeta className={styles.seccion}>
          <p className="zx-etiqueta">PARTICIPANDO</p>
          <p style={{ fontSize: 13, color: "var(--text-muted)", marginTop: 8 }}>
            Promociones donde la cuenta ya está activa en Mercado Libre. Depende de haber corrido &quot;Buscar&quot; al menos una vez para esa cuenta — una promoción nueva no aparece
            acá hasta la próxima búsqueda.
          </p>
          {cargandoParticipando ? (
            <p style={{ fontSize: 13, color: "var(--text-faint)", marginTop: 12 }}>Cargando…</p>
          ) : participando.length === 0 ? (
            <p style={{ fontSize: 13, color: "var(--text-faint)", marginTop: 12 }}>Ninguna cuenta tiene promociones activas en este momento (o todavía no se corrió &quot;Buscar&quot;).</p>
          ) : (
            <div style={{ marginTop: 12 }}>
              <Tabla encabezados={["Cuenta", "Producto", "SKU", "Tipo", "Precio con promo", "% desc.", "Desde", "Hasta", "Utilidad est.", "Piso", puedeEjecutar ? "Salir" : ""]}>
                {participando.map((f) => {
                  const key = `${f.cuentaMlId}:${f.itemId}:${f.tipoPromocion}`;
                  const descuento = f.precioOriginal != null && f.precioActual != null && f.precioOriginal > 0 ? ((f.precioOriginal - f.precioActual) / f.precioOriginal) * 100 : null;
                  const porDebajoDelPiso = f.precioMinimo != null && f.precioActual != null && f.precioActual < f.precioMinimo;
                  return (
                    <FilaTabla key={key}>
                      <CeldaTabla>{f.nicknameCuenta}</CeldaTabla>
                      <CeldaTabla>
                        {f.thumbnail && <img src={f.thumbnail} alt="" width={28} height={28} style={{ objectFit: "cover", borderRadius: 4, marginRight: 6, verticalAlign: "middle" }} />}
                        {f.tituloProducto ?? f.itemId}
                      </CeldaTabla>
                      <CeldaTabla>{f.skuCodigo ?? "—"}</CeldaTabla>
                      <CeldaTabla>{f.tipoPromocion}</CeldaTabla>
                      <CeldaTabla>{formatoPesos(f.precioActual)}</CeldaTabla>
                      <CeldaTabla>{formatoPorcentaje(descuento)}</CeldaTabla>
                      <CeldaTabla>{new Date(f.fechaInicio).toLocaleDateString("es-CO")}</CeldaTabla>
                      <CeldaTabla>{new Date(f.fechaFin).toLocaleDateString("es-CO")}</CeldaTabla>
                      <CeldaTabla>{formatoPesos(f.gananciaEstimada)}</CeldaTabla>
                      <CeldaTabla>
                        {f.precioMinimo == null ? (
                          <span style={{ color: "var(--kpi-peligro-texto)", fontSize: 12 }}>Falta precio mínimo</span>
                        ) : (
                          <Chip estado={porDebajoDelPiso ? "peligro" : "exito"}>{porDebajoDelPiso ? "Queda por debajo" : "Cumple"}</Chip>
                        )}
                      </CeldaTabla>
                      {puedeEjecutar && (
                        <CeldaTabla>
                          {f.puedeSalirApi ? (
                            <Boton type="button" variante="secundario" chico disabled={salidaEnCursoKey === key} onClick={() => dejarDeParticipar(f)}>
                              {salidaEnCursoKey === key ? "…" : "Dejar de participar"}
                            </Boton>
                          ) : (
                            <a
                              href="https://www.mercadolibre.com.co/promotions"
                              target="_blank"
                              rel="noopener noreferrer"
                              className="zx-etiqueta"
                              style={{ fontSize: 11 }}
                              title={`El tipo "${f.tipoPromocion}" no se puede dejar por la API de Mercado Libre — hacelo desde la Central de Promociones.`}
                            >
                              Solo desde ML ↗
                            </a>
                          )}
                        </CeldaTabla>
                      )}
                    </FilaTabla>
                  );
                })}
              </Tabla>
            </div>
          )}
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
                    <CeldaTabla>{formatoPesos(numero(h.precioAntes))}</CeldaTabla>
                    <CeldaTabla>{formatoPesos(numero(h.precioDespues))}</CeldaTabla>
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

      <Toast items={toasts} onCerrar={cerrarToast} />
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
