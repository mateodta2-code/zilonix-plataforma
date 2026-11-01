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
  // app.empresa_actual fijado) — ni siquiera la propia empresa dueña
  // debería ver la fila. Si algún día se quitara la columna
  // empresa_id o la política aislamiento_pedidos (db/rls-setup.sql),
  // esta consulta SÍ traería la fila y el `toHaveLength(0)` de abajo
  // reventaría.
  it("consultar pedidos con `db` directo (sin dbComoEmpresa) no devuelve nada, aunque la fila exista", async () => {
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

    const sinContexto = await db.select({ id: pedidos.id }).from(pedidos).where(eq(pedidos.id, pedido.id));
    expect(sinContexto, "sin app.empresa_actual, RLS tiene que bloquear hasta a la propia empresa dueña").toHaveLength(0);

    // La fila sí existe y es visible con el contexto correcto — así
    // el `toHaveLength(0)` de arriba no pasa "por accidente" por un
    // INSERT que en realidad falló.
    const conContexto = await dbComoEmpresa(contexto.empresaAId, (tx) =>
      tx.select({ id: pedidos.id }).from(pedidos).where(eq(pedidos.id, pedido.id))
    );
    expect(conContexto).toHaveLength(1);
  });
});
