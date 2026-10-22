import { describe, it } from "vitest";

// Issue #61 (Z-NV-03a) — Frankie todavía no pasó los 5 casos reales que
// motivaron estas funciones (son datos reales de publicaciones/alertas,
// así que no se inventan acá — ver CLAUDE.md "verificar con evidencia
// real antes de adivinar"). Quedan como it.todo para que no se pierdan
// y para que aparezcan en el resumen de `vitest run` como pendientes,
// no como aprobados. Cuando lleguen, cada uno se vuelve un it() real
// que llama a calcularHallazgos()/coincidenciaConAlerta() con los datos
// reales (siempre como fixture, nunca pegados sueltos en el chat) y
// confirma el hallazgo exacto que debería salir.
describe("casos reales (pendientes de Frankie, issue #61)", () => {
  it.todo("registro vencido: una publicación real cuyo registro sanitario está vencido según el INVIMA");
  it.todo("alerta por nombre: una publicación real que coincide con una alerta del INVIMA solo por el nombre del producto");
  it.todo("alerta por marca: una publicación real que coincide con una alerta del INVIMA solo por la marca");
  it.todo("registro con formato raro: una publicación real cuyo registro no sigue la numeración del INVIMA desde 2023");
  it.todo("publicación no consumible: una publicación real que esConsumible() debe descartar (no es del dominio ni del prefijo de SKU configurado)");
});
