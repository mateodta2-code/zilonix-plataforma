// Issue #61 (Z-NV-03a) — port casi literal de la sección "Hallazgos
// (función pura)" de lib/alertas-sanitarias.js (zilonix-os, autor
// Frankie): "Los hallazgos NO se guardan: se calculan al leer con
// calcularHallazgos(), una función pura (igual que calcularSugerencias
// en inventario-recompras), así cualquier cambio en las reglas aplica
// de una vez a todo lo guardado." Sin fetch, sin db, sin process.env —
// recibe todo ya leído (alertas, publicaciones, registros) como datos.
import { coincidenciaConAlerta, prepararAlertas, prepararProducto } from "./coincidencias";
import { formatoRaro, palabrasDelNombre } from "./normalizacion";
import type {
  AlertaInvima,
  Hallazgo,
  PublicacionConsumible,
  RegistroSanitario,
  ResumenAlerta,
  RevisionManual,
  VeredictoFoto,
} from "./tipos";

// Base del INVIMA para armar los links de una alerta — ningún fetch,
// solo concatenación de texto.
const INVIMA = "https://www.invima.gov.co";

const skuBase = (sku: string | null | undefined): string => String(sku || "").trim().replace(/x\d+$/i, "").toUpperCase();

export const TIPOS: Record<string, string> = {
  alerta: "Producto en una alerta del INVIMA",
  vencido: "Registro sanitario vencido",
  otroProducto: "El registro es de otro producto",
  noAparece: "Registro que no aparece en el INVIMA",
  sinRegistro: "Suplemento sin registro escrito",
};

export function resumenDeAlerta(a: AlertaInvima, nuevasDesde: string | null = null): ResumenAlerta {
  return {
    slug: a.slug,
    numero: a.numero,
    fecha: a.fecha,
    motivo: a.motivo,
    titulo: a.titulo,
    direccion: a.direccion,
    url: INVIMA + a.slug,
    pdf: a.pdf ? INVIMA + a.pdf : null,
    productos: (a.productos || []).map((x) => x.producto).filter(Boolean),
    nueva: Boolean(nuevasDesde && a.visto && new Date(a.visto) > new Date(nuevasDesde)),
  };
}

type GrupoDeSku = {
  sku: string;
  pubs: PublicacionConsumible[];
  registros: Set<string>;
  marcas: Set<string>;
  textos: string[];
  suplemento: boolean;
};

export function calcularHallazgos({
  alertas,
  publicaciones,
  registros,
  revisiones = {},
  fotos = {},
  nuevasDesde = null,
}: {
  alertas: AlertaInvima[];
  publicaciones: PublicacionConsumible[];
  registros: RegistroSanitario[];
  revisiones?: Record<string, RevisionManual>;
  fotos?: Record<string, VeredictoFoto>;
  nuevasDesde?: string | null;
}): Hallazgo[] {
  // Producto = SKU base (UNMRTAFULLx3 y UNMRTAFULL son lo mismo); las
  // publicaciones sin SKU van cada una por su lado para no mezclarlas.
  const grupos = new Map<string, GrupoDeSku>();
  for (const p of publicaciones) {
    const clave = skuBase(p.sku) || `SIN SKU · ${p.item_id}`;
    if (!grupos.has(clave)) {
      grupos.set(clave, { sku: clave, pubs: [], registros: new Set(), marcas: new Set(), textos: [], suplemento: false });
    }
    const g = grupos.get(clave) as GrupoDeSku;
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
    tipo: Hallazgo["tipo"];
    nivel: Hallazgo["nivel"];
    grupo: GrupoDeSku;
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
      cuentas: [...new Set(g.pubs.map((p) => p.alias))].sort(),
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
        agregar({
          clave: `alerta|${p.a.slug}|${g.sku}`,
          tipo: "alerta",
          nivel: c.nivel,
          grupo: g,
          detalle: c.detalle,
          alerta: resumenDeAlerta(p.a, nuevasDesde),
        });
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
          clave: `noAparece|${reg}|${g.sku}`,
          tipo: "noAparece",
          nivel: formatoRaro(reg) ? "raro" : "normal",
          grupo: g,
          registro: reg,
          detalle: formatoRaro(reg)
            ? `${reg} no aparece en la base del INVIMA y su número no sigue la numeración que usa el INVIMA desde 2023 (5 dígitos o más). Puede estar mal escrito o no existir.`
            : `${reg} no aparece en la base de datos abiertos del INVIMA. Puede estar mal escrito o ser muy reciente.`,
        });
        continue;
      }
      if (r.estado === "Vencido") {
        agregar({
          clave: `vencido|${reg}|${g.sku}`,
          tipo: "vencido",
          nivel: "seguro",
          grupo: g,
          registro: reg,
          invima,
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
            clave: `otroProducto|${reg}|${g.sku}`,
            tipo: "otroProducto",
            nivel: "revisar",
            grupo: g,
            registro: reg,
            invima,
            detalle: `En el INVIMA, ${reg} es "${invima.producto.slice(0, 160)}" de ${invima.titular}. No se parece a nuestra publicación: puede ser un número mal escrito.`,
          });
        }
      }
    }

    // 5) Suplementos sin ningún registro escrito.
    if (!g.registros.size && g.suplemento) {
      agregar({
        clave: `sinRegistro|${g.sku}`,
        tipo: "sinRegistro",
        nivel: "revisar",
        grupo: g,
        detalle: "La publicación no tiene número de registro sanitario ni en el atributo ni en la descripción. Solo se puede revisar por nombre.",
      });
    }
  }

  const peso: Record<string, number> = { alerta: 0, vencido: 1, otroProducto: 2, noAparece: 3, sinRegistro: 4 };
  const pesoNivel: Record<string, number> = { seguro: 0, marca: 1, raro: 1, nombre: 2, revisar: 3, normal: 3 };
  hallazgos.sort(
    (x, y) =>
      peso[x.tipo] - peso[y.tipo] ||
      (y.alerta?.nueva ? 1 : 0) - (x.alerta?.nueva ? 1 : 0) ||
      pesoNivel[x.nivel] - pesoNivel[y.nivel] ||
      y.publicaciones.length - x.publicaciones.length
  );
  return hallazgos;
}
