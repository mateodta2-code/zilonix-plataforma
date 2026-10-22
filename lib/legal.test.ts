import { readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";
import {
  PRIVACIDAD_VERSION,
  QUE_VE_ZILONIX_VERSION,
  TERMINOS_VERSION,
  consentimientoMarcado,
  detalleDeAceptacion,
  versionesAceptadasCompletas,
} from "./legal";

const raiz = process.cwd();

function leer(rel: string): string {
  return readFileSync(join(raiz, rel), "utf8");
}

describe("Z-MT-15 — versiones y casilla", () => {
  it("las tres versiones siguen marcadas como borrador", () => {
    for (const version of [TERMINOS_VERSION, PRIVACIDAD_VERSION, QUE_VE_ZILONIX_VERSION]) {
      expect(version).toMatch(/borrador/);
      expect(version.trim().length).toBeGreaterThan(0);
    }
  });

  it("solo cuenta la casilla marcada con el valor explícito «si»", () => {
    expect(consentimientoMarcado("si")).toBe(true);
    expect(consentimientoMarcado(null)).toBe(false);
    expect(consentimientoMarcado("")).toBe(false);
    expect(consentimientoMarcado("on")).toBe(false);
    expect(consentimientoMarcado("SI")).toBe(false);
    expect(consentimientoMarcado("no")).toBe(false);
  });

  it("el detalle de auditoría nombra las tres versiones y no inventa la fecha", () => {
    const detalle = detalleDeAceptacion({
      terminosVersion: TERMINOS_VERSION,
      privacidadVersion: PRIVACIDAD_VERSION,
      queVeVersion: QUE_VE_ZILONIX_VERSION,
    });
    expect(detalle).toContain(TERMINOS_VERSION);
    expect(detalle).toContain(PRIVACIDAD_VERSION);
    expect(detalle).toContain(QUE_VE_ZILONIX_VERSION);
    expect(detalle).not.toMatch(/\d{4}-\d{2}-\d{2}T/);
  });

  it("rechaza versiones en blanco", () => {
    expect(
      versionesAceptadasCompletas({
        terminosVersion: TERMINOS_VERSION,
        privacidadVersion: PRIVACIDAD_VERSION,
        queVeVersion: QUE_VE_ZILONIX_VERSION,
      })
    ).toBe(true);
    expect(
      versionesAceptadasCompletas({ terminosVersion: " ", privacidadVersion: "x", queVeVersion: "x" })
    ).toBe(false);
  });
});

describe("Z-MT-15 — los textos cubren lo que pide el issue", () => {
  const marco = leer("app/(legal)/marco.tsx");
  const terminos = leer("app/(legal)/terminos/page.tsx");
  const privacidad = leer("app/(legal)/privacidad/page.tsx");
  const queVe = leer("app/(legal)/que-ve-zilonix/page.tsx");
  const formulario = leer("app/crear-empresa/page.tsx");
  const accion = leer("app/crear-empresa/actions.ts");
  const empresas = leer("lib/empresas.ts");

  it("el aviso de borrador está arriba, en el marco que usan las tres páginas", () => {
    expect(marco).toContain("Borrador pendiente de revisión legal");
    expect(marco.indexOf("Borrador pendiente de revisión legal")).toBeLessThan(marco.indexOf("{titulo}"));
    for (const pagina of [terminos, privacidad, queVe]) {
      expect(pagina).toContain("<MarcoLegal");
    }
  });

  it("cada página muestra su constante de versión", () => {
    expect(terminos).toContain("TERMINOS_VERSION");
    expect(privacidad).toContain("PRIVACIDAD_VERSION");
    expect(queVe).toContain("QUE_VE_ZILONIX_VERSION");
  });

  it("los términos traen el periodo gratis, el aviso de 30 días, la DIAN y los límites", () => {
    expect(terminos).toContain("31-ene-2027");
    expect(terminos).toContain("30 días");
    expect(terminos).toContain("DIAN");
    expect(terminos).toMatch(/[Ll]ímites de responsabilidad/);
  });

  it("la política trae la ley, los plazos, el encargo y Railway y Clerk", () => {
    expect(privacidad).toContain("Ley 1581 de 2012");
    expect(privacidad).toContain("Decreto 1074 de 2015");
    expect(privacidad).toContain("10 días hábiles");
    expect(privacidad).toContain("15 días hábiles");
    expect(privacidad).toContain("consulta");
    expect(privacidad).toContain("actualización");
    expect(privacidad).toContain("rectificación");
    expect(privacidad).toContain("supresión");
    expect(privacidad).toContain("encargado");
    expect(privacidad).toContain("Railway");
    expect(privacidad).toContain("Clerk");
    expect(privacidad).toContain("Completar que=");
    expect(marco).toContain("[COMPLETAR:");
  });

  it("qué ve Zilonix dice la frase del issue y explica el acceso de 15 días", () => {
    expect(queVe).toContain("El personal de Zilonix no ve tus ventas ni tus clientes sin tu permiso");
    expect(queVe).toContain("15 días");
    expect(queVe).toContain("360");
  });

  it("la casilla no viene marcada y la acción la exige antes de crear", () => {
    expect(formulario).toContain('name="aceptaTerminos"');
    expect(formulario).toContain('value="si"');
    expect(formulario).not.toMatch(/defaultChecked|\bchecked\b/);
    const llamada = accion.indexOf("crearEmpresaConDueno(");
    expect(llamada).toBeGreaterThan(-1);
    expect(accion.indexOf("consentimientoMarcado")).toBeLessThan(llamada);
    expect(empresas).toContain("detalleDeAceptacion");
    expect(empresas).toContain("aceptar_terminos_y_datos");
  });
});
