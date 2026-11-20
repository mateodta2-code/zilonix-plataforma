// «Estilo experto ML»: texto PROPIO de Zilonix (no copiado de terceros),
// exactamente el de la tarea, con las {variables} que llena el código.

import { bloqueDatosProducto, type DatosProducto } from "./datosProducto";

export const ESTILO_EXPERTO_ML = { id: "experto_ml", etiqueta: "Estilo experto ML" } as const;

export const PLANTILLA_EXPERTO_ML = `Eres director de arte y diseñador de imágenes de venta para Mercado Libre ({nombrePais}).
Crea UNA imagen cuadrada 1:1 (salida final de 500 × 500 px), del tipo: {nombreTipo}.
Objetivo de esta imagen: {objetivoTipo}
Composición: {composicion}

PRODUCTO
- Usa EXACTAMENTE el producto de las fotos de referencia: misma forma, proporciones, colores, materiales, marca y piezas. No lo cambies, no agregues ni quites partes, no inventes funciones.
- El producto es el protagonista: grande, nítido, completo, con luz de estudio comercial y sombras suaves.
- Ficha confirmada por el vendedor: {fichaConfirmada}

TEXTO EN LA IMAGEN
- Idioma: {idioma}. Ortografía perfecta, con tildes y signos correctos. No traduzcas nombres de marca.
- Usa SOLO estos textos, escritos tal cual, sin agregar otros: titular «{titular}»; apoyos: {apoyos}.
- Tipografía sans serif gruesa, alto contraste y tamaño legible en celular (el titular ocupa como máximo un tercio del ancho). Máximo 6 bloques de texto en total.
- Prohibido: precios, descuentos, cuotas, envío gratis, sellos o certificaciones no confirmadas, garantías, promesas de salud, nombres o logos de otras marcas, marcas de agua, códigos QR, teléfonos, enlaces o datos de contacto.

DISEÑO
- Estética limpia, moderna y premium. Íconos simples y planos junto a cada apoyo.
- Paleta: {paleta}. Si no hay manual de marca, usa neutros con un solo color de acento que combine con el producto.
- Todo integrado en un solo diseño (no un collage). Fotografía comercial realista, sin aspecto de caricatura ni render artificial.
- Deja márgenes de seguridad: nada importante a menos del 5 % del borde.

Entrega una sola imagen final.`;

// Catálogo del «Estilo experto ML» (punto 4.3 de la tarea).
export const TIPOS_EXPERTO_ML = [
  { id: "beneficio_principal", nombre: "Beneficio principal", objetivo: "Mostrar el beneficio más importante en una escena de uso real.", composicion: "Producto grande a un lado y la escena de uso al otro, con el titular arriba.", porDefecto: true },
  { id: "escenarios_uso", nombre: "Escenarios de uso", objetivo: "Mostrar 3 o 4 situaciones reales donde se usa.", composicion: "Producto al centro y 3 o 4 escenas pequeñas integradas alrededor.", porDefecto: false },
  { id: "anatomia", nombre: "Anatomía del producto", objetivo: "Señalar sus partes reales y para qué sirve cada una.", composicion: "Producto al centro con 3 a 5 líneas finas hacia cada parte y su apoyo.", porDefecto: true },
  { id: "medidas", nombre: "Medidas", objetivo: "Mostrar las medidas reales y la escala.", composicion: "Producto de frente con cotas de medida limpias.", porDefecto: true, requiere: "medidas" },
  { id: "que_incluye", nombre: "Qué incluye", objetivo: "Mostrar todo lo que trae la caja.", composicion: "Cada pieza incluida separada y ordenada sobre fondo limpio.", porDefecto: true, requiere: "incluye" },
  { id: "detalle_material", nombre: "Detalle del material", objetivo: "Mostrar de cerca el material, el cierre o el mecanismo.", composicion: "Primer plano macro de un detalle real con el producto completo pequeño a un lado.", porDefecto: false },
  { id: "comparativa", nombre: "Comparativa", objetivo: "Nosotros vs. genérico, sin nombrar marcas ni cifras no confirmadas.", composicion: "Dos columnas: este producto con chulos y «opción genérica» con equis, solo diferencias confirmadas.", porDefecto: true },
  { id: "tabla_caracteristicas", nombre: "Tabla de características", objetivo: "Resumir especificaciones confirmadas.", composicion: "Producto a un lado y una tabla corta de 4 a 6 filas al otro.", porDefecto: false },
  { id: "objeciones", nombre: "Dudas del comprador", objetivo: "Responder 3 dudas reales con respuestas confirmadas.", composicion: "Producto al centro y 3 burbujas de pregunta y respuesta.", porDefecto: false },
  { id: "modo_uso", nombre: "Modo de uso", objetivo: "Explicar el uso en 3 pasos.", composicion: "Tres pasos numerados de izquierda a derecha con el producto en cada uno.", porDefecto: false },
  { id: "estilo_vida", nombre: "Estilo de vida", objetivo: "Emocionar con el producto en su mejor momento de uso.", composicion: "Escena aspiracional con el producto protagonista y un titular corto.", porDefecto: true },
] as const satisfies readonly { id: string; nombre: string; objetivo: string; composicion: string; porDefecto: boolean; requiere?: string }[];

export type TipoExpertoML = (typeof TIPOS_EXPERTO_ML)[number]["id"];

const MEDIDAS = /^- (Alto|Ancho|Largo|Capacidad|Peso):/m;

export function tipoExpertoDisponible(tipo: TipoExpertoML, datos: DatosProducto): { ok: true } | { ok: false; motivo: string } {
  const info = TIPOS_EXPERTO_ML.find((t) => t.id === tipo);
  if (!info) return { ok: false, motivo: "Tipo desconocido." };
  if ("requiere" in info && info.requiere === "medidas" && !MEDIDAS.test(datos.fichaConfirmada)) return { ok: false, motivo: "Confirma las medidas para crear esta imagen." };
  if ("requiere" in info && info.requiere === "incluye" && !datos.incluye) return { ok: false, motivo: "Confirma qué incluye para crear esta imagen." };
  return { ok: true };
}

export function promptExpertoML(datos: DatosProducto, tipo: TipoExpertoML, textos: { titular: string; apoyos: string[]; paleta?: string }): string {
  const info = TIPOS_EXPERTO_ML.find((t) => t.id === tipo)!;
  const valores: Record<string, string> = {
    nombrePais: datos.nombrePais,
    nombreTipo: info.nombre,
    objetivoTipo: info.objetivo,
    composicion: info.composicion,
    fichaConfirmada: datos.fichaConfirmada,
    idioma: datos.idioma,
    titular: textos.titular,
    apoyos: textos.apoyos.map((a) => `«${a}»`).join(", ") || "(ninguno)",
    paleta: textos.paleta || "sin manual de marca",
  };
  const texto = PLANTILLA_EXPERTO_ML.replace(/\{(\w+)\}/g, (_, k: string) => valores[k] ?? "");
  return [bloqueDatosProducto(datos), "", texto].join("\n");
}
