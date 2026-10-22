import { asc } from "drizzle-orm";
import { dbComoEmpresa } from "@/db/empresa-context";
import { cuentasMl } from "@/db/schema";

// Z-MT-08 — nombre del query que comparten bandeja, publicar,
// inventario y despachos cuando adopten el selector (cada una en su
// issue, no acá). "todas" es el valor explícito; ausente o vacío
// significan lo mismo.
export const PARAM_CUENTA = "cuenta";
export const CUENTA_TODAS = "todas";

// Lo único que puede llegar al navegador. `apodo` es
// cuentas_ml.nickname (así lo llama Mercado Libre). No entra el id
// externo de la cuenta, ni el token, ni el JSON cifrado: el SELECT de
// abajo ni siquiera pide esas columnas.
export type CuentaMlParaSelector = {
  id: string;
  apodo: string;
};

export type SeleccionCuentaMl = {
  cuentas: CuentaMlParaSelector[];
  // null = Todas. Nunca es el id de una cuenta de otra empresa.
  cuentaId: string | null;
};

function textoDelParametro(cuenta: string | string[] | null | undefined): string {
  if (typeof cuenta === "string") return cuenta.trim();
  // ?cuenta=a&cuenta=b no es una elección. Se trata como Todas en vez
  // de quedarse con una de las dos al azar.
  if (Array.isArray(cuenta) && cuenta.length === 1 && typeof cuenta[0] === "string") {
    return cuenta[0].trim();
  }
  return "";
}

// Pura, sin base: así se puede probar el "no es de esta empresa →
// Todas, sin tirar error" sin Postgres. `cuentasDeLaEmpresa` tiene
// que ser la lista que ya devolvió listarCuentasMlParaSelector (RLS).
// Un id que no está ahí — otra empresa, una cuenta borrada, basura —
// no es un error de datos: la pantalla sigue en Todas.
export function resolverCuentaMl(
  cuenta: string | string[] | null | undefined,
  cuentasDeLaEmpresa: readonly { id: string }[]
): string | null {
  const texto = textoDelParametro(cuenta).toLowerCase();
  if (!texto || texto === CUENTA_TODAS) return null;
  // Se devuelve el id de la fila, no el texto del query: un UUID en
  // mayúsculas sigue siendo la misma cuenta y no queda "Todas" por
  // el casing.
  const encontrada = cuentasDeLaEmpresa.find((c) => c.id.toLowerCase() === texto);
  return encontrada ? encontrada.id : null;
}

export async function listarCuentasMlParaSelector(empresaId: string): Promise<CuentaMlParaSelector[]> {
  // dbComoEmpresa fija app.empresa_actual con SET LOCAL dentro de la
  // transacción (db/empresa-context.ts). La política de cuentas_ml
  // compara empresa_id contra eso: la otra empresa no aparece, aunque
  // alguien pase su id. La conexión es la de app_user (db/index.ts),
  // la única que esta función puede usar — la de migraciones no se
  // importa desde acá.
  const filas = await dbComoEmpresa(empresaId, (tx) =>
    tx
      .select({
        id: cuentasMl.id,
        apodo: cuentasMl.nickname,
      })
      .from(cuentasMl)
      .orderBy(asc(cuentasMl.nickname), asc(cuentasMl.id))
  );
  // Copia explícita de los dos campos. Una cuenta desconectada sigue
  // en la lista: desconectar no borra la fila (tarea 2.3) y su
  // histórico sigue siendo de esta empresa, así que elegirla es
  // válido. Todas también la incluye.
  return filas.map((fila) => ({ id: fila.id, apodo: fila.apodo }));
}

// Lo que va a llamar cada pantalla para filtrar, y lo que usa el
// componente. Una sola regla: si el query no es una cuenta de ESTA
// empresa, cuentaId es null (Todas) y no se lanza.
export async function leerCuentaMlDeQuery(
  empresaId: string,
  cuenta: string | string[] | null | undefined
): Promise<SeleccionCuentaMl> {
  const cuentas = await listarCuentasMlParaSelector(empresaId);
  return { cuentas, cuentaId: resolverCuentaMl(cuenta, cuentas) };
}
