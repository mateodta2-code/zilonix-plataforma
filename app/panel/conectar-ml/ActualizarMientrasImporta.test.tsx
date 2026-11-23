// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

import { ActualizarMientrasImporta } from "./ActualizarMientrasImporta";
import { estaEnCurso, HORAS_MAX_IMPORTACION_EN_CURSO } from "./importacionEnCurso";

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  refresh.mockReset();
});

describe("ActualizarMientrasImporta", () => {
  it("refresca cada 5s mientras está montado", () => {
    render(<ActualizarMientrasImporta />);
    vi.advanceTimersByTime(10_000);
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it("al desmontar limpia el intervalo", () => {
    const { unmount } = render(<ActualizarMientrasImporta />);
    unmount();
    vi.advanceTimersByTime(60_000);
    expect(refresh).not.toHaveBeenCalled();
  });
});

describe("page.tsx", () => {
  it("ya no renderiza meta refresh", () => {
    const fuente = readFileSync(join(__dirname, "page.tsx"), "utf8");
    expect(fuente).not.toMatch(/httpEquiv/);
  });
});

describe("estaEnCurso", () => {
  const ahora = new Date("2026-01-01T12:00:00Z");
  const hace = (h: number) => new Date(ahora.getTime() - h * 3_600_000);
  it("reciente sin terminar: en curso", () => {
    expect(estaEnCurso({ completadoTs: null, iniciadoTs: hace(1) }, ahora)).toBe(true);
  });
  it("vieja sin terminar: no cuenta", () => {
    expect(estaEnCurso({ completadoTs: null, iniciadoTs: hace(HORAS_MAX_IMPORTACION_EN_CURSO + 1) }, ahora)).toBe(false);
  });
  it("terminada o inexistente: no", () => {
    expect(estaEnCurso({ completadoTs: ahora, iniciadoTs: hace(1) }, ahora)).toBe(false);
    expect(estaEnCurso(null, ahora)).toBe(false);
  });
});
