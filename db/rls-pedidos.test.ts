import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { db } from "./index";
import { dbComoEmpresa } from "./empresa-context";
import { pedidos } from "./schema";
import { afirmarAislamiento, crearDosEmpresas } from "./test-utils/aislamiento";
import { crearCuentaMlDePrueba } from "./test-utils/venta";

// Issue #320 — pedidos es una tabla crítica que la plantilla de #39
// (db/test-utils/aislamiento.ts) nunca llegó a cubrir directo: solo
// pedido_items (línea por línea) tenía su propia prueba de RLS. Mismo
// patrón que db/rls-cuentas-ml.test.ts: crearDosEmpresas() +
// afirmarAislamiento() ya prueban SELECT/UPDATE/DELETE cruzados entre
// A y B contra Postgres real.
describe("pedidos (RLS, issue #320)", () => {
  it("empresa B no ve, edita ni borra un pedido de empresa A", async () => {
    const contexto = await crearDosEmpresas();
    const cuentaMlId = await crearCuentaMlDePrueba(contexto.empresaAId);

    await afirmarAislamiento(contexto, pedidos, (tx, empresaId) =>
      tx
        .insert(pedidos)
        .values({
          empresaId,
          cuentaMlId,
          pedidoIdExterno: `orden-humo-${empresaId.slice(0, 8)}`,
          fecha: new Date("2026-10-20T15:00:00Z"),
          total: "100000.00",
          moneda: "COP",
          estado: "paid",
        })
        .returning({ id: pedidos.id })
    );
  });

  // Issue #320 ("el test debe fallar si se quita empresa_id/RLS") —
  // la prueba de arriba compara A contra B, pero nunca demuestra que
  // el candado es RLS y no "la app siempre se acuerda de filtrar". Acá
  // se consulta con `db` SIN pasar por dbComoEmpresa (sin ningún
  // app.empresa_actual fijado). La política aislamiento_pedidos hace
  // `current_setting('app.empresa_actual', true)::uuid` — sin
  // contexto ese valor es `""`, y `''::uuid` revienta con "invalid
  // input syntax for type uuid" (review 5725841190: con un
  // `toHaveLength(0)` esa excepción nunca llegaba a evaluarse, el
  // `await` del SELECT ya había reventado antes). Eso es justo lo que
  // se prueba: sin contexto, la consulta falla CERRADA por el cast,
  // nunca "silenciosamente vacía". Si algún día se quitara la columna
  // empresa_id o la política entera, este SELECT ya no haría ningún
  // cast y SÍ devolvería la fila sin tirar error — el `rejects` de
  // abajo fallaría, dejando la regresión en rojo.
  it("consultar pedidos con `db` directo (sin dbComoEmpresa) falla cerrado por el cast de la política, no devuelve nada en silencio", async () => {
    const contexto = await crearDosEmpresas();
    const cuentaMlId = await crearCuentaMlDePrueba(contexto.empresaAId);

    const [pedido] = await dbComoEmpresa(contexto.empresaAId, (tx) =>
      tx
        .insert(pedidos)
        .values({
          empresaId: contexto.empresaAId,
          cuentaMlId,
          pedidoIdExterno: `orden-sin-contexto-${contexto.empresaAId.slice(0, 8)}`,
          fecha: new Date("2026-10-20T15:00:00Z"),
          total: "50000.00",
          moneda: "COP",
          estado: "paid",
        })
        .returning({ id: pedidos.id })
    );

    await expect(
      db.select({ id: pedidos.id }).from(pedidos).where(eq(pedidos.id, pedido.id)),
      "sin app.empresa_actual, el cast de la política tiene que reventar, nunca devolver una lista vacía en silencio"
    ).rejects.toThrow(/invalid input syntax for type uuid/);

    // La fila sí existe y es visible con el contexto correcto — así
    // el `rejects.toThrow` de arriba no pasa "por accidente" por un
    // INSERT que en realidad falló.
    const conContexto = await dbComoEmpresa(contexto.empresaAId, (tx) =>
      tx.select({ id: pedidos.id }).from(pedidos).where(eq(pedidos.id, pedido.id))
    );
    expect(conContexto).toHaveLength(1);
  });
});
