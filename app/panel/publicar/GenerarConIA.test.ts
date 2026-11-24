import { describe, expect, it, vi } from "vitest";

vi.mock("./ia/imagenes/actions", () => ({ ajustarImagenAction: vi.fn(), crearImagenAction: vi.fn(), prepararImagenesAction: vi.fn() }));

import { tarjetasRestauradas, type Tarjeta } from "./GenerarConIA";

describe("tarjetasRestauradas: al recargar, nada queda «Creando…» para siempre", () => {
  const t = (estado: Tarjeta["estado"]) => ({ id: estado, estado, titulo: "", copy: "", ajuste: "" }) as unknown as Tarjeta;

  it("las que se estaban creando o esperaban turno vuelven a «propuesta» con aviso", () => {
    const r = tarjetasRestauradas([t("generando"), t("en_cola")]);
    expect(r.map((x) => x.estado)).toEqual(["propuesta", "propuesta"]);
    expect(r[0].mensaje).toMatch(/Se interrumpió/);
  });

  it("las listas, propuestas y con error quedan igual", () => {
    const antes = [t("lista"), t("propuesta"), t("error")];
    expect(tarjetasRestauradas(antes)).toEqual(antes);
  });
});
