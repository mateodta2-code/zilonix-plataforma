import { describe, expect, it, vi } from "vitest";

vi.mock("./ia/imagenes/actions", () => ({ ajustarImagenAction: vi.fn(), crearImagenAction: vi.fn(), prepararImagenesAction: vi.fn() }));

import { ponerEnCreadas, tarjetasRestauradas, type Creada, type Tarjeta } from "./GenerarConIA";

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

describe("ponerEnCreadas: la barra «Imágenes creadas» no pierde nada", () => {
  const c = (id: string, url: string): Creada => ({ id, url, nombre: id, tipo: "portada", estilo: "zilonix_portadas" });

  it("una imagen nueva se agrega al final", () => {
    expect(ponerEnCreadas([c("a", "u1")], c("b", "u2")).map((x) => x.id)).toEqual(["a", "b"]);
  });

  it("al regenerar (mismo id) se reemplaza en su lugar, sin duplicar", () => {
    const r = ponerEnCreadas([c("a", "u1"), c("b", "u2")], c("a", "u3"));
    expect(r.map((x) => `${x.id}:${x.url}`)).toEqual(["a:u3", "b:u2"]);
  });
});
