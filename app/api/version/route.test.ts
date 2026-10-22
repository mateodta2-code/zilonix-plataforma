import { afterEach, describe, expect, it, vi } from "vitest";
import { dynamic, GET, revalidate } from "./route";

// Issue #37 (Z-P0-09), ajuste — sin dynamic/revalidate, Next puede
// prerenderizar esta ruta como estática y servir siempre el mismo
// commit cacheado, sin importar qué versión esté corriendo de verdad.
describe("/api/version (issue #37)", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("exporta dynamic = \"force-dynamic\" y revalidate = 0 (nunca se cachea ni prerenderiza)", () => {
    expect(dynamic).toBe("force-dynamic");
    expect(revalidate).toBe(0);
  });

  it("GET devuelve el commit cortado cuando RAILWAY_GIT_COMMIT_SHA está puesta", async () => {
    vi.stubEnv("RAILWAY_GIT_COMMIT_SHA", "a1b2c3d4e5f6789012345678901234567890abcd");

    const respuesta = await GET();
    const cuerpo = await respuesta.json();

    expect(cuerpo.commit).toBe("a1b2c3d");
  });
});
