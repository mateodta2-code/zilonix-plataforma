import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { listarEmpresasDeUsuario } from "@/lib/empresas";
import { obtenerMiMembresia } from "@/lib/membresias";
import { obtenerOCrearUsuarioActual } from "@/lib/usuarios";
import { requierePermiso, SinPermisoError } from "@/lib/permisos";
import { tienePermiso } from "@/lib/roles-plantillas";
import { listarConexionesIA } from "@/lib/ia/conexion";
import { EncabezadoPagina } from "@/components/marco/EncabezadoPagina";
import { SinAcceso } from "@/components/marco/SinAcceso";
import { Tarjeta } from "@/components/marco/Tarjeta";
import { ConectarIA } from "./ConectarIA";
import styles from "./conectarIa.module.css";

// Administración → Conectar IA. Hasta 5 IA por empresa, una principal y
// qué IA usa cada módulo. La API key nunca llega al navegador
// (listarConexionesIA no la trae).
export default async function ConectarIaPage() {
  const usuario = await obtenerOCrearUsuarioActual();
  if (!usuario) redirect("/sign-in");

  const propias = await listarEmpresasDeUsuario(usuario.id);
  const empresaId = cookies().get("empresa_actual")?.value;
  const empresa = propias.find((e) => e.id === empresaId) ?? propias[0];
  if (!empresa) redirect("/crear-empresa");

  try {
    await requierePermiso(usuario.id, empresa.id, "configuracion", "consultar");
  } catch (error) {
    if (!(error instanceof SinPermisoError)) throw error;
    const miMembresia = await obtenerMiMembresia(usuario.id, empresa.id);
    return (
      <>
        <EncabezadoPagina titulo="Conectar IA" />
        <SinAcceso mensaje={`Tu rol (${miMembresia?.rolNombre ?? "sin rol"}) no tiene acceso a esta pantalla.`} />
      </>
    );
  }

  const miMembresia = await obtenerMiMembresia(usuario.id, empresa.id);
  const puedeModificar = tienePermiso(miMembresia?.permisos ?? [], "configuracion", "modificar");
  const conexiones = await listarConexionesIA(empresa.id);

  return (
    <>
      <EncabezadoPagina titulo="Conectar IA" descripcion="Conecta las IA que usarán los módulos de Seller." />
      <Tarjeta className={styles.seccion}>
        <p className={styles.texto}>
          La IA que conectas sirve para todos los módulos de Seller: hoy Promociones (resumen y reglas adicionales), Optimización e Investigación y,
          a futuro, Publicidad.
        </p>
        <p className={styles.texto}>Cada empresa paga con sus propias llaves: Zilonix no pone IA ni cobra ese consumo.</p>
        <p className={styles.texto}>Los números siempre los calcula el motor de reglas, nunca la IA. Sin IA, los módulos funcionan igual.</p>
        <p className={styles.texto}>
          Para «Buscar por foto», la IA asignada a Investigación debe ser un modelo que lea imágenes (por ejemplo, los modelos actuales con visión de
          Claude, GPT, Gemini o Grok).
        </p>
      </Tarjeta>
      <ConectarIA conexiones={conexiones.map(({ actualizadoTs: _t, ...c }) => c)} puedeModificar={puedeModificar} />
    </>
  );
}
