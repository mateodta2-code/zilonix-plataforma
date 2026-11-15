// Fase 4 de Publicidad (issue #257), paso 0 — partes puras de
// scripts/probar-escritura-publicidad.ts, separadas para probarlas sin
// Mercado Libre ni base.

const PATRON_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PATRON_ID_NUM = /^\d+$/;

export const SUFIJO_PRUEBA = " (prueba)";

export type Argumentos = {
  empresaId: string;
  cuentaMlId: string;
  campanaId: string;
  aplicar: boolean;
  autorizadoPor: string | null;
};

function valor(argv: readonly string[], nombre: string): string | null {
  const prefijo = `--${nombre}=`;
  const encontrado = argv.find((arg) => arg.startsWith(prefijo));
  return encontrado ? encontrado.slice(prefijo.length).trim() : null;
}

// Lanza con un mensaje para la persona que corre el script; nunca
// llega a Mercado Libre con un argumento mal escrito.
export function leerArgumentos(argv: readonly string[]): Argumentos {
  const empresaId = valor(argv, "empresa") ?? "";
  const cuentaMlId = valor(argv, "cuenta") ?? "";
  const campanaId = valor(argv, "campana") ?? "";
  const aplicar = argv.includes("--aplicar");
  const autorizadoPor = valor(argv, "autorizado-por");

  if (!PATRON_UUID.test(empresaId)) throw new Error("--empresa=<uuid de la empresa> es obligatorio.");
  if (!PATRON_UUID.test(cuentaMlId)) throw new Error("--cuenta=<uuid de cuentas_ml> es obligatorio.");
  if (!PATRON_ID_NUM.test(campanaId)) throw new Error("--campana=<id numérico de la campaña en Mercado Libre> es obligatorio.");
  if (aplicar && !autorizadoPor) {
    throw new Error('--aplicar exige --autorizado-por="Nombre de quien autorizó por escrito" (el responsable de la cuenta).');
  }
  return { empresaId, cuentaMlId, campanaId, aplicar, autorizadoPor: autorizadoPor || null };
}

// El nombre temporal. Si la campaña ya termina en el sufijo, una
// prueba anterior no se revirtió: se frena para no apilar sufijos y
// para que alguien mire qué pasó.
export function nombreDePrueba(original: string): string {
  if (original.endsWith(SUFIJO_PRUEBA)) {
    throw new Error(`La campaña ya se llama "${original}": parece una prueba anterior sin revertir. Revisala antes de seguir.`);
  }
  return `${original}${SUFIJO_PRUEBA}`;
}

export type CamposCampana = {
  name: string | null;
  status: string | null;
  budget: string | null;
  roas_target: string | null;
  strategy: string | null;
};

const CAMPOS_QUE_NO_DEBEN_CAMBIAR = ["status", "budget", "roas_target", "strategy"] as const;

function texto(valor: unknown): string | null {
  if (typeof valor === "string") return valor;
  if (typeof valor === "number" && Number.isFinite(valor)) return String(valor);
  return null;
}

// Solo los campos que importan para la prueba. Nunca se imprime la
// respuesta completa.
export function camposDeCampana(data: unknown): CamposCampana {
  const rec = data && typeof data === "object" ? (data as Record<string, unknown>) : {};
  return {
    name: texto(rec.name),
    status: texto(rec.status),
    budget: texto(rec.budget),
    roas_target: texto(rec.roas_target),
    strategy: texto(rec.strategy),
  };
}

// Lo que cambió fuera del nombre. Tiene que quedar vacío: la prueba
// solo toca `name`.
export function cambiosInesperados(antes: CamposCampana, despues: CamposCampana): string[] {
  return CAMPOS_QUE_NO_DEBEN_CAMBIAR.filter((campo) => antes[campo] !== despues[campo]).map(
    (campo) => `${campo}: ${antes[campo] ?? "—"} → ${despues[campo] ?? "—"}`
  );
}

// El error de Mercado Libre, recortado: código y mensaje, nunca el
// cuerpo crudo.
export function resumenError(data: unknown): string {
  const rec = data && typeof data === "object" ? (data as Record<string, unknown>) : {};
  const partes = [texto(rec.error), texto(rec.message), texto(rec.code)].filter((p): p is string => Boolean(p));
  return partes.length > 0 ? partes.join(" · ").slice(0, 300) : "sin detalle";
}
