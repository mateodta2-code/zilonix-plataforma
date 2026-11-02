// @vitest-environment jsdom
//
// Issue #323 — "test de que el checklist refleja bien cada estado".
// Mismo patrón que CopiarTexto.test.tsx (@testing-library/react +
// jsdom): sin DB acá, ChecklistOnboarding.tsx (server) ya tiene su
// propio progreso resuelto cuando llega a este componente — lo único
// que hay que probar es que pinta bien lo que le llega y que
// "Saltar por ahora"/"Ver los primeros pasos" funcionan.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ChecklistOnboardingCliente, type PasoChecklist } from "./ChecklistOnboardingCliente";

const PASOS_SIN_EMPEZAR: PasoChecklist[] = [
  { clave: "empresa", titulo: "Crea tu empresa", hecho: true },
  { clave: "conectar", titulo: "Conecta tu primera cuenta de Mercado Libre", hecho: false, href: "/panel/conectar-ml", etiquetaBoton: "Conectar cuenta" },
  { clave: "pedido", titulo: "Mira tu primer pedido", hecho: false, href: "/panel/pedidos", etiquetaBoton: "Ver pedidos" },
];

afterEach(() => {
  cleanup();
  localStorage.clear();
});

beforeEach(() => {
  localStorage.clear();
});

describe("ChecklistOnboardingCliente", () => {
  it("un paso hecho sale sin botón; uno pendiente sale con el botón al siguiente paso", () => {
    render(<ChecklistOnboardingCliente empresaId="empresa-1" pasos={PASOS_SIN_EMPEZAR} />);

    expect(screen.getByText("Crea tu empresa")).not.toBeNull();
    expect(screen.getByRole("link", { name: "Conectar cuenta" }).getAttribute("href")).toBe("/panel/conectar-ml");
    expect(screen.getByRole("link", { name: "Ver pedidos" }).getAttribute("href")).toBe("/panel/pedidos");
  });

  it("un paso pendiente sin acceso a esa pantalla no muestra ningún botón", () => {
    const pasos: PasoChecklist[] = [{ clave: "conectar", titulo: "Conecta tu primera cuenta de Mercado Libre", hecho: false }];
    render(<ChecklistOnboardingCliente empresaId="empresa-1" pasos={pasos} />);

    expect(screen.queryByRole("link")).toBeNull();
  });

  it("«Saltar por ahora» oculta el checklist y lo recuerda en localStorage por empresa", () => {
    render(<ChecklistOnboardingCliente empresaId="empresa-1" pasos={PASOS_SIN_EMPEZAR} />);

    fireEvent.click(screen.getByRole("button", { name: "Saltar por ahora" }));

    expect(screen.queryByText("Primeros pasos")).toBeNull();
    expect(localStorage.getItem("zilonix-onboarding-oculto-empresa-1")).toBe("1");
  });

  it("si ya estaba oculto para esta empresa, arranca oculto y «Ver los primeros pasos» lo vuelve a mostrar", async () => {
    localStorage.setItem("zilonix-onboarding-oculto-empresa-1", "1");
    render(<ChecklistOnboardingCliente empresaId="empresa-1" pasos={PASOS_SIN_EMPEZAR} />);

    expect(await screen.findByRole("button", { name: "Ver los primeros pasos" })).not.toBeNull();
    expect(screen.queryByText("Primeros pasos")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Ver los primeros pasos" }));
    expect(screen.getByText("Primeros pasos")).not.toBeNull();
    expect(localStorage.getItem("zilonix-onboarding-oculto-empresa-1")).toBeNull();
  });

  it("ocultarlo para una empresa no afecta a otra (clave por empresaId)", () => {
    localStorage.setItem("zilonix-onboarding-oculto-empresa-1", "1");
    render(<ChecklistOnboardingCliente empresaId="empresa-2" pasos={PASOS_SIN_EMPEZAR} />);

    expect(screen.getByText("Primeros pasos")).not.toBeNull();
  });
});
