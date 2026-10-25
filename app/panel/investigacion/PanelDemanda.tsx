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

// Issue #213 — "Importar listado": payload que manda extension/content.js
// (botón "Enviar a Zilonix" en una página de búsqueda/listado de
// cualquiera de los 6 sitios), reenviado por extension/background.js
// y extension/marcador-zilonix.js. Nunca se confía en la forma del
// mensaje sin revisarla acá — mismo criterio que esMensajeVendidosValido.
type MensajeListadoExtension = {
  plataforma: string;
  url: string;
  productos: { titulo: string; precio: number; vendidos: number | null; link: string | null }[];
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
        if (!productos.length) return; // mensaje vacío — nada que ofrecer importar
        setListado((actual) => ({ ...actual, pendiente: { plataforma: payload.plataforma, productos } }));
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
          otras plataformas — desde una página de búsqueda/listado, el botón &quot;Enviar a Zilonix&quot; del panel flotante importa esos
          candidatos acá abajo.
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

      {listado.importado.length > 0 ? (
        <div>
          <p className={styles.tituloSeccion}>
            Listados importados de la extensión ({listado.importado.length}) — Amazon/Temu/AliExpress/Shein/Alibaba y otros listados de Mercado
            Libre leídos a mano; cobertura solo extensión, nunca mezclado con los datos reales de la API de Mercado Libre de arriba.
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
