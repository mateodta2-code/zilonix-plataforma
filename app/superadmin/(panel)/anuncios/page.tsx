import { listarAnuncios } from "@/lib/anuncios";
import { ETIQUETA_ESTADO_ANUNCIO, MENSAJE_MAXIMO, TIPOS_ANUNCIO, estadoAnuncio, type EstadoAnuncio } from "@/lib/anuncios-reglas";
import { requiereSesionSuperadmin } from "@/lib/superadmin";
import { Boton } from "@/components/marco/Boton";
import { Campo } from "@/components/marco/Campo";
import { Chip, type EstadoChip } from "@/components/marco/Chip";
import { EncabezadoPagina } from "@/components/marco/EncabezadoPagina";
import { EstadoVacio } from "@/components/marco/EstadoVacio";
import { CeldaTabla, FilaTabla, Tabla } from "@/components/marco/Tabla";
import { Tarjeta } from "@/components/marco/Tarjeta";
import { FormConfirmar } from "@/components/superadmin/FormConfirmar";
import { crearAnuncioAction, retirarAnuncioAction } from "./actions";

// Anuncios de la plataforma (25-nov): un aviso para TODAS las empresas, arriba
// en su panel mientras esté vigente. Fechas en hora de Colombia.
const COLOR: Record<EstadoAnuncio, EstadoChip> = { programado: "aviso", activo: "exito", vencido: "neutro", retirado: "neutro" };
const hora = (d: Date) => d.toLocaleString("es-CO", { timeZone: "America/Bogota", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });

export default async function SuperadminAnunciosPage({ searchParams }: { searchParams: { error?: string } }) {
  await requiereSesionSuperadmin();
  const anuncios = await listarAnuncios();
  const ahora = new Date();

  return (
    <>
      <EncabezadoPagina
        titulo="Anuncios"
        descripcion="Un aviso para todas las empresas: sale arriba en su panel mientras esté vigente. Úsalo para fallas de Mercado Libre, mantenimientos o novedades importantes. Fechas en hora de Colombia."
      />
      {searchParams.error && <p role="alert">{searchParams.error}</p>}

      <Tarjeta>
        <form action={crearAnuncioAction} style={{ display: "grid", gap: 12 }}>
          <Campo etiqueta={`Mensaje (máximo ${MENSAJE_MAXIMO} caracteres)`}>
            <textarea name="mensaje" required maxLength={MENSAJE_MAXIMO} rows={3} className="zx-control" />
          </Campo>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-end" }}>
            <Campo etiqueta="Tipo">
              <select name="tipo" defaultValue="info" className="zx-control">
                {Object.entries(TIPOS_ANUNCIO).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
            </Campo>
            <Campo etiqueta="Desde (vacío = ahora)">
              <input type="datetime-local" name="desde" className="zx-control" />
            </Campo>
            <Campo etiqueta="Hasta (vacío = hasta retirarlo)">
              <input type="datetime-local" name="hasta" className="zx-control" />
            </Campo>
            <Boton type="submit">Publicar anuncio</Boton>
          </div>
        </form>
      </Tarjeta>

      {anuncios.length === 0 ? (
        <EstadoVacio>Todavía no hay anuncios.</EstadoVacio>
      ) : (
        <Tabla encabezados={["Mensaje", "Tipo", "Estado", "Desde", "Hasta", ""]}>
          {anuncios.map((a) => {
            const estado = estadoAnuncio(a, ahora);
            return (
              <FilaTabla key={a.id}>
                <CeldaTabla>{a.mensaje}</CeldaTabla>
                <CeldaTabla>{TIPOS_ANUNCIO[a.tipo] ?? a.tipo}</CeldaTabla>
                <CeldaTabla>
                  <Chip estado={COLOR[estado]}>{ETIQUETA_ESTADO_ANUNCIO[estado]}</Chip>
                </CeldaTabla>
                <CeldaTabla>{hora(a.inicioTs)}</CeldaTabla>
                <CeldaTabla>{a.retiradoTs ? `Retirado ${hora(a.retiradoTs)}` : a.finTs ? hora(a.finTs) : "Hasta retirarlo"}</CeldaTabla>
                <CeldaTabla>
                  {(estado === "activo" || estado === "programado") && (
                    <FormConfirmar action={retirarAnuncioAction} mensaje="¿Retirar este anuncio? Deja de verse en el panel de todas las empresas.">
                      <input type="hidden" name="anuncioId" value={a.id} />
                      <Boton type="submit" variante="peligro">
                        Retirar
                      </Boton>
                    </FormConfirmar>
                  )}
                </CeldaTabla>
              </FilaTabla>
            );
          })}
        </Tabla>
      )}
    </>
  );
}
