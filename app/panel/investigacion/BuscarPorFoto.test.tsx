// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { BuscarPorFoto, validarArchivoFoto } from "./BuscarPorFoto";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("BuscarPorFoto", () => {
  it("validarArchivoFoto rechaza tipo inválido y archivo grande", () => {
    expect(validarArchivoFoto({ type: "application/pdf", size: 10 })).toMatch(/JPG, PNG o WebP/);
    expect(validarArchivoFoto({ type: "image/gif", size: 10 })).not.toBeNull();
    expect(validarArchivoFoto({ type: "image/jpeg", size: 6 * 1024 * 1024 })).toMatch(/5 MB/);
    expect(validarArchivoFoto({ type: "image/png", size: 1024 })).toBeNull();
  });

  it("un archivo muy grande muestra el error y nunca llama al servidor", () => {
    const f = vi.fn();
    vi.stubGlobal("fetch", f);
    render(<BuscarPorFoto pais="CO" />);
    const grande = new File([new Uint8Array(6 * 1024 * 1024)], "a.jpg", { type: "image/jpeg" });
    fireEvent.change(screen.getByTestId("archivo-foto"), { target: { files: [grande] } });
    return screen.findByRole("alert").then((el) => {
      expect(el.textContent).toMatch(/5 MB/);
      expect(f).not.toHaveBeenCalled();
    });
  });

  it("un tipo inválido muestra el error y nunca llama al servidor", async () => {
    const f = vi.fn();
    vi.stubGlobal("fetch", f);
    render(<BuscarPorFoto pais="CO" />);
    fireEvent.change(screen.getByTestId("archivo-foto"), { target: { files: [new File(["x"], "a.pdf", { type: "application/pdf" })] } });
    expect((await screen.findByRole("alert")).textContent).toMatch(/JPG, PNG o WebP/);
    expect(f).not.toHaveBeenCalled();
  });
});
