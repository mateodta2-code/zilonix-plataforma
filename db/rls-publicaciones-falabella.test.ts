import { randomUUID } from "crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { dbComoEmpresa } from "./empresa-context";
import { cuentasFalabella, publicacionesFalabella } from "./schema";
import { afirmarAislamiento, crearDosEmpresas, type ContextoDosEmpresas } from "./test-utils/aislamiento";
import { construirBorrador } from "../lib/falabella/publicar-reglas";

// Publicar en Falabella (28/11/2026) — historial por empresa: B nunca ve,
// edita ni borra una publicación de A, ni cuelga una de la cuenta de A.
describe("publicaciones_falabella (RLS)", () => {
  let contexto: ContextoDosEmpresas;
  let cuentaAId: string;
  const borrador = construirBorrador({
    sku: "TEST1234",
    titulo: "Producto de prueba",
    descripcion: "Descripción de prueba",
    modelo: "Marca",
    precioOferta: 10000,
    stock: 1,
    categoriaId: 1,
    imagenes: ["https://x.com/1.jpg"],
  });

  beforeAll(async () => {
    contexto = await crearDosEmpresas();
    const [cuenta] = await dbComoEmpresa(contexto.empresaAId, (tx) =>
      tx
        .insert(cuentasFalabella)
        .values({
          empresaId: contexto.empresaAId,
          userId: `pub-a-${randomUUID()}@ejemplo.com`,
          apiKeyCifrada: { version: 1, iv: "x", authTag: "y", datos: "z" },
          sellerId: "TIENDA_A",
          nickname: "Tienda A",
        })
        .returning({ id: cuentasFalabella.id })
    );
    cuentaAId = cuenta.id;
  });

  it("B no ve, no edita ni borra una publicación de A", async () => {
    await afirmarAislamiento(contexto, publicacionesFalabella, (tx, empresaId) =>
      tx.insert(publicacionesFalabella).values({ empresaId, cuentaFalabellaId: cuentaAId, sku: "TEST1234", titulo: "Producto de prueba", borrador }).returning({ id: publicacionesFalabella.id })
    );
  });

  it("B no puede colgar una publicación de la cuenta de A (FK compuesta)", async () => {
    await expect(
      dbComoEmpresa(contexto.empresaBId, (tx) =>
        tx.insert(publicacionesFalabella).values({ empresaId: contexto.empresaBId, cuentaFalabellaId: cuentaAId, sku: "X1234", titulo: "x", borrador })
      )
    ).rejects.toThrow();
  });

  it("solo acepta los estados válidos (CHECK)", async () => {
    await expect(
      dbComoEmpresa(contexto.empresaAId, (tx) =>
        tx.insert(publicacionesFalabella).values({ empresaId: contexto.empresaAId, cuentaFalabellaId: cuentaAId, sku: "X1234", titulo: "x", borrador, estado: "inventado" as never })
      )
    ).rejects.toThrow();
  });
});
