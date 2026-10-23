// Z-FIN-00 (issue #122), Parte 2 — diagnóstico de SOLO LECTURA del
// acceso de la app de Zilonix Seller a la API de Mercado Libre, cuenta
// por cuenta, para las capacidades (a)–(f) de la Fase 1 de finanzas.
//
// Qué NO hace, a propósito:
// - No escribe en Mercado Libre: toda llamada pasa por
//   leerParaDiagnostico() de lib/ml/cliente.ts, que solo hace GET.
// - No escribe en la base: solo lee cuentas_ml con dbComoEmpresa().
//   Tampoco renueva tokens (renovar escribe en cuentas_ml y quema el
//   refresh_token): un token vencido se informa como "token vencido".
// - No imprime tokens, montos, ids de órdenes ni datos de compradores:
//   solo estados, códigos HTTP, tiempos y nombres de campos con
//   presente/ausente (ver verificar-acceso-ml-logica.ts).
//
// Uso (Mateo, en staging, con el túnel privado y las variables ya
// cargadas en su terminal — nunca pegadas en un chat ni en el comando):
//
//   CONFIRMO_SOLO_LECTURA=si EMPRESA_ID=<uuid> npx tsx scripts/finanzas/verificar-acceso-ml.ts
//
// Variables: DATABASE_URL_APP, ML_TOKEN_KEY_V1, EMPRESA_ID,
// CONFIRMO_SOLO_LECTURA=si. Opcional: MUESTRA_PEDIDOS (1–10, por
// defecto 3) = cuántas órdenes recientes por cuenta se miran para
// juntar valores de logistic_type.
//
// Código 0 si terminó (aunque haya celdas en "falta permiso": ese es
// justamente el resultado que se busca). Código 1 si falta una
// variable o no se pudo leer la base.

import {
  ESTADOS_LIBERACION_CONOCIDOS,
  LOGISTIC_TYPES_CONOCIDOS,
  camposPresentes,
  clasificarStatus,
  errorSeguro,
  esperaBackoffMs,
  formatearDetalle,
  formatearTablaResumen,
  idItem,
  idNumerico,
  validarEntorno,
  valorDeListaBlanca,
  type Capacidad,
  type Estado,
  type ResultadoCapacidad,
  type ResultadoCuenta,
} from "./verificar-acceso-ml-logica";

const REINTENTOS_429 = 3;
const PAUSA_ENTRE_LLAMADAS_MS = 200;

const dormir = (ms: number) => new Promise((r) => setTimeout(r, ms));

function describirCampos(campos: Record<string, boolean>): string {
  return Object.entries(campos)
    .map(([nombre, vino]) => `${nombre}=${vino ? "sí" : "no"}`)
    .join(", ");
}

type Medidor = { llamadas: number; respuestas429: number; msTotal: number; msMaximo: number };

async function main() {
  const errores = validarEntorno(process.env);
  if (errores.length > 0) {
    for (const e of errores) console.error(e);
    process.exitCode = 1;
    return;
  }
  const empresaId = process.env.EMPRESA_ID as string;
  const muestra = Math.min(10, Math.max(1, Number(process.env.MUESTRA_PEDIDOS) || 3));

  // Import diferido: db/index.ts revienta al importarse sin
  // DATABASE_URL_APP, y queremos el mensaje claro de arriba primero.
  const { listarCuentasConectadas, obtenerAccessTokenSinRenovar } = await import("@/lib/ml/cuentas");
  const { leerParaDiagnostico } = await import("@/lib/ml/cliente");

  let cuentas: Awaited<ReturnType<typeof listarCuentasConectadas>>;
  try {
    cuentas = await listarCuentasConectadas(empresaId);
  } catch (error) {
    console.error(`No se pudieron leer las cuentas ML de la base (${errorSeguro(error)}). No se imprime el error crudo.`);
    process.exitCode = 1;
    return;
  }

  console.log(`Cuentas ML de la empresa: ${cuentas.length}. Muestra de órdenes por cuenta: ${muestra}.`);
  const resultados: ResultadoCuenta[] = [];
  const logisticTypesVistos = new Set<string>();

  for (const [indice, cuenta] of cuentas.entries()) {
    // El nickname es el nombre de la tienda propia (ya visible en el
    // panel), no un dato de comprador.
    const etiqueta = `Cuenta ${indice + 1} (${cuenta.nickname})`;
    const medidor: Medidor = { llamadas: 0, respuestas429: 0, msTotal: 0, msMaximo: 0 };
    const caps = {} as Record<Capacidad, ResultadoCapacidad>;
    const poner = (cap: Capacidad, estado: Estado, detalle: string) => (caps[cap] = { estado, detalle });

    const token = await obtenerAccessTokenSinRenovar(empresaId, cuenta.id).catch(() => null);
    if (!token || token.estado !== "vigente") {
      const estado: Estado = token?.estado === "desconectada" ? "desconectada" : token?.estado === "vencido" ? "token vencido" : "error";
      const siguiente =
        estado === "desconectada"
          ? "reconectar la cuenta desde /panel/conectar-ml"
          : estado === "token vencido"
            ? "abrir la cuenta en el panel para que la app renueve el token y volver a correr"
            : "no se pudo leer el token de la base";
      for (const cap of ["a", "b", "c", "d", "e", "f"] as Capacidad[]) poner(cap, cap === "a" ? estado : "sin muestra", cap === "a" ? siguiente : "depende de (a)");
      resultados.push({ etiqueta, capacidades: caps, ...medidor });
      continue;
    }

    const leer = async (ruta: string, apiVersion?: "1" | "2") => {
      for (let intento = 0; ; intento++) {
        await dormir(PAUSA_ENTRE_LLAMADAS_MS);
        const r = await leerParaDiagnostico(ruta, token.token, apiVersion);
        medidor.llamadas += 1;
        medidor.msTotal += r.ms;
        medidor.msMaximo = Math.max(medidor.msMaximo, r.ms);
        if (r.status !== 429) return r;
        medidor.respuestas429 += 1;
        if (intento >= REINTENTOS_429) return r;
        await dormir(esperaBackoffMs(intento));
      }
    };

    try {
      // (a) Token vigente y de la cuenta correcta.
      const yo = await leer("/users/me");
      const idYo = idNumerico((yo.data as { id?: unknown } | null)?.id);
      if (yo.status === 200 && idYo !== cuenta.cuentaIdExterna) {
        poner("a", "error", "HTTP 200 pero el token es de otra cuenta ML — reconectar");
      } else {
        poner("a", clasificarStatus(yo.status), `GET /users/me → HTTP ${yo.status}`);
      }

      // (b) Órdenes recientes → detalle de la primera.
      const vendedor = idNumerico(cuenta.cuentaIdExterna);
      const busqueda = vendedor ? await leer(`/orders/search?seller=${vendedor}&sort=date_desc&limit=${muestra}`) : null;
      const ordenes = ((busqueda?.data as { results?: { id?: unknown }[] } | null)?.results ?? [])
        .map((o) => idNumerico(o.id))
        .filter((id): id is string => id !== null);

      let detallePrimera: unknown = null;
      const envios: string[] = [];
      for (const [i, ordenId] of ordenes.entries()) {
        const det = await leer(`/orders/${ordenId}`);
        if (i === 0) {
          detallePrimera = det.data;
          const campos = camposPresentes(det.data, [
            "order_items[].item.id",
            "order_items[].item.seller_sku",
            "order_items[].sale_fee",
            "payments[].status",
            "payments[].date_approved",
            "payments[].marketplace_fee",
            "shipping.id",
          ]);
          let extra = "";
          const itemId = idItem((det.data as { order_items?: { item?: { id?: unknown } }[] } | null)?.order_items?.[0]?.item?.id);
          if (!campos["order_items[].item.seller_sku"] && itemId) {
            const item = await leer(`/items/${itemId}`);
            const camposItem = camposPresentes(item.data, ["seller_custom_field", "attributes[].id"]);
            extra = `; seller_sku vacío → GET /items/{id} HTTP ${item.status} (${describirCampos(camposItem)})`;
          }
          const ok = det.status === 200 && campos["payments[].marketplace_fee"] && campos["payments[].date_approved"];
          poner(
            "b",
            det.status !== 200 ? clasificarStatus(det.status) : ok ? "OK" : "no disponible",
            `GET /orders/search HTTP ${busqueda?.status}; GET /orders/{id} HTTP ${det.status} (${describirCampos(campos)})${extra}`
          );
        }
        const envioId = idNumerico((det.data as { shipping?: { id?: unknown } } | null)?.shipping?.id);
        if (envioId) envios.push(envioId);
      }
      if (!caps.b) {
        poner("b", busqueda && busqueda.status !== 200 ? clasificarStatus(busqueda.status) : "sin muestra", `GET /orders/search HTTP ${busqueda?.status ?? "-"}; sin órdenes recientes`);
      }

      // (c) Envío: forma de entrega en toda la muestra, costos y SLA en el primero.
      if (envios.length === 0) {
        poner("c", "sin muestra", "ninguna orden de la muestra trae shipping.id");
      } else {
        const tiposCuenta = new Set<string>();
        let detalleC = "";
        for (const [i, envioId] of envios.entries()) {
          const envio = await leer(`/shipments/${envioId}`);
          const tipo = valorDeListaBlanca((envio.data as { logistic_type?: unknown } | null)?.logistic_type, LOGISTIC_TYPES_CONOCIDOS);
          if (tipo) {
            tiposCuenta.add(tipo);
            logisticTypesVistos.add(tipo);
          }
          if (i === 0) {
            const costos = await leer(`/shipments/${envioId}/costs`);
            const sla = await leer(`/shipments/${envioId}/sla`);
            const camposCostos = camposPresentes(costos.data, ["senders[].cost", "receiver.cost"]);
            const llaves = costos.data && typeof costos.data === "object" ? Object.keys(costos.data).join("/") : "-";
            detalleC = `GET /shipments/{id} HTTP ${envio.status}; /costs HTTP ${costos.status} (llaves: ${llaves}; ${describirCampos(camposCostos)}); /sla HTTP ${sla.status}`;
            poner("c", envio.status !== 200 ? clasificarStatus(envio.status) : clasificarStatus(costos.status), detalleC);
          }
        }
        caps.c.detalle = `${detalleC}; logistic_type vistos: ${[...tiposCuenta].join(", ") || "ninguno"}`;
      }

      // (d) Liberación del pago — punto crítico del issue.
      if (ordenes.length === 0) {
        poner("d", "sin muestra", "sin órdenes recientes");
      } else {
        const lib = await leer(`/billing/integration/group/ML/order/details?order_ids=${ordenes[0]}`);
        const campos = camposPresentes(lib.data, [
          "results[].payment_info[].money_release_date",
          "results[].payment_info[].money_release_status",
          "results[].payment_info[].money_release_days",
        ]);
        const estadoLib = valorDeListaBlanca(
          (lib.data as { results?: { payment_info?: { money_release_status?: unknown }[] }[] } | null)?.results?.[0]?.payment_info?.[0]?.money_release_status,
          ESTADOS_LIBERACION_CONOCIDOS
        );
        const ok = lib.status === 200 && campos["results[].payment_info[].money_release_date"];
        poner(
          "d",
          lib.status !== 200 ? clasificarStatus(lib.status) : ok ? "OK" : "no disponible",
          `GET /billing/integration/group/ML/order/details HTTP ${lib.status} (${describirCampos(campos)}; money_release_status=${estadoLib ?? "-"})`
        );
      }

      // (e) Reembolsos (en el detalle de la orden), reclamos y devoluciones.
      const camposReembolso = camposPresentes(detallePrimera, ["payments[].transaction_amount_refunded", "status"]);
      const reclamos = vendedor ? await leer(`/post-purchase/v1/claims/search?players.user_id=${vendedor}&players.role=respondent&limit=1`) : null;
      const reclamoId = idNumerico((reclamos?.data as { data?: { id?: unknown }[] } | null)?.data?.[0]?.id);
      let devol = "sin reclamo de muestra";
      if (reclamoId) {
        const ret = await leer(`/post-purchase/v2/claims/${reclamoId}/returns`);
        devol = `GET /post-purchase/v2/claims/{id}/returns HTTP ${ret.status} (404 = ese reclamo no tiene devolución)`;
      }
      poner(
        "e",
        reclamos ? clasificarStatus(reclamos.status) : "error",
        `orden: ${describirCampos(camposReembolso)}; GET /post-purchase/v1/claims/search HTTP ${reclamos?.status ?? "-"}; ${devol}`
      );

      // (f) Publicidad: anunciante en MCO → campañas con costo de ayer.
      const anunciantes = await leer("/advertising/advertisers?product_id=PADS", "1");
      const lista = (anunciantes.data as { advertisers?: { advertiser_id?: unknown; site_id?: unknown }[] } | null)?.advertisers ?? [];
      const anuncianteId = idNumerico(lista.find((a) => a.site_id === "MCO")?.advertiser_id);
      if (!anuncianteId) {
        poner("f", anunciantes.status === 200 ? "sin muestra" : clasificarStatus(anunciantes.status), `GET /advertising/advertisers HTTP ${anunciantes.status}; sin anunciante MCO`);
      } else {
        const ayer = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
        const campanas = await leer(
          `/advertising/MCO/advertisers/${anuncianteId}/product_ads/campaigns/search?date_from=${ayer}&date_to=${ayer}&metrics=cost`,
          "2"
        );
        const campos = camposPresentes(campanas.data, ["results[].id", "results[].metrics.cost"]);
        poner(
          "f",
          clasificarStatus(campanas.status),
          `GET /advertising/advertisers HTTP ${anunciantes.status}; GET .../product_ads/campaigns/search (1 día) HTTP ${campanas.status} (${describirCampos(campos)}); IVA: la API no lo indica, ver doc`
        );
      }
    } catch (error) {
      for (const cap of ["a", "b", "c", "d", "e", "f"] as Capacidad[]) {
        if (!caps[cap]) poner(cap, "error", `se cortó la cuenta (${errorSeguro(error)})`);
      }
    }

    resultados.push({ etiqueta, capacidades: caps, ...medidor });
  }

  console.log("\n## Cuenta × capacidad\n");
  console.log(formatearTablaResumen(resultados));
  console.log("\n## Detalle (códigos y nombres de campos, sin valores)\n");
  console.log(formatearDetalle(resultados));
  const nuevos = logisticTypesVistos.has("(valor nuevo)") ? " — OJO: apareció al menos un logistic_type que no está en la lista conocida" : "";
  console.log(`\nlogistic_type vistos en total: ${[...logisticTypesVistos].join(", ") || "ninguno"}${nuevos}`);
  const total429 = resultados.reduce((s, r) => s + r.respuestas429, 0);
  const totalMs = resultados.reduce((s, r) => s + r.msTotal, 0);
  console.log(`Total: ${resultados.reduce((s, r) => s + r.llamadas, 0)} llamadas, ${total429} respuestas 429, ${totalMs} ms acumulados en llamadas.`);
  process.exit(0);
}

main().catch((error) => {
  console.error(`El diagnóstico se cortó (${errorSeguro(error)}). No se imprime el error crudo.`);
  process.exit(1);
});
