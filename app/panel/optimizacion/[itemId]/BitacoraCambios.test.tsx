// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("../actions", () => ({ guardarNotaBitacoraAction: vi.fn(), revisarCambioAction: vi.fn() }));

import type { CambioBitacora, RevisionCambio } from "@/lib/optimizacion/bitacora";
import type { ResultadoCambio } from "@/lib/optimizacion/bitacoraResultado";
import type { ResumenPeriodo } from "@/lib/optimizacion/calculos";
import { BitacoraCambios } from "./BitacoraCambios";

afterEach(cleanup);

const REF = "auditoria:11111111-2222-3333-4444-555555555555";
const semana = { pedidos: 1, visitas: 10, conversion: "10", ganancia: null } as unknown as ResumenPeriodo;
const listo: ResultadoCambio = { estado: "listo", antes: semana, despues: semana, desde: "2026-11-05", hasta: "2026-11-18" };

const cambio = (revision: RevisionCambio | null): CambioBitacora => ({
  id: "11111111-2222-3333-4444-555555555555",
  ref: REF,
  origen: "zilonix",
  accion: "cambiar_precio_publicacion",
  rotulo: "Precio",
  ts: new Date("2026-11-12T15:00:00Z"),
  dia: "2026-11-12",
  usuario: "Mateo",
  valorAnterior: "100",
  valorNuevo: "90",
  detalle: null,
  revision,
});

const pintar = (revision: RevisionCambio | null) =>
  render(
    <BitacoraCambios
      cambios={[cambio(revision)]}
      resultados={new Map([[REF, listo]])}
      plata={(v) => v ?? "—"}
      num={(v) => (v === null ? "—" : String(v))}
      pct={(v) => v ?? "—"}
      idioma="es-CO"
      conFinanzas={false}
      cuentaMlId="cuenta"
      itemId="MCO1342632705"
      hoy="2026-11-21"
      puedeEditar
    />
  );

describe("BitacoraCambios: comentario sin resultado (0036)", () => {
  it("muestra el comentario, no lo pinta como «Sin cambio» y el cambio sigue «Sin revisar»", () => {
    pintar({ resultado: null, comentario: "bajé el precio por la competencia", usuario: "Pablo", ts: new Date("2026-11-20T15:00:00Z") });
    expect(screen.getByText(/Comentario de Pablo/)).toBeTruthy();
    expect(screen.getByText(/bajé el precio por la competencia/)).toBeTruthy();
    expect(screen.queryByText("Sin cambio")).toBeNull();
    expect(screen.getByText("Sin revisar")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Revisar" })).toBeTruthy();
  });

  it("con resultado muestra su etiqueta y ya no dice «Sin revisar»", () => {
    pintar({ resultado: "sin_cambio", comentario: null, usuario: "Pablo", ts: new Date("2026-11-20T15:00:00Z") });
    expect(screen.getByText("Sin cambio")).toBeTruthy();
    expect(screen.queryByText("Sin revisar")).toBeNull();
    expect(screen.getByRole("button", { name: "Cambiar revisión" })).toBeTruthy();
  });
});
