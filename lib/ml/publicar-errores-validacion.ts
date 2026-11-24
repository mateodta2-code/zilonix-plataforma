// Traductor puro de los errores de validación de Mercado Libre
// (`{"error":"validation_error","cause":[...]}`) a mensajes claros en
// español. Caso real (Camilo): ML devolvió un 400 y Publicar le mostró el
// JSON crudo, así que creyó que debía reconectar su cuenta. Un error de
// validación nunca es un problema de conexión: aquí jamás se sugiere
// reconectar.

export type CausaValidacionMl = {
  tipo: "error" | "warning";
  codigo: string;
  mensajeMl: string;
  referencias: string[];
};

export type CausaTraducida = {
  tipo: "error" | "warning";
  codigo: string;
  /** Texto claro en español, o el mensaje propio de ML si el código no se conoce. */
  mensaje: string;
  /** true si el código no está en el traductor (se muestra el código en letra pequeña). */
  desconocido: boolean;
  /** Campo señalado por `references`, ya en español, si se puede. */
  campo: string | null;
};

export type ErrorValidacionTraducido = {
  bloqueos: CausaTraducida[];
  avisos: CausaTraducida[];
};

const CAMPOS_POR_REFERENCIA: Record<string, string> = {
  "item.attributes": "Características",
  "item.available_quantity": "Cantidad disponible",
  "item.price": "Precio",
  "item.title": "Título",
  "item.family_name": "Título",
  "item.pictures": "Fotos",
  "item.category_id": "Categoría",
  "item.shipping": "Envío",
};

function parsear(texto: string): Record<string, unknown> | null {
  try {
    const v = JSON.parse(texto);
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** Extrae las causas de la respuesta cruda de ML; null si no es un validation_error con `cause[]`. */
export function parsearCausasValidacion(textoCrudo: string): CausaValidacionMl[] | null {
  const raiz = parsear(textoCrudo.trim());
  if (!raiz || !Array.isArray(raiz.cause)) return null;
  if (raiz.error !== "validation_error" && raiz.status !== 400) return null;
  const causas: CausaValidacionMl[] = [];
  for (const c of raiz.cause) {
    if (!c || typeof c !== "object") continue;
    const o = c as Record<string, unknown>;
    causas.push({
      tipo: o.type === "warning" ? "warning" : "error",
      codigo: typeof o.code === "string" ? o.code : "",
      mensajeMl: typeof o.message === "string" ? o.message : "",
      referencias: Array.isArray(o.references) ? o.references.filter((r): r is string => typeof r === "string") : [],
    });
  }
  return causas.length ? causas : null;
}

/** Atributos entre corchetes: "The attributes [GTIN, BRAND] are required…" → ["GTIN","BRAND"]. */
function atributosEntreCorchetes(mensajeMl: string): string[] {
  const m = /attributes?\s*\[([^\]]+)\]/i.exec(mensajeMl);
  return m ? m[1].split(",").map((s) => s.trim()).filter(Boolean) : [];
}

/** Nombre del campo entre comillas: `El campo "Tipo de producto" es…` → "Tipo de producto". */
function nombreDeCampoEnMensaje(mensajeMl: string): string | null {
  const m = /"([^"]+)"|“([^”]+)”|«([^»]+)»/.exec(mensajeMl);
  return (m?.[1] ?? m?.[2] ?? m?.[3] ?? null)?.trim() || null;
}

function campoDeReferencias(referencias: string[]): string | null {
  for (const r of referencias) {
    if (CAMPOS_POR_REFERENCIA[r]) return CAMPOS_POR_REFERENCIA[r];
  }
  return null;
}

export function traducirCausa(causa: CausaValidacionMl): CausaTraducida {
  const base = { tipo: causa.tipo, codigo: causa.codigo, campo: campoDeReferencias(causa.referencias) };
  switch (causa.codigo) {
    case "item.attribute.missing_conditional_required": {
      const atributos = atributosEntreCorchetes(causa.mensajeMl);
      if (atributos.some((a) => a.toUpperCase() === "GTIN")) {
        return { ...base, desconocido: false, mensaje: "Esta categoría exige el código de barras (GTIN). Llénalo o marca que el producto no tiene código." };
      }
      const lista = atributos.length ? atributos.join(", ") : null;
      return {
        ...base,
        desconocido: false,
        mensaje: lista ? `Esta categoría exige llenar estas características: ${lista}.` : "Esta categoría exige características que no están cargadas.",
      };
    }
    case "item.attribute.missing_catalog_required":
    case "item.attribute.missing_required": {
      const nombre = nombreDeCampoEnMensaje(causa.mensajeMl);
      return { ...base, desconocido: false, mensaje: nombre ? `Falta el campo ‹${nombre}›.` : "Falta una característica obligatoria de la categoría." };
    }
    case "item.available_quantity.ignored":
      return { ...base, desconocido: false, mensaje: "Tu cuenta maneja stock en varias bodegas; la cantidad se toma de allá. No tienes que hacer nada." };
    default:
      return { ...base, desconocido: true, mensaje: causa.mensajeMl || "Mercado Libre rechazó la publicación sin dar más detalle." };
  }
}

/** Traduce la respuesta cruda de ML; null si no es un error de validación reconocible. */
export function traducirErrorValidacion(textoCrudo: string): ErrorValidacionTraducido | null {
  const causas = parsearCausasValidacion(textoCrudo);
  if (!causas) return null;
  const traducidas = causas.map(traducirCausa);
  return {
    bloqueos: traducidas.filter((c) => c.tipo === "error"),
    avisos: traducidas.filter((c) => c.tipo === "warning"),
  };
}

/** Cuánto texto crudo se guarda: un validation_error se guarda completo (hasta 8000) para poder volver a leerlo; lo demás, como siempre, 2000. */
export function textoErrorParaGuardar(textoCrudo: string): string {
  return parsearCausasValidacion(textoCrudo) ? textoCrudo.slice(0, 8000) : textoCrudo.slice(0, 2000);
}
