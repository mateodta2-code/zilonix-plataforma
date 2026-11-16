import { eq, isNull } from "drizzle-orm";
import { dbComoEmpresa } from "@/db/empresa-context";
import { cuentasFalabella } from "@/db/schema";
import { cifrarTokenFalabella, descifrarTokenFalabella } from "@/lib/cifrado";

// Mismo criterio que CuentaMlDeOtraEmpresaError (lib/ml/cuentas.ts) — la
// API Key no tiene "quién es el dueño" verificable del lado de Zilonix
// más que el UserID (correo) que la persona escribió, así que el único
// candado real es la unicidad de ese UserID en cuentas_falabella.
export class CuentaFalabellaDeOtraEmpresaError extends Error {
  constructor() {
    super("Esta cuenta de Falabella ya está conectada a otra empresa en Zilonix. Desconéctala allá primero o escríbenos a soporte.");
    this.name = "CuentaFalabellaDeOtraEmpresaError";
  }
}

function esViolacionDeUnicidad(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "23505");
}

function esChoqueRlsConFilaAjena(error: unknown): boolean {
  if (!error || typeof error !== "object" || !("code" in error) || error.code !== "42501") return false;
  const mensaje = "message" in error && typeof error.message === "string" ? error.message : "";
  return mensaje.includes("row-level security policy") && mensaje.includes("cuentas_falabella");
}

// A diferencia de guardarCuentaConectada de Mercado Libre, acá no hay
// nada que "autorizar en vivo" antes de guardar (no es OAuth) — el que
// conecta la cuenta escribe el UserID/API Key/Seller ID a mano, tal como
// los ve en Falabella Seller Center ("Mi cuenta → Usuarios").
export async function guardarCuentaConectada(
  empresaId: string,
  datos: { userId: string; apiKey: string; sellerId: string; nickname: string }
): Promise<{ id: string }> {
  try {
    return await dbComoEmpresa(empresaId, async (tx) => {
      const [fila] = await tx
        .insert(cuentasFalabella)
        .values({
          empresaId,
          userId: datos.userId,
          apiKeyCifrada: cifrarTokenFalabella(datos.apiKey),
          sellerId: datos.sellerId,
          nickname: datos.nickname,
        })
        .onConflictDoUpdate({
          target: cuentasFalabella.userId,
          set: {
            apiKeyCifrada: cifrarTokenFalabella(datos.apiKey),
            sellerId: datos.sellerId,
            nickname: datos.nickname,
            desconectadaTs: null,
          },
          setWhere: eq(cuentasFalabella.empresaId, empresaId),
        })
        .returning({ id: cuentasFalabella.id });

      if (!fila) throw new CuentaFalabellaDeOtraEmpresaError();
      return fila;
    });
  } catch (error) {
    if (error instanceof CuentaFalabellaDeOtraEmpresaError) throw error;
    if (esViolacionDeUnicidad(error) || esChoqueRlsConFilaAjena(error)) throw new CuentaFalabellaDeOtraEmpresaError();
    throw error;
  }
}

export async function listarCuentasConectadas(empresaId: string) {
  return dbComoEmpresa(empresaId, (tx) =>
    tx
      .select({
        id: cuentasFalabella.id,
        userId: cuentasFalabella.userId,
        sellerId: cuentasFalabella.sellerId,
        nickname: cuentasFalabella.nickname,
        desconectadaTs: cuentasFalabella.desconectadaTs,
        creadoTs: cuentasFalabella.creadoTs,
      })
      .from(cuentasFalabella)
  );
}

export class CuentaFalabellaNoEncontradaError extends Error {
  constructor() {
    super("No se encontró esa cuenta de Falabella.");
    this.name = "CuentaFalabellaNoEncontradaError";
  }
}

// Credenciales reales para llamar a lib/falabella/cliente.ts — nunca se
// expone la API Key descifrada a ningún componente de cliente, solo se
// usa del lado del servidor para armar la llamada.
export async function obtenerCredenciales(empresaId: string, cuentaId: string) {
  return dbComoEmpresa(empresaId, async (tx) => {
    const [cuenta] = await tx
      .select()
      .from(cuentasFalabella)
      .where(eq(cuentasFalabella.id, cuentaId));
    if (!cuenta || cuenta.desconectadaTs) throw new CuentaFalabellaNoEncontradaError();
    return {
      userId: cuenta.userId,
      apiKey: descifrarTokenFalabella(cuenta.apiKeyCifrada),
      sellerId: cuenta.sellerId,
    };
  });
}

// Nunca borra la fila ni el histórico de pedidos ya importados — mismo
// principio que desconectarCuenta de Mercado Libre.
export async function desconectarCuenta(empresaId: string, cuentaId: string): Promise<void> {
  await dbComoEmpresa(empresaId, (tx) =>
    tx.update(cuentasFalabella).set({ desconectadaTs: new Date() }).where(eq(cuentasFalabella.id, cuentaId))
  );
}

export async function obtenerCuentaFalabellaActiva(empresaId: string): Promise<{ id: string } | null> {
  return dbComoEmpresa(empresaId, async (tx) => {
    const [cuenta] = await tx
      .select({ id: cuentasFalabella.id })
      .from(cuentasFalabella)
      .where(isNull(cuentasFalabella.desconectadaTs));
    return cuenta ?? null;
  });
}
