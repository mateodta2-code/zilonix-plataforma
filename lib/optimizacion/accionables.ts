// Optimización · Rendimiento — «Qué hacer primero»: accionables ordenados por
// la plata en juego del período. Lógica pura (sin base ni Mercado Libre):
// recibe las filas de Rendimiento más las señales ya leídas y devuelve
// tarjetas con su monto y el porqué. Reusa medianas, semáforos y mínimos de
// muestra de rendimiento.ts; nunca umbrales fijos.
//
// Los montos son ESTIMACIONES, no promesas: cada tarjeta explica los números
// que usó. Lo que no se puede estimar con honestidad queda con monto null y
// va al final (Seltrix pone reglas fijas; acá se ordena por plata).

import { cvr, medianaDe, medianasPorCategoria, MINIMO_VISITAS_CVR, semaforoPublicacion, type EntradaMediana, type Medianas } from "./rendimiento";

export type TipoAccionable = "portada" | "contenido" | "precio" | "stock" | "preguntas" | "calidad";

export const ROTULO_ACCIONABLE: Record<TipoAccionable, string> = {
  portada: "Cambiar portada",
  contenido: "Mejorar contenido",
  precio: "Revisar precio",
  stock: "Sin stock",
  preguntas: "Preguntas sin responder",
  calidad: "Subir calidad",
};

export type Accionable = {
  tipo: TipoAccionable;
  itemId: string;
  titulo: string;
  // Decimal con 2 cifras («1234.50») o null si no se puede estimar con honestidad.
  monto: string | null;
  explicacion: string;
};

export type FilaAccionable = {
  itemId: string;
  titulo: string | null;
  // En moneda de la cuenta; null = sin permiso ventas/consultar (ver `conMontos`).
  ingresos: number | null;
  // Participación en los ingresos (0–100): sirve para ordenar sin mostrar plata.
  porcentaje: number;
  ventas: number;
  impresiones: number | null;
  clics: number | null;
  visitas: number | null;
  categoria: string | null;
};

// Señales de Mercado Libre (solo las ≤ 10 publicaciones enriquecidas).
export type SenalesItem = {
  calidad?: { nivel: string | null; pendientes: string[] } | null;
  referenciaEstado?: string | null;
  referenciaPrecioActual?: number | null;
  referenciaPrecioSugerido?: number | null;
  referenciaDiferencia?: number | null;
  competenciaEstado?: string | null;
  competenciaPrecioParaGanar?: number | null;
};

// De la base de Seller (publicaciones.stock / .precio) y de la bandeja.
export type ContextoItem = {
  stock?: number | null;
  precio?: number | null;
  preguntasSinResponder?: number;
};

export type EntradaAccionables = {
  filas: FilaAccionable[];
  senales: Record<string, SenalesItem>;
  contexto: Record<string, ContextoItem>;
  diasPeriodo: number;
  // false = sin ventas/consultar: se ordena, pero ni monto ni plata en el texto.
  conMontos: boolean;
  formatoMoneda: (valor: number) => string;
  formatoNumero: (valor: number) => string;
};

const PRECIO_ALTO = ["with_benchmark_high", "with_benchmark_highest"];
const COMPITE = ["competing", "listed"];

const decimal = (n: number) => (Math.round(n * 100) / 100).toFixed(2);
const positivo = (n: number | null | undefined): n is number => typeof n === "number" && Number.isFinite(n) && n > 0;

// ML da el nivel como texto («Básica», «Estándar», «Profesional»): bajo = Básica.
export function nivelCalidadBajo(nivel: string | null | undefined): boolean {
  return typeof nivel === "string" && /^b[aá]sic/i.test(nivel.trim());
}

type Interno = Accionable & { orden: number };

export function armarAccionables(e: EntradaAccionables): Accionable[] {
  const medianas: Medianas = medianasPorCategoria(e.filas.map((f): EntradaMediana => ({ categoria: f.categoria, impresiones: f.impresiones, clics: f.clics, visitas: f.visitas, ventas: f.ventas })));
  const pct = (v: number) => `${e.formatoNumero(Math.round(v * 10) / 10)} %`;
  const salida: Interno[] = [];
  const conPlata = e.conMontos;
  const montosPorItem = new Map<string, { portada?: number; contenido?: number }>();

  for (const f of e.filas) {
    const titulo = f.titulo ?? f.itemId;
    const ctx = e.contexto[f.itemId] ?? {};
    const sen = e.senales[f.itemId] ?? {};
    // Sin permiso, `ingresos` no existe en el navegador: se ordena con el %
    // de ingresos, que escala igual que la plata y no la revela.
    const base = conPlata ? f.ingresos : f.porcentaje;
    const ticket = f.ventas > 0 && base !== null ? base / f.ventas : conPlata && positivo(ctx.precio) ? ctx.precio : null;
    const entrada: EntradaMediana = { categoria: f.categoria, impresiones: f.impresiones, clics: f.clics, visitas: f.visitas, ventas: f.ventas };
    const sCtr = semaforoPublicacion(entrada, medianas, "ctr");
    const sCvr = semaforoPublicacion(entrada, medianas, "cvr");
    const agregar = (tipo: TipoAccionable, monto: number | null, explicacion: string) =>
      salida.push({ tipo, itemId: f.itemId, titulo, monto: monto === null || !(monto > 0) ? null : decimal(monto), explicacion, orden: base ?? 0 });

    // 1) Portada: pocos clics para las veces que se muestra.
    if (sCtr.tono === "peligro" && sCtr.valor !== null && sCtr.mediana !== null && f.impresiones !== null) {
      const cvrItem = f.visitas !== null && f.visitas >= MINIMO_VISITAS_CVR ? cvr(f.ventas, f.visitas) : null;
      const cvrUsado = cvrItem ?? medianaDe(medianas, f.categoria, "cvr").valor;
      const monto = cvrUsado !== null && ticket !== null ? f.impresiones * ((sCtr.mediana - sCtr.valor) / 100) * (cvrUsado / 100) * ticket : null;
      if (monto !== null) montosPorItem.set(f.itemId, { ...montosPorItem.get(f.itemId), portada: monto });
      const porque = `${e.formatoNumero(f.impresiones)} impresiones con CTR ${pct(sCtr.valor)} frente a ${pct(sCtr.mediana)} de la mediana${sCtr.deCuenta ? " de la cuenta" : " de su categoría"}`;
      agregar(
        "portada",
        monto,
        monto !== null && conPlata
          ? `${porque}. Si llegara a la mediana, conversión ${pct(cvrUsado!)}${cvrItem === null ? " (mediana: la publicación no tiene muestra propia)" : ""} × ticket ${e.formatoMoneda(ticket!)}.`
          : `${porque}.${conPlata ? " Falta conversión o ticket para estimar el monto." : ""}`
      );
    }

    // 2) Contenido (incluye 0 ventas): muchas visitas que no compran.
    if (sCvr.tono === "peligro" && sCvr.valor !== null && sCvr.mediana !== null && f.visitas !== null) {
      const monto = ticket !== null ? ((sCvr.mediana - sCvr.valor) / 100) * f.visitas * ticket : null;
      if (monto !== null) montosPorItem.set(f.itemId, { ...montosPorItem.get(f.itemId), contenido: monto });
      const porque = `${e.formatoNumero(f.visitas)} visitas con conversión ${pct(sCvr.valor)} frente a ${pct(sCvr.mediana)} de la mediana${sCvr.deCuenta ? " de la cuenta" : " de su categoría"}`;
      agregar(
        "contenido",
        monto,
        monto !== null && conPlata
          ? `${porque}. Ticket ${e.formatoMoneda(ticket!)}${f.ventas === 0 ? " (sin ventas: precio actual)" : ""}.`
          : `${porque}.${conPlata ? " Sin ventas ni precio para estimar el monto." : ""}`
      );
    }

    // 3) Precio: ML dice que está alto frente a la referencia o que pierde la competencia.
    const precioAlto = PRECIO_ALTO.includes(sen.referenciaEstado ?? "");
    const compite = COMPITE.includes(sen.competenciaEstado ?? "");
    if (precioAlto || compite) {
      const partes: string[] = [];
      if (precioAlto) {
        const sugerido = positivo(sen.referenciaPrecioSugerido) && conPlata ? `, sugerido ${e.formatoMoneda(sen.referenciaPrecioSugerido)}` : "";
        const dif = typeof sen.referenciaDiferencia === "number" ? ` (${pct(sen.referenciaDiferencia)} de diferencia)` : "";
        partes.push(`la referencia de precio de Mercado Libre lo marca alto${sugerido}${dif}`);
      }
      if (compite) partes.push("no está ganando la competencia por el producto");
      // No hay un dato de ML que diga qué fracción de las ventas se pierde por el precio:
      // inventarla sería falsa precisión. Se muestra lo que sí se sabe.
      const ingresosTxt = conPlata && f.ingresos !== null && f.ingresos > 0 ? ` Ingresos del período en esta publicación: ${e.formatoMoneda(f.ingresos)}.` : "";
      agregar("precio", null, `${partes.join(" y ")}.${ingresosTxt} Monto sin estimar: Mercado Libre no informa cuánto se vende de menos por el precio.`);
    }

    // 4) Sin stock con ventas: lo que se deja de vender mientras siga en 0.
    if (ctx.stock === 0 && f.ventas > 0 && e.diasPeriodo > 0) {
      const diaria = base !== null ? base / e.diasPeriodo : null;
      const monto = diaria !== null ? diaria * e.diasPeriodo : null;
      agregar(
        "stock",
        monto,
        conPlata && diaria !== null
          ? `Stock actual 0 y ${e.formatoNumero(f.ventas)} ${f.ventas === 1 ? "venta" : "ventas"} en el período: venta diaria promedio ${e.formatoMoneda(diaria)} × ${e.formatoNumero(e.diasPeriodo)} ${e.diasPeriodo === 1 ? "día" : "días"}. Estimado con el stock de hoy (no hay foto diaria del stock).`
          : `Stock actual 0 y ${e.formatoNumero(f.ventas)} ${f.ventas === 1 ? "venta" : "ventas"} en el período. Estimado con el stock de hoy (no hay foto diaria del stock).`
      );
    }

    // 6) Calidad: nivel bajo u objetivos pendientes. Monto solo si ya califica en 1 o 2.
    const calidad = sen.calidad;
    if (calidad && (nivelCalidadBajo(calidad.nivel) || calidad.pendientes.length > 0)) {
      const m = montosPorItem.get(f.itemId);
      const monto = m ? Math.max(m.portada ?? 0, m.contenido ?? 0) : null;
      const detalle = `${calidad.nivel ? `Nivel ${calidad.nivel}. ` : ""}${calidad.pendientes.length > 0 ? `Objetivos pendientes: ${calidad.pendientes.slice(0, 3).join(", ")}${calidad.pendientes.length > 3 ? ` y ${calidad.pendientes.length - 3} más` : ""}.` : ""}`;
      agregar("calidad", monto, `${detalle}${monto && conPlata ? " Mismo dinero que portada/contenido: no se suma." : monto ? "" : " Sin monto: la publicación no tiene una conversión o un CTR bajo medido."}`.trim());
    }
  }

  // 5) Preguntas > 24 h: sin monto (no se inventan «ventas por pregunta»).
  const titulos = new Map(e.filas.map((f) => [f.itemId, f.titulo ?? f.itemId]));
  for (const [itemId, c] of Object.entries(e.contexto)) {
    const n = c.preguntasSinResponder ?? 0;
    if (n > 0) {
      salida.push({
        tipo: "preguntas",
        itemId,
        titulo: titulos.get(itemId) ?? itemId,
        monto: null,
        explicacion: `${e.formatoNumero(n)} ${n === 1 ? "pregunta lleva" : "preguntas llevan"} más de 24 h sin responder.`,
        orden: -1,
      });
    }
  }

  // Monto mayor primero; sin monto al final (por % de ingresos y luego tipo, estable).
  return salida
    .map((a, i) => ({ a, i }))
    .sort((x, y) => {
      const mx = x.a.monto === null ? null : Number(x.a.monto);
      const my = y.a.monto === null ? null : Number(y.a.monto);
      if (mx !== null && my !== null && mx !== my) return my - mx;
      if (mx !== null && my === null) return -1;
      if (mx === null && my !== null) return 1;
      return y.a.orden - x.a.orden || x.i - y.i;
    })
    .map(({ a }) => ({ tipo: a.tipo, itemId: a.itemId, titulo: a.titulo, monto: a.monto, explicacion: a.explicacion }));
}

// Publicaciones a las que vale la pena pedirles lecturas a Mercado Libre
// (calidad, referencia de precio, competencia): primero las que ya tienen un
// accionable con monto, luego las de más ingresos, hasta `maximo`.
export function elegirParaEnriquecer(filas: Pick<FilaAccionable, "itemId" | "porcentaje">[], base: Accionable[], maximo: number): string[] {
  const ids: string[] = [];
  for (const a of base) if (a.tipo !== "preguntas" && !ids.includes(a.itemId) && ids.length < maximo) ids.push(a.itemId);
  for (const f of [...filas].sort((a, b) => b.porcentaje - a.porcentaje)) if (ids.length < maximo && !ids.includes(f.itemId)) ids.push(f.itemId);
  return ids;
}
