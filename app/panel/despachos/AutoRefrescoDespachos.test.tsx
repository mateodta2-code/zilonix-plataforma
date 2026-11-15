// @vitest-environment jsdom
//
// Issue "despachos no aparecen solos" (Refs #49) — mismo patrón que
// SincronizarAhoraCliente.test.tsx (useRouter mockeado). Acá lo propio
// es el intervalo: refresca cada 60s, pero NUNCA mientras la pestaña
// está oculta (document.hidden) — nunca llama a Mercado Libre, solo
// router.refresh() (relee la base vía el Server Component).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

import { AutoRefrescoDespachos } from "./AutoRefrescoDespachos";

function mockVisibilidad(oculta: boolean) {
  Object.defineProperty(document, "hidden", { configurable: true, get: () => oculta });
}

beforeEach(() => {
  vi.useFakeTimers();
  mockVisibilidad(false);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  refresh.mockReset();
});

describe("AutoRefrescoDespachos", () => {
  it("refresca la página cada 60s mientras la pestaña está visible", () => {
    render(<AutoRefrescoDespachos />);
    expect(refresh).not.toHaveBeenCalled();

    vi.advanceTimersByTime(60_000);
    expect(refresh).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(60_000);
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it("con la pestaña oculta (document.hidden), no refresca — nunca gasta ciclos en segundo plano", () => {
    mockVisibilidad(true);
    render(<AutoRefrescoDespachos />);

    vi.advanceTimersByTime(180_000);
    expect(refresh).not.toHaveBeenCalled();
  });

  it("al desmontar, deja de refrescar", () => {
    const { unmount } = render(<AutoRefrescoDespachos />);
    unmount();

    vi.advanceTimersByTime(180_000);
    expect(refresh).not.toHaveBeenCalled();
  });
});
