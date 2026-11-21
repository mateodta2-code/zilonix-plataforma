import { CeldaTabla, FilaTabla, Tabla } from "@/components/marco/Tabla";
import { Chip } from "@/components/marco/Chip";
import type { CambioBitacora } from "@/lib/optimizacion/bitacora";
import { RESULTADOS_REVISION, type ResultadoCambio } from "@/lib/optimizacion/bitacoraResultado";
import { NotaBitacora, RevisarCambio } from "./AccionesBitacora";
import { variacion, type ResumenPeriodo } from "@/lib/optimizacion/calculos";
import styles from "../page.module.css";

// Bitácora de cambios de la publicación: cada cambio hecho desde
// Optimización y cada nota a mano, con su resultado a los 7 días (semana
// antes vs. semana desde el cambio) y su revisión (sirvió / no sirvió /
// sin cambio). Anotar y revisar piden el mismo permiso que editar.
export function BitacoraCambios({
  cambios,
  resultados,
  plata,
  num,
  pct,
  idioma,
  conFinanzas,
  cuentaMlId,
  itemId,
  hoy,
  puedeEditar,
}: {
  cambios: CambioBitacora[];
  resultados: Map<string, ResultadoCambio>;
  plata: (v: string | null) => string;
  num: (v: number | null) => string;
  pct: (v: string | null) => string;
  idioma: string;
  conFinanzas: boolean;
  cuentaMlId: string;
  itemId: string;
  hoy: string;
  puedeEditar: boolean;
}) {
  const fecha = (ts: Date) => ts.toLocaleDateString(idioma, { day: "numeric", month: "short", year: "numeric", timeZone: "America/Bogota" });
  const valor = (c: CambioBitacora, v: string | null) => (v === null ? "—" : c.accion === "cambiar_precio_publicacion" ? plata(v) : v.length > 60 ? `${v.slice(0, 57)}…` : v);
  const cambio = (c: CambioBitacora) => {
    if (c.origen === "nota") return `Nota: ${c.detalle ?? ""}`;
    if (c.valorAnterior !== null || c.valorNuevo !== null) return `${c.rotulo}: ${valor(c, c.valorAnterior)} → ${valor(c, c.valorNuevo)}`;
    return c.accion === "cambiar_fotos_publicacion" && c.detalle ? c.detalle : c.rotulo;
  };
  const flecha = (a: string | number | null, b: string | number | null) => {
    const v = variacion(a, b === null ? null : b);
    return v === null ? "" : ` (${Number(v) > 0 ? "+" : ""}${Number(v).toLocaleString(idioma, { maximumFractionDigits: 0 })} %)`;
  };
  const resumen = (antes: ResumenPeriodo, despues: ResumenPeriodo) => {
    const partes = [
      `Visitas ${num(antes.visitas)} → ${num(despues.visitas)}${flecha(despues.visitas, antes.visitas)}`,
      `Ventas ${num(antes.pedidos)} → ${num(despues.pedidos)}${flecha(despues.pedidos, antes.pedidos)}`,
      `Conversión ${pct(antes.conversion)} → ${pct(despues.conversion)}`,
    ];
    if (conFinanzas) partes.push(`Utilidad ${plata(antes.ganancia)} → ${plata(despues.ganancia)}`);
    return partes.join(" · ");
  };
  // Mejoró si subieron las ventas (o, a igual venta, las visitas).
  const juicio = (antes: ResumenPeriodo, despues: ResumenPeriodo): "exito" | "peligro" | "neutro" => {
    if (despues.pedidos !== antes.pedidos) return despues.pedidos > antes.pedidos ? "exito" : "peligro";
    if (antes.visitas !== null && despues.visitas !== null && despues.visitas !== antes.visitas) return despues.visitas > antes.visitas ? "exito" : "peligro";
    return "neutro";
  };

  return (
    <>
      <p className={styles.seccion}>Bitácora de cambios</p>
      {puedeEditar ? <NotaBitacora cuentaMlId={cuentaMlId} itemId={itemId} hoy={hoy} /> : null}
      {cambios.length === 0 ? (
        <p className={styles.nota}>Todavía no hay cambios en esta publicación. Cada cambio de precio, título, fotos o estado hecho desde Zilonix queda aquí; los que hagas fuera de Zilonix, anótalos con «Anotar un cambio». A los 7 días ves si funcionó.</p>
      ) : (
        <Tabla encabezados={["Fecha", "Cambio", "Quién", "Resultado (7 días antes vs. 7 días después)", "Revisión"]}>
          {cambios.map((c) => {
            const r = resultados.get(c.ref);
            const revision = c.revision ? RESULTADOS_REVISION.find((x) => x.id === c.revision?.resultado) : null;
            return (
              <FilaTabla key={c.id}>
                <CeldaTabla>{fecha(c.ts)}</CeldaTabla>
                <CeldaTabla>{cambio(c)}</CeldaTabla>
                <CeldaTabla>{c.usuario ?? "—"}</CeldaTabla>
                <CeldaTabla>
                  {!r ? (
                    "—"
                  ) : r.estado === "midiendo" ? (
                    <Chip estado="aviso">{`En medición: ${r.faltanDias === 1 ? "falta 1 día" : `faltan ${r.faltanDias} días`}`}</Chip>
                  ) : (
                    <span className={styles.resultadoCambio}>
                      <Chip estado={juicio(r.antes, r.despues)}>{juicio(r.antes, r.despues) === "exito" ? "Mejoró" : juicio(r.antes, r.despues) === "peligro" ? "Empeoró" : "Igual"}</Chip>
                      <span>{resumen(r.antes, r.despues)}</span>
                    </span>
                  )}
                </CeldaTabla>
                <CeldaTabla>
                  <span className={styles.revisionCelda}>
                    {c.revision && revision ? (
                      <span>
                        <Chip estado={c.revision.resultado === "sirvio" ? "exito" : c.revision.resultado === "no_sirvio" ? "peligro" : "neutro"}>{revision.rotulo}</Chip>
                        <span className={styles.notaNeutra}>
                          {` ${c.revision.usuario ?? ""} · ${fecha(c.revision.ts)}`}
                          {c.revision.comentario ? ` · «${c.revision.comentario}»` : ""}
                        </span>
                      </span>
                    ) : r?.estado === "listo" ? (
                      <span className={styles.notaNeutra}>Sin revisar</span>
                    ) : null}
                    {puedeEditar ? (
                      <RevisarCambio
                        cuentaMlId={cuentaMlId}
                        itemId={itemId}
                        refCambio={c.ref}
                        actual={c.revision ? { resultado: c.revision.resultado, comentario: c.revision.comentario } : null}
                      />
                    ) : null}
                  </span>
                </CeldaTabla>
              </FilaTabla>
            );
          })}
        </Tabla>
      )}
      <p className={styles.nota}>Los cambios hechos directamente en Mercado Libre no quedan solos: anótalos con «Anotar un cambio». El resultado compara semanas completas y también lo afectan la temporada, la publicidad y la competencia.</p>
    </>
  );
}
