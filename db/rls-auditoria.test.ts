import { describe, it } from "vitest";
import { auditoria } from "./schema";
import { afirmarAislamiento, crearDosEmpresas } from "./test-utils/aislamiento";

// Issue #318 (Ley 1581) — lib/datos-personales.ts registra en
// `auditoria` (misma tabla de siempre, sin tabla ni migración nueva)
// que alguien exportó o pidió borrar sus propios datos, una fila POR
// EMPRESA donde esa persona tenía membresía. La política RLS de
// auditoria (aislamiento_auditoria, db/rls-setup.sql) no cambió para
// esto — esta prueba confirma que esa fila sigue tan aislada por
// empresa como cualquier otra: empresa B nunca ve, edita ni borra la
// solicitud de datos personales de empresa A.
describe("auditoria (RLS) — empresa B no ve las solicitudes de datos personales de A (issue #318)", () => {
  it("una fila de auditoria por 'exportar'/'anonimizar' (mis-datos) está tan aislada como cualquier otra", async () => {
    const contexto = await crearDosEmpresas();
    await afirmarAislamiento(contexto, auditoria, (tx, empresaId) =>
      tx
        .insert(auditoria)
        .values({
          empresaId,
          usuarioId: contexto.usuarioAId,
          actorTipo: "persona",
          accion: "anonimizar",
          entidad: "usuario",
          entidadId: contexto.usuarioAId,
          detalle: "La persona pidió borrar su propia cuenta (Ley 1581) — datos anonimizados, membresía en esta empresa eliminada.",
        })
        .returning({ id: auditoria.id })
    );
  });
});
