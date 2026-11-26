// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { CapturasTicket } from "./CapturasTicket";

const T = "22222222-2222-4222-8222-222222222222";
const A = "33333333-3333-4333-8333-333333333333";

// Pedido del usuario (25-nov): la captura se amplía en la MISMA pestaña.
describe("CapturasTicket", () => {
  afterEach(cleanup);

  it("tocar una captura la amplía en la misma página y se cierra con Esc", () => {
    const { container } = render(<CapturasTicket base="/superadmin/soporte-imagen" ticketId={T} archivos={[A]} />);
    expect(container.querySelector("a[target=_blank]")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Ver foto ampliada: Captura 1/ }));
    const dialogo = screen.getByRole("dialog");
    expect(dialogo.querySelector("img")?.getAttribute("src")).toBe(`/superadmin/soporte-imagen/${T}/${A}`);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("sin capturas no pinta nada", () => {
    const { container } = render(<CapturasTicket base="/api/soporte/imagen" ticketId={T} archivos={[]} />);
    expect(container.innerHTML).toBe("");
  });
});
