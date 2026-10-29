import { exigirHostnamePublico } from "@/lib/seguridad/ssrf";

// Code review de Pablo — HIGH 3: un solo lugar que decide si una
// baseUrl de "otro_compatible_openai" se puede usar — exige https,
// parsea la URL y resuelve el hostname contra lib/seguridad/ssrf.ts
// para rechazar una IP privada o de metadata de nube (el blanco
// clásico de un SSRF). Se llama DOS VECES con esta misma función — al
// guardar la conexión (app/api/configuracion/ia-conexion/route.ts) y
// otra vez justo antes de cada fetch real (lib/ia/proveedores.ts) —
// porque el DNS puede cambiar entre medio (DNS rebinding); nunca se
// confía en que "ya se validó alguna vez".
export class UrlBaseIAInvalidaError extends Error {}

export async function exigirUrlBaseIASegura(baseUrl: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch {
    throw new UrlBaseIAInvalidaError("La URL base no es válida.");
  }
  if (url.protocol !== "https:") {
    throw new UrlBaseIAInvalidaError("La URL base tiene que empezar con https://.");
  }
  try {
    await exigirHostnamePublico(url.hostname);
  } catch {
    throw new UrlBaseIAInvalidaError("Esa URL base no se puede usar — no resuelve a una dirección pública.");
  }
  return url;
}
