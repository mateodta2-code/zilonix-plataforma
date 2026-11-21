import { obtenerContextoPanel } from "@/lib/panel-contexto";
import { requierePermiso, SinPermisoError } from "@/lib/permisos";
import { BotonLink } from "@/components/marco/Boton";
import { EncabezadoPagina } from "@/components/marco/EncabezadoPagina";
import { SinAcceso } from "@/components/marco/SinAcceso";
import { DetalleDiaCuentaProducto } from "@/components/finanzas/DetalleDiaCuentaProducto";
import { PanelRecalculoCostos } from "@/components/finanzas/PanelRecalculoCostos";
import { UtilidadFalabella } from "@/components/finanzas/UtilidadFalabella";
import { Pestanas } from "@/components/marco/Pestanas";
import styles from "../finanzas.module.css";

// Issue #131 (Z-FIN-09, Parte A) — ventas y utilidad. Filtros por
// cuenta, rango de días de Bogotá (máximo 31, por defecto el mes en
// curso) y con/sin costo. Sin ícono de quitar y sin lápiz: la corrección
// manual es la Parte B. La tabla vive en
// components/finanzas/DetalleDiaCuentaProducto.tsx, la misma que pinta
// /panel/pedidos.
//
// Parte C — «Recalcular costo con la tabla maestra»
// (components/finanzas/PanelRecalculoCostos.tsx): vista previa antes →
// después y confirmación obligatoria. Solo se pinta con
// finanzas.modificar; las actions y el motor lo vuelven a pedir.
//
// Issue #422 — selector de marketplace (?marketplace=ml|falabella|todos).
// Sin parámetro sigue siendo Mercado Libre, igual que antes. «Todos»
// pinta las dos secciones una debajo de la otra: cada marketplace tiene
// su moneda por cuenta y sus conceptos, así que no se suman en un solo
// número.
const MARKETPLACES = [
  { valor: "ml", etiqueta: "Mercado Libre" },
  { valor: "falabella", etiqueta: "Falabella" },
  { valor: "todos", etiqueta: "Todos" },
] as const;
type Marketplace = (typeof MARKETPLACES)[number]["valor"];
export default async function VentasUtilidadPage({ searchParams }: { searchParams: Record<string, string | string[] | undefined> }) {
  const { usuario, activa: empresa, rolNombre } = await obtenerContextoPanel();

  try {
    await requierePermiso(usuario.id, empresa.id, "finanzas", "consultar");
  } catch (error) {
    if (!(error instanceof SinPermisoError)) throw error;
    return <SinAcceso mensaje={`Tu rol (${rolNombre}) no tiene acceso a Finanzas.`} />;
  }

  let puedeRecalcular = true;
  try {
    await requierePermiso(usuario.id, empresa.id, "finanzas", "modificar");
  } catch (error) {
    if (!(error instanceof SinPermisoError)) throw error;
    puedeRecalcular = false;
  }

  const ruta = "/panel/finanzas/ventas";
  const pedido = typeof searchParams.marketplace === "string" ? searchParams.marketplace : "ml";
  const marketplace: Marketplace = MARKETPLACES.find((m) => m.valor === pedido)?.valor ?? "ml";
  // Mercado Libre sin parámetro: los enlaces de siempre siguen igual.
  const extra: Record<string, string> = marketplace === "ml" ? {} : { marketplace };
  const verMl = marketplace !== "falabella";
  const verFalabella = marketplace !== "ml";

  return (
    <>
      <EncabezadoPagina
        titulo="Ventas y utilidad"
        descripcion={
          marketplace === "falabella"
            ? "Utilidad por orden de Falabella: ventas − costo − comisiones − envíos netos − promociones. La publicidad sin orden se resta en el total del periodo."
            : "Utilidad por venta antes de publicidad: recaudo − comisión ML − flete ML − costo − packing − envío agencia."
        }
      />

      <Pestanas
        pestanas={MARKETPLACES.map((m) => ({
          etiqueta: m.etiqueta,
          href: m.valor === "ml" ? ruta : `${ruta}?marketplace=${m.valor}`,
          activa: m.valor === marketplace,
        }))}
      />

      {verMl && (
        <section className={styles.seccionMarketplace}>
          {marketplace === "todos" && <h2 className={styles.tituloSeccion}>Mercado Libre</h2>}
          <DetalleDiaCuentaProducto
            empresaId={empresa.id}
            usuarioId={usuario.id}
            searchParams={searchParams}
            ruta={ruta}
            extra={extra}
            acciones={puedeRecalcular ? <PanelRecalculoCostos /> : undefined}
          />
        </section>
      )}

      {verFalabella && (
        <section className={styles.seccionMarketplace}>
          {marketplace === "todos" && <h2 className={styles.tituloSeccion}>Falabella</h2>}
          <UtilidadFalabella empresaId={empresa.id} usuarioId={usuario.id} searchParams={searchParams} ruta={ruta} extra={extra} />
        </section>
      )}

      <BotonLink href="/panel/finanzas" variante="fantasma" className={styles.volver}>
        Volver a Finanzas
      </BotonLink>
    </>
  );
}
