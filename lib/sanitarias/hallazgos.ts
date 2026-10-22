// Hallazgos: función pura, igual que en el OS. No se guardan; se calculan
// al leer, así un cambio de reglas aplica de una vez a lo ya guardado.
// No pausa ni borra nada en Mercado Libre: solo avisa.

import { clavePartes, clavesDistintivas, contiene, extraerRegistros, formatoRaro, marcaDeNombre, normalizar, palabrasDelNombre } from "./texto";
import type { AlertaEntrada, FotoHallazgo, Hallazgo, PublicacionEntrada, RegistroEntrada, ResumenAlerta, RevisionHallazgo } from "./tipos";

const INVIMA = "https://www.invima.gov.co";

const skuBase = (sku: unknown) => String(sku || "").trim().replace(/x\d+$/i, "").toUpperCase();

export const TIPOS = {
  alerta: "Producto en una alerta del INVIMA",
  vencido: "Registro sanitario vencido",
  otroProducto: "El registro es de otro producto",
  noAparece: "Registro que no aparece en el INVIMA",
  sinRegistro: "Suplemento sin registro escrito",
} as const;

export type AlertaPreparada = {
  a: AlertaEntrada;
  texto: string;
  regs: Set<string>;
  nombres: (string | null | undefined)[];
};

// Lo que se compara de cada alerta, calculado una sola vez.
export function prepararAlertas(alertas: readonly AlertaEntrada[]): AlertaPreparada[] {
  return alertas
    .filter((a) => a.con_detalle)
    .map((a) => {
      const textoProductos = (a.productos || []).map((x) => `${x.producto} ${x.titular}`).join(" ");
      const todo = `${a.titulo} ${textoProductos} ${a.problema}`;
      return {
        a,
        texto: ` ${normalizar(todo)} `,
        regs: new Set(extraerRegistros(`${todo} ${(a.productos || []).map((x) => x.registro).join(" ")}`).map(clavePartes)),
        nombres: (a.productos || []).map((x) => x.producto).filter(Boolean).concat(a.productos?.length ? [] : [a.titulo]),
      };
    });
}

export function resumenDeAlerta(a: AlertaEntrada, nuevasDesde: string | null = null): ResumenAlerta {
  return {
    slug: a.slug,
    numero: a.numero,
    fecha: a.fecha,
    motivo: a.motivo,
    titulo: a.titulo,
    direccion: a.direccion,
    url: INVIMA + a.slug,
    pdf: a.pdf ? INVIMA + a.pdf : null,
    productos: (a.productos || []).map((x) => x.producto).filter((p): p is string => Boolean(p)),
    nueva: Boolean(nuevasDesde && a.visto && new Date(a.visto) > new Date(nuevasDesde)),
  };
}

export type ProductoPreparado = {
  registros: string[];
  marcas: string[];
  nuestras: Set<string>;
  marcasPropias: string[];
  palabrasNuestras: Set<string>;
};

// Un producto para comparar: el nuestro publicado (registros, marcas y
// títulos de sus publicaciones) o uno que alguien está evaluando vender.
export function prepararProducto({ registros = [], marcas = [], textos = [] }: {
  registros?: string[];
  marcas?: string[];
  textos?: string[];
} = {}): ProductoPreparado {
  const todo = `${textos.join(" ")} ${marcas.join(" ")}`;
  return {
    registros,
    marcas,
    nuestras: clavesDistintivas(todo),
    // La marca cuenta solo si tiene alguna palabra distintiva ("Resveratrol"
    // o "Creatine" como marca no dicen nada) y aparece COMPLETA en la alerta:
    // palabra por palabra, "Mega Red" chocaría con cualquier "red social".
    marcasPropias: marcas.filter((m) => clavesDistintivas(m).size).map((m) => ` ${normalizar(m)} `),
    palabrasNuestras: palabrasDelNombre(todo),
  };
}

export type CoincidenciaAlerta = { nivel: string; detalle: string };

// ¿Esta alerta habla de este producto? null si no; si sí, qué tan seguro.
export function coincidenciaConAlerta(
  producto: ProductoPreparado,
  alerta: Pick<AlertaPreparada, "texto" | "regs" | "nombres">,
  { quien = "nuestra publicación" }: { quien?: string } = {},
): CoincidenciaAlerta | null {
  const { registros, marcas, nuestras, marcasPropias, palabrasNuestras } = producto;
  const comunes = registros.filter((r) => alerta.regs.has(clavePartes(r)));
  if (comunes.length) {
    return { nivel: "seguro", detalle: `La alerta menciona el mismo registro sanitario que ${quien} (${comunes.join(", ")}).` };
  }
  if (marcasPropias.some((m) => alerta.texto.includes(m))) {
    return { nivel: "marca", detalle: `La alerta menciona la marca ${marcas.join(" / ")}. Puede ser otro producto de la misma marca.` };
  }
  for (const n of alerta.nombres) {
    const kMarca = clavesDistintivas(marcaDeNombre(n));
    const kNombre = clavesDistintivas(n);
    const completo = palabrasDelNombre(n);
    if ((kMarca.size && contiene(nuestras, kMarca) && [...kNombre].filter((w) => nuestras.has(w)).length >= 2)
        || (!kMarca.size && kNombre.size >= 2 && contiene(nuestras, kNombre))
        || (!kMarca.size && completo.size >= 3 && contiene(palabrasNuestras, completo))) {
      return { nivel: "nombre", detalle: `El nombre "${n}" coincide con ${quien}. Coincidencia por nombre: hay que confirmar si es el mismo producto.` };
    }
  }
  return null;
}

export type EntradaHallazgos = {
  alertas: readonly AlertaEntrada[];
  publicaciones: readonly PublicacionEntrada[];
  registros: readonly RegistroEntrada[];
  revisiones?: Record<string, RevisionHallazgo>;
  fotos?: Record<string, FotoHallazgo>;
  nuevasDesde?: string | null;
};

export function calcularHallazgos({
  alertas,
  publicaciones,
  registros,
  revisiones = {},
  fotos = {},
  nuevasDesde = null,
}: EntradaHallazgos): Hallazgo[] {
  // Producto = SKU base (UNMRTAFULLx3 y UNMRTAFULL son lo mismo); las
  // publicaciones sin SKU van cada una por su lado para no mezclarlas.
  const grupos = new Map<string, {
    sku: string;
    pubs: PublicacionEntrada[];
    registros: Set<string>;
    marcas: Set<string>;
    textos: string[];
    suplemento: boolean;
  }>();
  for (const p of publicaciones) {
    const clave = skuBase(p.sku) || `SIN SKU · ${p.item_id}`;
    if (!grupos.has(clave)) grupos.set(clave, { sku: clave, pubs: [], registros: new Set(), marcas: new Set(), textos: [], suplemento: false });
    const g = grupos.get(clave)!;
    g.pubs.push(p);
    for (const r of p.registros || []) g.registros.add(r);
    if (p.marca) g.marcas.add(p.marca);
    g.textos.push(`${p.titulo || ""} ${p.nombre_comercial || ""}`);
    if (/SUPPLEMENT|TEA$/i.test(p.dominio || "")) g.suplemento = true;
  }

  const registroDe = new Map(registros.map((r) => [r.registro, r]));
  const hallazgos: Hallazgo[] = [];
  const agregar = (h: {
    clave: string;
    tipo: string;
    nivel: string;
    grupo: { sku: string; pubs: PublicacionEntrada[]; marcas: Set<string> };
    detalle: string;
    alerta?: ResumenAlerta | null;
    registro?: string | null;
    invima?: Hallazgo["invima"];
  }) => {
    const g = h.grupo;
    hallazgos.push({
      clave: h.clave,
      tipo: h.tipo,
      nivel: h.nivel,
      sku: g.sku,
      titulo: g.pubs[0]?.titulo || "",
      marcas: [...g.marcas],
      imagen: g.pubs.find((p) => p.imagen)?.imagen || null,
      cuentas: [...new Set(g.pubs.map((p) => p.alias))].sort() as string[],
      publicaciones: g.pubs.map((p) => ({ item_id: p.item_id, alias: p.alias, titulo: p.titulo, permalink: p.permalink, sku: p.sku })),
      detalle: h.detalle,
      alerta: h.alerta || null,
      registro: h.registro || null,
      invima: h.invima || null,
      foto: fotos[h.clave] || null,
      revision: revisiones[h.clave] || null,
    });
  };

  // 1) Alertas.
  const preparadas = prepararAlertas(alertas);

  for (const g of grupos.values()) {
    const producto = prepararProducto({ registros: [...g.registros], marcas: [...g.marcas], textos: g.textos });
    const { palabrasNuestras } = producto;
    for (const p of preparadas) {
      const c = coincidenciaConAlerta(producto, p);
      if (c) {
        agregar({ clave: `alerta|${p.a.slug}|${g.sku}`, tipo: "alerta", nivel: c.nivel, grupo: g, detalle: c.detalle, alerta: resumenDeAlerta(p.a, nuevasDesde) });
      }
    }

    // 2-4) Estado de cada registro escrito en la publicación.
    for (const reg of g.registros) {
      const r = registroDe.get(reg);
      if (!r || r.estado === "ERROR") continue;
      const filas = r.filas || [];
      const invima = filas.length
        ? { producto: filas[0].producto, titular: filas[0].titular, estado: filas[0].estado, vence: filas[0].vence, grupo: filas[0].grupo }
        : null;
      if (r.estado === "NO_APARECE") {
        agregar({
          clave: `noAparece|${reg}|${g.sku}`, tipo: "noAparece", nivel: formatoRaro(reg) ? "raro" : "normal", grupo: g, registro: reg,
          detalle: formatoRaro(reg)
            ? `${reg} no aparece en la base del INVIMA y su número no sigue la numeración que usa el INVIMA desde 2023 (5 dígitos o más). Puede estar mal escrito o no existir.`
            : `${reg} no aparece en la base de datos abiertos del INVIMA. Puede estar mal escrito o ser muy reciente.`,
        });
        continue;
      }
      if (r.estado === "Vencido") {
        agregar({
          clave: `vencido|${reg}|${g.sku}`, tipo: "vencido", nivel: "seguro", grupo: g, registro: reg, invima,
          detalle: `${reg} está vencido${invima?.vence ? ` desde ${invima.vence}` : ""} según el INVIMA.`,
        });
      }
      // El registro existe pero lo que dice el INVIMA no comparte ninguna
      // palabra distintiva con nuestra publicación (el caso del colágeno con
      // el registro de un queso).
      if (invima) {
        // Se comparan TODAS las palabras, ingredientes incluidos: el INVIMA
        // describe genérico ("alimento en polvo a base de…, variedades…") y
        // casi nunca repite el nombre comercial, así que solo se avisa cuando
        // no hay ni un ingrediente en común.
        const delInvima = palabrasDelNombre(filas.map((f) => f.producto).join(" "));
        const coinciden = [...delInvima].some((w) => palabrasNuestras.has(w));
        if (delInvima.size && !coinciden) {
          agregar({
            clave: `otroProducto|${reg}|${g.sku}`, tipo: "otroProducto", nivel: "revisar", grupo: g, registro: reg, invima,
            detalle: `En el INVIMA, ${reg} es "${(invima.producto as string).slice(0, 160)}" de ${invima.titular}. No se parece a nuestra publicación: puede ser un número mal escrito.`,
          });
        }
      }
    }

    // 5) Suplementos sin ningún registro escrito.
    if (!g.registros.size && g.suplemento) {
      agregar({
        clave: `sinRegistro|${g.sku}`, tipo: "sinRegistro", nivel: "revisar", grupo: g,
        detalle: "La publicación no tiene número de registro sanitario ni en el atributo ni en la descripción. Solo se puede revisar por nombre.",
      });
    }
  }

  const peso: Record<string, number> = { alerta: 0, vencido: 1, otroProducto: 2, noAparece: 3, sinRegistro: 4 };
  const pesoNivel: Record<string, number> = { seguro: 0, marca: 1, raro: 1, nombre: 2, revisar: 3, normal: 3 };
  hallazgos.sort((x, y) =>
    peso[x.tipo] - peso[y.tipo]
    || (y.alerta?.nueva ? 1 : 0) - (x.alerta?.nueva ? 1 : 0)
    || pesoNivel[x.nivel] - pesoNivel[y.nivel]
    || y.publicaciones.length - x.publicaciones.length);
  return hallazgos;
}
