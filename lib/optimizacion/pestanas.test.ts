import { describe, expect, it } from "vitest";
import { sufijoPestanas } from "./pestanas";

describe("sufijoPestanas", () => {
  it("mantiene cuenta y período", () => {
    expect(sufijoPestanas("c1", { dias: "30" })).toBe("?cuenta=c1&dias=30");
    expect(sufijoPestanas("c1", { desde: "2026-11-01", hasta: "2026-11-15" })).toBe("?cuenta=c1&desde=2026-11-01&hasta=2026-11-15");
    expect(sufijoPestanas("c1", { periodo: "hoy" })).toBe("?cuenta=c1&periodo=hoy");
  });
  it("sin cuenta ni período, vacío; descarta claves ajenas", () => {
    expect(sufijoPestanas(null, {})).toBe("");
    expect(sufijoPestanas("c1", { q: "x" })).toBe("?cuenta=c1");
  });
});
