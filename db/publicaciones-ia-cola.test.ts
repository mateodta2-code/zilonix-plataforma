import { describe, expect, it } from "vitest";
import { crearImagenesIA, crearTrabajoIA, leerImagenIA, MAXIMO_GENERANDO_POR_EMPRESA, terminarImagenIA, tomarCupoImagen } from "../lib/publicaciones/cola";
import { crearDosEmpresas } from "./test-utils/aislamiento";

// Publicar → «Crear con IA» (PR2) — cola de concurrencia contra Postgres
// real: máximo 2 «generando» por empresa, la tercera queda en cola y
// entra sola al liberarse un cupo; el límite es por empresa; no hay tope
// por hora ni por día.

async function preparar(empresaId: string, usuarioId: string, cantidad: number) {
  const trabajoId = await crearTrabajoIA(empresaId, { usuarioId, cuentaMlId: null, siteId: "MCO", estilo: "zilonix_contenido", ficha: {}, proveedor: "openai", modelo: "gpt-image-1" });
  return crearImagenesIA(
    empresaId,
    trabajoId,
    Array.from({ length: cantidad }, (_, i) => ({ tipo: "modo_uso", orden: i, propuesta: { titulo: `Imagen ${i}` } }))
  );
}

describe("cola de imágenes por empresa", () => {
  it("máximo 2 generando; la tercera en cola entra sola al terminar una; otra empresa no espera", async () => {
    const { empresaAId, empresaBId, usuarioAId, usuarioBId } = await crearDosEmpresas();
    const [i1, i2, i3] = await preparar(empresaAId, usuarioAId, 3);
    expect(MAXIMO_GENERANDO_POR_EMPRESA).toBe(2);
    expect(await tomarCupoImagen(empresaAId, i1)).toBe("tomado");
    expect(await tomarCupoImagen(empresaAId, i2)).toBe("tomado");
    expect(await tomarCupoImagen(empresaAId, i3)).toBe("en_cola");
    expect((await leerImagenIA(empresaAId, i3))?.estado).toBe("aprobada");

    const [b1] = await preparar(empresaBId, usuarioBId, 1);
    expect(await tomarCupoImagen(empresaBId, b1)).toBe("tomado"); // el cupo es por empresa

    await terminarImagenIA(empresaAId, i1, { url: "https://res.cloudinary.com/x/a.png", diagnostico: null });
    expect(await tomarCupoImagen(empresaAId, i3)).toBe("tomado");
  });

  it("una generando de más de 5 minutos se da por caída y libera el cupo", async () => {
    const { empresaAId, usuarioAId } = await crearDosEmpresas();
    const [i1, i2, i3] = await preparar(empresaAId, usuarioAId, 3);
    const hace10 = new Date(Date.now() - 10 * 60_000);
    await tomarCupoImagen(empresaAId, i1, hace10);
    await tomarCupoImagen(empresaAId, i2, hace10);
    expect(await tomarCupoImagen(empresaAId, i3)).toBe("tomado");
    expect((await leerImagenIA(empresaAId, i1))?.estado).toBe("error");
  });

  it("sin tope por hora: 30 imágenes seguidas pasan, de a 2", async () => {
    const { empresaAId, usuarioAId } = await crearDosEmpresas();
    const ids = await preparar(empresaAId, usuarioAId, 30);
    for (const id of ids) {
      expect(await tomarCupoImagen(empresaAId, id)).toBe("tomado");
      await terminarImagenIA(empresaAId, id, { url: "https://res.cloudinary.com/x/a.png", diagnostico: null });
    }
  });
});
