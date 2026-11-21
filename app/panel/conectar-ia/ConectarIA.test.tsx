// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

import { ConectarIA, type ConexionIAVista } from "./ConectarIA";

const c = (n: number, extra: Partial<ConexionIAVista> = {}): ConexionIAVista => ({
  id: `id-${n}`, nombre: `IA ${n}`, proveedor: "openai", baseUrl: null, modelo: "gpt", esPrincipal: n === 0, modulos: [], ...extra,
});
afterEach(cleanup);

describe("ConectarIA (pantalla)", () => {
  it("muestra el contador, la llave enmascarada y las acciones", () => {
    const { container } = render(<ConectarIA conexiones={[c(0, { modulos: ["generacion_imagenes"] }), c(1)]} puedeModificar />);
    expect(screen.getByText(/2 de 5 IA conectadas/)).toBeTruthy();
    expect(screen.getAllByText(/Guardada/).length).toBe(2);
    expect(screen.getByText("Principal")).toBeTruthy();
    expect(screen.getAllByText("Probar conexión").length).toBe(2);
    // «Generación de imágenes» ya funciona (Publicar → «Crear con IA», PR2): sin aviso de próximamente.
    expect(screen.queryByText(/Próximamente: aún no genera imágenes/)).toBeNull();
    expect(container.querySelector('input[type="password"]')).toBeNull();
  });
  it("«Agregar IA» se deshabilita en 5 y avisa", () => {
    render(<ConectarIA conexiones={[0, 1, 2, 3, 4].map((n) => c(n))} puedeModificar />);
    expect((screen.getByText("Agregar IA") as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText("Puedes conectar hasta 5 IA")).toBeTruthy();
  });
  it("sin permiso de modificar no hay botones de cambio", () => {
    render(<ConectarIA conexiones={[c(0)]} puedeModificar={false} />);
    for (const t of ["Agregar IA", "Editar", "Eliminar", "Probar conexión", "Hacer principal"]) expect(screen.queryByText(t)).toBeNull();
  });
  it("textos sin voseo", () => {
    const { container } = render(<ConectarIA conexiones={[c(0)]} puedeModificar />);
    expect(container.textContent).not.toMatch(/\b(Conectá|tenés|Elegí|Agregá)\b/);
  });
  describe("ayuda para sacar la API key", () => {
    const casos: [string, string][] = [
      ["openai", "https://platform.openai.com/api-keys"],
      ["anthropic", "https://platform.claude.com/settings/keys"],
      ["google", "https://aistudio.google.com/app/apikey"],
      ["xai", "https://console.x.ai"],
    ];
    it.each(casos)("%s muestra su enlace oficial en otra pestaña", (proveedor, url) => {
      const { container } = render(<ConectarIA conexiones={[]} puedeModificar />);
      fireEvent.click(screen.getByText("Agregar IA"));
      fireEvent.change(container.querySelector("select")!, { target: { value: proveedor } });
      const a = container.querySelector(`a[href="${url}"]`) as HTMLAnchorElement;
      expect(a).toBeTruthy();
      expect(a.target).toBe("_blank");
      expect(a.rel).toContain("noopener");
      expect(a.textContent).toMatch(/^Crear mi API key en .* ↗$/);
      expect(container.querySelectorAll("ol li").length).toBeGreaterThanOrEqual(3);
    });
    it("«Otro compatible» no muestra enlace y la nota de suscripción aparece", () => {
      const { container } = render(<ConectarIA conexiones={[]} puedeModificar />);
      fireEvent.click(screen.getByText("Agregar IA"));
      fireEvent.change(container.querySelector("select")!, { target: { value: "otro_compatible_openai" } });
      expect(container.querySelector("a[target=_blank]")).toBeNull();
      expect(screen.getByText(/no sirve aquí: la API se paga aparte/)).toBeTruthy();
    });
  });
});
