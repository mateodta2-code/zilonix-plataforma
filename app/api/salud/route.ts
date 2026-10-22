import { sql } from "drizzle-orm";
import { db } from "@/db";

// Z-MT-10 (issue #45) — sonda pública para el monitor y para
// scripts/humo.sh. Solo números y estados: un `select 1` dice si la
// base contesta. El error del driver no se reenvía: postgres.js mete
// en el mensaje el host y, a veces, el usuario de la cadena de
// conexión, y esta URL la va a leer cualquiera.
//
// La cola de trabajos es el issue #49 y todavía no hay tabla en main.
// No se inventa una consulta contra un esquema que no existe: los dos
// campos salen null para que el cliente distinga "todavía no hay cola"
// de "la base no contestó" (eso es el 503, con los mismos campos en
// null y base=caida).
export const TIMEOUT_SALUD_MS = 2_000;

// Next.js 14 prerenderiza un GET que no lee la petición y dejaría
// congelado el JSON del build. Un 200 viejo, con la base ya caída, le
// mentiría al monitor. force-dynamic + revalidate 0 obliga a correr
// esto en el proceso vivo, y Cache-Control evita que un proxy lo guarde.
export const dynamic = "force-dynamic";
export const revalidate = 0;

const EDAD_ULTIMO_TRABAJO_S: number | null = null;
const TRABAJOS_MUERTOS: number | null = null;

// El tope es del lado de la respuesta, no solo statement_timeout: si
// el host de la base ni siquiera acepta la conexión, Postgres nunca
// llega a cancelar la sentencia y el driver espera su propio connect
// timeout (decenas de segundos). Quien llama —el monitor, cada
// minuto— no puede quedarse colgado eso.
function conTimeout<T>(promesa: PromiseLike<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const id = setTimeout(() => reject(new Error("timeout")), ms);
    promesa.then(
      (valor) => {
        clearTimeout(id);
        resolve(valor);
      },
      () => {
        clearTimeout(id);
        // Se descarta el motivo real a propósito (ver el comentario de
        // arriba). Quien llama solo necesita saber que no hubo respuesta.
        reject(new Error("base"));
      }
    );
  });
}

function responder(ok: boolean, status: number): Response {
  return Response.json(
    {
      ok,
      base: ok ? "ok" : "caida",
      // En el 503 tampoco se arrastran números de una consulta que no
      // llegó a correr. Hoy son null en los dos caminos; cuando exista
      // la cola, solo el 200 los llena.
      edad_ultimo_trabajo_s: ok ? EDAD_ULTIMO_TRABAJO_S : null,
      trabajos_muertos: ok ? TRABAJOS_MUERTOS : null,
    },
    {
      status,
      headers: { "Cache-Control": "no-store, max-age=0" },
    }
  );
}

export async function GET(): Promise<Response> {
  try {
    // No pasa por dbComoEmpresa: no hay empresa activa y `select 1` no
    // lee ninguna tabla de negocio. RLS no aplica a esta sentencia.
    await conTimeout(db.execute(sql`select 1`), TIMEOUT_SALUD_MS);
    return responder(true, 200);
  } catch {
    return responder(false, 503);
  }
}
