// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { BarraImportacion } from "./BarraImportacion";

afterEach(cleanup);

describe("BarraImportacion", () => {
  it("con total: progressbar y «X de Y pedidos (P %)»", () => {
    render(<BarraImportacion dias={365} pedidosImportados={50} pedidosEncontrados={200} />);
    expect(screen.getByText("Importando pedidos y publicaciones de los últimos 365 días…")).toBeTruthy();
    expect(screen.getByRole("progressbar").getAttribute("aria-valuenow")).toBe("25");
    expect(screen.getByText(/50 de 200 pedidos \(25 %\)/)).toBeTruthy();
  });

  it("sin total: indeterminada, sin progressbar", () => {
    render(<BarraImportacion dias={365} pedidosImportados={0} pedidosEncontrados={null} />);
    expect(screen.queryByRole("progressbar")).toBeNull();
    expect(screen.getByRole("status")).toBeTruthy();
  });
});
