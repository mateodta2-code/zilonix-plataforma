// Issue #61 (Z-NV-03a) — port casi literal de prepararAlertas(),
// prepararProducto() y coincidenciaConAlerta() de
// lib/alertas-sanitarias.js (zilonix-os, autor Frankie). Funciones
// puras: sin fetch, sin db, sin process.env.
import { clavePartes, clavesDistintivas, contiene, extraerRegistros, marcaDeNombre, normalizar, palabrasDelNombre } from "./normalizacion";
import type { AlertaInvima, AlertaPreparada, Coincidencia, ProductoPreparado } from "./tipos";

// Lo que se compara de cada alerta, calculado una sola vez.
export function prepararAlertas(alertas: AlertaInvima[]): AlertaPreparada[] {
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

// Un producto para comparar: el nuestro publicado (registros, marcas y
// títulos de sus publicaciones) o uno que alguien está evaluando vender.
export function prepararProducto({
  registros = [],
  marcas = [],
  textos = [],
}: {
  registros?: string[];
  marcas?: string[];
  textos?: string[];
}): ProductoPreparado {
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

// ¿Esta alerta habla de este producto? null si no; si sí, qué tan seguro.
export function coincidenciaConAlerta(
  producto: ProductoPreparado,
  { texto, regs, nombres }: Pick<AlertaPreparada, "texto" | "regs" | "nombres">,
  { quien = "nuestra publicación" }: { quien?: string } = {}
): Coincidencia | null {
  const { registros, marcas, nuestras, marcasPropias, palabrasNuestras } = producto;
  const comunes = registros.filter((r) => regs.has(clavePartes(r)));
  if (comunes.length) {
    return { nivel: "seguro", detalle: `La alerta menciona el mismo registro sanitario que ${quien} (${comunes.join(", ")}).` };
  }
  if (marcasPropias.some((m) => texto.includes(m))) {
    return { nivel: "marca", detalle: `La alerta menciona la marca ${marcas.join(" / ")}. Puede ser otro producto de la misma marca.` };
  }
  for (const n of nombres) {
    const kMarca = clavesDistintivas(marcaDeNombre(n));
    const kNombre = clavesDistintivas(n);
    const completo = palabrasDelNombre(n);
    if (
      (kMarca.size && contiene(nuestras, kMarca) && [...kNombre].filter((w) => nuestras.has(w)).length >= 2) ||
      (!kMarca.size && kNombre.size >= 2 && contiene(nuestras, kNombre)) ||
      (!kMarca.size && completo.size >= 3 && contiene(palabrasNuestras, completo))
    ) {
      return {
        nivel: "nombre",
        detalle: `El nombre "${n}" coincide con ${quien}. Coincidencia por nombre: hay que confirmar si es el mismo producto.`,
      };
    }
  }
  return null;
}
