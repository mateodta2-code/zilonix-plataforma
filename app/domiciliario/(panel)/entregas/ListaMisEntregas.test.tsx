// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

// Los botones de estado y novedad usan acciones del servidor: acá no importan.
vi.mock("./BotonesEntrega", () => ({ BotonesEntrega: () => null }));
vi.mock("./ReportarNovedad", () => ({ ReportarNovedad: () => null }));

import { ListaMisEntregas } from "./ListaMisEntregas";

const base = {
  pedidoReferencia: "P-1",
  marketplace: "mercadolibre",
  motivo: null,
  asignadaTs: new Date("2026-11-25T10:00:00Z"),
  actualizadaTs: new Date(),
  receptorNombre: "Ana",
  direccion: "Calle 1 # 2-3",
  barrio: "Centro",
  ciudad: "Medellín",
  telefono: "3001234567",
  nota: null,
};

describe("ListaMisEntregas — botones de mapa", () => {
  afterEach(cleanup);

  it("una entrega abierta trae Google Maps y Waze con su dirección", () => {
    render(<ListaMisEntregas entregas={[{ ...base, id: "e1", estado: "asignada" }] as never} ahora={Date.now()} />);
    const maps = screen.getByRole("link", { name: "Google Maps" }).getAttribute("href")!;
    const waze = screen.getByRole("link", { name: "Waze" }).getAttribute("href")!;
    expect(new URL(maps).searchParams.get("destination")).toBe("Calle 1 # 2-3, Centro, Medellín");
    expect(new URL(waze).searchParams.get("q")).toBe("Calle 1 # 2-3, Centro, Medellín");
  });

  it("una entrega cerrada no trae mapa (la base ya no devuelve la dirección)", () => {
    const cerrada = { ...base, id: "e2", estado: "entregada", receptorNombre: null, direccion: null, barrio: null, ciudad: null, telefono: null };
    render(<ListaMisEntregas entregas={[cerrada] as never} ahora={Date.now()} />);
    expect(screen.queryByRole("link", { name: "Google Maps" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Waze" })).toBeNull();
  });
});
