// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
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
});
