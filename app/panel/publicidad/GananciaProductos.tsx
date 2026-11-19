import { Boton } from "@/components/marco/Boton";
import Link from "next/link";
import { Ayuda } from "@/components/marco/Ayuda";
import { Chip } from "@/components/marco/Chip";
import { EstadoVacio } from "@/components/marco/EstadoVacio";
import { RejillaKpi } from "@/components/marco/RejillaKpi";
import { CeldaTabla, FilaTabla, Tabla, type EncabezadoTabla } from "@/components/marco/Tabla";
import { Tarjeta } from "@/components/marco/Tarjeta";
import { TarjetaKpi } from "@/components/marco/TarjetaKpi";
import { fechaHoraBogota } from "@/components/finanzas/formato";
import type { GananciaProductos as DatosGanancia } from "@/lib/publicidad/consultas";
import { mostrarFraccion } from "@/lib/publicidad/formato";
import {
  filtrarGanancia,
  resumenGanancia,
  type BandaGanancia,
  type FiltroAnunciado,
  type FiltroBanda,
  type FiltrosGanancia,
  type FilaGanancia,
} from "@/lib/publicidad/ganancia";
import { mitadDeMeta } from "@/lib/publicidad/meta-margen";
import { hrefPublicidad, type HrefPublicidad } from "@/lib/publicidad/params";
import styles from "./page.module.css";
import { pintarMargen, plataVisible } from "./vista";

// Issue #256 — pestaña "Ganancia real por producto". Solo lectura: los
// costos son de Finanzas y los precios y comisiones, la última foto que
// guardó "Actualizar ahora". Nada de acá escribe en Mercado Libre.

const ROTULO_BANDA: Record<FiltroBanda, string> = {
  todas: "Todas",
  verde: "En meta",
  amarillo: "Bajo meta",
  rojo: "Muy bajo",
  sin_dato: "Sin dato",
};

const ROTULO_ANUNCIADO: Record<FiltroAnunciado, string> = {
  todos: "Todos",
  si: "Anunciados",
  no: "Sin anuncio",
};

const CLASE_BANDA: Record<BandaGanancia, string | undefined> = {
  verde: styles.bandaVerde,
  amarillo: styles.bandaAmbar,
  rojo: styles.bandaRoja,
  sin_dato: undefined,
};

const ENCABEZADOS: EncabezadoTabla[] = [
  { clave: "producto", contenido: "Producto" },
  { clave: "precio", contenido: "Precio vigente", numerica: true },
  { clave: "costo", contenido: "Costo total", numerica: true },
  { clave: "comision", contenido: "Comisión ML", numerica: true },
  { clave: "envio", contenido: "Envío", numerica: true },
  { clave: "ganancia", contenido: "Ganancia", numerica: true },
  { clave: "margen", contenido: "Margen", numerica: true },
];

export function GananciaProductos({
  datos,
  filtros,
  siteId,
  hrefBase,
}: {
  datos: DatosGanancia;
  filtros: FiltrosGanancia;
  siteId: string;
  hrefBase: HrefPublicidad;
}) {
  const { filas, conteos } = filtrarGanancia(datos.filas, filtros);
  const resumen = resumenGanancia(filas);
  const meta = datos.metaMargen;
  const href = (cambio: Partial<HrefPublicidad>) =>
    hrefPublicidad({
      ...hrefBase,
      tab: "ganancia",
      q: filtros.texto,
      banda: filtros.banda,
      anunciado: filtros.anunciado,
      ...cambio,
    });

  return (
    <Tarjeta className={styles.tarjetaGanancia}>
      <div className={styles.toolbar}>
        <p className={styles.seccion}>Ganancia real por producto</p>
        <span className={styles.nota}>
          {datos.consultadoTs
            ? `Precios y comisiones consultados a Mercado Libre el ${fechaHoraBogota(datos.consultadoTs)}`
            : "Todavía no hay precios ni comisiones consultados a Mercado Libre. Usá Actualizar ahora."}
        </span>
      </div>

      <form method="get" action="/panel/publicidad" className={styles.barra}>
        {hrefBase.cuenta ? <input type="hidden" name="cuenta" value={hrefBase.cuenta} /> : null}
        <input type="hidden" name="tab" value="ganancia" />
        {filtros.banda !== "todas" ? <input type="hidden" name="banda" value={filtros.banda} /> : null}
        {filtros.anunciado !== "todos" ? <input type="hidden" name="anunciado" value={filtros.anunciado} /> : null}
        <label className={styles.campo}>
          <span className="zx-etiqueta">Buscar producto o SKU</span>
          <input
            className="zx-control"
            type="search"
            name="q"
            defaultValue={filtros.texto}
            maxLength={100}
            placeholder="Título, SKU o código de la publicación"
          />
        </label>
        <Boton type="submit">
          Buscar
        </Boton>
      </form>

      <div className={styles.filtrosGanancia}>
        <span className={styles.filtro} aria-label="Filtrar por margen">
          {(Object.keys(ROTULO_BANDA) as FiltroBanda[]).map((banda) => (
            <Link key={banda} scroll={false} href={href({ banda })} aria-current={filtros.banda === banda ? "page" : undefined}>
              {`${ROTULO_BANDA[banda]} (${conteos[banda]})`}
            </Link>
          ))}
        </span>
        <span className={styles.filtro} aria-label="Filtrar por anuncio">
          {(Object.keys(ROTULO_ANUNCIADO) as FiltroAnunciado[]).map((anunciado) => (
            <Link
              key={anunciado}
              scroll={false}
              href={href({ anunciado })}
              aria-current={filtros.anunciado === anunciado ? "page" : undefined}
            >
              {ROTULO_ANUNCIADO[anunciado]}
            </Link>
          ))}
        </span>
      </div>

      <RejillaKpi>
        <TarjetaKpi titulo="Productos" valor={String(resumen.productos)} />
        <TarjetaKpi
          titulo="Ganancia promedio"
          valor={resumen.gananciaPromedio === null ? "—" : plataVisible(resumen.gananciaPromedio, siteId)}
          detalle={[`Por unidad, de ${resumen.conCalculo} con todos los datos`]}
        />
        <TarjetaKpi
          titulo="Margen promedio"
          valor={mostrarFraccion(resumen.margenPromedio)}
          detalle={[`Meta ${mostrarFraccion(meta)} · amarillo desde ${mostrarFraccion(mitadDeMeta(meta))}`]}
        />
      </RejillaKpi>

      {filas.length === 0 ? (
        <EstadoVacio>
          {datos.filas.length === 0 ? "No hay publicaciones sincronizadas en esta cuenta." : "Ningún producto coincide con el filtro."}
        </EstadoVacio>
      ) : (
        <Tabla encabezados={ENCABEZADOS} scroll>
          {filas.map((fila) => (
            <FilaGananciaProducto key={fila.itemId} fila={fila} meta={meta} siteId={siteId} />
          ))}
        </Tabla>
      )}

      <p className={styles.nota}>
        Ganancia = precio vigente − costo total − comisión ML − envío (solo si lo paga el vendedor). No incluye la publicidad. El costo
        total (costo + empaque + envío a agencia) sale de la tabla de costos de Finanzas; en Full el envío a agencia no se cobra. Precio,
        comisión y envío salen de Mercado Libre; el envío es un estimado para una unidad. Si falta un dato se muestra “—”.
      </p>
    </Tarjeta>
  );
}

function FilaGananciaProducto({ fila, meta, siteId }: { fila: FilaGanancia; meta: string; siteId: string }) {
  const plata = (valor: string | null) => plataVisible(valor, siteId);
  const margen = pintarMargen(fila.resultado, meta);
  const costo =
    fila.resultado.tipo === "sin_sku" ? (
      <span className={styles.notaNeutra}>Sin SKU</span>
    ) : fila.resultado.tipo === "sin_costo" ? (
      <span className={styles.notaNeutra}>Sin costo</span>
    ) : (
      plata(fila.costoTotal)
    );
  return (
    <FilaTabla className={CLASE_BANDA[fila.banda]}>
      <CeldaTabla>
        <span className={styles.productoTitulo}>{fila.titulo ?? fila.itemId}</span>
        <span className={styles.notaNeutra}>
          {[fila.sku ?? "Sin SKU", fila.itemId, fila.full ? "Full" : null].filter(Boolean).join(" · ")}
        </span>
      </CeldaTabla>
      <CeldaTabla numerica>
        {fila.precioRegular ? (
          <span className={styles.thConAyuda}>
            {plata(fila.precio)}
            <Ayuda id={`ayuda-precio-${fila.itemId}`}>{`Con promoción. Precio regular ${plata(fila.precioRegular)}.`}</Ayuda>
          </span>
        ) : (
          plata(fila.precio)
        )}
      </CeldaTabla>
      <CeldaTabla numerica>{costo}</CeldaTabla>
      <CeldaTabla numerica>{plata(fila.comisionMl)}</CeldaTabla>
      <CeldaTabla numerica>
        {fila.envio.tipo === "comprador" ? (
          `${plata("0")} · comprador`
        ) : fila.envio.tipo === "estimado" ? (
          <>
            {plata(fila.envio.monto)}
            <span className={styles.notaNeutra}>estimado</span>
          </>
        ) : (
          "—"
        )}
      </CeldaTabla>
      <CeldaTabla numerica>{fila.resultado.tipo === "ok" ? plata(fila.resultado.ganancia) : "—"}</CeldaTabla>
      <CeldaTabla numerica>
        <Chip estado={margen.margenTono} title={margen.margenTitulo}>
          {margen.margen}
        </Chip>
      </CeldaTabla>
    </FilaTabla>
  );
}
