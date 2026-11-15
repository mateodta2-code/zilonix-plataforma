import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { listarEmpresasDeUsuario } from "@/lib/empresas";
import { obtenerOCrearUsuarioActual } from "@/lib/usuarios";
import { CantidadInvalidaError, StockInsuficienteError } from "@/lib/inventario/calculos";
import { BodegaNoValidaError, SkuNoValidoParaStockError } from "@/lib/inventario/movimientos";
import { BodegaDuplicadaError, DatosBodegaInvalidosError } from "@/lib/inventario/bodegas";
import { CompraInvalidaError } from "@/lib/inventario/compras";
import { AlertaNoPendienteError } from "@/lib/inventario/alertas";
import { ConfiguracionInventarioInvalidaError } from "@/lib/inventario/configuracion";
import { MontoInvalidoError } from "@/lib/finanzas/montos";

// Issue #280 — lo que repiten las Server Actions de inventario: quién
// está y en qué empresa (mismo criterio que app/panel/sku/actions.ts).
// El permiso NO se revisa acá: cada acción llama requierePermiso() en
// su propio archivo (scripts/verificar-permisos.test.ts lo exige así).
export async function usuarioYEmpresaActiva(): Promise<{ usuarioId: string; empresaId: string }> {
  const usuario = await obtenerOCrearUsuarioActual();
  if (!usuario) redirect("/sign-in");
  const propias = await listarEmpresasDeUsuario(usuario.id);
  const cookieEmpresa = cookies().get("empresa_actual")?.value;
  const empresa = propias.find((e) => e.id === cookieEmpresa) ?? propias[0];
  if (!empresa) redirect("/crear-empresa");
  return { usuarioId: usuario.id, empresaId: empresa.id };
}

// Errores que son de la persona (dato mal puesto, no alcanza el stock):
// vuelven a la pantalla como aviso. Cualquier otro sube tal cual.
export function mensajeParaPersona(error: unknown): string | null {
  if (error instanceof StockInsuficienteError) return "No alcanza el stock disponible para ese movimiento.";
  if (
    error instanceof CantidadInvalidaError ||
    error instanceof SkuNoValidoParaStockError ||
    error instanceof BodegaNoValidaError ||
    error instanceof BodegaDuplicadaError ||
    error instanceof DatosBodegaInvalidosError ||
    error instanceof CompraInvalidaError ||
    error instanceof AlertaNoPendienteError ||
    error instanceof ConfiguracionInventarioInvalidaError ||
    error instanceof MontoInvalidoError
  ) {
    return error.message;
  }
  return null;
}

export function conAviso(ruta: string, clave: "error" | "ok", mensaje: string): string {
  const separador = ruta.includes("?") ? "&" : "?";
  return `${ruta}${separador}${clave}=${encodeURIComponent(mensaje.slice(0, 300))}`;
}

export function enteroDe(valor: FormDataEntryValue | null): number {
  const texto = String(valor ?? "").trim();
  return /^-?\d+$/.test(texto) ? Number(texto) : Number.NaN;
}

// Filas sku_N / cantidad_N de un formulario de varias líneas; las
// vacías se ignoran.
export function lineasDelFormulario(formData: FormData, maximo: number): { skuId: string; cantidad: number }[] {
  const lineas: { skuId: string; cantidad: number }[] = [];
  for (let i = 0; i < maximo; i++) {
    const skuId = String(formData.get(`sku_${i}`) ?? "").trim();
    const cantidad = formData.get(`cantidad_${i}`);
    if (!skuId || !String(cantidad ?? "").trim()) continue;
    lineas.push({ skuId, cantidad: enteroDe(cantidad) });
  }
  return lineas;
}

export function textoDe(valor: FormDataEntryValue | null): string | null {
  const texto = String(valor ?? "").trim();
  return texto ? texto.slice(0, 500) : null;
}
