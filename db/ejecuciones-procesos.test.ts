import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { db } from "./index";
import { dbSuperadmin } from "./superadmin-context";
import { dbTrabajador } from "./trabajador-context";
import { dbTrabajadorPublicidad } from "./trabajador-publicidad-context";
import { dbTrabajadorSeguimiento } from "./trabajador-seguimiento-context";
import { avisosEnCola, listarEstadoProcesos } from "../lib/superadmin";

// Estado de los procesos (25-nov, migración 0047) — contra Postgres real:
// cada usuario de proceso anota SOLO su propio proceso, nadie lee la
// tabla directo y el superadmin ve el estado por la función.
const registrar = (proceso: string, inicio: Date, ok: boolean, resumen: object, error: string | null) =>
  sql`select registrar_ejecucion_proceso(${proceso}, ${inicio.toISOString()}::timestamptz, ${ok}, ${JSON.stringify(resumen)}::jsonb, ${error})`;

describe("ejecuciones_procesos", () => {
  it("cada proceso anota su corrida y el superadmin ve la última", async () => {
    const inicio = new Date(Date.now() - 1000);
    await dbTrabajador.execute(registrar("avisos_ml", inicio, true, { procesados: 31, fallidos: 2 }, null));
    await dbTrabajadorPublicidad.execute(registrar("publicidad", inicio, false, {}, "Error: algo falló"));

    const estado = await listarEstadoProcesos();
    expect(estado.map((p) => p.proceso).sort()).toEqual(["avisos_ml", "publicidad", "seguimiento"]);

    const avisos = estado.find((p) => p.proceso === "avisos_ml")!;
    expect(avisos.ultimaOk).toBe(true);
    expect(avisos.ultimoResumen).toEqual({ procesados: 31, fallidos: 2 });
    expect(avisos.ultimaTs?.getTime()).toBe(inicio.getTime());
    expect(avisos.corridas24h).toBeGreaterThanOrEqual(1);

    const publicidad = estado.find((p) => p.proceso === "publicidad")!;
    expect(publicidad.ultimaOk).toBe(false);
    expect(publicidad.ultimoError).toBe("Error: algo falló");
    expect(publicidad.fallidas24h).toBeGreaterThanOrEqual(1);
  });

  it("un usuario nunca puede anotar la corrida de otro proceso", async () => {
    await expect(dbTrabajador.execute(registrar("publicidad", new Date(), true, {}, null))).rejects.toThrow();
    await expect(dbTrabajadorPublicidad.execute(registrar("avisos_ml", new Date(), true, {}, null))).rejects.toThrow();
    await expect(dbTrabajadorSeguimiento.execute(registrar("avisos_ml", new Date(), true, {}, null))).rejects.toThrow();
  });

  it("ni la app ni el superadmin pueden anotar, leer ni borrar la tabla directo", async () => {
    await expect(db.execute(registrar("avisos_ml", new Date(), true, {}, null))).rejects.toThrow();
    await expect(dbSuperadmin.execute(registrar("avisos_ml", new Date(), true, {}, null))).rejects.toThrow();
    await expect(db.execute(sql`select count(*) from ejecuciones_procesos`)).rejects.toThrow();
    await expect(dbSuperadmin.execute(sql`select count(*) from ejecuciones_procesos`)).rejects.toThrow();
    await expect(dbTrabajador.execute(sql`select count(*) from ejecuciones_procesos`)).rejects.toThrow();
    await expect(dbTrabajador.execute(sql`delete from ejecuciones_procesos`)).rejects.toThrow();
  });

  it("la app no puede leer el estado ni la cola", async () => {
    await expect(db.execute(sql`select * from superadmin_estado_procesos()`)).rejects.toThrow();
    await expect(db.execute(sql`select * from superadmin_avisos_en_cola()`)).rejects.toThrow();
  });

  it("borra las corridas de más de 14 días", async () => {
    const vieja = new Date(Date.now() - 15 * 24 * 3600_000);
    await dbTrabajadorSeguimiento.execute(registrar("seguimiento", vieja, true, {}, null));
    const seguimiento = (await listarEstadoProcesos()).find((p) => p.proceso === "seguimiento")!;
    // La misma llamada que la anotó la borró: nunca queda como «última».
    expect(seguimiento.ultimaTs === null || seguimiento.ultimaTs.getTime() > Date.now() - 14 * 24 * 3600_000).toBe(true);
  });

  it("la cola de avisos devuelve solo dos números", async () => {
    const cola = await avisosEnCola();
    expect(Object.keys(cola).sort()).toEqual(["atrasados", "pendientes"]);
    expect(cola.pendientes).toBeGreaterThanOrEqual(cola.atrasados);
  });
});
