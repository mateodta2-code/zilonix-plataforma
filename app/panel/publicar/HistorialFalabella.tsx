"use client";

import { Fragment, useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Boton } from "@/components/marco/Boton";
import { Chip } from "@/components/marco/Chip";
import { CeldaTabla, FilaTabla } from "@/components/marco/Tabla";
import type { BorradorFalabella, EstadoPublicacionFalabella } from "@/lib/falabella/publicar-reglas";
import { aprobarFalabellaAction, atributosFalabellaAction, avanzarFalabellaAction, corregirFalabellaAction, descartarFalabellaAction, estadoRealFalabellaAction } from "./falabella-actions";
import { camposAcorregir, traducirErrorFalabella } from "@/lib/falabella/errores";
import type { ProductoFalabella } from "@/lib/falabella/producto";
import { formatearFechaBogota } from "./formulario-logica";
import { formatearMonedaIso } from "@/lib/ml/sitios";

export type PublicacionFalabella = {
  id: string;
  cuenta: string;
  cuentaId: string;
  sku: string;
  titulo: string;
  estado: EstadoPublicacionFalabella;
  borrador: BorradorFalabella;
  errores: string[];
  creadoTs: string;
};

const ETIQUETA: Record<EstadoPublicacionFalabella, string> = {
  borrador: "Borrador",
  creando: "Creando…",
  imagenes: "Subiendo imágenes…",
  publicado: "Publicado",
  rechazado: "Rechazado",
};

const pesos = (n: number) => formatearMonedaIso(n, "COP");

const SEGUNDOS_ENTRE_CONSULTAS = 20;
// Cuántas filas publicadas se consultan solas al abrir la página para tener su link.
const MAX_LINKS_AUTOMATICOS = 5;

export type RealFalabella = ProductoFalabella | "no_encontrado" | "error" | "cargando";

// Rechazo por campos faltantes o inválidos: se muestran esos mismos campos
// (con la lista de opciones cuando la categoría la define) para llenarlos y
// volver a borrador. Así no depende de haber adivinado bien al crear.
function CorregirRechazo({ p, onListo }: { p: PublicacionFalabella; onListo: (error?: string) => void }) {
  const campos = camposAcorregir(p.errores);
  const [opciones, setOpciones] = useState<Record<string, string[]>>({});
  const [valores, setValores] = useState<Record<string, string>>({});
  const [guardando, setGuardando] = useState(false);
  useEffect(() => {
    if (campos.length === 0) return;
    atributosFalabellaAction(p.cuentaId, p.borrador.categoriaId).then((r) => {
      if (r.ok) setOpciones(Object.fromEntries(r.datos.map((a) => [a.nombre, a.opciones])));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- una vez por fila
  }, [p.id]);
  const sobran = p.errores.some((e) => /is\/are not applicable/i.test(e));
  if (campos.length === 0 && !sobran) return null;
  async function guardar() {
    setGuardando(true);
    const r = await corregirFalabellaAction(p.id, valores);
    setGuardando(false);
    onListo(r.ok ? undefined : r.error);
  }
  return (
    <div style={{ marginTop: 8 }}>
      <p style={{ fontSize: 13, margin: "4px 0" }}>{campos.length > 0 ? "Llena lo que Falabella pidió y vuelve a enviarlo:" : "Falabella no acepta un atributo en esta categoría; se quita al guardar."}</p>
      {campos.map((c) => (
        <label key={c} style={{ display: "block", fontSize: 13, marginTop: 6 }}>
          {c}
          {(opciones[c] ?? []).length > 0 ? (
            <select className="zx-control" value={valores[c] ?? ""} onChange={(e) => setValores((v) => ({ ...v, [c]: e.target.value }))}>
              <option value="">Elegir…</option>
              {opciones[c].map((o) => (
                <option key={o} value={o}>
                  {o}
                </option>
              ))}
            </select>
          ) : (
            <input className="zx-control" value={valores[c] ?? ""} onChange={(e) => setValores((v) => ({ ...v, [c]: e.target.value }))} />
          )}
        </label>
      ))}
      <div style={{ marginTop: 8 }}>
        <Boton type="button" variante="primario" chico disabled={guardando} onClick={guardar}>
          Guardar y volver a borrador
        </Boton>
      </div>
    </div>
  );
}


// Estado compartido de las filas de Falabella dentro del historial único:
// seguimiento del feed mientras hay algo en proceso, aprobar, descartar y el
// estado real (link, revisión) traído de Falabella.
export function useHistorialFalabella(publicaciones: PublicacionFalabella[]) {
  const router = useRouter();
  const [pendiente, empezar] = useTransition();
  const [mensaje, setMensaje] = useState<string | null>(null);
  const [real, setReal] = useState<Record<string, RealFalabella>>({});
  const enProceso = publicaciones.filter((p) => p.estado === "creando" || p.estado === "imagenes");

  useEffect(() => {
    if (enProceso.length === 0) return;
    const ids = enProceso.map((p) => p.id);
    const t = setInterval(async () => {
      await Promise.all(ids.map((id) => avanzarFalabellaAction(id)));
      router.refresh();
    }, SEGUNDOS_ENTRE_CONSULTAS * 1000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- depende solo de qué ids están en proceso
  }, [enProceso.map((p) => p.id).join(",")]);

  async function cargarReal(id: string) {
    setReal((r) => ({ ...r, [id]: "cargando" }));
    const r = await estadoRealFalabellaAction(id);
    setReal((x) => ({ ...x, [id]: r.ok ? (r.datos ?? "no_encontrado") : "error" }));
  }

  // Los publicados más recientes traen su link solos (pocas llamadas de solo lectura).
  useEffect(() => {
    publicaciones
      .filter((p) => p.estado === "publicado")
      .slice(0, MAX_LINKS_AUTOMATICOS)
      .forEach((p) => {
        if (!real[p.id]) void cargarReal(p.id);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- una vez por conjunto de publicados
  }, [publicaciones.filter((p) => p.estado === "publicado").map((p) => p.id).join(",")]);

  function aprobar(id: string) {
    setMensaje(null);
    empezar(async () => {
      const r = await aprobarFalabellaAction(id);
      if (!r.ok) setMensaje(r.error);
      router.refresh();
    });
  }

  function descartar(p: PublicacionFalabella) {
    if (!window.confirm(`¿Borrar "${p.titulo}" del historial? No borra nada en Falabella, solo esta fila local.`)) return;
    empezar(async () => {
      const r = await descartarFalabellaAction(p.id);
      if (!r.ok) setMensaje(r.error);
      router.refresh();
    });
  }

  return { mensaje, setMensaje, pendiente, real, cargarReal, aprobar, descartar, refrescar: () => router.refresh() };
}

export type EstadoHistorialFalabella = ReturnType<typeof useHistorialFalabella>;

function chipEstado(estado: EstadoPublicacionFalabella) {
  if (estado === "publicado") return <Chip estado="exito">✅ {ETIQUETA[estado]}</Chip>;
  if (estado === "rechazado") return <Chip estado="peligro">❌ {ETIQUETA[estado]}</Chip>;
  return <Chip estado="aviso">{ETIQUETA[estado]}</Chip>;
}

const ETIQUETA_QC: Record<string, string> = { approved: "aprobada", pending: "en revisión", rejected: "rechazada" };

// Una publicación de Falabella como fila de la MISMA tabla del historial de
// Mercado Libre (Título, Precio, Estado, ver detalle, Fecha, Acciones).
export function FilaFalabella({ p, h, expandido, onToggle, columnas }: { p: PublicacionFalabella; h: EstadoHistorialFalabella; expandido: boolean; onToggle: () => void; columnas: number }) {
  const b = p.borrador;
  const r = h.real[p.id];
  const datos = r && typeof r === "object" ? r : null;
  const enProceso = p.estado === "creando" || p.estado === "imagenes";

  // Al abrir el detalle de algo ya creado, se trae su estado real.
  useEffect(() => {
    if (expandido && (p.estado === "publicado" || p.estado === "imagenes") && !h.real[p.id]) void h.cargarReal(p.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- solo al abrir
  }, [expandido]);

  return (
    <Fragment>
      <FilaTabla>
        <CeldaTabla>
          {datos?.url ? (
            <a href={datos.url} target="_blank" rel="noreferrer">
              {p.titulo}
            </a>
          ) : (
            p.titulo
          )}{" "}
          <Chip>Falabella</Chip>
          <div style={{ fontSize: 12, opacity: 0.7, marginTop: 2 }}>
            {p.sku} · {p.cuenta}
          </div>
        </CeldaTabla>
        <CeldaTabla>
          {pesos(b.precioOferta)}
          <div style={{ fontSize: 12, opacity: 0.7 }}>normal {pesos(b.precioNormal)}</div>
        </CeldaTabla>
        <CeldaTabla>{chipEstado(p.estado)}</CeldaTabla>
        <CeldaTabla>
          <button
            type="button"
            onClick={onToggle}
            aria-expanded={expandido}
            style={{ background: "none", border: "none", padding: 0, color: "inherit", textDecoration: "underline", cursor: "pointer", font: "inherit" }}
          >
            {expandido ? "ocultar" : "ver detalle"}
          </button>
        </CeldaTabla>
        <CeldaTabla>{formatearFechaBogota(p.creadoTs)}</CeldaTabla>
        <CeldaTabla>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {p.estado === "borrador" && (
              <Boton type="button" variante="primario" disabled={h.pendiente || b.problemas.length > 0} onClick={() => h.aprobar(p.id)}>
                Aprobar y crear en Falabella
              </Boton>
            )}
            {datos?.url && (
              <a href={datos.url} target="_blank" rel="noreferrer">
                Ver publicación ↗
              </a>
            )}
            {!enProceso && (
              <Boton type="button" variante="fantasma" aria-label="Borrar" disabled={h.pendiente} onClick={() => h.descartar(p)}>
                🗑
              </Boton>
            )}
          </div>
        </CeldaTabla>
      </FilaTabla>
      {expandido && (
        <FilaTabla>
          <CeldaTabla colSpan={columnas}>
            <ul style={{ fontSize: 13, margin: "0 0 8px", paddingLeft: 18 }}>
              <li>
                Marca {b.marca}
                {b.atributos.Modelo ? ` · Modelo ${b.atributos.Modelo}` : ""} · EAN {b.ean || "—"} · IVA {b.iva}%
              </li>
              <li>
                Oferta {pesos(b.precioOferta)} ({b.ofertaDesde.slice(0, 10)} a {b.ofertaHasta.slice(0, 10)}) · precio normal {pesos(b.precioNormal)}
              </li>
              <li>
                Stock {b.stock} en {b.bodega} · paquete {b.medidas.largo}×{b.medidas.ancho}×{b.medidas.alto} cm, {b.medidas.peso} kg
              </li>
              <li>
                {b.imagenes.length} imagen(es), la primera es la portada · categoría {b.categoriaId}
              </li>
            </ul>
            {(p.estado === "publicado" || p.estado === "imagenes") && (
              <div style={{ fontSize: 13, margin: "4px 0 8px" }}>
                <strong>Estado real en Falabella: </strong>
                {r === "cargando" || !r ? (
                  "consultando…"
                ) : r === "error" ? (
                  "no se pudo consultar ahora."
                ) : r === "no_encontrado" ? (
                  "Falabella todavía no lo muestra (puede tardar unos minutos en aparecer)."
                ) : (
                  <>
                    {datos?.estadoVenta ?? "—"} · {datos?.publicado === null ? "visibilidad sin dato" : datos?.publicado ? "visible al público" : "aún no visible"} · revisión de calidad:{" "}
                    {ETIQUETA_QC[datos?.qcStatus ?? ""] ?? datos?.qcStatus ?? "sin dato"}
                    {datos?.stock != null && <> · stock {datos.stock}</>}
                    {datos?.precio != null && <> · precio {pesos(datos.precio)}</>}
                    {datos?.precioOferta ? <> · oferta {pesos(datos.precioOferta)}</> : null}{" "}
                    {datos?.url && (
                      <a href={datos.url} target="_blank" rel="noreferrer">
                        Ver publicación ↗
                      </a>
                    )}
                  </>
                )}{" "}
                <button type="button" className="zx-enlace" onClick={() => void h.cargarReal(p.id)}>
                  actualizar
                </button>
              </div>
            )}
            {b.avisos.map((a) => (
              <p key={a} style={{ fontSize: 12, margin: "2px 0" }}>
                Aviso: {a}
              </p>
            ))}
            {p.estado === "borrador" &&
              b.problemas.map((m) => (
                <p key={m} style={{ fontSize: 12, margin: "2px 0", color: "var(--kpi-peligro-texto)" }}>
                  Corregir: {m}
                </p>
              ))}
            {p.errores.map((m) => (
              <p key={m} style={{ fontSize: 12, margin: "2px 0", color: "var(--kpi-peligro-texto)" }}>
                {traducirErrorFalabella(m)}
              </p>
            ))}
            {p.estado === "rechazado" && (
              <CorregirRechazo
                p={p}
                onListo={(e) => {
                  if (e) h.setMensaje(e);
                  h.refrescar();
                }}
              />
            )}
          </CeldaTabla>
        </FilaTabla>
      )}
    </Fragment>
  );
}
