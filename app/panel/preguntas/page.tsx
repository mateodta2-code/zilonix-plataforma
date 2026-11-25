import Link from "next/link";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { EncabezadoPagina } from "@/components/marco/EncabezadoPagina";
import { EstadoVacio } from "@/components/marco/EstadoVacio";
import { Pestanas } from "@/components/marco/Pestanas";
import { SinAcceso } from "@/components/marco/SinAcceso";
import { Chip } from "@/components/marco/Chip";
import { Tarjeta } from "@/components/marco/Tarjeta";
import { listarEmpresasDeUsuario } from "@/lib/empresas";
import { obtenerMiMembresia } from "@/lib/membresias";
import { leerBandejaPreguntas } from "@/lib/ml/preguntas";
import { requierePermiso, SinPermisoError } from "@/lib/permisos";
import { minutosDesde, minutosHasta, rotuloEtapaReclamo, rotuloTipoReclamo, textoEspera, textoPlazo, tonoPlazo } from "@/lib/preguntas/tiempo";
import { tienePermiso } from "@/lib/roles-plantillas";
import { obtenerOCrearUsuarioActual } from "@/lib/usuarios";
import { AutoRefrescoDespachos } from "../despachos/AutoRefrescoDespachos";
import { FilaPregunta } from "./FilaPregunta";
import styles from "./page.module.css";

// Preguntas y reclamos (Refs #51) — para responder rápido: Mercado
// Libre mide el tiempo de respuesta en la reputación. Lee en vivo de
// Mercado Libre (sin tablas propias); ver por consultar ventas,
// responder con modificar ventas.

export default async function PreguntasPage({ searchParams }: { searchParams?: { tab?: string | string[] } }) {
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
        <EncabezadoPagina titulo="Preguntas y reclamos" />
        <SinAcceso mensaje={`Tu rol (${miMembresia?.rolNombre ?? "sin rol"}) no tiene acceso a este módulo.`} />
      </>
    );
  }

  const tab = searchParams?.tab === "reclamos" ? "reclamos" : "preguntas";
  const miMembresia = await obtenerMiMembresia(usuario.id, empresa.id);
  const puedeResponder = miMembresia ? tienePermiso(miMembresia.permisos, "ventas", "modificar") : false;
  const bandeja = await leerBandejaPreguntas(empresa.id);
  const ahora = new Date();

  return (
    <>
      <EncabezadoPagina
        titulo="Preguntas y reclamos"
        descripcion="Preguntas sin responder y reclamos abiertos de todas tus cuentas. Mercado Libre califica qué tan rápido respondes."
      />

      {/* Vuelve a consultar cada minuto mientras la pestaña está visible. */}
      <AutoRefrescoDespachos />

      {bandeja.cuentasSinRevisar.length > 0 && (
        <div className={styles.aviso}>
          <p className={styles.avisoTitulo}>No se pudieron revisar estas cuentas de Mercado Libre:</p>
          <ul className={styles.avisoLista}>
            {bandeja.cuentasSinRevisar.map((c) => (
              <li key={c.nickname}>
                <strong>{c.nickname}</strong> — {c.motivo}
              </li>
            ))}
          </ul>
        </div>
      )}

      <Pestanas
        pestanas={[
          { etiqueta: `Preguntas (${bandeja.preguntas.length}${bandeja.hayMas ? "+" : ""})`, href: "/panel/preguntas", activa: tab === "preguntas" },
          { etiqueta: `Reclamos (${bandeja.reclamos.length})`, href: "/panel/preguntas?tab=reclamos", activa: tab === "reclamos" },
        ]}
      />

      {tab === "preguntas" ? (
        bandeja.preguntas.length === 0 ? (
          <EstadoVacio>No hay preguntas sin responder. ¡Al día!</EstadoVacio>
        ) : (
          <Tarjeta>
            {bandeja.hayMas ? (
              <p className={styles.nota}>Hay más preguntas de las que se muestran (hasta 50 por cuenta). Al responder estas, aparecen las siguientes.</p>
            ) : null}
            <ul className={styles.lista}>
              {bandeja.preguntas.map((pregunta) => (
                <FilaPregunta key={`${pregunta.cuentaMlId}-${pregunta.id}`} pregunta={pregunta} puedeResponder={puedeResponder} ahoraMs={ahora.getTime()} />
              ))}
            </ul>
          </Tarjeta>
        )
      ) : bandeja.reclamos.length === 0 ? (
        <EstadoVacio>No hay reclamos abiertos.</EstadoVacio>
      ) : (
        <Tarjeta>
          <ul className={styles.lista}>
            {bandeja.reclamos.map((reclamo) => {
              const minutos = minutosHasta(reclamo.plazo, ahora);
              return (
                <li key={`${reclamo.cuentaMlId}-${reclamo.id}`} className={styles.reclamo}>
                  <Link href={`/panel/preguntas/reclamos/${reclamo.cuentaMlId}/${reclamo.id}`} className={styles.reclamoEnlace}>
                    <div className={styles.cabeceraPregunta}>
                      <span className={styles.cuenta}>{reclamo.nickname}</span>
                      <Chip estado="neutro">{rotuloTipoReclamo(reclamo.tipo)}</Chip>
                      <Chip estado="aviso">{rotuloEtapaReclamo(reclamo.etapa)}</Chip>
                      <Chip estado={tonoPlazo(minutos)}>{textoPlazo(minutos)}</Chip>
                    </div>
                    <p className={styles.producto}>{reclamo.motivoTexto ?? reclamo.motivo ?? "Motivo sin detalle"}</p>
                    <p className={styles.producto}>
                      Venta {reclamo.recursoId ?? "—"} · abierto {textoEspera(minutosDesde(reclamo.fecha, ahora))} · último cambio {textoEspera(minutosDesde(reclamo.actualizado, ahora))}
                    </p>
                    <span className={styles.verReclamo}>Ver reclamo →</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </Tarjeta>
      )}
    </>
  );
}
