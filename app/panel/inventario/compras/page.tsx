import Link from "next/link";
import { requierePermiso, SinPermisoError } from "@/lib/permisos";
import { obtenerContextoPanel } from "@/lib/panel-contexto";
import { tienePermiso } from "@/lib/roles";
import { normalizarParametro } from "@/lib/filtros-listado";
import { listarBodegas } from "@/lib/inventario/bodegas";
import { listarRegistroCompras, sugerenciasFormaPago } from "@/lib/inventario/compras";
import { diasEntre, diasQueFaltan, fechaCorta, hoyBogota } from "@/lib/inventario/registro-compras";
import { listarSkusConStock } from "@/lib/inventario/stock";
import { listarTerceros } from "@/lib/terceros";
import { mostrarMonto } from "@/lib/finanzas/montos";
import { registrarCompraAction } from "./actions";
import { Boton, BotonLink } from "@/components/marco/Boton";
import { Chip } from "@/components/marco/Chip";
import { ESTADO_OC } from "@/components/inventario/estados";
import { EncabezadoPagina } from "@/components/marco/EncabezadoPagina";
import { EstadoVacio } from "@/components/marco/EstadoVacio";
import { SinAcceso } from "@/components/marco/SinAcceso";
import { CeldaTabla, FilaTabla, Tabla } from "@/components/marco/Tabla";
import { Tarjeta } from "@/components/marco/Tarjeta";
import { AvisosUrl } from "@/components/inventario/Avisos";
import { FormularioCompra } from "@/components/inventario/FormularioCompra";
import { SkuCopiable } from "@/components/marco/SkuCopiable";
import styles from "../inventario.module.css";

// Registro de compras (27-nov) — la hoja «PRODUCTOS COMPRADOS» del Zilonix
// OS: una fila por producto comprado, con fecha, cantidad, total, forma de
// pago, plataforma, SKU, liquidado, orden y link de la plataforma, y las
// fechas de entrega. Ver pide inventario.consultar; agregar,
// inventario.crear (también en la acción). La compra sola no mueve stock:
// lo mueve la recepción, desde el detalle de la OC.
const ENCABEZADOS = [
  "OC",
  "Fecha",
  "Nombre producto",
  "Cantidad",
  "Total",
  "Valor unidad",
  "Forma pago",
  "Plataforma",
  "SKU",
  "Liquidado",
  "Orden de compra",
  "Link",
  "Fecha de entrega",
  "Días en llegar",
  "Entrega estimada",
  "Días que faltan",
];

function textoDias(dias: number | null): string {
  if (dias === null) return "—";
  return `${dias} ${Math.abs(dias) === 1 ? "día" : "días"}`;
}

export default async function ComprasPage({ searchParams }: { searchParams: Record<string, string | string[] | undefined> }) {
  const { usuario, activa, permisos, rolNombre } = await obtenerContextoPanel();
  try {
    await requierePermiso(usuario.id, activa.id, "inventario", "consultar");
  } catch (error) {
    if (!(error instanceof SinPermisoError)) throw error;
    return <SinAcceso mensaje={`Tu rol (${rolNombre}) no tiene acceso a esta pantalla.`} />;
  }
  const puedeCrear = tienePermiso(permisos, "inventario", "crear");
  // Los proveedores y las cuentas de Disponible son de finanzas: sin ese
  // permiso, la compra se registra sin proveedor y la forma de pago solo
  // sugiere las que ya se usaron.
  const veFinanzas = tienePermiso(permisos, "finanzas", "consultar");
  const buscar = (normalizarParametro(searchParams.buscar) ?? "").trim().slice(0, 120);
  const [filas, lista, skusSimples, proveedores, formasPago] = await Promise.all([
    listarRegistroCompras(activa.id, buscar),
    puedeCrear ? listarBodegas(activa.id, { soloActivas: true }) : Promise.resolve([]),
    puedeCrear ? listarSkusConStock(activa.id) : Promise.resolve([]),
    puedeCrear && veFinanzas ? listarTerceros(activa.id) : Promise.resolve([]),
    puedeCrear ? sugerenciasFormaPago(activa.id, veFinanzas) : Promise.resolve([]),
  ]);
  const hoy = hoyBogota(new Date());

  return (
    <>
      <EncabezadoPagina
        titulo="Registro de compras"
        descripcion="Cada producto que compras, con su plataforma, pago y entrega. Al recibirlo en su orden (OC), el stock sube y el kardex dice de qué OC vino."
      />
      <AvisosUrl searchParams={searchParams} />

      {puedeCrear && lista.length > 0 && (
        <Tarjeta>
          <details open={filas.length === 0 && !buscar}>
            <summary className={styles.tituloSeccion} style={{ cursor: "pointer" }}>
              + Agregar compra
            </summary>
            <div style={{ marginTop: 12 }}>
              <FormularioCompra
                accion={registrarCompraAction}
                skus={skusSimples.map((s) => ({ id: s.id, codigo: s.codigo, nombre: s.nombre }))}
                bodegas={lista.map((b) => ({ id: b.id, nombre: b.nombre, esPrincipal: b.esPrincipal }))}
                proveedores={proveedores.map((p) => ({ id: p.id, nombre: p.nombre }))}
                formasPago={formasPago}
                hoy={hoy}
              />
            </div>
          </details>
        </Tarjeta>
      )}
      {puedeCrear && lista.length === 0 && <EstadoVacio>Primero crea una bodega activa en Inventario: ahí llega lo que compras.</EstadoVacio>}

      <form method="get" className={styles.filtros}>
        <label className={styles.campoBusqueda} style={{ flex: "1 1 320px" }}>
          <span className="zx-etiqueta">Buscar</span>
          <input type="search" name="buscar" defaultValue={buscar} placeholder="Producto, plataforma, SKU, OC, orden, forma de pago, fecha…" className="zx-control" />
        </label>
        <div className={styles.accionesFiltro}>
          <Boton type="submit">Buscar</Boton>
          {buscar && (
            <BotonLink href="/panel/inventario/compras" variante="fantasma">
              Limpiar
            </BotonLink>
          )}
        </div>
      </form>

      {filas.length === 0 ? (
        <EstadoVacio>{buscar ? `No hay compras que coincidan con «${buscar}».` : "Todavía no hay compras registradas."}</EstadoVacio>
      ) : (
        <>
          <Tabla encabezados={ENCABEZADOS} scroll>
            {filas.map((f) => {
              const diasLlegar = diasEntre(f.fechaCompra, f.fechaEntrega);
              const faltan = f.estado === "anulada" ? null : diasQueFaltan(f.entregaEstimada, f.fechaEntrega, hoy);
              return (
                <FilaTabla key={`${f.ordenId}-${f.skuCodigo}`}>
                  <CeldaTabla>
                    <Link href={`/panel/inventario/compras/${f.ordenId}`} className={styles.enlaceAviso}>
                      OC-{f.numero}
                    </Link>
                    <div>
                      <Chip estado={ESTADO_OC[f.estado]?.estado ?? "neutro"}>{ESTADO_OC[f.estado]?.texto ?? f.estado}</Chip>
                    </div>
                  </CeldaTabla>
                  <CeldaTabla>{fechaCorta(f.fechaCompra)}</CeldaTabla>
                  <CeldaTabla>
                    <div style={{ minWidth: 220, maxWidth: 320, whiteSpace: "normal" }}>{f.producto}</div>
                  </CeldaTabla>
                  <CeldaTabla className={styles.numero}>
                    {f.cantidad}
                    {f.recibida > 0 && f.recibida !== f.cantidad && <div className={styles.detalle}>llegaron {f.recibida}</div>}
                  </CeldaTabla>
                  <CeldaTabla className={styles.numero}>{mostrarMonto(f.total)}</CeldaTabla>
                  <CeldaTabla className={styles.numero}>{mostrarMonto(f.valorUnidad)}</CeldaTabla>
                  <CeldaTabla>{f.formaPago ?? "—"}</CeldaTabla>
                  <CeldaTabla>{f.plataforma ?? "—"}</CeldaTabla>
                  <CeldaTabla>
                    <SkuCopiable sku={f.skuCodigo} />
                  </CeldaTabla>
                  <CeldaTabla>{f.liquidado ? fechaCorta(f.liquidado) : <Chip estado="aviso">pendiente</Chip>}</CeldaTabla>
                  <CeldaTabla>{f.ordenPlataforma ?? "—"}</CeldaTabla>
                  <CeldaTabla>
                    {f.linkCompra ? (
                      <a href={f.linkCompra} target="_blank" rel="noopener noreferrer" className={styles.enlaceAviso}>
                        Abrir
                      </a>
                    ) : (
                      "—"
                    )}
                  </CeldaTabla>
                  <CeldaTabla>{f.fechaEntrega ? fechaCorta(f.fechaEntrega) : "—"}</CeldaTabla>
                  <CeldaTabla className={styles.numero}>{textoDias(diasLlegar)}</CeldaTabla>
                  <CeldaTabla>{fechaCorta(f.entregaEstimada)}</CeldaTabla>
                  <CeldaTabla className={styles.numero}>
                    {faltan !== null && faltan < 0 ? <Chip estado="peligro">{`atrasada ${textoDias(-faltan)}`}</Chip> : textoDias(faltan)}
                  </CeldaTabla>
                </FilaTabla>
              );
            })}
          </Tabla>
          <p className={styles.detalle} style={{ marginTop: 8 }}>
            {filas.length} {filas.length === 1 ? "producto" : "productos"}
            {filas.length >= 500 ? " (las 500 compras más recientes: usa el buscador para ver otras)" : ""}. Para recibir la mercancía, abre su OC.
          </p>
        </>
      )}
    </>
  );
}
