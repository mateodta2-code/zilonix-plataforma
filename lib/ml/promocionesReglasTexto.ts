// PR 2 de Promociones — «Reglas adicionales» (texto libre) que Mateo
// escribe bajo «Respetar siempre la tabla maestra». Este módulo es PURO
// (sin base de datos, sin IA, sin red): define la forma del JSON que
// sale de interpretar el texto, lo VALIDA de forma estricta y lo
// describe en español para la pantalla «Entendí esto». La IA
// (promocionesReglasTextoIA.ts) solo propone un JSON; nada se guarda ni
// se usa sin pasar por validarReglasAdicionales, y el resultado solo
// puede ser de este esquema — cualquier otra cosa se rechaza.
//
// Validación escrita a mano (mismo estilo que el resto del repo, p. ej.
// validarReglas en app/api/ml/promociones/reglas/route.ts): `zod` no
// está instalado en este repo y sumar una dependencia nueva no estaba
// aprobado. El esquema es estricto igual que lo sería con zod
// (.strict()): llaves de más, rangos y fechas inválidas se rechazan.

export const VERSION_REGLAS_ADICIONALES = 1;
export const LARGO_MAXIMO_REGLAS_TEXTO = 1000;

const MAX_ITEMS_POR_LISTA = 20;
const MAX_LARGO_VALOR = 80;
const MAX_LARGO_NO_ENTENDIDO = 200;

export const TIPOS_EXCLUSION = ["nombre_promocion", "tipo_promocion", "compartida"] as const;
export type TipoExclusion = (typeof TIPOS_EXCLUSION)[number];

export type ExclusionRegla = { tipo: TipoExclusion; valor?: string };
export type MaximoPorSku = { sku: string; maximoPct: number };
// Fechas SIN zona horaria ("YYYY-MM-DDTHH:mm:ss"): se comparan contra las
// fechas de la promoción de Mercado Libre recortadas a 19 caracteres (la
// hora local del sitio, ver fechasParaParticipar en lib/ml/promociones.ts),
// así nunca se fija una zona.
export type VentanaFecha = { desde: string; hasta: string; accion: "no_entrar" };

export type ReglasAdicionales = {
  version: 1;
  exclusiones: ExclusionRegla[];
  maximoDescuentoPct: number | null;
  maximoPorSku: MaximoPorSku[];
  ventanasFecha: VentanaFecha[];
  noEntendido: string[];
};

export type ResultadoValidacionReglas = { ok: true; reglas: ReglasAdicionales } | { ok: false; error: string };

// Minúsculas y sin tildes — para comparar "contiene" sin depender de
// cómo lo escribió la persona o cómo lo llama Mercado Libre.
export function normalizarTextoComparable(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function esObjetoPlano(valor: unknown): valor is Record<string, unknown> {
  return typeof valor === "object" && valor !== null && !Array.isArray(valor);
}

function llavesDeMas(objeto: Record<string, unknown>, permitidas: string[]): string | null {
  const extra = Object.keys(objeto).find((k) => !permitidas.includes(k));
  return extra ?? null;
}

function porcentajeValido(valor: unknown): valor is number {
  return typeof valor === "number" && Number.isFinite(valor) && valor >= 1 && valor <= 100;
}

const PATRON_FECHA = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?$/;

// Devuelve "YYYY-MM-DDTHH:mm:ss" o null. Una fecha sola ("2026-11-27") se
// completa a inicio de día (desde) o fin de día (hasta). Rechaza zona
// ("Z", "+05:00"), fechas imposibles (30 de febrero) y horas fuera de rango.
export function normalizarFechaSinZona(valor: unknown, extremo: "desde" | "hasta"): string | null {
  if (typeof valor !== "string") return null;
  const m = PATRON_FECHA.exec(valor.trim());
  if (!m) return null;
  const [, a, mes, d, hh, mm, ss] = m;
  const anio = Number(a);
  const mesN = Number(mes);
  const dia = Number(d);
  const comprobacion = new Date(Date.UTC(anio, mesN - 1, dia));
  if (comprobacion.getUTCFullYear() !== anio || comprobacion.getUTCMonth() !== mesN - 1 || comprobacion.getUTCDate() !== dia) return null;
  let hora: string;
  if (hh === undefined) hora = extremo === "desde" ? "00:00:00" : "23:59:59";
  else {
    if (Number(hh) > 23 || Number(mm) > 59 || Number(ss ?? 0) > 59) return null;
    hora = `${hh}:${mm}:${ss ?? "00"}`;
  }
  return `${a}-${mes}-${d}T${hora}`;
}

function textoCorto(valor: unknown, max: number): string | null {
  if (typeof valor !== "string") return null;
  const limpio = valor.trim();
  return limpio.length > 0 && limpio.length <= max ? limpio : null;
}

export function validarReglasAdicionales(entrada: unknown): ResultadoValidacionReglas {
  if (!esObjetoPlano(entrada)) return { ok: false, error: "La respuesta no es un objeto JSON." };
  const extraTop = llavesDeMas(entrada, ["version", "exclusiones", "maximoDescuentoPct", "maximoPorSku", "ventanasFecha", "noEntendido"]);
  if (extraTop) return { ok: false, error: `Campo no permitido: "${extraTop}".` };
  if (entrada.version !== VERSION_REGLAS_ADICIONALES) return { ok: false, error: "Versión del esquema no soportada." };

  const lista = (nombre: string): unknown[] | null => {
    const v = entrada[nombre];
    if (v === undefined) return [];
    return Array.isArray(v) && v.length <= MAX_ITEMS_POR_LISTA ? v : null;
  };

  const exclusionesCrudas = lista("exclusiones");
  const porSkuCrudo = lista("maximoPorSku");
  const ventanasCrudas = lista("ventanasFecha");
  const noEntendidoCrudo = lista("noEntendido");
  if (!exclusionesCrudas) return { ok: false, error: "«exclusiones» no es una lista válida." };
  if (!porSkuCrudo) return { ok: false, error: "«maximoPorSku» no es una lista válida." };
  if (!ventanasCrudas) return { ok: false, error: "«ventanasFecha» no es una lista válida." };
  if (!noEntendidoCrudo) return { ok: false, error: "«noEntendido» no es una lista válida." };

  const exclusiones: ExclusionRegla[] = [];
  for (const e of exclusionesCrudas) {
    if (!esObjetoPlano(e) || llavesDeMas(e, ["tipo", "valor"])) return { ok: false, error: "Una exclusión tiene un formato no permitido." };
    if (!TIPOS_EXCLUSION.includes(e.tipo as TipoExclusion)) return { ok: false, error: "Una exclusión tiene un tipo no permitido." };
    if (e.tipo === "compartida") {
      if (e.valor !== undefined && e.valor !== null) return { ok: false, error: "La exclusión «compartida» no lleva valor." };
      exclusiones.push({ tipo: "compartida" });
      continue;
    }
    const valor = textoCorto(e.valor, MAX_LARGO_VALOR);
    if (!valor) return { ok: false, error: "Una exclusión necesita un valor corto." };
    exclusiones.push({ tipo: e.tipo as TipoExclusion, valor: normalizarTextoComparable(valor) });
  }

  let maximoDescuentoPct: number | null = null;
  if (entrada.maximoDescuentoPct !== undefined && entrada.maximoDescuentoPct !== null) {
    if (!porcentajeValido(entrada.maximoDescuentoPct)) return { ok: false, error: "El máximo de descuento tiene que estar entre 1 y 100." };
    maximoDescuentoPct = entrada.maximoDescuentoPct;
  }

  const maximoPorSku: MaximoPorSku[] = [];
  for (const s of porSkuCrudo) {
    if (!esObjetoPlano(s) || llavesDeMas(s, ["sku", "maximoPct"])) return { ok: false, error: "Un máximo por SKU tiene un formato no permitido." };
    const sku = textoCorto(s.sku, MAX_LARGO_VALOR);
    if (!sku) return { ok: false, error: "Un máximo por SKU necesita el SKU." };
    if (!porcentajeValido(s.maximoPct)) return { ok: false, error: "El máximo de un SKU tiene que estar entre 1 y 100." };
    maximoPorSku.push({ sku, maximoPct: s.maximoPct });
  }

  const ventanasFecha: VentanaFecha[] = [];
  for (const v of ventanasCrudas) {
    if (!esObjetoPlano(v) || llavesDeMas(v, ["desde", "hasta", "accion"])) return { ok: false, error: "Una ventana de fechas tiene un formato no permitido." };
    if (v.accion !== "no_entrar") return { ok: false, error: "Una ventana de fechas tiene una acción no permitida." };
    const desde = normalizarFechaSinZona(v.desde, "desde");
    const hasta = normalizarFechaSinZona(v.hasta, "hasta");
    if (!desde || !hasta) return { ok: false, error: "Una ventana de fechas tiene una fecha inválida (sin zona horaria, formato AAAA-MM-DD)." };
    if (desde > hasta) return { ok: false, error: "Una ventana de fechas termina antes de empezar." };
    ventanasFecha.push({ desde, hasta, accion: "no_entrar" });
  }

  const noEntendido: string[] = [];
  for (const n of noEntendidoCrudo) {
    const t = textoCorto(n, MAX_LARGO_NO_ENTENDIDO);
    if (!t) return { ok: false, error: "«noEntendido» tiene un texto inválido." };
    noEntendido.push(t);
  }

  return { ok: true, reglas: { version: 1, exclusiones, maximoDescuentoPct, maximoPorSku, ventanasFecha, noEntendido } };
}

export function tieneReglasAplicables(reglas: ReglasAdicionales): boolean {
  return reglas.exclusiones.length > 0 || reglas.maximoDescuentoPct !== null || reglas.maximoPorSku.length > 0 || reglas.ventanasFecha.length > 0;
}

export function describirExclusion(e: ExclusionRegla): string {
  if (e.tipo === "compartida") return "no entrar en promociones compartidas con Mercado Libre";
  if (e.tipo === "nombre_promocion") return `no entrar en promociones cuyo nombre contenga «${e.valor}»`;
  return `no entrar en promociones del tipo «${e.valor}»`;
}

export function describirMaximoGlobal(pct: number): string {
  return `máximo ${pct}% de descuento`;
}

export function describirMaximoSku(m: MaximoPorSku): string {
  return `máximo ${m.maximoPct}% de descuento en el SKU ${m.sku}`;
}

export function describirVentana(v: VentanaFecha): string {
  return `no entrar en promociones que corran entre ${v.desde.replace("T", " ").slice(0, 16)} y ${v.hasta.replace("T", " ").slice(0, 16)}`;
}

// Lista legible para «Entendí esto: …» (nunca el JSON crudo).
export function describirReglas(reglas: ReglasAdicionales): string[] {
  return [
    ...reglas.exclusiones.map(describirExclusion),
    ...(reglas.maximoDescuentoPct !== null ? [describirMaximoGlobal(reglas.maximoDescuentoPct)] : []),
    ...reglas.maximoPorSku.map(describirMaximoSku),
    ...reglas.ventanasFecha.map(describirVentana),
  ];
}

// Saca el primer objeto JSON de la respuesta de la IA (que a veces lo
// envuelve en ```json o en una frase). null si no hay nada parseable.
export function extraerJson(respuesta: string): unknown | null {
  const inicio = respuesta.indexOf("{");
  const fin = respuesta.lastIndexOf("}");
  if (inicio === -1 || fin <= inicio) return null;
  try {
    return JSON.parse(respuesta.slice(inicio, fin + 1));
  } catch {
    return null;
  }
}
