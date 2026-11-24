// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ConfirmacionDoble } from "./ConfirmacionDoble";

afterEach(cleanup);

function montar() {
  const accion = vi.fn();
  render(
    <ConfirmacionDoble textoDisparador="Eliminar" titulo="¿Eliminar la IA ChatGPT?" descripcion="Explicación" nombreEsperado="ChatGPT" textoConfirmar="Eliminar definitivamente" onConfirmar={accion} />
  );
  return accion;
}

describe("ConfirmacionDoble", () => {
  it("un clic solo abre el diálogo accesible, sin llamar la acción", () => {
    const accion = montar();
    fireEvent.click(screen.getByText("Eliminar"));
    const d = screen.getByRole("dialog");
    expect(d.getAttribute("aria-modal")).toBe("true");
    expect(d.getAttribute("aria-labelledby")).toBeTruthy();
    fireEvent.click(screen.getByText("Continuar"));
    expect(accion).not.toHaveBeenCalled();
  });
  it("nombre incorrecto deja el botón deshabilitado", () => {
    montar();
    fireEvent.click(screen.getByText("Eliminar"));
    fireEvent.click(screen.getByText("Continuar"));
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "chatgpt" } });
    expect((screen.getByText("Eliminar definitivamente") as HTMLButtonElement).disabled).toBe(true);
  });
  it("llama la acción solo con el nombre exacto", () => {
    const accion = montar();
    fireEvent.click(screen.getByText("Eliminar"));
    fireEvent.click(screen.getByText("Continuar"));
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "ChatGPT" } });
    fireEvent.click(screen.getByText("Eliminar definitivamente"));
    expect(accion).toHaveBeenCalledTimes(1);
  });
  it("Esc y Cancelar cierran sin llamar la acción", () => {
    const accion = montar();
    fireEvent.click(screen.getByText("Eliminar"));
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(screen.getByText("Eliminar"));
    fireEvent.click(screen.getByText("Continuar"));
    fireEvent.click(screen.getByText("Cancelar"));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(accion).not.toHaveBeenCalled();
  });
});
