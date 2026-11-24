// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { SkuCopiable } from "./SkuCopiable";

afterEach(cleanup);

describe("SkuCopiable", () => {
  it("sin SKU (null, undefined o vacío) no renderiza nada", () => {
    for (const sku of [null, undefined, ""]) {
      const { container } = render(<SkuCopiable sku={sku} />);
      expect(container.innerHTML).toBe("");
      cleanup();
    }
  });

  it("con SKU pinta el botón con aria-label 'Copiar SKU <sku>'", () => {
    render(<SkuCopiable sku="ABC-1" prefijo="SKU: " />);
    expect(screen.getByRole("button", { name: "Copiar SKU ABC-1" })).not.toBeNull();
  });
});
