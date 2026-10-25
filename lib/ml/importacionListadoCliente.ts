// Issue #213 — "Importar listado": la extensión de Zilonix ya lee
// listados/búsquedas en los 6 sitios (Mercado Libre + Amazon, Temu,
// AliExpress, Shein, Alibaba — extension/content.js, leerListado de
// cada extension/lectores/<sitio>.js) pero hasta ahora solo los
// mostraba en su propio panel flotante, nunca se los mandaba al panel
// de Zilonix. Este archivo es la contraparte PURA (sin I/O) del lado
// del panel — igual que lib/ml/investigacionCliente.ts (issue #210),
// separado de lib/ml/investigacion.ts a propósito: ese archivo importa
// lib/ml/cliente.ts/lib/ml/cuentas.ts (fetch con token, Postgres) y
// nunca puede entrar al bundle del cliente.
//
// A propósito, estos productos NUNCA se mezclan con PublicacionInvestigacion
// (la tabla de arriba, con datos reales de la API de Mercado Libre):
// son candidatos de OTRAS plataformas (o de un listado de ML leído a
// mano, sin pasar por la API oficial) — "nunca pisar vendidos API
// reales" (issue #213, punto 2) se cumple simplemente manteniéndolos
// en su propia lista, nunca fusionados fila por fila con la oficial.
// Tampoco se estima ventas/mes ni facturación para estos candidatos:
// los factores de lib/ml/estimacionVentas.ts ("estilo Selltrix") solo
// están confirmados contra datos reales de Mercado Libre — aplicarlos
// a un vendidos aproximado de otro sitio sería inventar, no estimar.

// Issue #225 (parte B) — bug real de Zilonix OS que esto existe para
// NUNCA repetir: mostrar un acumulado histórico (ej. "1.234 vendidos"
// de toda la vida de la publicación en AliExpress/Shein/Alibaba/Temu)
// con una etiqueta de "/mes", como si fuera una tasa mensual real.
// Cada plataforma expone un tipo de señal DISTINTO:
//   - "mensual_piso": SOLO Amazon ("10 K+ comprados el mes pasado" —
//     un piso real, confirmado por Amazon mismo, de hace un mes).
//   - "acumulado_sin_periodo": Mercado Libre ("+N vendidos"),
//     Temu/AliExpress/Shein/Alibaba ("vendidos"/"ventas"/"soldOrder")
//     — un acumulado histórico SIN que la plataforma diga de qué
//     período, nunca se divide entre nada ni se le pone "/mes".
//   - "ausente": la plataforma no mostró ningún número de ventas.
// clasificarSenalVentas (abajo) es el ÚNICO lugar que decide esto —
// la UI (PanelDemanda.tsx) nunca vuelve a adivinar el tipo por su
// cuenta, siempre lee senalVentas.tipo ya resuelto.
export type TipoSenalVentas = "mensual_piso" | "acumulado_sin_periodo" | "ausente";
export type SenalVentas = { valor: number | null; tipo: TipoSenalVentas };

export function clasificarSenalVentas(plataforma: string, vendidos: number | null): SenalVentas {
  if (vendidos == null || !Number.isFinite(vendidos)) return { valor: null, tipo: "ausente" };
  // Único caso real confirmado de "piso mensual" — ver nota arriba.
  return { valor: vendidos, tipo: plataforma === "Amazon" ? "mensual_piso" : "acumulado_sin_periodo" };
}

export type ProductoImportado = {
  plataforma: string;
  titulo: string;
  precio: number;
  senalVentas: SenalVentas;
  link: string | null;
};

export type ResumenImportado = {
  total: number;
  precioMinimo: number | null;
  precioPromedio: number | null;
  precioMaximo: number | null;
  // Separados a propósito — nunca se suman entre sí (sumar un piso
  // mensual con un acumulado histórico sin período sería inventar un
  // número sin sentido real).
  sumaAcumuladaSinPeriodo: number | null;
  sumaMensualPiso: number | null;
};

// Mismo criterio que linkSeguro (extension/seguridad.js) del lado del
// navegador — defensa en profundidad: el link ya se validó ahí antes
// de mandarlo, pero el panel nunca confía ciegamente en un mensaje
// (mismo principio que ya aplica el puente de "Completar vendidos").
export function linkHttpSeguro(valor: string | null): string | null {
  if (!valor) return null;
  try {
    const url = new URL(valor);
    return url.protocol === "http:" || url.protocol === "https:" ? url.href : null;
  } catch {
    return null;
  }
}

function claveProducto(p: ProductoImportado): string {
  return p.link ?? `${p.plataforma}|${p.titulo}`;
}

// "Fusionar": agrega los nuevos a la sesión ya importada, sin
// duplicar (mismo link, o mismo título+plataforma sin link) — reimportar
// la misma página dos veces no infla el total.
export function fusionarProductosImportados(actuales: ProductoImportado[], nuevos: ProductoImportado[]): ProductoImportado[] {
  const vistos = new Set(actuales.map(claveProducto));
  const agregados = nuevos.filter((p) => !vistos.has(claveProducto(p)));
  return [...actuales, ...agregados];
}

// "Reemplazar": descarta la sesión importada anterior por completo.
export function reemplazarProductosImportados(nuevos: ProductoImportado[]): ProductoImportado[] {
  return [...nuevos];
}

// Recalculado sobre el conjunto YA fusionado/reemplazado (nunca sobre
// un solo mensaje) — mismo cálculo que calcularResumenListado del lado
// de la extensión (extension/content.js), pero acá sí tiene sentido
// recalcularlo: el total cambia con cada fusión.
export function calcularResumenImportado(productos: ProductoImportado[]): ResumenImportado {
  const precios = productos.map((p) => p.precio).filter((p) => typeof p === "number" && Number.isFinite(p) && p > 0);
  const acumulados = productos.filter((p) => p.senalVentas.tipo === "acumulado_sin_periodo" && p.senalVentas.valor != null);
  const mensuales = productos.filter((p) => p.senalVentas.tipo === "mensual_piso" && p.senalVentas.valor != null);
  return {
    total: productos.length,
    precioMinimo: precios.length ? Math.min(...precios) : null,
    precioPromedio: precios.length ? Math.round((precios.reduce((a, b) => a + b, 0) / precios.length) * 100) / 100 : null,
    precioMaximo: precios.length ? Math.max(...precios) : null,
    sumaAcumuladaSinPeriodo: acumulados.length ? acumulados.reduce((s, p) => s + (p.senalVentas.valor as number), 0) : null,
    sumaMensualPiso: mensuales.length ? mensuales.reduce((s, p) => s + (p.senalVentas.valor as number), 0) : null,
  };
}
