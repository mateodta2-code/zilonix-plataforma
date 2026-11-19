// Issue #422 (cuentas por cobrar) — cálculo puro de lo que las
// plataformas le deben a la empresa: Mercado Libre (ventas con la plata
// sin liberar) y Falabella (cortes Abierto, Procesando cierre o Pago
// programado). Sin base ni red: la consulta vive en por-cobrar-consulta.ts.
//
// Nunca se suman monedas distintas: cada total va por moneda (la de cada
// cuenta). Montos en texto y BigInt, nunca Number: Falabella guarda 4
// decimales y la suma tiene que cuadrar con el corte.

export const MARKETPLACES_POR_COBRAR = ["ml", "falabella"] as const;
export type MarketplacePorCobrar = (typeof MARKETPLACES_POR_COBRAR)[number];

export const ETIQUETA_MARKETPLACE: Record<MarketplacePorCobrar, string> = {
  ml: "Mercado Libre",
  falabella: "Falabella",
};

// Estados de pago del «Reporte de transacciones» que todavía no son plata
// en la cuenta. «Pagado» ya entró; «No pagado» no se espera.
export const ESTADOS_FALABELLA_POR_COBRAR = ["Abierto", "Procesando cierre", "Pago programado"] as const;

export type PartidaPorCobrar = {
  marketplace: MarketplacePorCobrar;
  cuentaId: string;
  cuenta: string;
  moneda: string;
  // Nº de orden de ML o Nº de estado de cuenta de Falabella.
  referencia: string;
  // Estado tal cual lo da la plataforma (pending, Pago programado…).
  estado: string | null;
  // Día de Bogotá (AAAA-MM-DD) en que se espera la plata; null = sin fecha
  // (Falabella no la trae en el reporte).
  fechaEsperada: string | null;
  monto: string;
};

// ---------- Montos (diezmilésimas, BigInt) ----------

const ESCALA = BigInt(10_000);
const CERO = BigInt(0);
const PATRON = /^(-?)(\d+)(?:\.(\d{1,4}))?$/;

export function aDiezmilesimas(monto: string): bigint {
  const m = PATRON.exec(monto.trim());
  if (!m) throw new Error(`Monto inválido: ${JSON.stringify(monto)}`);
  const valor = BigInt(m[2]) * ESCALA + BigInt(((m[3] ?? "") + "0000").slice(0, 4));
  return m[1] === "-" ? -valor : valor;
}

// A 2 decimales, la mitad lejos de cero (como el resto de Finanzas).
export function aTextoMonto(valor: bigint): string {
  const negativo = valor < CERO;
  const abs = negativo ? -valor : valor;
  const centavos = (abs + BigInt(50)) / BigInt(100);
  const texto = `${centavos / BigInt(100)}.${(centavos % BigInt(100)).toString().padStart(2, "0")}`;
  return negativo && centavos !== CERO ? `-${texto}` : texto;
}

// ---------- Ventanas de fechas (Bogotá) ----------

const DESFASE_BOGOTA_MS = 5 * 60 * 60 * 1000;
const DIA_MS = 86_400_000;

export type Ventana = { desde: string; hasta: string };
export type Ventanas = { hoy: string; semana: Ventana; proximoMes: Ventana };

const dia = (ms: number) => new Date(ms).toISOString().slice(0, 10);

// «Esta semana» = de hoy al domingo (semana de lunes a domingo).
// «Próximo mes» = el mes calendario siguiente completo.
export function ventanasBogota(ahora: Date): Ventanas {
  const local = new Date(ahora.getTime() - DESFASE_BOGOTA_MS);
  const hoyMs = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate());
  const diasHastaDomingo = (7 - local.getUTCDay()) % 7;
  const inicioProximo = Date.UTC(local.getUTCFullYear(), local.getUTCMonth() + 1, 1);
  const finProximo = Date.UTC(local.getUTCFullYear(), local.getUTCMonth() + 2, 0);
  return {
    hoy: dia(hoyMs),
    semana: { desde: dia(hoyMs), hasta: dia(hoyMs + diasHastaDomingo * DIA_MS) },
    proximoMes: { desde: dia(inicioProximo), hasta: dia(finProximo) },
  };
}

// Una fecha ya pasada que sigue por cobrar cuenta en «esta semana»: es
// plata que debería estar entrando ya.
const entraEstaSemana = (fecha: string | null, v: Ventanas) => fecha !== null && fecha <= v.semana.hasta;
const entraProximoMes = (fecha: string | null, v: Ventanas) => fecha !== null && fecha >= v.proximoMes.desde && fecha <= v.proximoMes.hasta;

// ---------- Resúmenes ----------

export type TotalesMoneda = {
  moneda: string;
  partidas: number;
  total: string;
  estaSemana: string;
  proximoMes: string;
  sinFecha: string;
};

type Acumulado = { partidas: number; total: bigint; estaSemana: bigint; proximoMes: bigint; sinFecha: bigint };
const nuevo = (): Acumulado => ({ partidas: 0, total: CERO, estaSemana: CERO, proximoMes: CERO, sinFecha: CERO });

function acumular(a: Acumulado, p: PartidaPorCobrar, v: Ventanas): void {
  const monto = aDiezmilesimas(p.monto);
  a.partidas += 1;
  a.total += monto;
  if (entraEstaSemana(p.fechaEsperada, v)) a.estaSemana += monto;
  if (entraProximoMes(p.fechaEsperada, v)) a.proximoMes += monto;
  if (p.fechaEsperada === null) a.sinFecha += monto;
}

const textos = (a: Acumulado) => ({
  partidas: a.partidas,
  total: aTextoMonto(a.total),
  estaSemana: aTextoMonto(a.estaSemana),
  proximoMes: aTextoMonto(a.proximoMes),
  sinFecha: aTextoMonto(a.sinFecha),
});

export function resumirPorMoneda(partidas: PartidaPorCobrar[], v: Ventanas): TotalesMoneda[] {
  const porMoneda = new Map<string, Acumulado>();
  for (const p of partidas) {
    if (!porMoneda.has(p.moneda)) porMoneda.set(p.moneda, nuevo());
    acumular(porMoneda.get(p.moneda)!, p, v);
  }
  return [...porMoneda.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([moneda, a]) => ({ moneda, ...textos(a) }));
}

export type FilaCuenta = TotalesMoneda & {
  marketplace: MarketplacePorCobrar;
  cuentaId: string;
  cuenta: string;
  proximaFecha: string | null;
};

// Una fila por plataforma, cuenta y moneda; Mercado Libre primero.
export function agruparPorCuenta(partidas: PartidaPorCobrar[], v: Ventanas): FilaCuenta[] {
  const grupos = new Map<string, { base: PartidaPorCobrar; a: Acumulado; proxima: string | null }>();
  for (const p of partidas) {
    const clave = `${p.marketplace}|${p.cuentaId}|${p.moneda}`;
    let g = grupos.get(clave);
    if (!g) grupos.set(clave, (g = { base: p, a: nuevo(), proxima: null }));
    acumular(g.a, p, v);
    if (p.fechaEsperada !== null && (g.proxima === null || p.fechaEsperada < g.proxima)) g.proxima = p.fechaEsperada;
  }
  const orden = (m: MarketplacePorCobrar) => MARKETPLACES_POR_COBRAR.indexOf(m);
  return [...grupos.values()]
    .map(({ base, a, proxima }) => ({
      marketplace: base.marketplace,
      cuentaId: base.cuentaId,
      cuenta: base.cuenta,
      moneda: base.moneda,
      proximaFecha: proxima,
      ...textos(a),
    }))
    .sort((x, y) => orden(x.marketplace) - orden(y.marketplace) || x.cuenta.localeCompare(y.cuenta) || x.moneda.localeCompare(y.moneda));
}

// Detalle: primero lo que entra antes; lo sin fecha al final.
export function ordenarPartidas(partidas: PartidaPorCobrar[]): PartidaPorCobrar[] {
  return [...partidas].sort((a, b) => {
    if (a.fechaEsperada !== b.fechaEsperada) {
      if (a.fechaEsperada === null) return 1;
      if (b.fechaEsperada === null) return -1;
      return a.fechaEsperada.localeCompare(b.fechaEsperada);
    }
    return a.cuenta.localeCompare(b.cuenta) || a.referencia.localeCompare(b.referencia);
  });
}

// ---------- Filtros de la URL ----------

export type FiltrosPorCobrar = { marketplace: MarketplacePorCobrar | null; cuentaId: string | null };

const PATRON_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Lista blanca: un marketplace desconocido o una cuenta que no es uuid se
// ignoran (se ve todo), nunca llegan a la consulta.
export function leerFiltrosPorCobrar(params: Record<string, string | string[] | undefined>): FiltrosPorCobrar {
  const uno = (v: string | string[] | undefined) => (typeof v === "string" ? v : undefined);
  const marketplace = uno(params.marketplace);
  const cuenta = uno(params.cuenta);
  return {
    marketplace: MARKETPLACES_POR_COBRAR.find((m) => m === marketplace) ?? null,
    cuentaId: cuenta && PATRON_UUID.test(cuenta) ? cuenta : null,
  };
}

export function filtrarPartidas(partidas: PartidaPorCobrar[], f: FiltrosPorCobrar): PartidaPorCobrar[] {
  return partidas.filter((p) => (!f.marketplace || p.marketplace === f.marketplace) && (!f.cuentaId || p.cuentaId === f.cuentaId));
}
