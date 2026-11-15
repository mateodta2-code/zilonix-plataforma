import Link from "next/link";
import { obtenerContextoPanel } from "@/lib/panel-contexto";
import { alertasMaestra } from "@/lib/finanzas/maestra";
import { requierePermiso, SinPermisoError } from "@/lib/permisos";
import { BotonLink } from "@/components/marco/Boton";
import { CeldaTabla, FilaTabla, Tabla } from "@/components/marco/Tabla";
import { EncabezadoPagina } from "@/components/marco/EncabezadoPagina";
import { EstadoVacio } from "@/components/marco/EstadoVacio";
import { SinAcceso } from "@/components/marco/SinAcceso";
import styles from "../../finanzas.module.css";

// Issue #128 (Z-FIN-06) — alerta en rojo de lo que deja ventas fuera de
// la utilidad. No calcula ninguna utilidad. Un costo 0 puesto a
// propósito no aparece acá.
export default async function AlertasMaestraPage() {
  const { usuario, activa: empresa, rolNombre } = await obtenerContextoPanel();
  try {
    await requierePermiso(usuario.id, empresa.id, "finanzas", "consultar");
  } catch (error) {
    if (!(error instanceof SinPermisoError)) throw error;
    return <SinAcceso mensaje={`Tu rol (${rolNombre}) no tiene acceso a Finanzas.`} />;
  }

  const alertas = await alertasMaestra(empresa.id);

  return (
    <>
      <EncabezadoPagina
        titulo="SKU sin costo"
        descripcion="Las ventas de estos SKU quedan fuera de la utilidad hasta que tengan costo. No se inventa ningún número."
      />
      <p className={styles.aviso}>
        Cuántas ventas del período quedan sin utilidad (conteo y valor) se va a ver aquí cuando existan las líneas de venta con SKU
        (#129/#130).
      </p>

      <section className={styles.seccion}>
        <h2 className={styles.tituloSeccion}>SKU con costo vacío ({alertas.sinCosto.total})</h2>
        {alertas.sinCosto.total === 0 ? (
          <EstadoVacio>Todos los SKU de la tabla maestra tienen costo.</EstadoVacio>
        ) : (
          <Tabla encabezados={["SKU", "Producto", ""]}>
            {alertas.sinCosto.skus.map((s) => (
              <FilaTabla key={s.skuCodigo}>
                <CeldaTabla>
                  <strong>{s.skuCodigo}</strong>
                </CeldaTabla>
                <CeldaTabla>{s.nombreProducto ?? "—"}</CeldaTabla>
                <CeldaTabla>
                  <Link href={`/panel/finanzas/maestra-sku/editar?sku=${encodeURIComponent(s.skuCodigo)}`} className={styles.enlace}>
                    Poner costo
                  </Link>
                </CeldaTabla>
              </FilaTabla>
            ))}
          </Tabla>
        )}
      </section>

      <section className={styles.seccion}>
        <h2 className={styles.tituloSeccion}>SKU publicados que no están en la tabla maestra ({alertas.publicadosFueraDeMaestra.total})</h2>
        {alertas.publicadosFueraDeMaestra.total === 0 ? (
          <EstadoVacio>Todos los SKU enlazados a publicaciones están en la tabla maestra.</EstadoVacio>
        ) : (
          <Tabla encabezados={["SKU", "Publicaciones", ""]}>
            {alertas.publicadosFueraDeMaestra.skus.map((s) => (
              <FilaTabla key={s.skuCodigo}>
                <CeldaTabla>
                  <strong>{s.skuCodigo}</strong>
                </CeldaTabla>
                <CeldaTabla>{s.publicaciones}</CeldaTabla>
                <CeldaTabla>
                  <Link href={`/panel/finanzas/maestra-sku/editar?sku=${encodeURIComponent(s.skuCodigo)}`} className={styles.enlace}>
                    Agregar a la maestra
                  </Link>
                </CeldaTabla>
              </FilaTabla>
            ))}
          </Tabla>
        )}
      </section>

      <section className={styles.seccion}>
        <h2 className={styles.tituloSeccion}>Publicaciones sin SKU ({alertas.publicacionesSinSku})</h2>
        {alertas.publicacionesSinSku > 0 ? (
          <p className={styles.ayuda}>
            Sin SKU no se puede buscar su costo.{" "}
            <Link href="/panel/sku/sin-vincular" className={styles.enlace}>
              Enlazarlas
            </Link>
          </p>
        ) : (
          <EstadoVacio>Todas las publicaciones tienen SKU.</EstadoVacio>
        )}
      </section>

      <BotonLink href="/panel/finanzas/maestra-sku" variante="fantasma" chico className={styles.volver}>
        Volver a la tabla maestra
      </BotonLink>
    </>
  );
}
