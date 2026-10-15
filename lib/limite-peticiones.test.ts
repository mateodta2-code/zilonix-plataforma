import { describe, expect, it } from "vitest";
import { creaContador, limpiarVencidos, superaLimite } from "./limite-peticiones";

describe("límite de peticiones (tarea 1.10)", () => {
  it("deja pasar hasta el límite, y bloquea una más dentro de la misma ventana", () => {
    const contador = creaContador();
    const t0 = 1_000_000;
    for (let i = 0; i < 5; i++) {
      expect(superaLimite(contador, "ip-1", 5, 60_000, t0 + i)).toBe(false);
    }
    expect(superaLimite(contador, "ip-1", 5, 60_000, t0 + 6)).toBe(true);
  });

  it("dos claves distintas (dos IPs, o un usuario y su IP) no se mezclan", () => {
    const contador = creaContador();
    const t0 = 2_000_000;
    for (let i = 0; i < 5; i++) superaLimite(contador, "ip-A", 5, 60_000, t0 + i);
    // ip-B empieza su propia cuenta en cero, aunque ip-A ya esté en el tope.
    expect(superaLimite(contador, "ip-B", 5, 60_000, t0)).toBe(false);
  });

  it("al pasar la ventana, la cuenta arranca de nuevo", () => {
    const contador = creaContador();
    const t0 = 3_000_000;
    for (let i = 0; i < 5; i++) superaLimite(contador, "ip-1", 5, 1_000, t0 + i);
    // Todavía dentro de la ventana (exactamente en el borde): la cuenta
    // ya llegó a 5, una más la pasa.
    expect(superaLimite(contador, "ip-1", 5, 1_000, t0 + 1_000)).toBe(true);
    // Ya pasado el borde, arranca una ventana nueva desde cero.
    expect(superaLimite(contador, "ip-1", 5, 1_000, t0 + 1_001)).toBe(false);
  });

  it("limpiarVencidos borra solo las entradas fuera de la ventana", () => {
    const contador = creaContador();
    superaLimite(contador, "vieja", 100, 1_000, 0);
    superaLimite(contador, "nueva", 100, 1_000, 5_000);
    limpiarVencidos(contador, 1_000, 5_500);
    expect(contador.has("vieja")).toBe(false);
    expect(contador.has("nueva")).toBe(true);
  });
});
