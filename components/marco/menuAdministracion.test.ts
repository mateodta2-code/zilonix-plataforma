import { describe, expect, it } from "vitest";
import { PLANTILLAS, permisosDeDueno } from "@/lib/roles-plantillas";
import { itemsAdministracion } from "./menuAdministracion";

// Sharel, 13-nov — «Administración» de la barra lateral sale por
// permiso, no por el nombre del rol: el Gerente también lo ve.

const etiquetas = (permisos: { modulo: string; accion: string }[]) => itemsAdministracion(permisos).map((i) => i.etiqueta);

const TODAS = ["Invitar persona", "Ajustar roles", "Acceso de soporte", "Conectar Mercado Libre", "Avisos de Mercado Libre"];

describe("itemsAdministracion", () => {
  it("el Dueño y el Gerente (plantilla nueva) ven las 5 opciones", () => {
    expect(etiquetas(permisosDeDueno())).toEqual(TODAS);
    expect(etiquetas(PLANTILLAS.Gerente)).toEqual(TODAS);
  });

  it("cada opción sale con el permiso que pide su página", () => {
    // Un Gerente de una empresa ya creada, con la plantilla de antes.
    const gerenteViejo = [
      { modulo: "personas", accion: "crear" },
      { modulo: "configuracion", accion: "consultar" },
      { modulo: "configuracion", accion: "modificar" },
    ];
    expect(etiquetas(gerenteViejo)).toEqual(["Invitar persona", "Conectar Mercado Libre", "Avisos de Mercado Libre"]);
    expect(etiquetas([{ modulo: "configuracion", accion: "autorizar" }])).toEqual(["Ajustar roles", "Acceso de soporte"]);
  });

  it("sin ninguno de esos permisos no sale nada (el grupo no se pinta)", () => {
    expect(etiquetas(PLANTILLAS.Operador)).toEqual([]);
    expect(etiquetas(PLANTILLAS.Auxiliar)).toEqual([]);
  });
});
