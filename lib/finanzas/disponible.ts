import { leerMonto } from "@/lib/importar-archivo";
import { SITIOS_ML } from "@/lib/ml/sitios";

// Issue #422 (fase 6 de Finanzas) — Disponible: «¿cuánta plata tengo hoy
// y dónde?». Lógica pura, sin base de datos: saldo vigente de cada
// cuenta, totales y qué saldo está desactualizado. Montos en texto y
// BigInt (centavos), nunca Number: un total de varias cuentas no puede
// perder pesos por redondeo de coma flotante. Los totales nunca mezclan
// monedas.

export const TIPOS_CUENTA_DISPONIBLE = ["banco", "billetera", "efectivo"] as const;
export type TipoCuentaDisponible = (typeof TIPOS_CUENTA_DISPONIBLE)[number];

export const ETIQUETA_TIPO_CUENTA: Record<TipoCuentaDisponible, string> = {
  banco: "Bancos",
  billetera: "Billeteras",
  efectivo: "Efectivo",
};

// Más de 7 días desde la fecha de corte = desactualizado (pedido de la
// tarea: un saldo de hace dos semanas ya no responde «cuánto tengo hoy»).
export const DIAS_PARA_DESACTUALIZADO = 7;

// Monedas que Zilonix opera, de lib/ml/sitios.ts — nunca una lista fija.
export const MONEDAS_DISPONIBLE: string[] = Array.from(new Set(Object.values(SITIOS_ML).map((s) => s.moneda)));

export class DisponibleInvalidoError extends Error {}

export type CuentaDisponible = {
  id: string;
  nombre: string;
  tipo: TipoCuentaDisponible;
  entidad: string | null;
  ultimos4: string | null;
  moneda: string;
  activa: boolean;
};

export type SaldoDisponible = {
  id: string;
  cuentaId: string;
  saldo: string;
  fechaCorte: string; // AAAA-MM-DD
  nota: string | null;
  registradoPor: string | null;
  creadoTs: Date;
};

export type FilaDisponible = CuentaDisponible & {
  saldo: string | null;
  fechaCorte: string | null;
  desactualizado: boolean;
};

export type TotalDisponible = {
  moneda: string;
  total: string;
  cuentas: number;
  // El total es tan viejo como su pieza más vieja: se muestra ese corte.
  corteMasAntiguo: string | null;
  corteMasReciente: string | null;
  desactualizadas: number;
};

// ---------- Montos (centavos, BigInt) ----------

const CIEN = BigInt(100);
const CERO = BigInt(0);

function aCentavos(monto: string): bigint {
  const m = /^(-?)(\d+)(?:\.(\d{1,2}))?$/.exec(monto.trim());
  if (!m) throw new DisponibleInvalidoError(`"${monto}" no es un monto válido.`);
  const valor = BigInt(m[2]) * CIEN + BigInt(((m[3] ?? "") + "00").slice(0, 2));
  return m[1] === "-" ? -valor : valor;
}

function deCentavos(centavos: bigint): string {
  const negativo = centavos < CERO;
  const abs = negativo ? -centavos : centavos;
  const texto = `${abs / CIEN}.${(abs % CIEN).toString().padStart(2, "0")}`;
  return negativo ? `-${texto}` : texto;
}

export function sumarSaldos(montos: string[]): string {
  return deCentavos(montos.reduce((acc, m) => acc + aCentavos(m), CERO));
}

// ---------- Fechas ----------

function esFechaValida(fecha: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) return false;
  const d = new Date(`${fecha}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === fecha;
}

function diasEntre(desde: string, hasta: string): number {
  return Math.round((Date.parse(`${hasta}T00:00:00Z`) - Date.parse(`${desde}T00:00:00Z`)) / 86_400_000);
}

// `hoy` es el día de Bogotá (diaBogota), nunca el del servidor.
export function esDesactualizado(fechaCorte: string | null, hoy: string): boolean {
  if (fechaCorte === null) return false;
  return diasEntre(fechaCorte, hoy) > DIAS_PARA_DESACTUALIZADO;
}

// ---------- Saldo vigente ----------

// El de la fecha de corte más reciente. Si hay dos el mismo día, gana el
// último registrado (corregir un saldo es registrar otro, nunca editar).
export function saldoVigente<T extends Pick<SaldoDisponible, "fechaCorte" | "creadoTs">>(saldos: T[]): T | null {
  let vigente: T | null = null;
  for (const s of saldos) {
    if (
      vigente === null ||
      s.fechaCorte > vigente.fechaCorte ||
      (s.fechaCorte === vigente.fechaCorte && s.creadoTs.getTime() > vigente.creadoTs.getTime())
    ) {
      vigente = s;
    }
  }
  return vigente;
}

// Historial de una cuenta, del más nuevo al más viejo (mismo orden que
// saldoVigente: el primero es el vigente).
export function historialDeCuenta(saldos: SaldoDisponible[], cuentaId: string): SaldoDisponible[] {
  return saldos
    .filter((s) => s.cuentaId === cuentaId)
    .sort((a, b) => (a.fechaCorte === b.fechaCorte ? b.creadoTs.getTime() - a.creadoTs.getTime() : a.fechaCorte < b.fechaCorte ? 1 : -1));
}

export function armarFilas(cuentas: CuentaDisponible[], saldos: SaldoDisponible[], hoy: string): FilaDisponible[] {
  return cuentas.map((c) => {
    const vigente = saldoVigente(saldos.filter((s) => s.cuentaId === c.id));
    return {
      ...c,
      saldo: vigente?.saldo ?? null,
      fechaCorte: vigente?.fechaCorte ?? null,
      desactualizado: esDesactualizado(vigente?.fechaCorte ?? null, hoy),
    };
  });
}

// Solo cuentas activas y con algún saldo registrado. Una por moneda.
export function totalesPorMoneda(filas: FilaDisponible[]): TotalDisponible[] {
  const porMoneda = new Map<string, FilaDisponible[]>();
  for (const f of filas) {
    if (!f.activa || f.saldo === null) continue;
    porMoneda.set(f.moneda, [...(porMoneda.get(f.moneda) ?? []), f]);
  }
  return Array.from(porMoneda.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([moneda, lista]) => {
      const cortes = lista.map((f) => f.fechaCorte as string).sort();
      return {
        moneda,
        total: sumarSaldos(lista.map((f) => f.saldo as string)),
        cuentas: lista.length,
        corteMasAntiguo: cortes[0] ?? null,
        corteMasReciente: cortes[cortes.length - 1] ?? null,
        desactualizadas: lista.filter((f) => f.desactualizado).length,
      };
    });
}

export function totalesPorTipo(filas: FilaDisponible[]): { tipo: TipoCuentaDisponible; totales: TotalDisponible[] }[] {
  return TIPOS_CUENTA_DISPONIBLE.map((tipo) => ({ tipo, totales: totalesPorMoneda(filas.filter((f) => f.tipo === tipo)) }));
}

// ---------- Mercado Pago (Reporte de Liberaciones) ----------

// Issue #422 — el último saldo disponible de cada cuenta de Mercado Pago
// activa, guardado en cuentas_mp por sincronizarSaldoMp
// (lib/finanzas/disponible-consulta.ts). La página lo lee de la base, sin
// llamar a Mercado Pago en cada visita.
export type CuentaMpDisponible = {
  id: string;
  cuentaIdExterna: string;
  nickname: string | null;
  ultimoSaldoDisponible: string | null;
  ultimaMoneda: string | null;
  ultimoCorteFecha: string | null;
  ultimoSaldoTs: Date | null;
  reportePendienteFile: string | null;
  reportePendienteTs: Date | null;
  ultimoErrorSaldo: string | null;
};

// Solo las cuentas ya sincronizadas: suman a totalesPorMoneda y
// totalesPorTipo como billeteras. El id lleva el prefijo "mp:" para que
// nunca se confunda con el UUID de una cuenta manual.
export function filasDesdeCuentasMp(cuentasMp: CuentaMpDisponible[], hoy: string): FilaDisponible[] {
  return cuentasMp.flatMap((c): FilaDisponible[] => {
    if (c.ultimoSaldoDisponible === null) return [];
    return [
      {
        id: `mp:${c.id}`,
        nombre: c.nickname || c.cuentaIdExterna,
        tipo: "billetera",
        entidad: "Mercado Pago",
        ultimos4: null,
        moneda: c.ultimaMoneda ?? "COP",
        activa: true,
        saldo: c.ultimoSaldoDisponible,
        fechaCorte: c.ultimoCorteFecha,
        desactualizado: esDesactualizado(c.ultimoCorteFecha, hoy),
      },
    ];
  });
}

// ---------- Validación de formularios ----------

export type DatosCuentaDisponible = Omit<CuentaDisponible, "id" | "activa">;

export function validarCuenta(entrada: { nombre: string; tipo: string; entidad: string; ultimos4: string; moneda: string }): DatosCuentaDisponible {
  const nombre = entrada.nombre.trim();
  if (!nombre) throw new DisponibleInvalidoError("Ponle un nombre a la cuenta.");
  if (nombre.length > 80) throw new DisponibleInvalidoError("El nombre puede tener hasta 80 caracteres.");
  const tipo = TIPOS_CUENTA_DISPONIBLE.find((t) => t === entrada.tipo);
  if (!tipo) throw new DisponibleInvalidoError("Elige si es banco, billetera o efectivo.");
  const entidad = entrada.entidad.trim() || null;
  if (tipo !== "efectivo" && !entidad) throw new DisponibleInvalidoError("Escribe la entidad (por ejemplo Bancolombia o Nequi).");
  if (entidad && entidad.length > 60) throw new DisponibleInvalidoError("La entidad puede tener hasta 60 caracteres.");
  const ultimos4 = entrada.ultimos4.trim() || null;
  if (ultimos4 && !/^\d{4}$/.test(ultimos4)) throw new DisponibleInvalidoError("Los últimos dígitos tienen que ser exactamente 4 números.");
  if (!MONEDAS_DISPONIBLE.includes(entrada.moneda)) throw new DisponibleInvalidoError("Elige la moneda de la cuenta.");
  return { nombre, tipo, entidad, ultimos4, moneda: entrada.moneda };
}

// Acepta 2.000 / 1.234,56 / 1234.56 (leerMonto) y un "-" adelante para un
// sobregiro. La fecha de corte no puede ser futura: es una foto de lo que
// ya hay.
export function validarSaldo(entrada: { saldo: string; fechaCorte: string; nota: string }, hoy: string): { saldo: string; fechaCorte: string; nota: string | null } {
  const texto = entrada.saldo.trim();
  const negativo = texto.startsWith("-");
  const leido = leerMonto({ tipo: "texto", valor: negativo ? texto.slice(1) : texto });
  if (leido.tipo === "vacio") throw new DisponibleInvalidoError("Escribe el saldo.");
  if (leido.tipo === "error") throw new DisponibleInvalidoError(leido.mensaje);
  const centavos = aCentavos(leido.valor);
  const saldo = deCentavos(negativo ? -centavos : centavos);

  const fechaCorte = entrada.fechaCorte.trim();
  if (!esFechaValida(fechaCorte)) throw new DisponibleInvalidoError("Elige la fecha de corte.");
  if (fechaCorte > hoy) throw new DisponibleInvalidoError("La fecha de corte no puede ser futura.");

  const nota = entrada.nota.trim() || null;
  if (nota && nota.length > 200) throw new DisponibleInvalidoError("La nota puede tener hasta 200 caracteres.");
  return { saldo, fechaCorte, nota };
}
