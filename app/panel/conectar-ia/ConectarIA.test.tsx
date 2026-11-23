// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

import { ConectarIA, type ConexionIAVista } from "./ConectarIA";

const c = (n: number, extra: Partial<ConexionIAVista> = {}): ConexionIAVista => ({
  id: `id-${n}`, nombre: `IA ${n}`, proveedor: "openai", baseUrl: null, modelo: "gpt", esPrincipal: n === 0, modulos: [], ...extra,
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

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
  it("imágenes deshabilitado con nota si el proveedor no genera imágenes; con OpenAI no", () => {
    render(<ConectarIA conexiones={[c(0, { proveedor: "anthropic" })]} puedeModificar />);
    const caja = screen.getByLabelText(/Generación de imágenes/) as HTMLInputElement;
    expect(caja.disabled).toBe(true);
    expect(screen.getByText(/Esta IA no genera imágenes\. Usa una de OpenAI o Google\./)).toBeTruthy();
    cleanup();
    render(<ConectarIA conexiones={[c(0)]} puedeModificar />);
    expect((screen.getByLabelText(/Generación de imágenes/) as HTMLInputElement).disabled).toBe(false);
  });
  it("Publicidad muestra Próximamente y se puede marcar", () => {
    render(<ConectarIA conexiones={[c(0)]} puedeModificar />);
    expect(screen.getByText(/Próximamente/)).toBeTruthy();
    expect((screen.getByLabelText(/Publicidad/) as HTMLInputElement).disabled).toBe(false);
  });
  it("un módulo de otra IA muestra «(hoy usa: Nombre)»", () => {
    render(<ConectarIA conexiones={[c(0, { modulos: ["promociones"] }), c(1)]} puedeModificar />);
    expect(screen.getAllByText(/\(hoy usa: IA 0\)/).length).toBe(1);
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
  describe("lista de modelos de la cuenta", () => {
    const abrir = (respuesta: unknown) => {
      vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => respuesta })));
      const r = render(<ConectarIA conexiones={[]} puedeModificar />);
      fireEvent.click(screen.getByText("Agregar IA"));
      fireEvent.change(r.container.querySelector("select")!, { target: { value: "openai" } });
      fireEvent.change(r.container.querySelector('input[type="password"]')!, { target: { value: "sk-prueba" } });
      return r.container;
    };
    it("muestra el select con el recomendado elegido y permite escribir otro", async () => {
      const container = abrir({ ok: true, modelos: ["gpt-6.2-sol", "otro"], recomendado: "gpt-6.2-sol" });
      await screen.findByText("gpt-6.2-sol (recomendado)", {}, { timeout: 3000 });
      const selects = container.querySelectorAll("select");
      expect((selects[1] as HTMLSelectElement).value).toBe("gpt-6.2-sol");
      fireEvent.click(screen.getByText("Escribir otro modelo"));
      expect(container.querySelectorAll("select").length).toBe(1);
      expect(screen.getByText("Elegir de la lista")).toBeTruthy();
    });
    it("con error muestra el mensaje y deja el input libre", async () => {
      const container = abrir({ ok: false, error: "La API key no es válida. Revisa que la copiaste completa." });
      await waitFor(() => expect(screen.getByText(/La API key no es válida/)).toBeTruthy(), { timeout: 3000 });
      expect(container.querySelectorAll("select").length).toBe(1);
      expect(container.querySelector('input[placeholder^="ej."]')).toBeTruthy();
    });
  });
});
