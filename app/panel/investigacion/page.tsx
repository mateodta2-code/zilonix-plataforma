import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { listarEmpresasDeUsuario } from "@/lib/empresas";
import { obtenerMiMembresia } from "@/lib/membresias";
import { obtenerOCrearUsuarioActual } from "@/lib/usuarios";
import { requierePermiso, SinPermisoError } from "@/lib/permisos";
import { normalizarParametro, normalizarTextoBusqueda } from "@/lib/filtros-listado";
import { BotonLink } from "@/components/marco/Boton";
import { EncabezadoPagina } from "@/components/marco/EncabezadoPagina";
import { EstadoVacio } from "@/components/marco/EstadoVacio";
import { Pestanas, type Pestana } from "@/components/marco/Pestanas";
import { SinAcceso } from "@/components/marco/SinAcceso";
import { Tarjeta } from "@/components/marco/Tarjeta";
import { FormularioAnalizar } from "./FormularioAnalizar";
import { PanelInvestigacion } from "./PanelInvestigacion";
import styles from "./page.module.css";

// Issue #174 (Parte 1) + #197/#221/#225 — módulo "Investigación".
//
// Issue #227 — "quitar API de Investigación": smoke real de Sharel
// con "calzado" (Selltrix ~24 publicaciones con datos, Zilonix OS
// ~40, esta plataforma ~6 casi todas "Sin dato") confirmó que la API
// de catálogo de Mercado Libre (buscarInvestigacionProducto,
// lib/ml/investigacion.ts — BORRADO en este PR, nada más lo importa)
// no da volumen real. Demanda/Mercado/Estrategia dejan de depender de
// ella por completo: esta página ya NO llama a Mercado Libre — solo
// normaliza el término/pestaña de la URL y renderiza
// PanelInvestigacion.tsx (Client Component), que calcula las 3
// pestañas del lado del cliente a partir de bloques de listados
// reales escaneados por la extensión (issue #221/#225, lib/ml/listadoCliente.ts).
//
// /panel/investigacion/seguimiento NO se tocó — sigue 100% con la API
// de Mercado Libre, explícito en el pedido.
type Tab = "demanda" | "mercado" | "estrategia";

function esTabValida(valor: string | undefined): Tab {
  return valor === "mercado" || valor === "estrategia" ? valor : "demanda";
}

export default async function InvestigacionPage({ searchParams }: { searchParams: { termino?: string | string[]; tab?: string } }) {
  const usuario = await obtenerOCrearUsuarioActual();
  if (!usuario) redirect("/sign-in");

  const propias = await listarEmpresasDeUsuario(usuario.id);
  const empresaId = cookies().get("empresa_actual")?.value;
  const empresa = propias.find((e) => e.id === empresaId) ?? propias[0];
  if (!empresa) redirect("/crear-empresa");

  try {
    await requierePermiso(usuario.id, empresa.id, "inventario", "consultar");
  } catch (error) {
    if (!(error instanceof SinPermisoError)) throw error;
    const miMembresia = await obtenerMiMembresia(usuario.id, empresa.id);
    return <SinAcceso mensaje={`Tu rol (${miMembresia?.rolNombre ?? "sin rol"}) no tiene acceso a esta pantalla.`} />;
  }

  const terminoUrl = normalizarParametro(searchParams.termino);
  const termino = normalizarTextoBusqueda(terminoUrl) ?? "";
  const tab = esTabValida(normalizarParametro(searchParams.tab));

  const qsTab = (destino: Tab) => `?termino=${encodeURIComponent(termino)}&tab=${destino}`;
  const pestanas: Pestana[] = [
    { etiqueta: "Demanda", href: qsTab("demanda"), activa: tab === "demanda" },
    { etiqueta: "Mercado", href: qsTab("mercado"), activa: tab === "mercado" },
    { etiqueta: "Estrategia", href: qsTab("estrategia"), activa: tab === "estrategia" },
  ];

  return (
    <>
      <EncabezadoPagina
        titulo="Investigación"
        descripcion="Analiza un producto o nicho con listados reales de Mercado Libre y otras plataformas antes de invertir en él."
        accion={
          <BotonLink href="/panel/investigacion/seguimiento" variante="secundario" chico>
            Seguimiento diario
          </BotonLink>
        }
      />

      <Tarjeta className={styles.formulario}>
        <FormularioAnalizar termino={termino} tab={tab} />
        <p className={styles.ayuda}>
          Con la extensión de Zilonix instalada: Analizar escanea el listado real de Mercado Libre (tu país elegido) — ya no depende de la API de
          catálogo. Amazon, Temu, AliExpress, Shein y Alibaba se analizan con su propio botón, en la pestaña Demanda.
        </p>
      </Tarjeta>

      {!termino ? <EstadoVacio>Escribe un producto o nicho para analizar demanda, competencia y oportunidades.</EstadoVacio> : null}

      {termino ? (
        <div className={styles.resultado}>
          <Pestanas pestanas={pestanas} />
          <p className={styles.alcance}>
            Candidatos reales del listado de &quot;{termino}&quot; escaneado por la extensión — nunca el total del mercado (esa cifra no la expone
            ninguna de estas plataformas).
          </p>
          <PanelInvestigacion termino={termino} tab={tab} />
        </div>
      ) : null}

      <BotonLink href="/panel" variante="fantasma" chico className={styles.volver}>
        Volver al panel
      </BotonLink>
    </>
  );
}
