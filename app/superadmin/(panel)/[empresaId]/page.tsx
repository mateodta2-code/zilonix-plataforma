import { redirect } from "next/navigation";
import {
  requiereSesionSuperadmin,
  listarEmpresasConConteo,
  obtenerMiembrosConAcceso,
  SinAccesoTemporalError,
  PLANES,
} from "@/lib/superadmin";
import { EncabezadoPagina } from "@/components/marco/EncabezadoPagina";
import { Tarjeta } from "@/components/marco/Tarjeta";
import { Tabla, FilaTabla, CeldaTabla } from "@/components/marco/Tabla";
import { Boton, BotonLink } from "@/components/marco/Boton";
import { Campo } from "@/components/marco/Campo";
import { EstadoVacio } from "@/components/marco/EstadoVacio";
import { FormConfirmar } from "@/components/superadmin/FormConfirmar";
import { cambiarPlanAction, editarNotasAction, reactivarAction, suspenderAction } from "./actions";

// Tarea 1.11 (decisión D8) — el criterio de "listo" de esta tarea,
// literal: como superadmin ves "Empresa X — N miembros" siempre, pero
// el detalle (quién es quién) solo si la empresa concedió un acceso
// temporal activo. Cada vista de detalle exitosa queda en auditoria
// (lib/superadmin.ts) — eso no se ve acá, lo prueba db/superadmin.test.ts
// contra Postgres real.
export default async function SuperadminEmpresaPage({ params }: { params: { empresaId: string } }) {
  const usuario = { id: (await requiereSesionSuperadmin()).usuarioId };

  const empresas = await listarEmpresasConConteo();
  const empresa = empresas.find((e) => e.id === params.empresaId);
  if (!empresa) redirect("/superadmin/empresas");

  let miembros: { nombre: string; email: string; rolNombre: string }[] | null = null;
  let sinAcceso = false;
  try {
    miembros = await obtenerMiembrosConAcceso(empresa.id, usuario.id);
  } catch (error) {
    if (!(error instanceof SinAccesoTemporalError)) throw error;
    sinAcceso = true;
  }

  return (
    <>
      <EncabezadoPagina
        titulo={empresa.nombre}
        descripcion={`NIT ${empresa.nit} · ${empresa.miembros} miembro${empresa.miembros === 1 ? "" : "s"} · Plan: ${empresa.plan} · Estado: ${empresa.estado}${
          empresa.estado === "suspendida" && empresa.suspendidaMotivo ? ` — ${empresa.suspendidaMotivo}` : ""
        }`}
        accion={
          <BotonLink href="/superadmin/empresas" variante="fantasma">
            ← Todas las empresas
          </BotonLink>
        }
      />

      <Tarjeta>
        <FormConfirmar action={cambiarPlanAction} mensaje="¿Cambiar el plan de esta empresa?">
          <input type="hidden" name="empresaId" value={empresa.id} />
          <Campo etiqueta="Plan">
            <select name="plan" className="zx-control" defaultValue={empresa.plan}>
              {PLANES.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </Campo>
          <Boton type="submit" variante="secundario">
            Cambiar plan
          </Boton>
        </FormConfirmar>
      </Tarjeta>

      <Tarjeta>
        {empresa.estado === "activa" ? (
          <FormConfirmar action={suspenderAction} mensaje="¿Suspender esta empresa? Sus miembros no podrán usar ningún módulo.">
            <input type="hidden" name="empresaId" value={empresa.id} />
            <Campo etiqueta="Motivo de la suspensión (obligatorio)">
              <textarea name="motivo" className="zx-control" required rows={2} />
            </Campo>
            <Boton type="submit" variante="secundario">
              Suspender
            </Boton>
          </FormConfirmar>
        ) : (
          <FormConfirmar action={reactivarAction} mensaje="¿Reactivar esta empresa?">
            <input type="hidden" name="empresaId" value={empresa.id} />
            <Boton type="submit">Reactivar</Boton>
          </FormConfirmar>
        )}
      </Tarjeta>

      <Tarjeta>
        <FormConfirmar action={editarNotasAction} mensaje="¿Guardar las notas internas?">
          <input type="hidden" name="empresaId" value={empresa.id} />
          <Campo etiqueta="Notas internas (solo Zilonix)">
            <textarea name="notas" className="zx-control" defaultValue={empresa.notasInternas ?? ""} rows={4} />
          </Campo>
          <Boton type="submit" variante="secundario">
            Guardar notas
          </Boton>
        </FormConfirmar>
      </Tarjeta>

      {sinAcceso ? (
        <EstadoVacio>
          Esta empresa no te ha concedido ningún acceso temporal activo — no se puede ver más detalle que el conteo de arriba.
        </EstadoVacio>
      ) : (
        <>
          <h2 style={{ fontSize: 16, fontWeight: 600 }}>Miembros (vista con acceso temporal)</h2>
          <Tabla encabezados={["Nombre", "Correo", "Rol"]}>
            {miembros!.map((m, i) => (
              <FilaTabla key={i}>
                <CeldaTabla>{m.nombre}</CeldaTabla>
                <CeldaTabla>{m.email}</CeldaTabla>
                <CeldaTabla>{m.rolNombre}</CeldaTabla>
              </FilaTabla>
            ))}
          </Tabla>
        </>
      )}
    </>
  );
}
