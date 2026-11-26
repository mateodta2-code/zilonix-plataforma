import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { cifrarToken } from "../lib/cifrado";
import { guardarCompetidores, leerCompetidoresGuardados } from "../lib/optimizacion/competidoresGuardados";
import { validarCompetidores } from "../lib/optimizacion/competidoresExtension";
import { dbComoEmpresa } from "./empresa-context";
import { cuentasMl, optimizacionCompetidoresExt } from "./schema";
import { crearDosEmpresas } from "./test-utils/aislamiento";

// Competidores leídos con la extensión (migración 0055) contra Postgres real:
// cada empresa solo ve los suyos, nadie los borra y una lectura nueva
// reemplaza a la anterior (una fila por publicación).

const ITEM = "MCO1342632705";
const comp = (n: number) => ({ link: `https://articulo.mercadolibre.com.co/MCO-${n}-algo`, itemId: `MCO${100000000 + n}`, titulo: `Otro ${n}`, precio: 1000 * n });

async function crearCuenta(empresaId: string) {
  const [c] = await dbComoEmpresa(empresaId, (tx) =>
    tx
      .insert(cuentasMl)
      .values({
        empresaId,
        cuentaIdExterna: `${Date.now()}${Math.floor(Math.random() * 100000)}`,
        nickname: "TIENDA",
        accessTokenCifrado: cifrarToken("a"),
        refreshTokenCifrado: cifrarToken("r"),
        tokenExpiraTs: new Date(Date.now() + 3600_000),
      })
      .returning({ id: cuentasMl.id })
  );
  return c.id;
}

function lectura(competidores: unknown[]) {
  const v = validarCompetidores({ itemId: ITEM, termino: "lámpara led", candidatos: competidores.length, competidores });
  if (!v) throw new Error("lectura inválida de prueba");
  return v;
}

describe("optimizacion_competidores_ext (RLS y seguimiento)", () => {
  it("B no ve los competidores de A; nadie los borra", async () => {
    const { empresaAId, empresaBId, usuarioAId } = await crearDosEmpresas();
    const cuentaA = await crearCuenta(empresaAId);
    await guardarCompetidores(empresaAId, { usuarioId: usuarioAId, cuentaMlId: cuentaA, itemId: ITEM, ...lectura([comp(1), comp(2), comp(3), comp(4), comp(5)]) });

    expect((await leerCompetidoresGuardados(empresaAId, ITEM))?.competidores).toHaveLength(5);
    expect(await leerCompetidoresGuardados(empresaBId, ITEM)).toBeNull();
    expect(await dbComoEmpresa(empresaBId, (tx) => tx.select().from(optimizacionCompetidoresExt).where(eq(optimizacionCompetidoresExt.itemId, ITEM)))).toHaveLength(0);
    await expect(dbComoEmpresa(empresaAId, (tx) => tx.delete(optimizacionCompetidoresExt).where(eq(optimizacionCompetidoresExt.itemId, ITEM)))).rejects.toThrow(/permission denied/);
  });

  it("una lectura nueva reemplaza a la anterior (una fila por publicación)", async () => {
    const { empresaAId, usuarioAId } = await crearDosEmpresas();
    const cuentaA = await crearCuenta(empresaAId);
    await guardarCompetidores(empresaAId, { usuarioId: usuarioAId, cuentaMlId: cuentaA, itemId: ITEM, ...lectura([comp(1), comp(2)]) });
    await guardarCompetidores(empresaAId, { usuarioId: usuarioAId, cuentaMlId: cuentaA, itemId: ITEM, ...lectura([comp(3), comp(4), comp(5)]) });
    const filas = await dbComoEmpresa(empresaAId, (tx) => tx.select().from(optimizacionCompetidoresExt).where(eq(optimizacionCompetidoresExt.itemId, ITEM)));
    expect(filas).toHaveLength(1);
    expect((await leerCompetidoresGuardados(empresaAId, ITEM))?.competidores.map((c) => c.titulo)).toEqual(["Otro 3", "Otro 4", "Otro 5"]);
  });

  it("los CHECK de la base: id de publicación válido", async () => {
    const { empresaAId } = await crearDosEmpresas();
    await expect(
      dbComoEmpresa(empresaAId, (tx) => tx.insert(optimizacionCompetidoresExt).values({ empresaId: empresaAId, itemId: "no-es-un-id", termino: "x", candidatos: 1, competidores: [] }))
    ).rejects.toThrow();
  });
});
