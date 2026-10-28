// ADENDO UX de Publicar — lógica pura del formulario de "Publicar
// producto nuevo" (sin DOM, sin fetch) para poder probarla con datos
// simples, mismo criterio que lib/ml/publicar-reglas.ts. Las funciones
// de serialización arman EXACTAMENTE el mismo formato de texto que
// nuevo/actions.ts ya sabe leer (ID=valor por línea, siteId::título=
// categoryId por línea) — para que la UI dinámica (SelectorCategoria,
// CaracteristicasDinamicas, EditorVariantes) no necesite CAMBIAR el
// parser del servidor, solo llenarlo mejor.

export type DimensionesTexto = { peso: string; largo: string; ancho: string; alto: string };

// Bug real evitado (igual que Zilonix OS actual): alguien pone "1" en
// las 4 medidas sin medir de verdad, para pasar la validación de
// "obligatorias" sin pensarlo — Mercado Libre calcula el costo real de
// envío con esto, un relleno falso cobra mal (o rechaza el pedido más
// adelante). Bloquea SOLO cuando las 4 están presentes Y las 4 son
// <=1 — una sola en 1 (ej. "1cm de ancho" de algo chato de verdad)
// nunca dispara esto solo.
export function esRellenoFalsoDimensiones(dim: DimensionesTexto): boolean {
  const valores = [dim.peso, dim.largo, dim.ancho, dim.alto];
  if (valores.some((v) => v.trim() === "")) return false;
  const numeros = valores.map((v) => Number(v));
  if (numeros.some((n) => !Number.isFinite(n))) return false;
  return numeros.every((n) => n <= 1);
}

// Sin ejes, o con algún eje elegido pero todavía sin ningún valor
// elegido: [] (nunca una combinación "fantasma" con ese eje vacío —
// sería una fila sin cómo distinguirla de otra en la tabla).
export function productoCartesiano(valoresPorEje: Record<string, string[]>, ejes: string[]): Record<string, string>[] {
  if (ejes.length === 0 || ejes.some((eje) => (valoresPorEje[eje] ?? []).length === 0)) return [];
  return ejes.reduce<Record<string, string>[]>((acc, eje) => {
    const valoresEje = valoresPorEje[eje] ?? [];
    const siguiente: Record<string, string>[] = [];
    for (const combinacionPrevia of acc) {
      for (const valor of valoresEje) {
        siguiente.push({ ...combinacionPrevia, [eje]: valor });
      }
    }
    return siguiente;
  }, [{}]);
}

// Mismo formato "ID=valor\nID2=valor2" que parsearLineasClaveValor
// (nuevo/actions.ts) ya sabe leer — nunca se cambia el parser, solo se
// llena mejor desde la UI dinámica. Entradas vacías se omiten (igual
// que el parser, que las ignora de todas formas).
export function serializarClaveValor(valores: Record<string, string>): string {
  return Object.entries(valores)
    .filter(([, v]) => v.trim() !== "")
    .map(([k, v]) => `${k}=${v}`)
    .join("\n");
}

// Mismo formato "siteId::título=categoryId" que ya lee nuevo/actions.ts
// (categoriasOverride). `SITE_ID` siempre "MCO" en esta fase (único
// país en alcance, ver lib/ml/cliente.ts) — nunca se pide a la persona
// que lo escriba a mano.
export function serializarCategoriaOverride(siteId: string, titulo: string, categoryId: string): string {
  if (!titulo.trim() || !categoryId.trim()) return "";
  return `${siteId}::${titulo}=${categoryId}`;
}

export type MaxFotos = number | null;

// Punto 5 del ADENDO — "galería por URL: respetar max_pictures; la
// primera es portada si no hay portada por cuenta". La categoría
// decide el tope real (obtenerLimiteFotos, lib/ml/publicar.ts — 12 de
// respaldo si Mercado Libre no lo confirma); acá solo se usa ese
// número para avisar/recortar en la UI ANTES de publicar, nunca
// después de un rechazo.
export function fotosDentroDelLimite(urls: string[], limite: MaxFotos): string[] {
  if (limite == null) return urls;
  return urls.slice(0, limite);
}
