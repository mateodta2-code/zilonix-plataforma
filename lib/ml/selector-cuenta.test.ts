import { randomUUID } from "crypto";
import { readFileSync } from "fs";
import { eq } from "drizzle-orm";
import { describe, expect, it, beforeAll } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { dbComoEmpresa } from "@/db/empresa-context";
import { cuentasMl, empresas } from "@/db/schema";
import { cifrarToken } from "@/lib/cifrado";
import { SelectorCuentaMl } from "@/components/SelectorCuentaMl";
import {
  CUENTA_TODAS,
  leerCuentaMlDeQuery,
  listarCuentasMlParaSelector,
  resolverCuentaMl,
} from "./selector-cuenta";

const ID_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

describe("resolverCuentaMl (sin base)", () => {
  const cuentas = [{ id: ID_A, apodo: "VENDEDOR_A" }];

  it("sin parámetro, vacío o 'todas' es Todas", () => {
    expect(resolverCuentaMl(undefined, cuentas)).toBeNull();
    expect(resolverCuentaMl(null, cuentas)).toBeNull();
    expect(resolverCuentaMl("", cuentas)).toBeNull();
    expect(resolverCuentaMl("   ", cuentas)).toBeNull();
    expect(resolverCuentaMl(CUENTA_TODAS, cuentas)).toBeNull();
    expect(resolverCuentaMl("  TODAS ", cuentas)).toBeNull();
  });

  it("un id de la lista se respeta, aunque el query venga en mayúsculas", () => {
    expect(resolverCuentaMl(ID_A, cuentas)).toBe(ID_A);
    expect(resolverCuentaMl(ID_A.toUpperCase(), cuentas)).toBe(ID_A);
  });

  it("un id que no está en la lista es Todas y no lanza", () => {
    expect(resolverCuentaMl("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", cuentas)).toBeNull();
  });

  it("basura, inyección o un query repetido es Todas y no lanza", () => {
    expect(resolverCuentaMl("'; drop table cuentas_ml; --", cuentas)).toBeNull();
    expect(resolverCuentaMl("<script>", cuentas)).toBeNull();
    expect(resolverCuentaMl(["una", "otra"], cuentas)).toBeNull();
    expect(resolverCuentaMl([ID_A], cuentas)).toBe(ID_A);
  });

  it("un empresaId que no es UUID falla antes de tocar la base", async () => {
    await expect(leerCuentaMlDeQuery("no-es-uuid", undefined)).rejects.toThrow(/UUID/);
  });
});

describe("el selector no abre la conexión de superusuario ni pide columnas cifradas", () => {
  const fuentes = ["lib/ml/selector-cuenta.ts", "components/SelectorCuentaMl.tsx"]
    .map((ruta) => readFileSync(ruta, "utf8"))
    .join("\n");

  it("la lectura pasa por dbComoEmpresa", () => {
    expect(fuentes).toContain("dbComoEmpresa(");
  });

  it("no importa la conexión de migraciones ni nombra los campos cifrados", () => {
    expect(fuentes).not.toMatch(/DATABASE_URL/);
    expect(fuentes).not.toMatch(/db\/migrate/);
    expect(fuentes).not.toMatch(/superadmin-context/);
    expect(fuentes).not.toContain('from "@/db"');
    expect(fuentes).not.toContain('from "@/db/index"');
    expect(fuentes).not.toMatch(/accessTokenCifrado|refreshTokenCifrado|cifrarToken|descifrarToken/);
  });
});

// Contra Postgres real: RLS no se puede simular. La empresa B nunca
// entra en la lista de A, y un ?cuenta= con el id de B queda en Todas.
describe("selector de cuenta ML (RLS, Z-MT-08)", () => {
  const empresaAId = randomUUID();
  const empresaBId = randomUUID();
  const tokenEnClaro = `access-selector-${randomUUID()}`;
  let cuentaAId: string;
  let cuentaBId: string;
  let cuentaDesconectadaId: string;
  let datosCifrados: string;

  beforeAll(async () => {
    await dbComoEmpresa(empresaAId, (tx) =>
      tx.insert(empresas).values({ id: empresaAId, nombre: "Empresa A (selector)", nit: `TEST-SEL-A-${empresaAId.slice(0, 8)}` })
    );
    await dbComoEmpresa(empresaBId, (tx) =>
      tx.insert(empresas).values({ id: empresaBId, nombre: "Empresa B (selector)", nit: `TEST-SEL-B-${empresaBId.slice(0, 8)}` })
    );

    const accessA = cifrarToken(tokenEnClaro);
    datosCifrados = accessA.datos;
    const [cuentaA] = await dbComoEmpresa(empresaAId, (tx) =>
      tx
        .insert(cuentasMl)
        .values({
          empresaId: empresaAId,
          cuentaIdExterna: `ml-sel-a-${randomUUID()}`,
          nickname: `Vend <b>${empresaAId.slice(0, 4)}</b>`,
          accessTokenCifrado: accessA,
          refreshTokenCifrado: cifrarToken("refresh-selector-a"),
          tokenExpiraTs: new Date(Date.now() + 3600_000),
        })
        .returning({ id: cuentasMl.id })
    );
    cuentaAId = cuentaA.id;

    const [desconectada] = await dbComoEmpresa(empresaAId, (tx) =>
      tx
        .insert(cuentasMl)
        .values({
          empresaId: empresaAId,
          cuentaIdExterna: `ml-sel-off-${randomUUID()}`,
          nickname: "VIEJA_A",
          accessTokenCifrado: cifrarToken("access-vieja"),
          refreshTokenCifrado: cifrarToken("refresh-vieja"),
          tokenExpiraTs: new Date(Date.now() + 3600_000),
          desconectadaTs: new Date(),
        })
        .returning({ id: cuentasMl.id })
    );
    cuentaDesconectadaId = desconectada.id;

    const [cuentaB] = await dbComoEmpresa(empresaBId, (tx) =>
      tx
        .insert(cuentasMl)
        .values({
          empresaId: empresaBId,
          cuentaIdExterna: `ml-sel-b-${randomUUID()}`,
          nickname: "VENDEDOR_B_SECRETO",
          accessTokenCifrado: cifrarToken("access-de-b"),
          refreshTokenCifrado: cifrarToken("refresh-de-b"),
          tokenExpiraTs: new Date(Date.now() + 3600_000),
        })
        .returning({ id: cuentasMl.id })
    );
    cuentaBId = cuentaB.id;
  });

  it("la empresa A solo ve sus cuentas, y cada fila es id + apodo", async () => {
    const cuentas = await listarCuentasMlParaSelector(empresaAId);
    expect(cuentas.map((c) => c.id).sort()).toEqual([cuentaAId, cuentaDesconectadaId].sort());
    for (const cuenta of cuentas) {
      expect(Object.keys(cuenta).sort()).toEqual(["apodo", "id"]);
    }
    expect(JSON.stringify(cuentas)).not.toContain(tokenEnClaro);
    expect(JSON.stringify(cuentas)).not.toContain(datosCifrados);
    expect(JSON.stringify(cuentas)).not.toContain("VENDEDOR_B_SECRETO");
  });

  it("la empresa B no ve las cuentas de A", async () => {
    const cuentas = await listarCuentasMlParaSelector(empresaBId);
    expect(cuentas.map((c) => c.id)).toEqual([cuentaBId]);
    expect(cuentas[0].apodo).toBe("VENDEDOR_B_SECRETO");
  });

  it("un ?cuenta= de otra empresa, o desconocido, es Todas y no lanza", async () => {
    const ajena = await leerCuentaMlDeQuery(empresaAId, cuentaBId);
    expect(ajena.cuentaId).toBeNull();
    expect(ajena.cuentas.map((c) => c.id)).not.toContain(cuentaBId);

    const basura = await leerCuentaMlDeQuery(empresaAId, "no-es-una-cuenta");
    expect(basura.cuentaId).toBeNull();

    const propia = await leerCuentaMlDeQuery(empresaAId, cuentaAId);
    expect(propia.cuentaId).toBe(cuentaAId);

    const vieja = await leerCuentaMlDeQuery(empresaAId, cuentaDesconectadaId);
    expect(vieja.cuentaId).toBe(cuentaDesconectadaId);
  });

  it("el HTML lista el apodo de A, marca Todas si el query es de B, y no vuelca tokens", async () => {
    const htmlAjena = renderToStaticMarkup(
      await SelectorCuentaMl({
        empresaId: empresaAId,
        cuenta: cuentaBId,
        parametros: { estado: "abierta", cuenta: cuentaBId, "<script>": "x" },
      })
    );
    expect(htmlAjena).toContain('name="cuenta"');
    expect(htmlAjena).toContain('value="todas"');
    expect(htmlAjena).toContain("Todas");
    expect(htmlAjena).toContain("VIEJA_A");
    expect(htmlAjena).toContain("&lt;b&gt;");
    expect(htmlAjena).not.toContain("<b>");
    expect(htmlAjena).not.toContain("VENDEDOR_B_SECRETO");
    expect(htmlAjena).not.toContain(cuentaBId);
    expect(htmlAjena).not.toContain(tokenEnClaro);
    expect(htmlAjena).not.toContain(datosCifrados);
    expect(htmlAjena).toContain('name="estado"');
    expect(htmlAjena).toContain('value="abierta"');
    expect(htmlAjena).not.toContain("<script>");
    // La opción "Todas" queda elegida: el id de B no es una opción.
    expect(htmlAjena).toMatch(/<option[^>]*value="todas"[^>]*>Todas<\/option>/);
    expect(htmlAjena).toMatch(/<option[^>]*\bselected\b[^>]*value="todas"[^>]*>|<option[^>]*value="todas"[^>]*\bselected\b[^>]*>/);

    const htmlPropia = renderToStaticMarkup(
      await SelectorCuentaMl({ empresaId: empresaAId, cuenta: cuentaAId })
    );
    expect(htmlPropia).toMatch(new RegExp(`<option[^>]*value="${cuentaAId}"[^>]*selected|<option[^>]*selected[^>]*value="${cuentaAId}"`));
    expect(htmlPropia).not.toContain(tokenEnClaro);

    const fila = await dbComoEmpresa(empresaAId, (tx) =>
      tx.select({ cifrado: cuentasMl.accessTokenCifrado }).from(cuentasMl).where(eq(cuentasMl.id, cuentaAId))
    );
    expect(htmlPropia).not.toContain(fila[0].cifrado.datos);
    expect(htmlPropia).not.toContain(fila[0].cifrado.iv);
  });
});
