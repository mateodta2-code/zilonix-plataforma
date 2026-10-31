import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { dbComoEmpresa } from "./empresa-context";
import { auditoria } from "./schema";
import { crearDosEmpresas } from "./test-utils/aislamiento";

// Issue #318 (Ley 1581) — lib/datos-personales.ts registra en
// `auditoria` (misma tabla de siempre, sin tabla ni migración nueva)
// que alguien exportó o pidió borrar sus propios datos, una fila POR
// EMPRESA donde esa persona tenía membresía. afirmarAislamiento()
// (db/test-utils/aislamiento.ts) no sirve para esta tabla: auditoria
// es de solo ESCRITURA para app_user (REVOKE UPDATE, DELETE en
// db/rls-setup.sql, issue #125), así que su UPDATE/DELETE de prueba
// fallarían por permiso de Postgres, no por RLS — no probarían nada
// sobre el aislamiento. Esta prueba confirma solo lo que sí aplica:
// empresa B nunca ve (SELECT) la solicitud de datos personales de A.
describe("auditoria (RLS) — empresa B no ve las solicitudes de datos personales de A (issue #318)", () => {
  it("una fila de auditoria por 'exportar'/'anonimizar' (mis-datos) no es visible desde otra empresa", async () => {
    const { empresaAId, empresaBId, usuarioAId } = await crearDosEmpresas();

    const [fila] = await dbComoEmpresa(empresaAId, (tx) =>
      tx
        .insert(auditoria)
        .values({
          empresaId: empresaAId,
          usuarioId: usuarioAId,
          actorTipo: "persona",
          accion: "anonimizar",
          entidad: "usuario",
          entidadId: usuarioAId,
          detalle: "La persona pidió borrar su propia cuenta (Ley 1581) — datos anonimizados, membresía en esta empresa eliminada.",
        })
        .returning({ id: auditoria.id })
    );

    const veB = await dbComoEmpresa(empresaBId, (tx) => tx.select({ id: auditoria.id }).from(auditoria).where(eq(auditoria.id, fila.id)));
    expect(veB, "empresa B no debería poder ver la solicitud de datos personales de empresa A").toHaveLength(0);
  });
});
