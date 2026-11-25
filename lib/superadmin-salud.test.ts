import { describe, expect, it } from "vitest";
import { ordenarPorProblemas, problemasDe, resumirSalud, type SaludEmpresa } from "@/lib/superadmin-salud";

const base: SaludEmpresa = {
  empresaId: "e",
  nombre: "E",
  estado: "activa",
  mlConectadas: 1,
  mlDesconectadas: 0,
  mlSinRenovar: 0,
  avisosAtrasados: 0,
  publicidadConError: 0,
  falabellaDesconectadas: 0,
};

describe("salud de conexiones (superadmin, solo conteos)", () => {
  it("una empresa sana no tiene problemas", () => {
    expect(problemasDe(base)).toBe(0);
  });

  it("suma cada señal; sin ninguna cuenta ML conectada (habiendo tenido) suma uno más", () => {
    expect(problemasDe({ ...base, mlSinRenovar: 1, avisosAtrasados: 3, publicidadConError: 1 })).toBe(5);
    expect(problemasDe({ ...base, mlConectadas: 0, mlDesconectadas: 2 })).toBe(3);
    // Nunca conectó ninguna: no es un problema de conexión.
    expect(problemasDe({ ...base, mlConectadas: 0 })).toBe(0);
  });

  it("una empresa suspendida no cuenta como problema (sus procesos están parados a propósito)", () => {
    const suspendida = { ...base, estado: "suspendida", mlSinRenovar: 2, avisosAtrasados: 9 };
    expect(problemasDe(suspendida)).toBe(0);
    expect(resumirSalud([suspendida])).toEqual({
      empresasConProblemas: 0,
      mlDesconectadas: 0,
      mlSinRenovar: 0,
      avisosAtrasados: 0,
      publicidadConError: 0,
      falabellaDesconectadas: 0,
    });
  });

  it("totales de la plataforma y orden: primero las que tienen más problemas", () => {
    const filas = [
      { ...base, empresaId: "a", nombre: "Alfa" },
      { ...base, empresaId: "b", nombre: "Beta", avisosAtrasados: 4 },
      { ...base, empresaId: "c", nombre: "Casa", mlSinRenovar: 1, falabellaDesconectadas: 1 },
    ];
    expect(resumirSalud(filas)).toMatchObject({ empresasConProblemas: 2, avisosAtrasados: 4, mlSinRenovar: 1, falabellaDesconectadas: 1 });
    expect(ordenarPorProblemas(filas).map((f) => f.nombre)).toEqual(["Beta", "Casa", "Alfa"]);
  });
});
