// Issue #422 (cuentas por cobrar) — cálculo puro de lo que las
// plataformas le deben a la empresa: Mercado Libre (ventas con la plata
// sin liberar) y Falabella (cortes Abierto, Procesando cierre, Pago
// programado o Programado para AAAA-MM-DD). Sin base ni red: la consulta vive en por-cobrar-consulta.ts.
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

// El reporte real trae «Programado para AAAA-MM-DD» (p. ej. «Programado para
// 2026-11-26»), no solo «Pago programado»: buscar el texto exacto dejaba
// esos cortes por fuera de lo por cobrar.
const PREFIJO_PROGRAMADO = "programado para ";
const ESTADOS_EXACTOS = new Set(ESTADOS_FALABELLA_POR_COBRAR.map((e) => e.toLowerCase()));

export function esEstadoFalabellaPorCobrar(estado: string | null): boolean {
  const e = (estado ?? "").trim().toLowerCase();
  if (!e) return false;
  return ESTADOS_EXACTOS.has(e) || e.startsWith(PREFIJO_PROGRAMADO);
}

const PATRON_PROGRAMADO = /^programado para (\d{4})-(\d{2})-(\d{2})$/i;

// Fecha de pago que Falabella anuncia en el corte. Solo fechas calendario
// reales (2026-02-30 se descarta, no se corrige). Si el corte trae varias,
// la más próxima: es la primera plata que entra.
export function extraerFechaProgramadaFalabella(estados: (string | null)[]): string | null {
  let mejor: string | null = null;
  for (const estado of estados) {
    const m = PATRON_PROGRAMADO.exec((estado ?? "").trim());
    if (!m) continue;
    const [a, mes, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
    const f = new Date(Date.UTC(a, mes - 1, d));
    if (f.getUTCFullYear() !== a || f.getUTCMonth() !== mes - 1 || f.getUTCDate() !== d) continue;
    const texto = `${m[1]}-${m[2]}-${m[3]}`;
    if (mejor === null || texto < mejor) mejor = texto;
  }
  return mejor;
}

// De dónde sale la partida: «mp» = pagos sin liberar leídos de Mercado
// Pago (pagos_mp_por_cobrar); «ventas» = estimado desde pedidos_finanzas
// (cuentas ML sin Mercado Pago sincronizado); «falabella» = reporte de
// transacciones.
export const FUENTES_POR_COBRAR = ["mp", "ventas", "falabella"] as const;
export type FuentePorCobrar = (typeof FUENTES_POR_COBRAR)[number];

export const ETIQUETA_FUENTE: Record<FuentePorCobrar, string> = {
  mp: "Mercado Pago",
  ventas: "Estimado ventas",
  falabella: "Reporte Falabella",
};

export type PartidaPorCobrar = {
  marketplace: MarketplacePorCobrar;
  fuente: FuentePorCobrar;
  // true = plata retenida por un reclamo (in_mediation): no tiene fecha
  // de entrada confiable, así que suma a «retenido» y al total, nunca a
  // esta semana / próximo mes / vencido / sin fecha.
  retenido: boolean;
  cuentaId: string;
  cuenta: string;
  moneda: string;
  // Nº de orden de ML o Nº de estado de cuenta de Falabella.
  referencia: string;
  // Estado tal cual lo da la plataforma (pending, Pago programado…).
  estado: string | null;
  // Día de Bogotá (AAAA-MM-DD) en que se espera la plata; null = sin fecha
  // (cortes de Falabella abiertos o sin «Programado para AAAA-MM-DD»).
  fechaEsperada: string | null;
  // null = pendiente sin neto (ML no lo mandó): se muestra igual, pero no
  // suma a los totales — el monto no se adivina.
  monto: string | null;
};

// ---------- Mercado Pago ↔ Mercado Libre (sin doble conteo) ----------

type CuentaExterna = { id: string; cuentaIdExterna: string; nickname: string | null };

// Una cuenta ML cuyo user_id (cuenta_id_externa) tiene una cuenta MP ya
// sincronizada queda «reemplazada»: sus partidas salen de Mercado Pago y
// el estimado de pedidos_finanzas se omite. Una cuenta MP sin cuenta ML
// emparejada se muestra con su propio id y nombre.
export function emparejarCuentasMp(
  cuentasMl: (CuentaExterna & { nickname: string })[],
  cuentasMpSincronizadas: CuentaExterna[]
): { reemplazadas: Set<string>; destinoMp: Map<string, { cuentaId: string; cuenta: string }> } {
  const mlPorExterna = new Map(cuentasMl.map((c) => [c.cuentaIdExterna, c]));
  const reemplazadas = new Set<string>();
  const destinoMp = new Map<string, { cuentaId: string; cuenta: string }>();
  for (const c of cuentasMpSincronizadas) {
    const emparejada = mlPorExterna.get(c.cuentaIdExterna);
    if (emparejada) reemplazadas.add(emparejada.id);
    destinoMp.set(c.id, emparejada ? { cuentaId: emparejada.id, cuenta: emparejada.nickname } : { cuentaId: c.id, cuenta: c.nickname ?? c.cuentaIdExterna });
  }
  return { reemplazadas, destinoMp };
}

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

// Revisión del PR #486: una fecha ya pasada que sigue sin liberar no se
// esconde: es «vencida» (debió entrar y no entró — reclamo, mediación o
// la sync no volvió a pasar por esa venta). Va aparte de «esta semana».
export const estaVencida = (p: Pick<PartidaPorCobrar, "fechaEsperada">, v: Ventanas) => p.fechaEsperada !== null && p.fechaEsperada < v.hoy;

// Estado claro para el detalle de Mercado Libre. Falabella conserva el
// estado de su reporte.
export function estadoVisiblePartida(p: PartidaPorCobrar, v: Ventanas): string | null {
  if (p.marketplace !== "ml") return p.estado;
  if (p.retenido) return "Retenido (reclamo)";
  if (estaVencida(p, v)) return "Vencido";
  return "Por liberar";
}
const entraEstaSemana = (fecha: string | null, v: Ventanas) => fecha !== null && fecha >= v.semana.desde && fecha <= v.semana.hasta;
const entraProximoMes = (fecha: string | null, v: Ventanas) => fecha !== null && fecha >= v.proximoMes.desde && fecha <= v.proximoMes.hasta;

// ---------- Resúmenes ----------

export type TotalesMoneda = {
  moneda: string;
  partidas: number;
  // total = porLiberar + retenido.
  total: string;
  porLiberar: string;
  retenido: string;
  estaSemana: string;
  proximoMes: string;
  sinFecha: string;
  vencido: string;
  // Partidas pendientes sin neto: cuentan como partida, no en los montos.
  sinNeto: number;
};

type Acumulado = {
  partidas: number;
  porLiberar: bigint;
  retenido: bigint;
  estaSemana: bigint;
  proximoMes: bigint;
  sinFecha: bigint;
  vencido: bigint;
  sinNeto: number;
};
const nuevo = (): Acumulado => ({ partidas: 0, porLiberar: CERO, retenido: CERO, estaSemana: CERO, proximoMes: CERO, sinFecha: CERO, vencido: CERO, sinNeto: 0 });

function acumular(a: Acumulado, p: PartidaPorCobrar, v: Ventanas): void {
  a.partidas += 1;
  if (p.monto === null) {
    a.sinNeto += 1;
    return;
  }
  const monto = aDiezmilesimas(p.monto);
  if (p.retenido) {
    a.retenido += monto;
    return;
  }
  a.porLiberar += monto;
  if (estaVencida(p, v)) a.vencido += monto;
  if (entraEstaSemana(p.fechaEsperada, v)) a.estaSemana += monto;
  if (entraProximoMes(p.fechaEsperada, v)) a.proximoMes += monto;
  if (p.fechaEsperada === null) a.sinFecha += monto;
}

const textos = (a: Acumulado) => ({
  partidas: a.partidas,
  total: aTextoMonto(a.porLiberar + a.retenido),
  porLiberar: aTextoMonto(a.porLiberar),
  retenido: aTextoMonto(a.retenido),
  estaSemana: aTextoMonto(a.estaSemana),
  proximoMes: aTextoMonto(a.proximoMes),
  sinFecha: aTextoMonto(a.sinFecha),
  vencido: aTextoMonto(a.vencido),
  sinNeto: a.sinNeto,
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

// Detalle: primero lo vencido y lo que entra antes; lo sin fecha al final.
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
