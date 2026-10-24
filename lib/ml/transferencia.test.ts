import { randomUUID } from "crypto";
import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { db } from "@/db";
import { dbComoEmpresa } from "@/db/empresa-context";
import { cuentasMl, empresas, membresias, permisosRol, roles, usuarios } from "@/db/schema";
import { SinPermisoError } from "@/lib/permisos";
import { guardarCuentaConectada } from "./cuentas";
import type { TokensMl } from "./oauth";

// Issue #181 — confirmarTransferenciaCuentaMl dispara
// ejecutarImportacionInicial sin esperarla (mismo criterio que
// app/api/ml/callback/route.ts) — se mockea para que esta prueba no
// dependa de red real contra Mercado Libre, mismo criterio que
// app/api/ml/callback/route.test.ts.
vi.mock("@/lib/ml/importacion", () => ({ ejecutarImportacionInicial: vi.fn(async () => {}) }));

import { ejecutarImportacionInicial } from "@/lib/ml/importacion";
import { confirmarTransferenciaCuentaMl } from "./transferencia";

// Mismo patrón que lib/ml/sku-importar.test.ts: confirmarTransferenciaCuentaMl
// es otra de las pocas funciones de lib/ml/ que llama requierePermiso()
// por su cuenta, así que acá sí hace falta armar un rol y una
// membresía reales.
async function crearEmpresaConPermiso(nombre: string) {
  const empresaId = randomUUID();
  const usuarioId = randomUUID();
  const rolId = randomUUID();

  await dbComoEmpresa(empresaId, (tx) => tx.insert(empresas).values({ id: empresaId, nombre, nit: `TEST-TRANSF-${empresaId.slice(0, 8)}` }));
  await db.insert(usuarios).values({ id: usuarioId, email: `prueba-transf-${usuarioId.slice(0, 8)}@zilonix.test`, nombre: `Usuario ${nombre}` });
  await dbComoEmpresa(empresaId, async (tx) => {
    await tx.insert(roles).values({ id: rolId, nombre: "Rol de prueba", empresaId });
    await tx.insert(permisosRol).values({ rolId, modulo: "configuracion", accion: "crear" });
    await tx.insert(membresias).values({ usuarioId, empresaId, rolId });
  });

  return { empresaId, usuarioId };
}

function tokensDePrueba(cuentaIdExterna: string, sufijo: string): TokensMl {
  return { accessToken: `access-${sufijo}`, refreshToken: `refresh-${sufijo}`, expiraEnSegundos: 21_600, cuentaIdExterna };
}

describe("confirmarTransferenciaCuentaMl (issue #181) — permiso real contra Postgres", () => {
  vi.setConfig({ testTimeout: 20_000 });

  let empresaAId: string;
  let empresaBId: string;
  let usuarioBId: string;
  let usuarioSinPermisoId: string;

  beforeAll(async () => {
    const a = await crearEmpresaConPermiso("Empresa A transferencia");
    empresaAId = a.empresaId;

    const b = await crearEmpresaConPermiso("Empresa B transferencia");
    empresaBId = b.empresaId;
    usuarioBId = b.usuarioId;

    usuarioSinPermisoId = randomUUID();
    await db.insert(usuarios).values({ id: usuarioSinPermisoId, email: `prueba-transf-sinpermiso-${usuarioSinPermisoId.slice(0, 8)}@zilonix.test`, nombre: "Usuario sin permiso" });
    // A propósito, SIN ninguna membresía en empresaBId.
  });

  it("con permiso: transfiere la fila y dispara ejecutarImportacionInicial", async () => {
    const cuentaIdExterna = `${Date.now()}${Math.floor(Math.random() * 10_000)}`;
    const deEmpresaA = await guardarCuentaConectada(empresaAId, {
      cuentaIdExterna,
      nickname: "VENDEDOR_A",
      tokens: tokensDePrueba(cuentaIdExterna, "a"),
    });

    const resultado = await confirmarTransferenciaCuentaMl(usuarioBId, empresaBId, {
      cuentaIdExterna,
      nickname: "VENDEDOR_TRANSFERIDO",
      tokens: tokensDePrueba(cuentaIdExterna, "transferida"),
    });

    expect(resultado.id).toBe(deEmpresaA.id);
    const [filaB] = await dbComoEmpresa(empresaBId, (tx) => tx.select().from(cuentasMl).where(eq(cuentasMl.id, deEmpresaA.id)));
    expect(filaB.empresaId).toBe(empresaBId);
    expect(ejecutarImportacionInicial).toHaveBeenCalledWith(empresaBId, deEmpresaA.id, cuentaIdExterna);
  });

  it("sin permiso: SinPermisoError, y la fila se queda intacta en la empresa anterior", async () => {
    const cuentaIdExterna = `${Date.now()}${Math.floor(Math.random() * 10_000)}`;
    const deEmpresaA = await guardarCuentaConectada(empresaAId, {
      cuentaIdExterna,
      nickname: "VENDEDOR_A_2",
      tokens: tokensDePrueba(cuentaIdExterna, "a2"),
    });

    await expect(
      confirmarTransferenciaCuentaMl(usuarioSinPermisoId, empresaBId, {
        cuentaIdExterna,
        nickname: "INTENTO_SIN_PERMISO",
        tokens: tokensDePrueba(cuentaIdExterna, "robo"),
      })
    ).rejects.toThrow(SinPermisoError);

    const [filaIntacta] = await dbComoEmpresa(empresaAId, (tx) => tx.select().from(cuentasMl).where(eq(cuentasMl.id, deEmpresaA.id)));
    expect(filaIntacta.empresaId).toBe(empresaAId);
    expect(filaIntacta.nickname).toBe("VENDEDOR_A_2");
  });
});
