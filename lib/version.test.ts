import { describe, expect, it } from "vitest";
import { VERSION } from "./version";

describe("version", () => {
  it("sigue el formato semver (x.y.z)", () => {
    expect(VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });
});
