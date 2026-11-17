// @vitest-environment jsdom
import { readFileSync } from "fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

import { INTERVALO_REFRESCO_MS, RefrescarImportacion } from "./RefrescarImportacion";

beforeEach(() => {
  vi.useFakeTimers();
  refresh.mockClear();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("RefrescarImportacion", () => {
  it("refresca cada 5 s mientras está montado", () => {
    render(<RefrescarImportacion />);
    vi.advanceTimersByTime(INTERVALO_REFRESCO_MS * 3);
    expect(refresh).toHaveBeenCalledTimes(3);
  });

  it("al desmontar limpia el intervalo: no vuelve a refrescar", () => {
    const { unmount } = render(<RefrescarImportacion />);
    vi.advanceTimersByTime(INTERVALO_REFRESCO_MS);
    expect(refresh).toHaveBeenCalledTimes(1);
    unmount();
    vi.advanceTimersByTime(INTERVALO_REFRESCO_MS * 5);
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("la página de conectar-ml ya no usa meta refresh", () => {
    const fuente = readFileSync("app/panel/conectar-ml/page.tsx", "utf8");
    expect(fuente).not.toMatch(/httpEquiv|http-equiv/i);
    expect(fuente).toContain("<RefrescarImportacion />");
  });
});
