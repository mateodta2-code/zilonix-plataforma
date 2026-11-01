import { obtenerFotoItemMl, obtenerOfertasProducto, obtenerPublicacionesVendedorAjenoMl, type PublicacionTiendaMl } from "@/lib/ml/cliente";

// Issue #175 — traduce lo que devuelve lib/ml/cliente.ts (campos
// crudos de Mercado Libre) a lo que necesita una fila de
// seguimiento_fotos. Nunca llama a fetch por su cuenta — toda llamada
// real sigue viviendo en lib/ml/cliente.ts.
export type DatosFotoNueva = {
  precio: number | null;
  precioAnterior: number | null;
  inventarioDisponible: number | null;
  inventarioAproximado: boolean;
  vendidos: number | null;
  estado: string | null;
  enCatalogo: boolean | null;
  ganaBotonCompra: boolean | null;
  esFull: boolean | null;
  esEnvioGratis: boolean | null;
  publicaciones: PublicacionTiendaMl[] | null;
  // Issue #251 ("Seguimiento muestra aproximados como Selltrix") —
  // date_created real de Mercado Libre, cuando la API lo confirma
  // (nunca para tipo "tienda", que no tiene una fecha de creación
  // propia). lib/seguimiento/aproximados.ts lo usa para la antigüedad
  // real de la publicación; si viene null, esa misma función cae a
  // interpolar por el número del id — nunca se inventa acá.
  //
  // Issue #262 (revisión de Pablo, punto bloqueante) — SOLO real para
  // recurso_ml "item" (la publicación puntual que de verdad se sigue).
  // Para "product" (catálogo) este campo queda SIEMPRE null acá abajo
  // — el date_created de catálogo real nunca sale de este lector (que
  // solo ve ofertas/ítems puntuales), sale de resolverNombreYFechaCatalogo
  // (lib/seguimiento/seguimientos.ts, GET /products/{id}) y se guarda
  // aparte como `fechaCreacionCatalogo` (lib/trabajos/revisionDiariaSeguimiento.ts) —
  // nunca la fecha de la oferta GANADORA de ese catálogo, que es el
  // date_created de un ítem puntual de un vendedor cualquiera, no del
  // catálogo en sí.
  fechaCreacion: string | null;
};

function fotoVacia(): DatosFotoNueva {
  return {
    precio: null,
    precioAnterior: null,
    inventarioDisponible: null,
    inventarioAproximado: false,
    vendidos: null,
    estado: null,
    enCatalogo: null,
    ganaBotonCompra: null,
    esFull: null,
    esEnvioGratis: null,
    publicaciones: null,
    fechaCreacion: null,
  };
}

export type SeguimientoParaLeer = {
  tipo: "producto" | "tienda";
  recursoMl: "item" | "product" | "seller";
  mlIdExterno: string;
};

// "Gana el botón de compra" significa algo distinto según qué se está
// siguiendo (nunca se adivina una sola regla para los dos casos):
// - recursoMl = "item": esa publicación PUNTUAL (de un vendedor
//   conocido, sea propio o de un competidor) es la oferta que
//   Mercado Libre muestra primero en el catálogo — confirmado en
//   producción (lib/ml/cliente.ts, obtenerOfertasProducto): el orden
//   real que devuelve /products/{id}/items ya refleja esto, el primer
//   resultado es el que gana.
// - recursoMl = "product": se sigue el catálogo en sí, sin una
//   publicación puntual — acá "gana" se interpreta como "la cuenta
//   PROPIA conectada (cuentaIdExternaPropia) es la que actualmente
//   gana", porque es la única lectura que tiene sentido sin una
//   publicación de referencia. Si el día de mañana se confirma otra
//   semántica real contra Mercado Libre, se ajusta acá, nunca en
//   lib/trabajos/.
export async function leerFotoSeguimiento(seguimiento: SeguimientoParaLeer, token: string, cuentaIdExternaPropia: string): Promise<DatosFotoNueva> {
  if (seguimiento.tipo === "tienda") {
    const publicaciones = await obtenerPublicacionesVendedorAjenoMl(seguimiento.mlIdExterno, token);
    return { ...fotoVacia(), publicaciones };
  }

  if (seguimiento.recursoMl === "item") {
    const item = await obtenerFotoItemMl(seguimiento.mlIdExterno, token);
    if (!item) return fotoVacia();

    let ganaBotonCompra: boolean | null = null;
    if (item.catalogProductId) {
      const ofertas = await obtenerOfertasProducto(item.catalogProductId, token);
      ganaBotonCompra = ofertas.length > 0 ? ofertas[0].itemId === seguimiento.mlIdExterno : null;
    }

    return {
      precio: item.precio,
      precioAnterior: item.precioAnterior,
      inventarioDisponible: item.inventarioDisponible,
      // Siempre true para un item AJENO: Mercado Libre no garantiza
      // que available_quantity sea el disponible real exacto para una
      // publicación que no es nuestra (regla explícita del issue).
      inventarioAproximado: item.inventarioDisponible != null,
      vendidos: item.vendidos,
      estado: item.estado,
      enCatalogo: item.enCatalogo,
      ganaBotonCompra,
      esFull: item.esFull,
      esEnvioGratis: item.esEnvioGratis,
      publicaciones: null,
      fechaCreacion: item.fechaCreacion,
    };
  }

  // recursoMl === "product"
  const ofertas = await obtenerOfertasProducto(seguimiento.mlIdExterno, token);
  const ganadora = ofertas[0] ?? null;
  return {
    precio: ganadora?.precio ?? null,
    precioAnterior: null, // original_price es del ITEM, no de la lista de ofertas del catálogo
    inventarioDisponible: null,
    inventarioAproximado: false,
    vendidos: null,
    estado: null,
    enCatalogo: true, // si tiene ofertas reales, el id es de catálogo por definición
    ganaBotonCompra: ganadora ? ganadora.sellerId === cuentaIdExternaPropia : null,
    esFull: ganadora?.esFull ?? null,
    esEnvioGratis: ganadora?.esEnvioGratis ?? null,
    publicaciones: null,
    // Issue #262 (revisión de Pablo, punto bloqueante) — bug real:
    // antes esto era `ganadora?.fechaCreacion ?? null` — el
    // date_created de la OFERTA GANADORA (un ítem puntual de un
    // vendedor cualquiera), nunca el del catálogo en sí. Guardarlo acá
    // como si fuera la antigüedad del catálogo hubiera calibrado (y
    // mostrado) una antigüedad de catálogo basada en cuándo un
    // vendedor cualquiera publicó SU oferta — nunca el campo correcto.
    // Siempre `null`, a propósito: el date_created real del catálogo
    // sale de resolverNombreYFechaCatalogo (lib/seguimiento/seguimientos.ts,
    // GET /products/{id}) y se guarda aparte como `fechaCreacionCatalogo`
    // (lib/trabajos/revisionDiariaSeguimiento.ts) — nunca de este lector.
    fechaCreacion: null,
  };
}
