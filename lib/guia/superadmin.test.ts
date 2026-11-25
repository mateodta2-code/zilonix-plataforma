import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { gruposSuperadmin } from "@/components/marco/menuSuperadmin";
import { SECCIONES_GUIA_SUPERADMIN as secciones, seccionSuperadminDeRuta } from "@/lib/guia/superadmin";

describe("guía del superadmin", () => {
  it("cada sección tiene un id único", () => {
    const ids = secciones.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^[a-z][a-z0-9-]*$/);
  });

  it("cada ruta de una guía es una pantalla que existe (dentro de app/superadmin/(panel))", () => {
    for (const s of secciones) {
      for (const ruta of [s.ruta, ...(s.otrasRutas ?? [])]) {
        const resto = ruta.split("/").filter(Boolean).slice(1);
        const carpeta = join(process.cwd(), "app", "superadmin", "(panel)", ...resto);
        expect(existsSync(join(carpeta, "page.tsx")), `${s.id}: ${ruta} no existe`).toBe(true);
      }
    }
  });

  it("cada pantalla del menú del superadmin tiene su guía", () => {
    for (const item of gruposSuperadmin().flatMap((g) => g.items)) {
      expect(seccionSuperadminDeRuta(item.href), `${item.etiqueta} (${item.href}) no tiene guía`).not.toBeNull();
    }
  });

  it("cada pantalla encuentra la guía de su módulo", () => {
    expect(seccionSuperadminDeRuta("/superadmin")?.id).toBe("inicio");
    expect(seccionSuperadminDeRuta("/superadmin/")?.id).toBe("inicio");
    expect(seccionSuperadminDeRuta("/superadmin/0b6f7c2e-1a2b-4c3d-8e9f-0123456789ab")?.id).toBe("empresas");
    expect(seccionSuperadminDeRuta("/superadmin/bodegas/0b6f7c2e-1a2b-4c3d-8e9f-0123456789ab")?.id).toBe("bodegas");
    expect(seccionSuperadminDeRuta("/superadmin/soporte/abc")?.id).toBe("soporte");
    expect(seccionSuperadminDeRuta("/superadmin/conexiones")?.id).toBe("conexiones");
    expect(seccionSuperadminDeRuta("/superadmin/iniciar-sesion")).toBeNull();
    expect(seccionSuperadminDeRuta("/superadmin/foros")).toBeNull(); // no confunde prefijos sin "/"
  });

  it("ninguna sección queda vacía", () => {
    for (const s of secciones) {
      expect(s.paraQue.length, s.id).toBeGreaterThan(10);
      expect(s.pasos.length, s.id).toBeGreaterThan(0);
      for (const a of s.apartados ?? []) expect(a.pasos.length, `${s.id}: ${a.titulo}`).toBeGreaterThan(0);
    }
  });
});
