// @vitest-environment jsdom
//
// Issue "copiar SKU en despachos" (despachos-copiar-sku) — mismo
// patrón que PaginaPromociones.test.tsx/FotoConZoom.test.tsx
// (@testing-library/react + jsdom): sin DB/acciones de servidor en
// CopiarTexto.tsx, corre sin Postgres.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { CopiarTexto } from "./CopiarTexto";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("CopiarTexto", () => {
  it("el click copia el valor EXACTO con navigator.clipboard.writeText y muestra el aviso", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText } });

    render(<CopiarTexto valor="SKU-12345" mensajeCopiado="SKU copiado" />);
    fireEvent.click(screen.getByRole("button", { name: "Copiar SKU-12345" }));

    expect(writeText).toHaveBeenCalledTimes(1);
    expect(writeText).toHaveBeenCalledWith("SKU-12345");
    expect(await screen.findByText("✓ SKU copiado")).not.toBeNull();
  });

  it("el aviso desaparece solo después de ~1.5s (tiempo real, sin fake timers: act() no corre limpio en este repo todavía)", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText } });

    render(<CopiarTexto valor="SKU-1" />);
    fireEvent.click(screen.getByRole("button", { name: "Copiar SKU-1" }));
    expect(await screen.findByText("✓ Copiado")).not.toBeNull();

    await vi.waitFor(() => expect(screen.queryByText("✓ Copiado")).toBeNull(), { timeout: 2_500, interval: 50 });
  }, 10_000);

  it("si el portapapeles falla, muestra 'No se pudo copiar' (el botón sigue con user-select: text para copiar a mano)", async () => {
    vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText: vi.fn().mockRejectedValue(new Error("sin permiso")) } });

    render(<CopiarTexto valor="SKU-9" />);
    fireEvent.click(screen.getByRole("button", { name: "Copiar SKU-9" }));

    expect(await screen.findByText("No se pudo copiar")).not.toBeNull();
  });

  it("aria-label por defecto es 'Copiar <valor>'; un llamador puede pasar uno más específico", () => {
    render(<CopiarTexto valor="ABC" etiquetaAria="Copiar SKU ABC" />);
    expect(screen.getByRole("button", { name: "Copiar SKU ABC" })).not.toBeNull();
  });

  it("el click nunca burbujea (stopPropagation) — no dispara el onClick de un contenedor ancestro", () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText } });
    const onClickAncestro = vi.fn();

    render(
      <div onClick={onClickAncestro}>
        <CopiarTexto valor="SKU-7" />
      </div>
    );
    fireEvent.click(screen.getByRole("button", { name: "Copiar SKU-7" }));

    expect(writeText).toHaveBeenCalledWith("SKU-7");
    expect(onClickAncestro).not.toHaveBeenCalled();
  });

  it("resalta (.copiado) al copiar y el title por defecto es 'Clic para copiar'", async () => {
    vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } });
    render(<CopiarTexto valor="SKU-3" />);
    const boton = screen.getByRole("button", { name: "Copiar SKU-3" });
    expect(boton.getAttribute("title")).toBe("Clic para copiar");
    fireEvent.click(boton);
    await screen.findByText("✓ Copiado");
    expect(boton.className).toContain("copiado");
  });

  it("el click hace preventDefault (no navega dentro de un enlace)", () => {
    vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } });
    render(<CopiarTexto valor="SKU-4" />);
    const ok = fireEvent.click(screen.getByRole("button", { name: "Copiar SKU-4" }));
    expect(ok).toBe(false);
  });

  it("comoSpan: span role=button, Enter y Espacio copian sin burbujear ni ejecutar el default", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText } });
    const onKeyDownAncestro = vi.fn();
    render(
      <div onKeyDown={onKeyDownAncestro}>
        <CopiarTexto valor="SKU-5" comoSpan />
      </div>
    );
    const el = screen.getByRole("button", { name: "Copiar SKU-5" });
    expect(el.tagName).toBe("SPAN");
    expect(el.getAttribute("tabindex")).toBe("0");
    expect(fireEvent.keyDown(el, { key: "Enter" })).toBe(false);
    expect(fireEvent.keyDown(el, { key: " " })).toBe(false);
    expect(writeText).toHaveBeenCalledTimes(2);
    expect(onKeyDownAncestro).not.toHaveBeenCalled();
    expect(await screen.findByText("✓ Copiado")).not.toBeNull();
  });
});
