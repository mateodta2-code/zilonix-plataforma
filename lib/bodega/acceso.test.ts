import { describe, expect, it } from "vitest";
import { decidirAcceso, type MembresiaBodega } from "./acceso";
import { PERMISOS_BODEGA, ROLES_BODEGA, estadoInvitacion } from "./roles";

const base: MembresiaBodega = { bodegaId: "b1", bodegaNombre: "Bodega Uno", bodegaNit: null, bodegaEstado: "activa", rol: "operario", activo: true };
const con = (p: Partial<MembresiaBodega>): MembresiaBodega => ({ ...base, ...p });

describe("decidirAcceso — acceso negado sin la membresía correcta", () => {
  it("sin ninguna membresía no entra a ningún panel", () => {
    expect(decidirAcceso({ panel: "bodega", membresias: [] })).toEqual({ ok: false, motivo: "sin-membresia" });
    expect(decidirAcceso({ panel: "domiciliario", membresias: [] })).toEqual({ ok: false, motivo: "sin-membresia" });
  });

  it("operario y admin entran a /bodega; un domiciliario no", () => {
    expect(decidirAcceso({ panel: "bodega", membresias: [con({ rol: "operario" })] }).ok).toBe(true);
    expect(decidirAcceso({ panel: "bodega", membresias: [con({ rol: "admin_bodega" })] }).ok).toBe(true);
    expect(decidirAcceso({ panel: "bodega", membresias: [con({ rol: "domiciliario" })] })).toMatchObject({ ok: false, motivo: "rol-incorrecto" });
  });

  it("solo el domiciliario entra a /domiciliario", () => {
    expect(decidirAcceso({ panel: "domiciliario", membresias: [con({ rol: "domiciliario" })] }).ok).toBe(true);
    expect(decidirAcceso({ panel: "domiciliario", membresias: [con({ rol: "admin_bodega" })] })).toMatchObject({ ok: false, motivo: "rol-incorrecto" });
    expect(decidirAcceso({ panel: "domiciliario", membresias: [con({ rol: "operario" })] })).toMatchObject({ ok: false, motivo: "rol-incorrecto" });
  });

  it("las pantallas de administración exigen admin_bodega", () => {
    expect(decidirAcceso({ panel: "bodega", soloAdmin: true, membresias: [con({ rol: "operario" })] })).toMatchObject({ ok: false, motivo: "rol-incorrecto" });
    expect(decidirAcceso({ panel: "bodega", soloAdmin: true, membresias: [con({ rol: "admin_bodega" })] }).ok).toBe(true);
  });

  it("una persona desactivada no entra", () => {
    expect(decidirAcceso({ panel: "bodega", membresias: [con({ activo: false })] })).toMatchObject({ ok: false, motivo: "desactivado" });
  });

  it("una bodega suspendida muestra el aviso de suspensión, no el panel", () => {
    expect(decidirAcceso({ panel: "bodega", membresias: [con({ bodegaEstado: "suspendida" })] })).toMatchObject({ ok: false, motivo: "suspendida" });
  });

  it("con dos bodegas, prefiere la de la cookie si sirve y si no, la primera que sirva", () => {
    const a = con({ bodegaId: "a", activo: false });
    const b = con({ bodegaId: "b" });
    const c = con({ bodegaId: "c" });
    expect(decidirAcceso({ panel: "bodega", membresias: [a, b, c], bodegaPreferidaId: "c" })).toMatchObject({ ok: true, membresia: { bodegaId: "c" } });
    expect(decidirAcceso({ panel: "bodega", membresias: [a, b, c], bodegaPreferidaId: "a" })).toMatchObject({ ok: true, membresia: { bodegaId: "b" } });
  });
});

describe("estadoInvitacion — válida, vencida o usada", () => {
  const ahora = new Date("2026-11-15T12:00:00Z");
  const dia = 24 * 60 * 60 * 1000;
  it("válida: no vencida y sin aceptar", () => {
    expect(estadoInvitacion({ expiraTs: new Date(ahora.getTime() + dia), aceptadaTs: null }, ahora)).toBe("valida");
  });
  it("vencida: pasó la fecha y nadie la aceptó", () => {
    expect(estadoInvitacion({ expiraTs: new Date(ahora.getTime() - 1), aceptadaTs: null }, ahora)).toBe("vencida");
  });
  it("usada: ya fue aceptada (gana sobre vencida)", () => {
    expect(estadoInvitacion({ expiraTs: new Date(ahora.getTime() + dia), aceptadaTs: ahora }, ahora)).toBe("usada");
    expect(estadoInvitacion({ expiraTs: new Date(ahora.getTime() - dia), aceptadaTs: ahora }, ahora)).toBe("usada");
  });
});

describe("matriz de permisos", () => {
  it("solo roles conocidos, y invitar/personas/configuración son solo del admin_bodega", () => {
    for (const p of PERMISOS_BODEGA) for (const r of p.roles) expect(ROLES_BODEGA).toContain(r);
    for (const p of PERMISOS_BODEGA.filter((x) => /invitar|desactivar|rol|NIT/i.test(x.capacidad))) expect(p.roles).toEqual(["admin_bodega"]);
  });
});

describe("decidirAcceso — «en espera» del domiciliario con perfil", () => {
  it("con perfil y sin membresías: en-espera (sin perfil sigue sin-membresia)", () => {
    expect(decidirAcceso({ panel: "domiciliario", membresias: [], tienePerfilDomiciliario: true })).toEqual({ ok: false, motivo: "en-espera" });
    expect(decidirAcceso({ panel: "domiciliario", membresias: [], tienePerfilDomiciliario: false })).toEqual({ ok: false, motivo: "sin-membresia" });
  });

  it("un admin o operario de bodega con perfil queda en-espera en /domiciliario, y sigue entrando a /bodega", () => {
    for (const rol of ["admin_bodega", "operario"] as const) {
      expect(decidirAcceso({ panel: "domiciliario", membresias: [con({ rol })], tienePerfilDomiciliario: true })).toEqual({ ok: false, motivo: "en-espera" });
      expect(decidirAcceso({ panel: "bodega", membresias: [con({ rol })], tienePerfilDomiciliario: true }).ok).toBe(true);
    }
  });

  it("con membresía activa de domiciliario entra normal aunque tenga perfil", () => {
    expect(decidirAcceso({ panel: "domiciliario", membresias: [con({ rol: "domiciliario" })], tienePerfilDomiciliario: true }).ok).toBe(true);
  });

  it("el perfil no esconde una bodega suspendida ni un acceso desactivado", () => {
    expect(decidirAcceso({ panel: "domiciliario", membresias: [con({ rol: "domiciliario", bodegaEstado: "suspendida" })], tienePerfilDomiciliario: true })).toMatchObject({ ok: false, motivo: "suspendida" });
    expect(decidirAcceso({ panel: "domiciliario", membresias: [con({ rol: "domiciliario", activo: false })], tienePerfilDomiciliario: true })).toMatchObject({ ok: false, motivo: "desactivado" });
  });

  it("en el panel de bodega el perfil no cambia nada", () => {
    expect(decidirAcceso({ panel: "bodega", membresias: [], tienePerfilDomiciliario: true })).toEqual({ ok: false, motivo: "sin-membresia" });
  });
});
