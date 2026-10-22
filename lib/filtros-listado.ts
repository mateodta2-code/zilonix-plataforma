// Validación compartida de los query params de un listado del panel
// (hoy Pedidos; Despachos va a reutilizar lo mismo). Vive aparte de
// lib/ml/pedidos.ts porque no sabe nada de Mercado Libre ni de la
// base: solo decide qué valor de la URL se acepta y cuál se ignora.
//
// Cada regla de acá salió de un caso concreto que la versión anterior
// dejaba pasar:
// - ?pagina=1e20: Number.isInteger(1e20) es true, pero el offset
//   (pagina - 1) * 25 se va a Infinity y Postgres rechaza el query.
// - ?desde=2026-02-30: `new Date("2026-02-30T00:00:00-05:00")` no da
//   NaN, desborda a marzo, y filtraba un día que la persona no pidió.
// - ?q=%: ilike('%' || q || '%') trata % y _ como comodines. Un solo
//   "%" matchea todos los pedidos.
// - ?q=q&q=otro: Next entrega string[] cuando la clave se repite. Sin
//   normalizar, el filtro y el defaultValue del <input> reciben el
//   arreglo entero.

export const PAGINA_MAXIMA = 10_000;
export const LARGO_MAXIMO_BUSQUEDA = 100;

// Entero seguro, entre 1 y PAGINA_MAXIMA. Cualquier otra cosa (0,
// negativo, decimal, 1e20, texto, > 10000) vuelve a la página 1.
// El tope de 10000 es anterior al acote por totalPaginas: una página
// enorme no se "arregla" saltando a la última, se descarta.
export function parsearPagina(valor: number | string | undefined | null): number {
  const numero = typeof valor === "number" ? valor : typeof valor === "string" ? Number(valor.trim()) : Number.NaN;
  if (!Number.isSafeInteger(numero) || numero < 1 || numero > PAGINA_MAXIMA) return 1;
  return numero;
}

// Después del count(*). totalPaginas puede ser 0 (no hay filas); la
// página visible nunca baja de 1 ni pasa de la última que tiene datos,
// así el offset no cae en una página vacía cuando sí hay pedidos.
export function acotarPagina(pagina: number, totalPaginas: number): number {
  return Math.min(pagina, Math.max(1, totalPaginas));
}

// Solo "YYYY-MM-DD" (dos dígitos en mes y día: "2026-1-5" no entra).
// Se arma con Date.UTC(año, mes-1, día, 5) — las 00:00 en Bogotá, que
// es UTC-5 todo el año — y se exige que año/mes/día sobrevivan el
// ida y vuelta. Date.UTC desborda (30 de febrero → marzo) en vez de
// devolver inválido; sin el ida y vuelta ese desborde se colaba.
export function limitesDiaBogota(fecha: string | undefined | null): { inicio: Date; finExclusivo: Date } | null {
  if (typeof fecha !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(fecha)) return null;
  const anio = Number(fecha.slice(0, 4));
  const mes = Number(fecha.slice(5, 7));
  const dia = Number(fecha.slice(8, 10));
  const inicio = new Date(Date.UTC(anio, mes - 1, dia, 5));
  if (inicio.getUTCFullYear() !== anio || inicio.getUTCMonth() !== mes - 1 || inicio.getUTCDate() !== dia) {
    return null;
  }
  // El fin es el día siguiente a las 00:00 de Bogotá (05:00 UTC),
  // exclusivo. Un <= 23:59:59.999 deja afuera cualquier timestamp
  // posterior a ese milisegundo que sigue siendo el mismo día.
  const finExclusivo = new Date(Date.UTC(anio, mes - 1, dia + 1, 5));
  return { inicio, finExclusivo };
}

export function normalizarTextoBusqueda(valor: string | undefined | null): string | null {
  if (typeof valor !== "string") return null;
  const recortado = valor.trim().slice(0, LARGO_MAXIMO_BUSQUEDA);
  return recortado.length > 0 ? recortado : null;
}

// Postgres usa la barra invertida como escape por defecto de LIKE /
// ILIKE (no hace falta cláusula ESCAPE). Hay que escapar la propia
// barra además de % y _, si no un "\" al final del texto deja el
// patrón inválido y el query falla.
export function escaparComodinesLike(texto: string): string {
  return texto.replace(/[\\%_]/g, "\\$&");
}

export function patronBusquedaLike(valor: string | undefined | null): string | null {
  const texto = normalizarTextoBusqueda(valor);
  if (texto == null) return null;
  return `%${escaparComodinesLike(texto)}%`;
}

// Next.js entrega string | string[] cuando el mismo parámetro viene
// repetido (?q=a&q=b). Nos quedamos con el primero, que es el que
// escribió el formulario.
export function normalizarParametro(valor: string | string[] | undefined): string | undefined {
  const primero = Array.isArray(valor) ? valor[0] : valor;
  return typeof primero === "string" ? primero : undefined;
}
