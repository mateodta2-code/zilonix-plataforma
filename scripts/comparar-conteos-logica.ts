// Z-MT-11. La comparación no abre conexiones: así se puede probar sin
// una base y sin riesgo de imprimir una cadena de conexión. El script
// que sí se conecta está en comparar-conteos.ts y solo lee.

export type ConteoTabla = {
  tabla: string;
  filas: number;
};

export type FilaComparacion = {
  tabla: string;
  origen: number | null;
  restaurada: number | null;
};

export type IdentidadBase = {
  base: string;
  dir: string;
  puerto: string;
};

export const VARIABLE_ORIGEN = "DATABASE_URL_ORIGEN";
export const VARIABLE_RESTAURADA = "DATABASE_URL_RESTAURADA";

export type LadoConexion = "origen" | "restaurada";

// `rolsuper OR rolbypassrls` ya viene calculado desde Postgres. Solo
// `true` cuenta: un null (el rol no apareció en pg_roles) o cualquier
// otro valor se trata como "no salta", porque si no los conteos de
// app_user quedarían filtrados por empresa y parecerían una
// restauración mala. El mensaje no lleva la URL ni el nombre del rol.
export function decisionSaltoRls(
  lado: LadoConexion,
  rolsuperOBypass: boolean | null,
): { ok: true } | { ok: false; mensaje: string } {
  if (rolsuperOBypass === true) return { ok: true };
  return {
    ok: false,
    mensaje:
      `La conexión de ${lado} no salta RLS; los conteos saldrían filtrados por empresa. ` +
      "Usa el usuario postgres del túnel.",
  };
}

const NOMBRE_TABLA = /^[A-Za-z_][A-Za-z0-9_]*$/;

export function variablesFaltantes(env: Record<string, string | undefined>): string[] {
  const faltan: string[] = [];
  for (const nombre of [VARIABLE_ORIGEN, VARIABLE_RESTAURADA]) {
    const valor = env[nombre];
    if (typeof valor !== "string" || valor.trim() === "") faltan.push(nombre);
  }
  return faltan;
}

export function mensajeVariablesFaltantes(faltan: readonly string[]): string {
  return (
    `Faltan variables de entorno: ${faltan.join(", ")}. ` +
    "Hay que exportarlas en esta terminal y volver a correr el script. " +
    "No pegues la cadena de conexión en un issue, un chat ni un log."
  );
}

export function urlsSonIguales(origen: string, restaurada: string): boolean {
  return origen.trim() === restaurada.trim();
}

// Railway nombra `railway` la base de casi todo Postgres nuevo. Por eso
// el nombre solo no alcanza para saber si las dos URLs son el mismo
// servicio. Si el servidor no informa dirección, no se bloquea acá: el
// caso de pegar la misma cadena ya lo cubre urlsSonIguales.
export function esLaMismaBase(origen: IdentidadBase, restaurada: IdentidadBase): boolean {
  if (origen.base !== restaurada.base) return false;
  if (origen.dir === "" || restaurada.dir === "") return false;
  return origen.dir === restaurada.dir && origen.puerto === restaurada.puerto;
}

export function citarTabla(nombre: string): string {
  if (!NOMBRE_TABLA.test(nombre)) {
    throw new Error(
      "Hay una tabla en public con un nombre que este script no cita. No se imprime el nombre.",
    );
  }
  return `"${nombre}"`;
}

// Una sola sentencia, sin punto y coma: el nombre ya pasó por citarTabla,
// así que no se puede colar otra orden detrás del conteo.
export function consultaConteos(tablas: readonly string[]): string {
  if (tablas.length === 0) {
    return "SELECT ''::text AS tabla, '0'::text AS filas WHERE false";
  }
  return tablas
    .map((tabla) => {
      const citada = citarTabla(tabla);
      return `SELECT '${tabla}'::text AS tabla, count(*)::text AS filas FROM public.${citada}`;
    })
    .join(" UNION ALL ");
}

export function conteoDesdeTexto(tabla: string, texto: string): ConteoTabla {
  if (!NOMBRE_TABLA.test(tabla) || !/^\d+$/.test(texto)) {
    throw new Error("Conteo ilegible. No se imprime el valor crudo.");
  }
  const filas = Number(texto);
  if (!Number.isSafeInteger(filas)) {
    throw new Error("Conteo fuera de rango. No se imprime el valor crudo.");
  }
  return { tabla, filas };
}

export function compararConteos(
  origen: readonly ConteoTabla[],
  restaurada: readonly ConteoTabla[],
): FilaComparacion[] {
  const a = indexar(origen);
  const b = indexar(restaurada);
  const nombres = [...new Set([...a.keys(), ...b.keys()])].sort((x, y) => (x < y ? -1 : x > y ? 1 : 0));
  return nombres.map((tabla) => ({
    tabla,
    origen: a.has(tabla) ? a.get(tabla)! : null,
    restaurada: b.has(tabla) ? b.get(tabla)! : null,
  }));
}

function indexar(filas: readonly ConteoTabla[]): Map<string, number> {
  const mapa = new Map<string, number>();
  for (const fila of filas) {
    if (!NOMBRE_TABLA.test(fila.tabla)) {
      throw new Error("Nombre de tabla no comparable. No se imprime el nombre.");
    }
    if (mapa.has(fila.tabla)) {
      throw new Error(`Tabla repetida en un lado: ${fila.tabla}.`);
    }
    if (!Number.isSafeInteger(fila.filas) || fila.filas < 0) {
      throw new Error(`Conteo inválido para ${fila.tabla}.`);
    }
    mapa.set(fila.tabla, fila.filas);
  }
  return mapa;
}

export function hayDiferencias(filas: readonly FilaComparacion[]): boolean {
  return filas.some((fila) => fila.origen !== fila.restaurada);
}

// Solo el nombre y los dos conteos. `-` es "la tabla no está en ese lado",
// que no es lo mismo que cero filas.
export function formatearComparacion(filas: readonly FilaComparacion[]): string {
  return filas
    .map((fila) => {
      if (!NOMBRE_TABLA.test(fila.tabla)) {
        throw new Error("Nombre de tabla no imprimible.");
      }
      if (!esConteoImprimible(fila.origen) || !esConteoImprimible(fila.restaurada)) {
        throw new Error("Conteo no imprimible.");
      }
      const origen = fila.origen === null ? "-" : String(fila.origen);
      const restaurada = fila.restaurada === null ? "-" : String(fila.restaurada);
      return `${fila.tabla} ${origen} ${restaurada}`;
    })
    .join("\n");
}

function esConteoImprimible(valor: number | null): boolean {
  return valor === null || (Number.isSafeInteger(valor) && valor >= 0);
}

export function mensajeErrorSeguro(error: unknown): string {
  const crudo = error instanceof Error ? error.message : "Error desconocido.";
  const limpio = crudo
    .replace(/postgres(?:ql)?:\/\/\S+/gi, "[omitido]")
    .replace(/\/\/[^\s/]*@[^\s/]+/g, "//[omitido]")
    .replace(/\bpassword\b[=:][^\s]*/gi, "password=[omitido]")
    .replace(/\b[\w.+-]+:[^@\s/]+@[\w.-]+/g, "[omitido]")
    .replace(/\b\d{1,3}(?:\.\d{1,3}){3}(?::\d+)?\b/g, "[host]")
    .replace(/\blocalhost:\d+\b/gi, "[host]");
  if (/postgres(?:ql)?:\/\//i.test(limpio) || /password/i.test(limpio)) {
    return "Falló la lectura. No se imprime el detalle porque puede incluir datos de conexión.";
  }
  return `Falló la lectura: ${limpio}`;
}
