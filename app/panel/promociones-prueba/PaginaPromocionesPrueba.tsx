"use client";

import { useRef, useState } from "react";
import { Boton } from "@/components/marco/Boton";
import { Campo } from "@/components/marco/Campo";
import { Chip, type EstadoChip } from "@/components/marco/Chip";
import { Tarjeta } from "@/components/marco/Tarjeta";
import { datosSitioMl, formatearMoneda, formatearNumero } from "@/lib/ml/sitios";
import {
  CUENTAS_EJEMPLO,
  PUBLICACIONES_EJEMPLO,
  TABLA_MAESTRA_PRECIOS_MINIMOS,
  type EstadoPublicacionPrueba,
  type PromocionDisponiblePrueba,
  type PublicacionPrueba,
} from "./datosEjemplo";
import styles from "./promociones-prueba.module.css";

type Regla = "todas" | "maximo" | "tabla-maestra";
type TipoAjuste = "porcentaje" | "valor";

const ETIQUETA_ESTADO: Record<EstadoPublicacionPrueba, { texto: string; estado: EstadoChip }> = {
  en_promocion_aplicada: { texto: "En promoción aplicada", estado: "exito" },
  sin_promocion: { texto: "Sin promoción", estado: "neutro" },
  error: { texto: "Error al participar", estado: "peligro" },
};

function cuentaDe(cuentaId: string) {
  return CUENTAS_EJEMPLO.find((c) => c.id === cuentaId) ?? CUENTAS_EJEMPLO[0];
}

// Placeholder de foto — sin ninguna URL externa (esto es una maqueta,
// nunca pide una imagen real a ningún lado).
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

export function PaginaPromocionesPrueba() {
  const [cuentaSeleccionada, setCuentaSeleccionada] = useState<string>("todas");
  const [regla, setRegla] = useState<Regla>("todas");
  const [maximoPorcentaje, setMaximoPorcentaje] = useState(15);

  const [expandidaId, setExpandidaId] = useState<string | null>(null);
  const [varianteMarcada, setVarianteMarcada] = useState<Record<string, boolean>>({});

  const [estados, setEstados] = useState<Record<string, EstadoPublicacionPrueba>>(() =>
    Object.fromEntries(PUBLICACIONES_EJEMPLO.map((p) => [p.id, p.estadoInicial]))
  );
  const [motivosError, setMotivosError] = useState<Record<string, string>>(() =>
    Object.fromEntries(PUBLICACIONES_EJEMPLO.filter((p) => p.motivoErrorInicial).map((p) => [p.id, p.motivoErrorInicial as string]))
  );

  const dialogRef = useRef<HTMLDialogElement>(null);
  const [seleccion, setSeleccion] = useState<{ publicacion: PublicacionPrueba; promocion: PromocionDisponiblePrueba } | null>(null);
  const [tipoAjuste, setTipoAjuste] = useState<TipoAjuste>("porcentaje");
  const [valorTexto, setValorTexto] = useState("");

  const publicacionesVisibles = cuentaSeleccionada === "todas" ? PUBLICACIONES_EJEMPLO : PUBLICACIONES_EJEMPLO.filter((p) => p.cuentaId === cuentaSeleccionada);

  function abrirModal(publicacion: PublicacionPrueba, promocion: PromocionDisponiblePrueba) {
    setSeleccion({ publicacion, promocion });
    setTipoAjuste("porcentaje");
    setValorTexto(String(promocion.descuentoVendedorSugeridoPorcentaje));
    dialogRef.current?.showModal();
  }

  function cerrarModal() {
    dialogRef.current?.close();
    setSeleccion(null);
  }

  function confirmarModal() {
    if (!seleccion) return;
    setEstados((actual) => ({ ...actual, [seleccion.publicacion.id]: "en_promocion_aplicada" }));
    setMotivosError((actual) => {
      const siguiente = { ...actual };
      delete siguiente[seleccion.publicacion.id];
      return siguiente;
    });
    cerrarModal();
  }

  // Cálculo en vivo del modal — "a cargo de Mercado Libre" nunca lo
  // edita el vendedor (mismo criterio que la pantalla real de ML): solo
  // el % o el valor "a tu cargo" es el campo editable.
  let calculoModal: { precioOriginal: number; descuentoVendedorValor: number; aporteMlValor: number; precioFinal: number; porcentajeVendedor: number; quedaBajoMinimo: boolean; minimo: number | null } | null = null;
  if (seleccion) {
    const { publicacion, promocion } = seleccion;
    const valorNumerico = Number(valorTexto.replace(",", ".")) || 0;
    const porcentajeVendedor = tipoAjuste === "porcentaje" ? valorNumerico : publicacion.precio > 0 ? (valorNumerico / publicacion.precio) * 100 : 0;
    const descuentoVendedorValor = tipoAjuste === "porcentaje" ? Math.round((publicacion.precio * valorNumerico) / 100) : Math.round(valorNumerico);
    const aporteMlValor = Math.round((publicacion.precio * promocion.aporteMlPorcentaje) / 100);
    const precioFinal = publicacion.precio - descuentoVendedorValor - aporteMlValor;
    const minimo = TABLA_MAESTRA_PRECIOS_MINIMOS[publicacion.sku] ?? null;
    calculoModal = {
      precioOriginal: publicacion.precio,
      descuentoVendedorValor,
      aporteMlValor,
      precioFinal,
      porcentajeVendedor,
      quedaBajoMinimo: minimo != null && precioFinal < minimo,
      minimo,
    };
  }

  return (
    <>
      <div className={styles.letrero}>Vista de prueba con datos de ejemplo — nada de esto toca Mercado Libre ni la base de datos.</div>

      <Tarjeta className={styles.seccion}>
        <Campo etiqueta="Tienda">
          <select className="zx-control" value={cuentaSeleccionada} onChange={(e) => setCuentaSeleccionada(e.target.value)}>
            <option value="todas">Todas las tiendas</option>
            {CUENTAS_EJEMPLO.map((c) => (
              <option key={c.id} value={c.id}>
                {c.nickname}
              </option>
            ))}
          </select>
        </Campo>
      </Tarjeta>

      <Tarjeta className={styles.seccion}>
        <p className="zx-etiqueta">Reglas de participación</p>
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
              min={0}
              max={100}
              value={maximoPorcentaje}
              disabled={regla !== "maximo"}
              onChange={(e) => setMaximoPorcentaje(Number(e.target.value))}
            />
            % de descuento a cargo del vendedor
          </label>
          <label className={styles.filaRegla}>
            <input type="radio" name="regla" checked={regla === "tabla-maestra"} onChange={() => setRegla("tabla-maestra")} />
            Respetar siempre la tabla maestra de SKU con precios mínimos
          </label>
        </div>
      </Tarjeta>

      <div className={styles.listaPublicaciones}>
        {publicacionesVisibles.map((publicacion) => {
          const cuenta = cuentaDe(publicacion.cuentaId);
          const estado = estados[publicacion.id];
          const etiquetaEstado = ETIQUETA_ESTADO[estado];
          const expandida = expandidaId === publicacion.id;
          return (
            <Tarjeta key={publicacion.id} className={styles.tarjetaPublicacion}>
              <button type="button" className={styles.filaResumen} onClick={() => setExpandidaId(expandida ? null : publicacion.id)} aria-expanded={expandida}>
                <FotoPlaceholder />
                <div className={styles.infoPublicacion}>
                  <span className={styles.titulo}>{publicacion.titulo}</span>
                  <span className={styles.subtitulo}>
                    {cuenta.nickname} · SKU {publicacion.sku} · {formatearMoneda(publicacion.precio, cuenta.siteId)} · Stock {formatearNumero(publicacion.stock, datosSitioMl(cuenta.siteId).idioma)}
                  </span>
                </div>
                <Chip estado={etiquetaEstado.estado} title={estado === "error" ? motivosError[publicacion.id] : undefined}>
                  {etiquetaEstado.texto}
                </Chip>
                <span className={styles.chevron} data-abierto={expandida}>
                  ⌄
                </span>
              </button>

              {estado === "error" && motivosError[publicacion.id] && <p className={styles.avisoError}>{motivosError[publicacion.id]}</p>}

              {expandida && (
                <div className={styles.detalle}>
                  {publicacion.promociones.map((promocion) => {
                    const descuentoValor = Math.round((publicacion.precio * promocion.descuentoVendedorSugeridoPorcentaje) / 100);
                    const aporteValor = Math.round((publicacion.precio * promocion.aporteMlPorcentaje) / 100);
                    const precioFinalSugerido = publicacion.precio - descuentoValor - aporteValor;
                    const superaMaximo = regla === "maximo" && promocion.descuentoVendedorSugeridoPorcentaje > maximoPorcentaje;
                    return (
                      <div key={promocion.id} className={styles.filaPromocion}>
                        <div className={styles.encabezadoPromocion}>
                          <span className={styles.nombrePromocion}>{promocion.nombre}</span>
                          {promocion.etiqueta && <Chip estado="neutro">{promocion.etiqueta}</Chip>}
                          {superaMaximo && <Chip estado="aviso">Supera el máximo configurado</Chip>}
                        </div>
                        <div className={styles.datosPromocion}>
                          <span>Vigencia: {promocion.vigenciaTexto}</span>
                          <span>Descuento a tu cargo: {formatearMoneda(descuentoValor, cuenta.siteId)}</span>
                          <span>Aporte de la plataforma: {formatearMoneda(aporteValor, cuenta.siteId)}</span>
                          <span>Precio final sugerido: {formatearMoneda(precioFinalSugerido, cuenta.siteId)}</span>
                        </div>
                        <Boton type="button" variante="primario" chico onClick={() => abrirModal(publicacion, promocion)}>
                          Participar
                        </Boton>
                      </div>
                    );
                  })}

                  {publicacion.variantes && (
                    <div className={styles.variantes}>
                      <p className="zx-etiqueta">Variantes</p>
                      {publicacion.variantes.map((variante) => (
                        <label key={variante.id} className={styles.filaVariante}>
                          <input
                            type="checkbox"
                            checked={!!varianteMarcada[variante.id]}
                            onChange={(e) => setVarianteMarcada((actual) => ({ ...actual, [variante.id]: e.target.checked }))}
                          />
                          {variante.nombre} — SKU {variante.sku} — {formatearMoneda(variante.precio, cuenta.siteId)} — Stock {formatearNumero(variante.stock, datosSitioMl(cuenta.siteId).idioma)}
                        </label>
                      ))}
                      <p className={styles.avisoVariantes}>El comportamiento real con variantes se confirmará contra la API de Mercado Libre — acá es solo una maqueta.</p>
                    </div>
                  )}
                </div>
              )}
            </Tarjeta>
          );
        })}
      </div>

      <dialog ref={dialogRef} className={styles.dialogo} onClick={(e) => e.target === e.currentTarget && cerrarModal()}>
        {seleccion && calculoModal && (
          <div className={styles.panelModal}>
            <p className={styles.tituloModal}>Confirma los detalles de la promoción</p>
            <p className={styles.resumenProducto}>
              {seleccion.publicacion.titulo} — SKU {seleccion.publicacion.sku}
            </p>
            <p className={styles.filaDato}>
              <span>Promoción</span>
              <span>{seleccion.promocion.nombre}</span>
            </p>
            <p className={styles.filaDato}>
              <span>Vigencia</span>
              <span>{seleccion.promocion.vigenciaTexto}</span>
            </p>
            <p className={styles.filaDato}>
              <span>Precio original</span>
              <span>{formatearMoneda(calculoModal.precioOriginal, cuentaDe(seleccion.publicacion.cuentaId).siteId)}</span>
            </p>

            <div className={styles.bloqueAjuste}>
              <div className={styles.tipoAjuste}>
                <label>
                  <input type="radio" name="tipoAjuste" checked={tipoAjuste === "porcentaje"} onChange={() => setTipoAjuste("porcentaje")} />
                  Porcentaje
                </label>
                <label>
                  <input type="radio" name="tipoAjuste" checked={tipoAjuste === "valor"} onChange={() => setTipoAjuste("valor")} />
                  Valor
                </label>
              </div>
              <div className={styles.filaValor}>
                <input type="text" inputMode="decimal" className="zx-control" style={{ width: 120 }} value={valorTexto} onChange={(e) => setValorTexto(e.target.value)} />
                <span className={styles.unidad}>{tipoAjuste === "porcentaje" ? "%" : "a tu cargo"}</span>
                <button
                  type="button"
                  className={styles.linkSugerido}
                  onClick={() => {
                    setTipoAjuste("porcentaje");
                    setValorTexto(String(seleccion.promocion.descuentoVendedorSugeridoPorcentaje));
                  }}
                >
                  Sugerido: {seleccion.promocion.descuentoVendedorSugeridoPorcentaje}%. Aplicar
                </button>
              </div>
            </div>

            <p className={styles.filaDato}>
              <span>Descuento a tu cargo</span>
              <span>
                {formatearMoneda(calculoModal.descuentoVendedorValor, cuentaDe(seleccion.publicacion.cuentaId).siteId)} ({formatearNumero(Math.round(calculoModal.porcentajeVendedor * 10) / 10, datosSitioMl(cuentaDe(seleccion.publicacion.cuentaId).siteId).idioma)}%)
              </span>
            </p>
            <p className={styles.filaDato}>
              <span>Aporte de la plataforma</span>
              <span className={styles.aporteMl}>{formatearMoneda(calculoModal.aporteMlValor, cuentaDe(seleccion.publicacion.cuentaId).siteId)}</span>
            </p>
            <p className={styles.filaDatoFinal}>
              <span>Precio final</span>
              <span>{formatearMoneda(calculoModal.precioFinal, cuentaDe(seleccion.publicacion.cuentaId).siteId)}</span>
            </p>
            {calculoModal.quedaBajoMinimo && (
              <p className={styles.avisoMinimo}>
                Este precio queda bajo el mínimo de la tabla maestra ({formatearMoneda(calculoModal.minimo as number, cuentaDe(seleccion.publicacion.cuentaId).siteId)}).
              </p>
            )}

            <div className={styles.accionesModal}>
              <Boton type="button" variante="primario" chico onClick={confirmarModal}>
                Confirmar
              </Boton>
              <Boton type="button" variante="secundario" chico onClick={cerrarModal}>
                Cancelar
              </Boton>
            </div>
          </div>
        )}
      </dialog>
    </>
  );
}
