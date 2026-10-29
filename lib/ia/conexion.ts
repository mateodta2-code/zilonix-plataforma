import { eq } from "drizzle-orm";
import { dbComoEmpresa } from "@/db/empresa-context";
import { iaConexiones } from "@/db/schema";
import { cifrarToken, descifrarToken } from "@/lib/cifrado";
import type { ConexionIA, ConexionIAConClave, ProveedorIA } from "./tipos";

// Rama feat-promociones, punto 6 — "Conexión de IA" por empresa, pieza
// COMÚN (lib/ia/) para que cualquier módulo futuro la use, no solo
// Promociones. La API key se cifra con el MISMO mecanismo que los
// tokens de Mercado Libre (lib/cifrado.ts, AES-256-GCM versionado) —
// reusado a propósito en vez de armar un segundo sistema de cifrado
// solo para esto (regla de CLAUDE.md: "credenciales... siempre
// cifradas, con versión de clave"). El nombre de la variable de
// entorno (ML_TOKEN_KEY_V*) queda igual aunque ya no sea solo para
// tokens de ML — rotar esa clave rota las dos cosas a la vez, lo cual
// es aceptable: es la misma garantía de seguridad para las dos.
//
// DOS funciones de lectura a propósito, nunca una sola: obtenerConexionIA
// (sin la key, segura para pasar a la UI/logs) y
// obtenerConexionIAConClave (con la key YA descifrada, SOLO para el
// código del servidor que de verdad va a llamar al proveedor de IA —
// lib/ia/proveedores.ts). Esta separación hace estructuralmente difícil
// filtrar la key por error: el llamador tiene que pedir explícitamente
// la versión "ConClave".
function filaAConexion(fila: typeof iaConexiones.$inferSelect): ConexionIA {
  return { id: fila.id, proveedor: fila.proveedor, baseUrl: fila.baseUrl, modelo: fila.modelo, actualizadoTs: fila.actualizadoTs };
}

export async function obtenerConexionIA(empresaId: string): Promise<ConexionIA | null> {
  const filas = await dbComoEmpresa(empresaId, (tx) => tx.select().from(iaConexiones).where(eq(iaConexiones.empresaId, empresaId)));
  const fila = filas[0];
  return fila ? filaAConexion(fila) : null;
}

export async function obtenerConexionIAConClave(empresaId: string): Promise<ConexionIAConClave | null> {
  const filas = await dbComoEmpresa(empresaId, (tx) => tx.select().from(iaConexiones).where(eq(iaConexiones.empresaId, empresaId)));
  const fila = filas[0];
  if (!fila) return null;
  return { ...filaAConexion(fila), apiKey: descifrarToken(fila.apiKeyCifrada) };
}

export type DatosConexionIA = { proveedor: ProveedorIA; baseUrl: string | null; modelo: string; apiKey: string };

// Una sola fila por empresa (unique en empresaId) — guardar de nuevo
// reemplaza la conexión anterior entera, nunca la mezcla a medias.
export async function guardarConexionIA(empresaId: string, usuarioId: string, datos: DatosConexionIA): Promise<void> {
  await dbComoEmpresa(empresaId, (tx) =>
    tx
      .insert(iaConexiones)
      .values({
        empresaId,
        proveedor: datos.proveedor,
        baseUrl: datos.baseUrl,
        modelo: datos.modelo,
        apiKeyCifrada: cifrarToken(datos.apiKey),
        actualizadoPor: usuarioId,
      })
      .onConflictDoUpdate({
        target: iaConexiones.empresaId,
        set: {
          proveedor: datos.proveedor,
          baseUrl: datos.baseUrl,
          modelo: datos.modelo,
          apiKeyCifrada: cifrarToken(datos.apiKey),
          actualizadoTs: new Date(),
          actualizadoPor: usuarioId,
        },
      })
  );
}

// Desconectar la IA de una empresa — acción legítima de un clic, sin
// ningún motivo para guardar la fila vieja (ia_conexiones sí tiene
// DELETE otorgado a app_user, al revés de las tablas de promociones).
export async function eliminarConexionIA(empresaId: string): Promise<void> {
  await dbComoEmpresa(empresaId, (tx) => tx.delete(iaConexiones).where(eq(iaConexiones.empresaId, empresaId)));
}
