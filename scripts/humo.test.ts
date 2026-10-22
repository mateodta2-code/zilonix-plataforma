import { spawn } from "child_process";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "http";
import { afterEach, describe, expect, it } from "vitest";

// La tabla vive en el shell. Estas pruebas levantan un origen falso y
// confirman que el script exige exactamente esos códigos, los tiempos
// y la regla de trabajos muertos — sin red y sin credenciales.

type Modo = "sano" | "codigo" | "login" | "lento" | "muertos" | "viejo" | "en-cero";

let servidor: Server | undefined;

function escuchar(modo: Modo): Promise<string> {
  const server = createServer((req, res) => responder(modo, req, res));
  servidor = server;
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const direccion = server.address();
      const puerto = typeof direccion === "object" && direccion ? direccion.port : 0;
      resolve(`http://127.0.0.1:${puerto}`);
    });
  });
}

function responder(modo: Modo, req: IncomingMessage, res: ServerResponse) {
  const ruta = (req.url ?? "/").split("?")[0];

  if (modo === "lento" && ruta === "/api/ml/webhooks") {
    setTimeout(() => {
      res.writeHead(200);
      res.end("{}");
    }, 700);
    return;
  }

  if (ruta === "/login") {
    res.writeHead(307, { Location: "/sign-in" });
    res.end();
    return;
  }
  if (ruta === "/panel") {
    const location = modo === "login" ? "/panel/otra" : "/sign-in?redirect_url=%2Fpanel";
    res.writeHead(307, { Location: location });
    res.end();
    return;
  }
  if (ruta === "/api/ml/etiquetas" || ruta === "/api/ml/conectar") {
    res.writeHead(modo === "codigo" && ruta === "/api/ml/etiquetas" ? 500 : 401);
    res.end();
    return;
  }
  if (ruta === "/api/ml/webhooks") {
    res.writeHead(req.method === "POST" ? 200 : 405);
    res.end("{}");
    return;
  }
  if (ruta === "/api/ml/trabajador") {
    // Si el script manda el secreto, esto no es "sin el encabezado".
    if (req.headers["x-trabajador-secret"]) {
      res.writeHead(200);
      res.end('{"ok":true}');
      return;
    }
    res.writeHead(req.method === "POST" ? 401 : 405);
    res.end();
    return;
  }
  if (ruta === "/api/ml/callback") {
    // La tabla es "sin state/cookie". Si el script manda cookie, no es esa fila.
    if (req.headers.cookie) {
      res.writeHead(401);
      res.end();
      return;
    }
    res.writeHead(307, { Location: "/sign-in" });
    res.end();
    return;
  }
  if (ruta === "/api/salud") {
    let edad: number | null = null;
    let muertos: number | null = null;
    if (modo === "muertos") muertos = 2;
    if (modo === "viejo") edad = 601;
    if (modo === "en-cero") {
      edad = 600;
      muertos = 0;
    }
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true, base: "ok", edad_ultimo_trabajo_s: edad, trabajos_muertos: muertos }));
    return;
  }
  if (ruta === "/api/version") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end('{"version":"0.1.0"}');
    return;
  }
  res.writeHead(404);
  res.end();
}

function correr(url: string): Promise<{ code: number; stdout: string }> {
  return new Promise((resolve) => {
    const child = spawn("bash", ["scripts/humo.sh", url], { cwd: process.cwd() });
    let stdout = "";
    child.stdout.on("data", (d) => {
      stdout += String(d);
    });
    child.on("close", (code) => resolve({ code: code ?? 1, stdout }));
  });
}

afterEach(async () => {
  const actual = servidor;
  servidor = undefined;
  if (!actual) return;
  await new Promise<void>((resolve) => actual.close(() => resolve()));
});

describe("scripts/humo.sh", () => {
  it("exige un origen y rechaza una URL con credenciales sin repetirla", async () => {
    const sinArgs = await new Promise<number>((resolve) => {
      const child = spawn("bash", ["scripts/humo.sh"], { cwd: process.cwd() });
      child.on("close", (code) => resolve(code ?? 1));
    });
    expect(sinArgs).toBe(2);

    const conSecreto = await new Promise<{ code: number; stderr: string }>((resolve) => {
      const child = spawn("bash", ["scripts/humo.sh", "https://user:clave@example.test"], { cwd: process.cwd() });
      let stderr = "";
      child.stderr.on("data", (d) => {
        stderr += String(d);
      });
      child.on("close", (code) => resolve({ code: code ?? 1, stderr }));
    });
    expect(conSecreto.code).toBe(2);
    expect(conSecreto.stderr).not.toMatch(/clave/);
  });

  it("acepta la tabla completa cuando cada ruta da su código a tiempo", async () => {
    const url = await escuchar("sano");
    const { code, stdout } = await correr(url);
    expect(code).toBe(0);
    for (const ruta of [
      "/login",
      "/panel",
      "/api/ml/etiquetas",
      "/api/ml/conectar",
      "/api/ml/webhooks",
      "/api/ml/trabajador",
      "/api/ml/callback",
      "/api/salud",
      "/api/version",
    ]) {
      expect(stdout).toContain(ruta);
    }
    expect(stdout).toContain("Todo coincidió.");
  });

  it("acepta edad de 10 min justos y cero trabajos muertos", async () => {
    const url = await escuchar("en-cero");
    const { code } = await correr(url);
    expect(code).toBe(0);
  });

  it("falla si una ruta no da el código de la tabla", async () => {
    const url = await escuchar("codigo");
    const { code, stdout } = await correr(url);
    expect(code).toBe(1);
    expect(stdout).toMatch(/\/api\/ml\/etiquetas.*FALLO/);
  });

  it("falla si /panel responde 307 pero no hacia el login", async () => {
    const url = await escuchar("login");
    const { code, stdout } = await correr(url);
    expect(code).toBe(1);
    expect(stdout).toMatch(/\/panel.*no redirige a login/);
  });

  it("falla si el webhook tarda más de 500 ms", async () => {
    const url = await escuchar("lento");
    const { code, stdout } = await correr(url);
    expect(code).toBe(1);
    expect(stdout).toMatch(/\/api\/ml\/webhooks.*tiempo/);
  }, 10_000);

  it("falla si hay trabajos muertos o el último tiene más de 10 min", async () => {
    const muertos = await correr(await escuchar("muertos"));
    expect(muertos.code).toBe(1);
    expect(muertos.stdout).toMatch(/trabajos muertos/);

    await new Promise<void>((resolve) => servidor?.close(() => resolve()));
    servidor = undefined;

    const viejo = await correr(await escuchar("viejo"));
    expect(viejo.code).toBe(1);
    expect(viejo.stdout).toMatch(/más de 10 min/);
  });
});
