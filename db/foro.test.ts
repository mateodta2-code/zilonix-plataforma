import { randomUUID } from "crypto";
import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { cambiarVisibilidad, crearPregunta, crearRespuesta, ForoError, listarParaModerar, listarPreguntas, obtenerPregunta } from "../lib/foro";
import { NoEsSuperadminError } from "../lib/superadmin";
import { crearEmpresaConPermisos } from "../lib/test-utils/empresa-con-permiso";
import { dbSuperadmin } from "./superadmin-context";
import { db } from "./index";
import { foroPreguntas, foroRespuestas, usuarios } from "./schema";

// Foro de la comunidad (14-nov) — prueba real contra Postgres: dos
// vendedores de empresas DISTINTAS se ven y se responden (el foro es
// compartido por diseño), nadie edita ni borra desde la app, lo
// escondido desaparece para todos y solo el superadmin modera.
describe("foro de la comunidad", () => {
  let vendedorA: string;
  let vendedorB: string;
  const sinEmpresaId = randomUUID();
  const superadminId = randomUUID();
  const marca = randomUUID().slice(0, 8);

  beforeAll(async () => {
    vendedorA = (await crearEmpresaConPermisos(`Foro A ${marca}`, [])).usuarioId;
    vendedorB = (await crearEmpresaConPermisos(`Foro B ${marca}`, [])).usuarioId;
    await db.insert(usuarios).values([
      { id: sinEmpresaId, email: `foro-sin-${sinEmpresaId.slice(0, 8)}@zilonix.test`, nombre: "Sin Empresa" },
      { id: superadminId, email: `foro-sa-${superadminId.slice(0, 8)}@zilonix.test`, nombre: "Súper Foro", esSuperadmin: true },
    ]);
  });

  it("un vendedor pregunta, otro de OTRA empresa responde, y los dos lo ven con el nombre de la persona", async () => {
    const preguntaId = await crearPregunta(vendedorA, `Duda Flex ${marca}`, "¿Cómo manejan las devoluciones de Flex?");
    await crearRespuesta(vendedorB, preguntaId, "Yo las recibo en bodega y las reviso el mismo día.");

    const detalle = await obtenerPregunta(preguntaId);
    expect(detalle?.autorNombre).toBe(`Usuario Foro A ${marca}`);
    expect(detalle?.respuestas.map((r) => [r.autorNombre, r.cuerpo])).toEqual([[`Usuario Foro B ${marca}`, "Yo las recibo en bodega y las reviso el mismo día."]]);

    const lista = await listarPreguntas({ busqueda: `Duda Flex ${marca}` });
    expect(lista).toHaveLength(1);
    expect(lista[0].respuestas).toBe(1);
  });

  it("la búsqueda trata % y _ literal, nunca como comodín", async () => {
    await crearPregunta(vendedorA, `Promo ${marca} 50% off`, "¿Les funciona el descuento de 50% en promociones?");
    expect(await listarPreguntas({ busqueda: `${marca} 50%` })).toHaveLength(1);
    expect(await listarPreguntas({ busqueda: `${marca}%off` })).toHaveLength(0);
  });

  it("quien no tiene ninguna empresa no puede publicar", async () => {
    await expect(crearPregunta(sinEmpresaId, "Pregunta sin empresa", "No debería poder publicar esto.")).rejects.toBeInstanceOf(ForoError);
  });

  it("no se puede responder una pregunta que no existe", async () => {
    await expect(crearRespuesta(vendedorB, randomUUID(), "Respuesta huérfana")).rejects.toBeInstanceOf(ForoError);
    await expect(crearRespuesta(vendedorB, "no-es-un-uuid", "Respuesta huérfana")).rejects.toBeInstanceOf(ForoError);
  });

  it("la app (app_user) no puede editar ni borrar nada del foro, ni lo propio", async () => {
    const preguntaId = await crearPregunta(vendedorA, `Editable ${marca}`, "Intento editar esto desde la app.");
    await expect(db.update(foroPreguntas).set({ cuerpo: "cambiado" }).where(eq(foroPreguntas.id, preguntaId))).rejects.toThrow();
    await expect(db.update(foroPreguntas).set({ ocultaTs: new Date() }).where(eq(foroPreguntas.id, preguntaId))).rejects.toThrow();
    await expect(db.delete(foroPreguntas).where(eq(foroPreguntas.id, preguntaId))).rejects.toThrow();
    await expect(db.delete(foroRespuestas).where(eq(foroRespuestas.preguntaId, preguntaId))).rejects.toThrow();
  });

  it("solo el superadmin esconde; lo escondido desaparece para todos y se puede volver a mostrar", async () => {
    const preguntaId = await crearPregunta(vendedorA, `Spam ${marca}`, "Compra seguidores baratos aquí.");
    await crearRespuesta(vendedorB, preguntaId, "Esto es spam.");

    await expect(cambiarVisibilidad(vendedorB, "pregunta", preguntaId, true)).rejects.toBeInstanceOf(NoEsSuperadminError);

    await cambiarVisibilidad(superadminId, "pregunta", preguntaId, true);
    expect(await obtenerPregunta(preguntaId)).toBeNull();
    expect(await listarPreguntas({ busqueda: `Spam ${marca}` })).toHaveLength(0);
    await expect(crearRespuesta(vendedorB, preguntaId, "Otra respuesta")).rejects.toBeInstanceOf(ForoError);

    const moderacion = await listarParaModerar(superadminId);
    const escondida = moderacion.find((p) => p.tipo === "pregunta" && p.id === preguntaId);
    expect(escondida?.ocultaTs).not.toBeNull();

    await cambiarVisibilidad(superadminId, "pregunta", preguntaId, false);
    expect((await obtenerPregunta(preguntaId))?.titulo).toBe(`Spam ${marca}`);
  });

  it("una respuesta escondida no se muestra ni se cuenta", async () => {
    const preguntaId = await crearPregunta(vendedorA, `Conteo ${marca}`, "¿Cuántas respuestas tiene esto?");
    await crearRespuesta(vendedorB, preguntaId, "Una buena respuesta.");
    await crearRespuesta(vendedorB, preguntaId, "Una respuesta grosera.");
    const [, grosera] = (await obtenerPregunta(preguntaId))!.respuestas;

    await cambiarVisibilidad(superadminId, "respuesta", grosera.id, true);

    expect((await obtenerPregunta(preguntaId))?.respuestas.map((r) => r.cuerpo)).toEqual(["Una buena respuesta."]);
    expect((await listarPreguntas({ busqueda: `Conteo ${marca}` }))[0].respuestas).toBe(1);
  });

  it("guarda la imagen adjunta (pregunta y respuesta) y rechaza una que no salió de nuestro Cloudinary", async () => {
    const nubeAntes = process.env.CLOUDINARY_CLOUD_NAME;
    process.env.CLOUDINARY_CLOUD_NAME = "zilonix-prueba";
    try {
      const imagen = "https://res.cloudinary.com/zilonix-prueba/image/upload/v1/zilonix-foro/captura.png";
      const preguntaId = await crearPregunta(vendedorA, `Con imagen ${marca}`, "Miren esta captura del error.", imagen);
      await crearRespuesta(vendedorB, preguntaId, "Ese error sale por esto:", imagen);
      const detalle = await obtenerPregunta(preguntaId);
      expect(detalle?.imagenUrl).toBe(imagen);
      expect(detalle?.respuestas[0].imagenUrl).toBe(imagen);

      await expect(crearPregunta(vendedorA, `Imagen ajena ${marca}`, "Con una imagen de otro sitio.", "https://ejemplo.com/rastreo.gif")).rejects.toBeInstanceOf(ForoError);
      expect(await listarPreguntas({ busqueda: `Imagen ajena ${marca}` })).toHaveLength(0);
    } finally {
      process.env.CLOUDINARY_CLOUD_NAME = nubeAntes;
    }
  });

  it("superadmin_user solo puede marcar oculta_ts/oculta_por, nunca reescribir el texto ni borrar", async () => {
    const preguntaId = await crearPregunta(vendedorB, `Intacta ${marca}`, "El superadmin no puede cambiar este texto.");
    await expect(dbSuperadmin.update(foroPreguntas).set({ cuerpo: "reescrito" }).where(eq(foroPreguntas.id, preguntaId))).rejects.toThrow();
    await expect(dbSuperadmin.delete(foroPreguntas).where(eq(foroPreguntas.id, preguntaId))).rejects.toThrow();
  });
});
