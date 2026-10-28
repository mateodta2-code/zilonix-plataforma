"use client";

import Link from "next/link";
import { Boton } from "@/components/marco/Boton";
import { CeldaTabla, FilaTabla, Tabla } from "@/components/marco/Tabla";
import { Tarjeta } from "@/components/marco/Tarjeta";
import { Chip } from "@/components/marco/Chip";
import { EstadoVacio } from "@/components/marco/EstadoVacio";
import { borrarProductoAction } from "./actions";
import { formatearFechaBogota, resumenEstadoProducto, type FilaProductoParaCargar } from "./formulario-logica";

export type ProductoHistorial = FilaProductoParaCargar & {
  id: string;
  titulo: string | null;
  estado: string;
  creadoTs: string;
};

const ETIQUETA_ESTADO: Record<string, string> = {
  borrador: "Borrador",
  publicando: "Publicando…",
  publicado: "Publicado",
  con_errores: "Con errores",
};

function EstadoCelda({ producto }: { producto: ProductoHistorial }) {
  const resumen = resumenEstadoProducto(producto.resultado);
  if (!resumen) return <Chip>{ETIQUETA_ESTADO[producto.estado] ?? producto.estado}</Chip>;
  const estadoChip = resumen.icono === "✅" ? "exito" : resumen.icono === "❌" ? "peligro" : "aviso";
  return (
    <Chip estado={estadoChip}>
      {resumen.icono} {resumen.ok}/{resumen.total}
    </Chip>
  );
}

// Punto 8 del pedido — "Productos publicados recientemente en la
// misma página" con Título/Precio/Estado/"ver detalle"/Fecha y los 3
// botones (Cargar/Reintentar, Duplicar, Borrar). "ver detalle" enlaza
// a /panel/publicar/[id] (sin cambios de esa pantalla — "lo que sea
// más simple sin romper enlaces", mismo criterio que pidió Mateo para
// esa ruta) en vez de duplicar el render del resultado por cuenta acá
// mismo. Borrar pide confirmación real (nunca silenciosa) y aclara
// "no borra nada en Mercado Libre" — el mensaje exacto que pidió
// Mateo, para que nadie piense que también pausa/elimina la
// publicación real.
export function HistorialPublicaciones({
  productos,
  onCargar,
  onDuplicar,
}: {
  productos: ProductoHistorial[];
  onCargar: (producto: ProductoHistorial) => void;
  onDuplicar: (producto: ProductoHistorial) => void;
}) {
  return (
    <Tarjeta>
      <div id="historial">
        <p className="zx-etiqueta">Historial</p>
        <h2 style={{ fontSize: 18, fontWeight: 700, marginTop: 4 }}>Productos publicados recientemente</h2>
        {productos.length === 0 ? (
          <EstadoVacio>Todavía no se publicó ningún producto.</EstadoVacio>
        ) : (
          <Tabla encabezados={["Título", "Precio", "Estado", "", "Fecha", "Acciones"]}>
            {productos.map((p) => (
              <FilaTabla key={p.id}>
                <CeldaTabla>{p.titulo || "(sin título)"}</CeldaTabla>
                <CeldaTabla>${Number(p.precio).toLocaleString("es-CO")}</CeldaTabla>
                <CeldaTabla>
                  <EstadoCelda producto={p} />
                </CeldaTabla>
                <CeldaTabla>
                  <Link href={`/panel/publicar/${p.id}`}>ver detalle</Link>
                </CeldaTabla>
                <CeldaTabla>{formatearFechaBogota(p.creadoTs)}</CeldaTabla>
                <CeldaTabla>
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                    <Boton type="button" variante="secundario" chico onClick={() => onCargar(p)}>
                      Cargar / Reintentar
                    </Boton>
                    <Boton type="button" variante="secundario" chico onClick={() => onDuplicar(p)}>
                      Duplicar
                    </Boton>
                    <form
                      action={borrarProductoAction}
                      onSubmit={(e) => {
                        // Confirmación real (nunca silenciosa) — el
                        // mensaje exacto que pidió Mateo, para que
                        // nadie confunda esto con borrar la
                        // publicación real en Mercado Libre.
                        if (!window.confirm(`¿Borrar "${p.titulo || "(sin título)"}" del historial? No borra nada en Mercado Libre, solo esta fila local.`)) {
                          e.preventDefault();
                        }
                      }}
                    >
                      <input type="hidden" name="id" value={p.id} />
                      <Boton type="submit" variante="fantasma" chico aria-label="Borrar">
                        🗑
                      </Boton>
                    </form>
                  </div>
                </CeldaTabla>
              </FilaTabla>
            ))}
          </Tabla>
        )}
      </div>
    </Tarjeta>
  );
}
