import { notFound } from "next/navigation";
import { obtenerContextoPanel } from "@/lib/panel-contexto";
import { normalizarParametro } from "@/lib/filtros-listado";
import { requierePermiso, SinPermisoError } from "@/lib/permisos";
import { diaBogota } from "@/lib/finanzas/utilidad-venta";
import { claveTienda } from "@/lib/finanzas/gastos";
import { leerGasto, leerOpcionesGasto, listarCategoriasGasto } from "@/lib/finanzas/gastos-db";
import { BotonLink } from "@/components/marco/Boton";
import { EncabezadoPagina } from "@/components/marco/EncabezadoPagina";
import { SinAcceso } from "@/components/marco/SinAcceso";
import { Tarjeta } from "@/components/marco/Tarjeta";
import { editarGastoAction } from "../actions";
import { FormularioGasto } from "../FormularioGasto";
import styles from "../../finanzas.module.css";

// Issue #422 (fase 4 de Finanzas) — editar un gasto externo: exige
// finanzas.modificar acá y en el servidor (actions.ts, gastos-db.ts).
export default async function EditarGastoPage({
  params,
  searchParams,
}: {
  params: { id: string };
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const { usuario, activa: empresa, rolNombre } = await obtenerContextoPanel();
  let datos;
  try {
    await requierePermiso(usuario.id, empresa.id, "finanzas", "modificar");
    const [gasto, opciones, categorias] = await Promise.all([
      leerGasto(empresa.id, usuario.id, params.id),
      leerOpcionesGasto(empresa.id, usuario.id),
      listarCategoriasGasto(empresa.id, usuario.id, { incluirInactivas: true }),
    ]);
    datos = { gasto, opciones, categorias };
  } catch (error) {
    if (!(error instanceof SinPermisoError)) throw error;
    return <SinAcceso mensaje={`Tu rol (${rolNombre}) no puede editar gastos.`} />;
  }
  const { gasto, opciones, categorias } = datos;
  if (!gasto) notFound();
  const error = normalizarParametro(searchParams.error);

  return (
    <>
      <EncabezadoPagina titulo="Editar gasto" descripcion={gasto.descripcion} />
      {error && <p className={styles.avisoError}>{error}</p>}
      <Tarjeta>
        <FormularioGasto
          accion={editarGastoAction}
          hoy={diaBogota(new Date())}
          tiendas={opciones.tiendas}
          categorias={categorias}
          proveedores={opciones.proveedores}
          valores={{ ...gasto, tienda: claveTienda(gasto) }}
          textoBoton="Guardar cambios"
        />
      </Tarjeta>
      <BotonLink href="/panel/finanzas/gastos" variante="fantasma" className={styles.volver}>
        Volver a Gastos
      </BotonLink>
    </>
  );
}
