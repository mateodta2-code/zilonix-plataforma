import { existsSync, readFileSync } from "fs";
import { describe, expect, it } from "vitest";
import { MultipartArchivoDemasiadoGrandeError, MultipartInvalidoError, recibirMultipartVideo } from "./recibir-multipart-video";

function peticionMultipart(form: FormData): Request {
  // Node/undici fija el boundary y el content-type reales al construir
  // el Request con un FormData como body — nunca se arma el header a
  // mano (un boundary mal copiado rompería el parseo de busboy).
  return new Request("https://staging.test/subir", { method: "POST", body: form });
}

describe("recibirMultipartVideo — rama feat-publicar-clip, punto 4 (streaming a disco, nunca en memoria)", () => {
  it("campos de texto y un archivo chico: el archivo queda escrito en disco con su contenido real", async () => {
    const form = new FormData();
    form.append("cuentas", JSON.stringify([{ cuentaId: "c1", itemId: "MCO1" }]));
    form.append("archivo", new File([new Uint8Array([1, 2, 3, 4])], "clip.mp4", { type: "video/mp4" }));

    const resultado = await recibirMultipartVideo(peticionMultipart(form), 1024);

    expect(resultado.campos.cuentas).toBe(JSON.stringify([{ cuentaId: "c1", itemId: "MCO1" }]));
    expect(resultado.archivos.archivo.contentType).toBe("video/mp4");
    expect(resultado.archivos.archivo.nombreOriginal).toBe("clip.mp4");
    expect(existsSync(resultado.archivos.archivo.rutaArchivo)).toBe(true);
    expect(Array.from(readFileSync(resultado.archivos.archivo.rutaArchivo))).toEqual([1, 2, 3, 4]);
  });

  it("varios archivos (video por defecto + override de una cuenta puntual) quedan en rutas DISTINTAS", async () => {
    const form = new FormData();
    form.append("archivo", new File([new Uint8Array([1, 1])], "a.mp4", { type: "video/mp4" }));
    form.append("archivo_c2", new File([new Uint8Array([2, 2])], "b.mp4", { type: "video/mp4" }));

    const resultado = await recibirMultipartVideo(peticionMultipart(form), 1024);

    expect(resultado.archivos.archivo.rutaArchivo).not.toBe(resultado.archivos.archivo_c2.rutaArchivo);
    expect(existsSync(resultado.archivos.archivo.rutaArchivo)).toBe(true);
    expect(existsSync(resultado.archivos.archivo_c2.rutaArchivo)).toBe(true);
  });

  it("un archivo que supera el tope: rechaza con MultipartArchivoDemasiadoGrandeError y borra el temporal parcial", async () => {
    const form = new FormData();
    form.append("archivo", new File([new Uint8Array(2000)], "grande.mp4", { type: "video/mp4" }));

    // No hay forma de leer la ruta desde afuera cuando rechaza (el
    // objeto `archivos` nunca llega al llamador) — se confirma el
    // borrado real comparando la carpeta temporal antes/después: nunca
    // debería quedar un zilonix-clip-subida-*.tmp NUEVO huérfano (otras
    // pruebas de este mismo archivo sí dejan los suyos a propósito, acá
    // solo importa que ESTA llamada no sume ninguno).
    const { readdirSync } = await import("fs");
    const { tmpdir } = await import("os");
    const antes = new Set(readdirSync(tmpdir()).filter((n) => n.startsWith("zilonix-clip-subida-")));

    try {
      await recibirMultipartVideo(peticionMultipart(form), 1000);
      throw new Error("tenía que rechazar");
    } catch (error) {
      expect(error).toBeInstanceOf(MultipartArchivoDemasiadoGrandeError);
    }

    const despues = readdirSync(tmpdir()).filter((n) => n.startsWith("zilonix-clip-subida-") && !antes.has(n));
    expect(despues).toEqual([]);
  });

  it("content-type que no es multipart/form-data: rechaza con MultipartInvalidoError, nunca intenta parsear", async () => {
    const peticion = new Request("https://staging.test/subir", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ a: 1 }) });

    await expect(recibirMultipartVideo(peticion, 1000)).rejects.toThrow(MultipartInvalidoError);
  });

  it("sin cuerpo: rechaza con MultipartInvalidoError", async () => {
    const peticion = new Request("https://staging.test/subir", { method: "GET" });

    await expect(recibirMultipartVideo(peticion, 1000)).rejects.toThrow(MultipartInvalidoError);
  });
});
