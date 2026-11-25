import { notFound, redirect } from "next/navigation";

// Enlaces viejos (correos, marcadores): el detalle de reclamo ahora vive
// en Posventa. Solo redirige; la ruta nueva exige sesión y permiso. Los
// params se validan para no armar una URL con texto arbitrario.
const SEGURO = /^[A-Za-z0-9-]+$/;

export default function ReclamoViejoPage({ params }: { params: { cuentaId: string; reclamoId: string } }) {
  if (!SEGURO.test(params.cuentaId) || !SEGURO.test(params.reclamoId)) notFound();
  redirect(`/panel/posventa/reclamos/${params.cuentaId}/${params.reclamoId}`);
}
