import { redirect } from "next/navigation";
import { requiereSesionSuperadmin } from "@/lib/superadmin";
import { listarBodegas, listarEmpresasLigadas, listarEmpresasLigables } from "@/lib/superadmin-bodegas";
import { urlPublicaBase } from "@/lib/url-publica";
import { FormConfirmar } from "@/components/superadmin/FormConfirmar";
import { Boton, BotonLink } from "@/components/marco/Boton";
import { Chip } from "@/components/marco/Chip";
import { Campo } from "@/components/marco/Campo";
import { EncabezadoPagina } from "@/components/marco/EncabezadoPagina";
import { Tarjeta } from "@/components/marco/Tarjeta";
import { cambiarEstadoVinculoBodegaAction, invitarAdminBodegaAction, ligarEmpresaBodegaAction, reactivarBodegaAction, suspenderBodegaAction } from "../actions";

// Detalle de una bodega: invitar a su admin_bodega (link en pantalla),
// suspender y reactivar. Todo por db/superadmin-context.ts y con auditoria.
export default async function SuperadminBodegaPage({ params, searchParams }: { params: { bodegaId: string }; searchParams: { token?: string; error?: string } }) {
  await requiereSesionSuperadmin();
  const bodega = (await listarBodegas()).find((b) => b.id === params.bodegaId);
  if (!bodega) redirect("/superadmin/bodegas");
  const ligadas = await listarEmpresasLigadas(bodega.id);
  const ligables = await listarEmpresasLigables(bodega.id);
  const link = searchParams.token ? `${urlPublicaBase()}/invitacion-bodega/${searchParams.token}` : null;

  return (
    <>
      <EncabezadoPagina
        titulo={bodega.nombre}
        descripcion={`${bodega.nit ? `NIT ${bodega.nit} · ` : ""}Estado: ${bodega.estado} · ${bodega.admins} admin, ${bodega.operarios} operarios, ${bodega.domiciliarios} domiciliarios`}
        accion={
          <BotonLink href="/superadmin/bodegas" variante="fantasma">
            ← Todas las bodegas
          </BotonLink>
        }
      />
      {searchParams.error && <p>{searchParams.error}</p>}

      <Tarjeta>
        <form action={invitarAdminBodegaAction} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <input type="hidden" name="bodegaId" value={bodega.id} />
          <Campo etiqueta="Correo del administrador de la bodega">
            <input type="email" name="email" required className="zx-control" />
          </Campo>
          <Boton type="submit" variante="primario">
            Invitar administrador
          </Boton>
        </form>
        {link && (
          <div style={{ marginTop: 16 }}>
            <p>Comparte este link — solo funciona una vez y vence en 7 días:</p>
            <input readOnly value={link} className="zx-control" />
          </div>
        )}
      </Tarjeta>

      <Tarjeta>
        <h2>Empresas que atiende</h2>
        {ligadas.length === 0 ? (
          <p>Todavía no atiende a ninguna empresa.</p>
        ) : (
          <ul style={{ listStyle: "none", padding: 0, display: "flex", flexDirection: "column", gap: 8 }}>
            {ligadas.map((e) => (
              <li key={e.vinculoId} style={{ display: "flex", gap: 12, alignItems: "center" }}>
                <strong>{e.nombre}</strong>
                <Chip estado={e.estado === "activa" ? "exito" : "neutro"}>{e.estado === "activa" ? "Activa" : "Pausada"}</Chip>
                <form action={cambiarEstadoVinculoBodegaAction}>
                  <input type="hidden" name="bodegaId" value={bodega.id} />
                  <input type="hidden" name="empresaId" value={e.empresaId} />
                  <input type="hidden" name="estado" value={e.estado === "activa" ? "pausada" : "activa"} />
                  <Boton type="submit" variante="fantasma">
                    {e.estado === "activa" ? "Pausar" : "Reactivar"}
                  </Boton>
                </form>
              </li>
            ))}
          </ul>
        )}
        {ligables.length > 0 && (
          <form action={ligarEmpresaBodegaAction} style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 16 }}>
            <input type="hidden" name="bodegaId" value={bodega.id} />
            <Campo etiqueta="Ligar una empresa">
              <select name="empresaId" required className="zx-control" defaultValue="">
                <option value="" disabled>
                  Elige una empresa
                </option>
                {ligables.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.nombre}
                  </option>
                ))}
              </select>
            </Campo>
            <Boton type="submit" variante="primario">
              Ligar empresa
            </Boton>
          </form>
        )}
      </Tarjeta>

      <Tarjeta>
        {bodega.estado === "activa" ? (
          <FormConfirmar action={suspenderBodegaAction} mensaje="¿Suspender esta bodega? Sus personas no podrán entrar a ningún panel.">
            <input type="hidden" name="bodegaId" value={bodega.id} />
            <Campo etiqueta="Motivo de la suspensión (obligatorio)">
              <textarea name="motivo" className="zx-control" required rows={2} />
            </Campo>
            <Boton type="submit" variante="peligro">
              Suspender
            </Boton>
          </FormConfirmar>
        ) : (
          <FormConfirmar action={reactivarBodegaAction} mensaje="¿Reactivar esta bodega?">
            <input type="hidden" name="bodegaId" value={bodega.id} />
            <Boton type="submit">Reactivar</Boton>
          </FormConfirmar>
        )}
      </Tarjeta>
    </>
  );
}
