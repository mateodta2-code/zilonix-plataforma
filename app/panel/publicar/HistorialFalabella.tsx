"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Boton } from "@/components/marco/Boton";
import { Tarjeta } from "@/components/marco/Tarjeta";
import type { BorradorFalabella, EstadoPublicacionFalabella } from "@/lib/falabella/publicar-reglas";
import { aprobarFalabellaAction, atributosFalabellaAction, avanzarFalabellaAction, corregirFalabellaAction, descartarFalabellaAction } from "./falabella-actions";
import { camposAcorregir, traducirErrorFalabella } from "@/lib/falabella/errores";
import styles from "./publicar.module.css";

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
  borrador: "Borrador — falta tu aprobación",
  creando: "Falabella está creando el producto…",
  imagenes: "Subiendo imágenes…",
  publicado: "Publicado",
  rechazado: "Rechazado por Falabella",
};

const pesos = (n: number) => `$${n.toLocaleString("es-CO")}`;

const SEGUNDOS_ENTRE_CONSULTAS = 20;

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

export function HistorialFalabella({ publicaciones }: { publicaciones: PublicacionFalabella[] }) {
  const router = useRouter();
  const [pendiente, empezar] = useTransition();
  const [mensaje, setMensaje] = useState<string | null>(null);
  const enProceso = publicaciones.filter((p) => p.estado === "creando" || p.estado === "imagenes");

  // Mientras haya algo en proceso, se consulta a Falabella cada 20 s y se
  // refresca la lista. Se detiene solo cuando todo terminó.
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

  function aprobar(id: string) {
    setMensaje(null);
    empezar(async () => {
      const r = await aprobarFalabellaAction(id);
      if (!r.ok) setMensaje(r.error);
      router.refresh();
    });
  }

  function descartar(id: string) {
    if (!window.confirm("¿Descartar? Solo borra esta fila de Zilonix; no borra nada en Falabella.")) return;
    empezar(async () => {
      const r = await descartarFalabellaAction(id);
      if (!r.ok) setMensaje(r.error);
      router.refresh();
    });
  }

  return (
    <Tarjeta className={styles.seccion}>
      <div id="historial-falabella" />
      <p className="zx-etiqueta">Historial de Falabella</p>
      {mensaje && <p style={{ fontSize: 13, color: "var(--kpi-peligro-texto)", marginTop: 8 }}>{mensaje}</p>}
      {publicaciones.length === 0 ? (
        <p style={{ fontSize: 13, color: "var(--texto-suave)", marginTop: 8 }}>Todavía no hay publicaciones de Falabella.</p>
      ) : (
        publicaciones.map((p) => {
          const b = p.borrador;
          return (
            <div key={p.id} className={styles.recuadroMarca} style={{ marginTop: 10 }}>
              <p style={{ fontSize: 14, margin: 0 }}>
                <strong>{p.titulo}</strong> · {p.sku} · {p.cuenta}
              </p>
              <p style={{ fontSize: 13, margin: "4px 0" }}>{ETIQUETA[p.estado]}</p>

              {p.estado === "borrador" && (
                <ul style={{ fontSize: 12, color: "var(--texto-suave)", margin: "4px 0 8px", paddingLeft: 18 }}>
                  <li>
                    Marca {b.marca} · Modelo {b.atributos.Modelo} · EAN {b.ean || "—"} · IVA {b.iva}%
                  </li>
                  <li>
                    Precio normal {pesos(b.precioNormal)} · oferta {pesos(b.precioOferta)} ({b.ofertaDesde.slice(0, 10)} a {b.ofertaHasta.slice(0, 10)})
                  </li>
                  <li>
                    Stock {b.stock} en {b.bodega} · paquete {b.medidas.largo}×{b.medidas.ancho}×{b.medidas.alto} cm, {b.medidas.peso} kg
                  </li>
                  <li>
                    {b.imagenes.length} imagen(es), la primera es la portada · categoría {b.categoriaId}
                  </li>
                </ul>
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
                    if (e) setMensaje(e);
                    router.refresh();
                  }}
                />
              )}

              <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                {p.estado === "borrador" && (
                  <Boton type="button" variante="primario" chico disabled={pendiente || b.problemas.length > 0} onClick={() => aprobar(p.id)}>
                    Aprobar y crear en Falabella
                  </Boton>
                )}
                {p.estado !== "creando" && p.estado !== "imagenes" && (
                  <Boton type="button" variante="secundario" chico disabled={pendiente} onClick={() => descartar(p.id)}>
                    Descartar
                  </Boton>
                )}
              </div>
            </div>
          );
        })
      )}
    </Tarjeta>
  );
}
