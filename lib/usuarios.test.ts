import { randomUUID } from "crypto";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

// Issue #219 — igual que el resto del repo, esta prueba necesita
// Postgres real (DATABASE_URL_APP) para probar la carrera de verdad
// contra el índice único de Postgres — nunca se puede simular con un
// mock de la base. A diferencia del resto del repo (que deja que
// `@/db` reviente al cargarse si falta la variable, tratado como baseline
// conocido en CI), este archivo evita el import ESTÁTICO de `@/db` y
// usa `describe.skipIf` + imports dinámicos dentro de cada prueba —
// así, sin la variable, vitest muestra un "skipped" limpio en vez de
// un "failed", sin cambiar nada del comportamiento real en CI (que
// siempre tiene la variable puesta).
const HAY_POSTGRES = Boolean(process.env.DATABASE_URL_APP);

// Mismo motivo que middleware.test.ts: desde Clerk 6.39.8,
// @clerk/nextjs/server importa "server-only", que revienta fuera de
// un runtime real de Server Component — hace falta mockearlo para que
// vitest (Node) pueda cargar el módulo.
vi.mock("server-only", () => ({}));
vi.mock("@clerk/nextjs/server", async (importOriginal) => {
  const real = await importOriginal<typeof import("@clerk/nextjs/server")>();
  return { ...real, currentUser: vi.fn() };
});

describe.skipIf(!HAY_POSTGRES)("obtenerOCrearUsuarioActual (issue #219)", () => {
  let currentUser: (typeof import("@clerk/nextjs/server"))["currentUser"];
  let db: (typeof import("@/db"))["db"];
  let obtenerOCrearUsuarioActual: (typeof import("./usuarios"))["obtenerOCrearUsuarioActual"];
  let usuarios: (typeof import("@/db/schema"))["usuarios"];
  let eq: (typeof import("drizzle-orm"))["eq"];

  beforeAll(async () => {
    ({ currentUser } = await import("@clerk/nextjs/server"));
    ({ db } = await import("@/db"));
    ({ obtenerOCrearUsuarioActual } = await import("./usuarios"));
    ({ usuarios } = await import("@/db/schema"));
    ({ eq } = await import("drizzle-orm"));
  });

  afterEach(() => vi.restoreAllMocks());

  // Solo los 4 campos que obtenerOCrearUsuarioActual lee de verdad —
  // nunca el tipo completo real de Clerk, que no hace falta acá.
  function clerkUserFalso(id: string, email: string) {
    return { id, primaryEmailAddress: { emailAddress: email }, firstName: "Prueba", lastName: "Race" } as never;
  }

  // El bug real (issue #219): dos requests casi simultáneos del MISMO
  // usuario de Clerk, sin fila todavía, pasaban los dos el SELECT
  // inicial como "no existe" antes de que el primer INSERT
  // confirmara — Promise.all() con el mismo clerkUserId reproduce esa
  // ventana de verdad (los dos `await` de la función interleaving en
  // el mismo event loop), contra Postgres real, nunca simulado.
  it("carrera real: dos llamadas concurrentes con el MISMO clerkUserId nunca revientan, nunca duplican la fila", async () => {
    const clerkUserId = `clerk-race-${randomUUID()}`;
    const email = `prueba-race-${randomUUID()}@zilonix.test`;
    vi.mocked(currentUser).mockResolvedValue(clerkUserFalso(clerkUserId, email));

    const [a, b] = await Promise.all([obtenerOCrearUsuarioActual(), obtenerOCrearUsuarioActual()]);

    expect(a).toBeDefined();
    expect(b).toBeDefined();
    expect(a?.id).toBe(b?.id); // la misma fila para los dos, nunca dos filas

    const filas = await db.select().from(usuarios).where(eq(usuarios.clerkUserId, clerkUserId));
    expect(filas).toHaveLength(1);
  });

  // Caso ya cubierto desde antes de este issue (ver el comentario de
  // esViolacionDeEmailUnico en lib/usuarios.ts) — se mantiene la MISMA
  // política, solo que ahora llega por un camino distinto dentro de
  // la función: nunca se inventa nada nuevo acá.
  it("fila existente con el MISMO email pero clerk_user_id distinto/null: la adopta, nunca la duplica", async () => {
    const email = `prueba-adopta-${randomUUID()}@zilonix.test`;
    const [previo] = await db.insert(usuarios).values({ email, nombre: "Fila sembrada" }).returning();

    const clerkUserIdNuevo = `clerk-adopta-${randomUUID()}`;
    vi.mocked(currentUser).mockResolvedValue(clerkUserFalso(clerkUserIdNuevo, email));

    const resultado = await obtenerOCrearUsuarioActual();

    expect(resultado?.id).toBe(previo.id); // misma fila, nunca una nueva
    expect(resultado?.clerkUserId).toBe(clerkUserIdNuevo);

    const filas = await db.select().from(usuarios).where(eq(usuarios.email, email));
    expect(filas).toHaveLength(1);
  });

  it("usuario nuevo de verdad, sin ninguna carrera: crea exactamente una fila con los datos de Clerk", async () => {
    const clerkUserId = `clerk-nuevo-${randomUUID()}`;
    const email = `prueba-nuevo-${randomUUID()}@zilonix.test`;
    vi.mocked(currentUser).mockResolvedValue(clerkUserFalso(clerkUserId, email));

    const resultado = await obtenerOCrearUsuarioActual();

    expect(resultado?.email).toBe(email);
    expect(resultado?.clerkUserId).toBe(clerkUserId);
    expect(resultado?.nombre).toBe("Prueba Race");

    const filas = await db.select().from(usuarios).where(eq(usuarios.clerkUserId, clerkUserId));
    expect(filas).toHaveLength(1);
  });
});
