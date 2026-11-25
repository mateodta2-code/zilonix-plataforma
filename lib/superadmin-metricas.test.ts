import { describe, expect, it, vi } from "vitest";
import { calcularMetricas, inicioDeSemana } from "./superadmin-metricas";

vi.hoisted(() => {
  process.env.DATABASE_URL_APP ||= "postgres://x:x@localhost:5432/x";
  process.env.DATABASE_URL_SUPERADMIN ||= "postgres://x:x@localhost:5432/x";
});

const e = (o: Partial<Parameters<typeof calcularMetricas>[0][number]> = {}) => ({
  creadoTs: new Date("2026-11-25T10:00:00Z"),
  plan: "prueba" as const,
  estado: "activa" as const,
  miembros: 1,
  cuentasMl: 0,
  cuentasFalabella: 0,
  ...o,
});
const ahora = new Date("2026-11-25T12:00:00Z"); // miércoles

describe("calcularMetricas", () => {
  it("el inicio de semana es el lunes UTC", () => {
    expect(inicioDeSemana(ahora).toISOString().slice(0, 10)).toBe("2026-11-23");
    expect(inicioDeSemana(new Date("2026-11-29T23:00:00Z")).toISOString().slice(0, 10)).toBe("2026-11-23");
  });
  it("sin empresas devuelve ceros y 8 semanas", () => {
    const m = calcularMetricas([], [], ahora);
    expect(m.empresasPorSemana).toHaveLength(8);
    expect(m.empresasPorSemana[7].inicio).toBe("2026-11-23");
    expect(m.empresasPorSemana[0].inicio).toBe("2026-10-05");
    expect(m.empresasActivas + m.empresasSuspendidas + m.miembros + m.bodegasActivas).toBe(0);
  });
  it("cuenta por semana, descarta lo anterior a 8 semanas", () => {
    const m = calcularMetricas(
      [e(), e({ creadoTs: new Date("2026-11-23T00:00:00Z") }), e({ creadoTs: new Date("2026-11-22T23:59:00Z") }), e({ creadoTs: new Date("2026-10-05T00:00:00Z") }), e({ creadoTs: new Date("2026-10-04T23:00:00Z") })],
      [],
      ahora,
    );
    expect(m.empresasPorSemana[7].empresas).toBe(2);
    expect(m.empresasPorSemana[6].empresas).toBe(1);
    expect(m.empresasPorSemana[0].empresas).toBe(1);
    expect(m.empresasPorSemana.reduce((s, x) => s + x.empresas, 0)).toBe(4);
  });
  it("estados, planes, canales, miembros y bodegas activas", () => {
    const m = calcularMetricas(
      [
        e({ plan: "pro", cuentasMl: 3, miembros: 4 }),
        e({ estado: "suspendida", cuentasFalabella: 1, miembros: 2 }),
        e({ plan: "pro", cuentasMl: 1, cuentasFalabella: 2 }),
      ],
      [{ estado: "activa" }, { estado: "suspendida" }, { estado: "activa" }],
      ahora,
    );
    expect(m.empresasActivas).toBe(2);
    expect(m.empresasSuspendidas).toBe(1);
    expect(m.empresasPorPlan).toEqual({ prueba: 1, basico: 0, pro: 2, empresarial: 0 });
    expect(m.empresasConMl).toBe(2);
    expect(m.empresasConFalabella).toBe(2);
    expect(m.miembros).toBe(7);
    expect(m.bodegasActivas).toBe(2);
  });
});
