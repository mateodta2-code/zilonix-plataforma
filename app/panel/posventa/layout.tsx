import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { Suspense, type ReactNode } from "react";
import { EncabezadoPagina } from "@/components/marco/EncabezadoPagina";
import { SinAcceso } from "@/components/marco/SinAcceso";
import { listarEmpresasDeUsuario } from "@/lib/empresas";
import { obtenerMiMembresia } from "@/lib/membresias";
import { leerConteosPosventa } from "@/lib/ml/posventaConteos";
import { requierePermiso, SinPermisoError } from "@/lib/permisos";
import { obtenerOCrearUsuarioActual } from "@/lib/usuarios";
import { PestanasPosventa } from "./PestanasPosventa";

// Posventa-0 (Refs #647) — marco del módulo: encabezado + pestañas con
// contador. Mismo permiso que Preguntas (ventas.consultar). Sin permiso,
// SinAcceso y no se renderiza ninguna pestaña hija.

export default async function PosventaLayout({ children }: { children: ReactNode }) {
  const usuario = await obtenerOCrearUsuarioActual();
  if (!usuario) redirect("/sign-in");

  const propias = await listarEmpresasDeUsuario(usuario.id);
  const empresaId = cookies().get("empresa_actual")?.value;
  const empresa = propias.find((e) => e.id === empresaId) ?? propias[0];
  if (!empresa) redirect("/crear-empresa");

  try {
    await requierePermiso(usuario.id, empresa.id, "ventas", "consultar");
  } catch (error) {
    if (!(error instanceof SinPermisoError)) throw error;
    const miMembresia = await obtenerMiMembresia(usuario.id, empresa.id);
    return (
      <>
        <EncabezadoPagina titulo="Posventa" />
        <SinAcceso mensaje={`Tu rol (${miMembresia?.rolNombre ?? "sin rol"}) no tiene acceso a este módulo.`} />
      </>
    );
  }

  return (
    <>
      <EncabezadoPagina titulo="Posventa" descripcion="Reclamos y mediaciones, mensajes y devoluciones de todas tus cuentas." />
      {/* Los conteos leen de ML: en Suspense para que las pestañas salgan de una vez (sin número) y el loading.tsx de cada pestaña muestre la barra. */}
      <Suspense fallback={<PestanasPosventa conteos={{ reclamos: null, mensajes: null }} />}>
        <PestanasConConteos empresaId={empresa.id} />
      </Suspense>
      {children}
    </>
  );
}

// Si la lectura falla, las pestañas salen sin número; nunca rompe la página.
async function PestanasConConteos({ empresaId }: { empresaId: string }) {
  const conteos = await leerConteosPosventa(empresaId).catch(() => ({ reclamos: null, mensajes: null }));
  return <PestanasPosventa conteos={{ reclamos: conteos.reclamos, mensajes: conteos.mensajes }} />;
}
