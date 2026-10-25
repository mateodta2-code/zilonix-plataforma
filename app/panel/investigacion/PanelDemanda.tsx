"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Chip } from "@/components/marco/Chip";
import { Boton } from "@/components/marco/Boton";
import { CeldaTabla, FilaTabla, Tabla } from "@/components/marco/Tabla";
import { InsigniaExtension } from "@/components/marco/InsigniaExtension";
import { TarjetaKpi } from "@/components/marco/TarjetaKpi";
import { aplicarVendidosExtension, combinarKpisConCompletados, ordenarPorVendidos, type KpisDemanda } from "@/lib/ml/investigacionCliente";
import type { PublicacionInvestigacion } from "@/lib/ml/investigacion";
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

export function PanelDemanda({
  publicacionesIniciales,
  kpisBase,
  publicacionesEncontradas,
}: {
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

  // Issue #197/#210 — mismo atributo que lee InsigniaExtension, puesto
  // por extension/marcador-zilonix.js SOLO cuando corre sobre esta app.
  useEffect(() => {
    setConExtension(document.documentElement.hasAttribute("data-zilonix-extension"));
  }, []);

  // Issue #210 — puente extensión → panel. El mensaje real llega por
  // extension/marcador-zilonix.js (window.postMessage con origin =
  // esta misma página) — nunca se confía en un mensaje de otro origin
  // ni de otra window, y nunca se completa una fila que ya tenía
  // vendidos real de la API (aplicarVendidosExtension lo revisa).
  useEffect(() => {
    function alRecibirMensaje(evento: MessageEvent) {
      if (evento.origin !== window.location.origin || evento.source !== window) return;
      const datos = evento.data as { fuente?: string; tipo?: string; payload?: unknown } | null;
      if (!datos || datos.fuente !== "zilonix-extension" || datos.tipo !== "vendidos-completados") return;
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
    }

    window.addEventListener("message", alRecibirMensaje);
    return () => window.removeEventListener("message", alRecibirMensaje);
  }, []);

  const publicacionesOrdenadas = useMemo(() => ordenarPorVendidos(estado.publicaciones), [estado.publicaciones]);
  const kpis = useMemo(() => combinarKpisConCompletados(kpisBase, estado.completadasPorExtension), [kpisBase, estado.completadasPorExtension]);

  const candidatosPendientes = useMemo(() => estado.publicaciones.filter((p) => p.vendidos == null && p.link), [estado.publicaciones]);

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
          Con la extensión podés abrir cada candidato en Mercado Libre para ver datos reales actualizados al momento, y analizar Amazon, Temu y
          otras plataformas.
        </span>
      </div>

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
    </>
  );
}
