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

export type ProductoImportado = {
  plataforma: string;
  titulo: string;
  precio: number;
  // Lo que el sitio mostró (exacto o aproximado, según el lector de
  // ese sitio) — null si el sitio no lo muestra. Nunca una visita ni
  // un vendidos inventado en su lugar.
  vendidos: number | null;
  link: string | null;
};

export type ResumenImportado = {
  total: number;
  precioMinimo: number | null;
  precioPromedio: number | null;
  precioMaximo: number | null;
  sumaVendidos: number | null;
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
  const conVendidos = productos.filter((p): p is ProductoImportado & { vendidos: number } => p.vendidos != null);
  return {
    total: productos.length,
    precioMinimo: precios.length ? Math.min(...precios) : null,
    precioPromedio: precios.length ? Math.round((precios.reduce((a, b) => a + b, 0) / precios.length) * 100) / 100 : null,
    precioMaximo: precios.length ? Math.max(...precios) : null,
    sumaVendidos: conVendidos.length ? conVendidos.reduce((s, p) => s + p.vendidos, 0) : null,
  };
}
