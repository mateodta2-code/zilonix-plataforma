import { requierePermiso, SinPermisoError } from "@/lib/permisos";
import { obtenerContextoPanel } from "@/lib/panel-contexto";
import { tienePermiso } from "@/lib/roles";
import { normalizarParametro } from "@/lib/filtros-listado";
import { calcularProyeccion } from "@/lib/inventario/proyeccion-datos";
import { VENTANAS_DIAS, type VentanaDias } from "@/lib/inventario/proyeccion";
import { EncabezadoPagina } from "@/components/marco/EncabezadoPagina";
import { Pestanas } from "@/components/marco/Pestanas";
import { SinAcceso } from "@/components/marco/SinAcceso";
import { AvisosUrl } from "@/components/inventario/Avisos";
import { SelectorVentana } from "./formato";
import { VistaPlan } from "./VistaPlan";
import { VistaReglas } from "./VistaReglas";
import { VistaRotacion } from "./VistaRotacion";
import { VistaSemaforo } from "./VistaSemaforo";
import styles from "./proyeccion.module.css";

// Proyección de inventarios (módulo Productos): cuánto dura el stock,
// qué comprar y cuándo, con los datos propios de Seller (stock de las
// bodegas y ventas ya importadas). Cuatro vistas en la misma ruta:
// semáforo (default), plan de compra, rotación y reglas.
// Ver pide inventario.consultar; las reglas y los días de entrega,
// inventario.modificar; crear la orden de compra, inventario.crear
// (también en cada acción).
const VISTAS = [
  { clave: "semaforo", etiqueta: "Qué comprar hoy" },
  { clave: "plan", etiqueta: "Plan de compra" },
  { clave: "rotacion", etiqueta: "Rotación y tendencia" },
  { clave: "reglas", etiqueta: "Reglas y entregas" },
] as const;
type Vista = (typeof VISTAS)[number]["clave"];

export default async function ProyeccionInventariosPage({ searchParams }: { searchParams: Record<string, string | string[] | undefined> }) {
  const { usuario, activa, permisos, rolNombre } = await obtenerContextoPanel();
  try {
    await requierePermiso(usuario.id, activa.id, "inventario", "consultar");
  } catch (error) {
    if (!(error instanceof SinPermisoError)) throw error;
    return <SinAcceso mensaje={`Tu rol (${rolNombre}) no tiene acceso a esta pantalla.`} />;
  }
  const puedeEditar = tienePermiso(permisos, "inventario", "modificar");
  const puedeCrear = tienePermiso(permisos, "inventario", "crear");

  // Lo que viene de la URL solo elige entre valores conocidos.
  const pedida = normalizarParametro(searchParams.vista);
  const vista: Vista = VISTAS.find((v) => v.clave === pedida)?.clave ?? "semaforo";
  const ventanaPedida = Number(normalizarParametro(searchParams.ventana));
  const ventana = VENTANAS_DIAS.find((d) => d === ventanaPedida) as VentanaDias | undefined;

  const { reglas, filas, recortado } = await calcularProyeccion(activa.id, { ventanaDias: ventana });

  return (
    <>
      <EncabezadoPagina titulo="Proyección de inventarios" descripcion="Cuánto vas a necesitar y cuándo reponer, según tus ventas." />
      <Pestanas pestanas={VISTAS.map((v) => ({ etiqueta: v.etiqueta, href: `/panel/inventario/proyeccion?vista=${v.clave}`, activa: v.clave === vista }))} />
      <AvisosUrl searchParams={searchParams} />
      {vista !== "reglas" && vista !== "rotacion" && <SelectorVentana vista={vista} activa={reglas.ventanaDias} ventanas={VENTANAS_DIAS} />}
      {recortado && <p className={styles.nota}>Hay más de 1.000 productos con movimiento: se muestran los primeros por código.</p>}

      {vista === "semaforo" && <VistaSemaforo filas={filas} reglas={reglas} />}
      {vista === "plan" && <VistaPlan filas={filas} reglas={reglas} puedeCrear={puedeCrear} />}
      {vista === "rotacion" && <VistaRotacion filas={filas} />}
      {vista === "reglas" && <VistaReglas reglas={reglas} filas={filas} puedeEditar={puedeEditar} />}
    </>
  );
}
