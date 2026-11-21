import { obtenerContextoPanel } from "@/lib/panel-contexto";
import { requierePermiso, SinPermisoError } from "@/lib/permisos";
import { leerCorteFalabella, type TotalesCategoria } from "@/lib/falabella/conciliacion";
import { ChipsEstadoPago } from "@/components/finanzas/ChipEstadoPago";
import { mostrarMontoIso } from "@/components/finanzas/formato";
import { BotonLink } from "@/components/marco/Boton";
import { EncabezadoPagina } from "@/components/marco/EncabezadoPagina";
import { EstadoVacio } from "@/components/marco/EstadoVacio";
import { SinAcceso } from "@/components/marco/SinAcceso";
import { CeldaTabla, FilaTabla, Tabla } from "@/components/marco/Tabla";
import { Tarjeta } from "@/components/marco/Tarjeta";
import { TarjetaKpi } from "@/components/marco/TarjetaKpi";
import styles from "../../finanzas.module.css";

// Issue #422 — detalle de un corte de Falabella: totales por grupo, el
// neto, y por orden cuánto vendió, cuánto cobró Falabella y cuánto se
// pagó. Las retenciones van aparte y NO bajan la utilidad: son un saldo
// a favor en impuestos. Solo lectura: finanzas.consultar (en
// lib/falabella/conciliacion.ts).

const GRUPOS: { categoria: keyof TotalesCategoria; titulo: string }[] = [
  { categoria: "precio", titulo: "Precio de productos" },
  { categoria: "comision", titulo: "Comisiones" },
  { categoria: "envio", titulo: "Envíos" },
  { categoria: "promocion", titulo: "Cupones y promociones" },
  { categoria: "publicidad", titulo: "Publicidad" },
  { categoria: "fulfillment", titulo: "Fulfillment" },
  { categoria: "devolucion", titulo: "Devoluciones" },
  { categoria: "ajuste", titulo: "Ajustes y compensaciones" },
  { categoria: "otro", titulo: "Otros" },
];

function texto(valor: string | string[] | undefined): string | null {
  return typeof valor === "string" && valor.trim() !== "" ? valor : null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function CorteFalabellaPage({ searchParams }: { searchParams: Record<string, string | string[] | undefined> }) {
  const { usuario, activa: empresa, rolNombre } = await obtenerContextoPanel();
  const cuentaId = texto(searchParams.cuenta);
  const corte = texto(searchParams.corte);
  const moneda = texto(searchParams.moneda);

  const volver = (
    <BotonLink href="/panel/finanzas/falabella" variante="fantasma" className={styles.volver}>
      Volver a la conciliación
    </BotonLink>
  );

  let detalle = null;
  try {
    await requierePermiso(usuario.id, empresa.id, "finanzas", "consultar");
    if (cuentaId && UUID.test(cuentaId) && corte && moneda) {
      detalle = await leerCorteFalabella(empresa.id, usuario.id, { cuentaId, estadoCuenta: corte, moneda });
    }
  } catch (error) {
    if (!(error instanceof SinPermisoError)) throw error;
    return <SinAcceso mensaje={`Tu rol (${rolNombre}) no tiene acceso a Finanzas.`} />;
  }

  if (!detalle) {
    return (
      <>
        <EncabezadoPagina titulo="Corte de Falabella" />
        <EstadoVacio>No encontramos ese corte. Vuelve a la lista y elígelo de nuevo.</EstadoVacio>
        {volver}
      </>
    );
  }

  const m = (valor: string) => mostrarMontoIso(valor, detalle.moneda);
  const gruposConMovimiento = GRUPOS.filter((g) => g.categoria === "precio" || Number(detalle.totales[g.categoria]) !== 0);

  return (
    <>
      <EncabezadoPagina titulo={detalle.estadoCuenta ?? "Líneas sin estado de cuenta"} descripcion={`Cuenta de Falabella: ${detalle.cuenta}`} />
      <section className={styles.tablero}>
        <div className={styles.gridKpi}>
          <TarjetaKpi
            titulo="Pago a recibir"
            junto={<ChipsEstadoPago estados={detalle.estadosPago} />}
            valor={m(detalle.pagoARecibir)}
            detalle={["Suma de todas las líneas del corte: lo que Falabella te paga o te va a pagar."]}
          />
          <TarjetaKpi
            titulo="Neto antes de retenciones"
            valor={m(detalle.netoAntesDeRetenciones)}
            detalle={["Precio menos lo que cobró Falabella. Es el neto para la utilidad: las retenciones no son un costo."]}
          />
          <TarjetaKpi
            titulo="Retenciones"
            valor={m(detalle.totales.retencion)}
            detalle={["Retención en la fuente, IVA e ICA. Saldo a favor en tus impuestos: no se resta de la utilidad."]}
          />
        </div>
      </section>

      <Tarjeta>
        <h2 className={styles.tituloSeccion}>Detalle del corte</h2>
        <Tabla encabezados={["Concepto", { clave: "monto", contenido: "Monto", numerica: true }]}>
          {gruposConMovimiento.map((g) => (
            <FilaTabla key={g.categoria}>
              <CeldaTabla>{g.titulo}</CeldaTabla>
              <CeldaTabla numerica>{m(detalle.totales[g.categoria])}</CeldaTabla>
            </FilaTabla>
          ))}
          <FilaTabla>
            <CeldaTabla>
              <strong>Neto antes de retenciones</strong>
            </CeldaTabla>
            <CeldaTabla numerica>
              <strong>{m(detalle.netoAntesDeRetenciones)}</strong>
            </CeldaTabla>
          </FilaTabla>
          <FilaTabla>
            <CeldaTabla>Retenciones (saldo a favor en impuestos)</CeldaTabla>
            <CeldaTabla numerica>{m(detalle.totales.retencion)}</CeldaTabla>
          </FilaTabla>
          <FilaTabla>
            <CeldaTabla>
              <strong>Pago a recibir</strong>
            </CeldaTabla>
            <CeldaTabla numerica>
              <strong>{m(detalle.pagoARecibir)}</strong>
            </CeldaTabla>
          </FilaTabla>
        </Tabla>
      </Tarjeta>

      <Tarjeta>
        <h2 className={styles.tituloSeccion}>Por orden</h2>
        <p className={styles.ayuda}>
          Las órdenes en $0 con solo retenciones se vendieron en un corte anterior; Falabella les aplicó la retención en este corte.
        </p>
        <p className={styles.ayuda}>
          Cobró Falabella: comisiones, envíos, promociones, publicidad y demás cobros. Las líneas sin Nº de orden (publicidad y otros servicios) van
          juntas al final.
        </p>
        <Tabla
          encabezados={[
            "Orden",
            { clave: "vendido", contenido: "Vendió", numerica: true },
            { clave: "cobrado", contenido: "Cobró Falabella", numerica: true },
            { clave: "retenciones", contenido: "Retenciones", numerica: true },
            { clave: "neto", contenido: "Neto del corte", numerica: true },
          ]}
        >
          {detalle.ordenes.map((o) => (
            <FilaTabla key={o.numeroOrden ?? "sin-orden"}>
              <CeldaTabla>{o.numeroOrden ?? "Sin orden"}</CeldaTabla>
              <CeldaTabla numerica>{m(o.vendido)}</CeldaTabla>
              <CeldaTabla numerica>{m(o.cobradoFalabella)}</CeldaTabla>
              <CeldaTabla numerica>{m(o.retenciones)}</CeldaTabla>
              <CeldaTabla numerica>{m(o.netoCorte)}</CeldaTabla>
            </FilaTabla>
          ))}
        </Tabla>
      </Tarjeta>
      {volver}
    </>
  );
}
