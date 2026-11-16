// Fase 4 de Publicidad (issue #257), paso 0 — verificar si la API de
// Mercado Libre deja MODIFICAR una campaña de Product Ads de un
// vendedor de Colombia. La escritura solo está documentada para Global
// Selling (docs/publicidad/api-research.md §3); la doc CO no la trae.
//
// Hace el cambio más inocuo posible: le agrega " (prueba)" al NOMBRE de
// UNA campaña, lo verifica volviendo a leer, y lo devuelve al nombre
// original. No toca presupuesto, estado, ROAS ni anuncios. Si cualquier
// otro campo aparece cambiado, se detiene y lo dice.
//
// Reglas (issue #257):
// - Solo con autorización POR ESCRITO del responsable de la cuenta
//   piloto (--autorizado-por). Sin --aplicar solo lee y muestra el plan.
// - Una sola ruta: la documentada. Si responde error, NO se prueban
//   otras rutas: se anota el resultado y se le pregunta a Mercado Libre.
// - Se corre contra el ambiente donde la cuenta piloto está conectada
//   (docs/publicidad/entornos.md): el token sale de esa base y, si está
//   por vencer, se renueva ahí mismo. Nunca contra el otro ambiente.
// - No imprime el token ni la respuesta cruda.
//
//   DATABASE_URL_APP=... npx tsx scripts/probar-escritura-publicidad.ts --empresa=<uuid> --cuenta=<uuid> --campana=<id>
//   DATABASE_URL_APP=... npx tsx scripts/probar-escritura-publicidad.ts --empresa=<uuid> --cuenta=<uuid> --campana=<id> \
//     --aplicar --autorizado-por="Nombre"
//   ... --nombre="vendedor 2"   # nombre temporal libre en vez del sufijo; igual se revierte
//
// Código 0 si la prueba salió bien (o el plan en modo lectura); 1 si
// algo falló. Si la reversión falla, lo grita con el nombre original
// para volver a ponerlo a mano en Mercado Libre.

import { pedirLecturaMl } from "@/lib/ml/cliente";
import { obtenerAccessTokenVigente } from "@/lib/ml/cuentas";
import { obtenerAnunciante } from "@/lib/ml/publicidad";
import { textoErrorCorto } from "@/lib/publicidad/plan";
import {
  cambiosInesperados,
  camposDeCampana,
  leerArgumentos,
  nombreDePrueba,
  resumenError,
  type CamposCampana,
} from "./probar-escritura-publicidad-logica";

const BASE_URL = "https://api.mercadolibre.com";
const TIMEOUT_MS = 20_000;

async function leerCampana(siteId: string, campanaId: string, token: string): Promise<CamposCampana> {
  const ruta = `/advertising/${siteId}/product_ads/campaigns/${campanaId}`;
  const resp = await pedirLecturaMl<unknown>(ruta, token, { cabeceras: { "api-version": "2" } });
  if (!resp.ok) throw new Error(`No se pudo leer la campaña (HTTP ${resp.status}, ${resumenError(resp.error)}).`);
  return camposDeCampana(resp.data);
}

// La ruta de escritura de Global Selling (F2), tal cual. Vive acá y no
// en lib/ml/publicidad.ts: ese cliente es solo lectura y su prueba lo exige.
async function cambiarNombre(
  siteId: string,
  campanaId: string,
  token: string,
  nombre: string
): Promise<{ status: number; detalle: string }> {
  const ruta = `/marketplace/advertising/${siteId}/product_ads/campaigns/${campanaId}`;
  let res: Response;
  try {
    res = await fetch(`${BASE_URL}${ruta}`, {
      method: "PUT",
      headers: { Authorization: `Bearer ${token}`, "api-version": "2", "Content-Type": "application/json" },
      body: JSON.stringify({ name: nombre }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    return { status: 0, detalle: "sin respuesta (red o tiempo agotado)" };
  }
  const crudo = await res.text().catch(() => "");
  let data: unknown = null;
  try {
    data = JSON.parse(crudo);
  } catch {
    // Respuesta no-JSON: solo se informa el código HTTP.
  }
  return { status: res.status, detalle: res.ok ? `name=${camposDeCampana(data).name ?? "—"}` : resumenError(data) };
}

function linea(texto = ""): void {
  console.log(texto);
}

async function main(): Promise<number> {
  const args = leerArgumentos(process.argv.slice(2));
  const token = await obtenerAccessTokenVigente(args.empresaId, args.cuentaMlId);
  const anunciante = await obtenerAnunciante(token);
  if (anunciante.estado !== "ok") {
    linea(`La cuenta no tiene Product Ads disponible (${anunciante.estado}). No se intentó nada.`);
    return 1;
  }
  const site = anunciante.siteId;
  const antes = await leerCampana(site, args.campanaId, token);
  if (!antes.name) {
    linea("La campaña no trae nombre en la lectura. No se intentó nada.");
    return 1;
  }
  const temporal = nombreDePrueba(antes.name, args.nombreLibre);

  linea(`Campaña ${args.campanaId} (${site}): "${antes.name}", estado ${antes.status ?? "—"}, presupuesto ${antes.budget ?? "—"}, ROAS objetivo ${antes.roas_target ?? "—"}.`);
  linea(`Plan: renombrar a "${temporal}", verificar, y volver a "${antes.name}".`);
  if (!args.aplicar) {
    linea("Modo lectura: no se cambió nada. Para hacer la prueba, agregá --aplicar --autorizado-por=\"Nombre\".");
    return 0;
  }

  linea(`Autorizado por: ${args.autorizadoPor}.`);
  const ida = await cambiarNombre(site, args.campanaId, token, temporal);
  linea(`PUT (renombrar): HTTP ${ida.status} — ${ida.detalle}`);
  if (ida.status < 200 || ida.status >= 300) {
    const sigue = await leerCampana(site, args.campanaId, token).catch(() => null);
    linea(sigue?.name === antes.name ? "La campaña quedó igual: no se cambió nada." : `REVISAR: la campaña ahora se llama "${sigue?.name ?? "?"}".`);
    linea("Resultado: la ruta documentada NO funcionó para esta cuenta. No probar otras rutas: anotarlo y preguntarle a Mercado Libre.");
    return 1;
  }

  const durante = await leerCampana(site, args.campanaId, token);
  const raros = cambiosInesperados(antes, durante);
  linea(`Lectura después del cambio: "${durante.name ?? "—"}".${raros.length > 0 ? ` CAMBIOS INESPERADOS: ${raros.join("; ")}` : " Nada más cambió."}`);

  const vuelta = await cambiarNombre(site, args.campanaId, token, antes.name);
  linea(`PUT (revertir): HTTP ${vuelta.status} — ${vuelta.detalle}`);
  const despues = await leerCampana(site, args.campanaId, token).catch(() => null);
  if (despues?.name !== antes.name) {
    linea(`¡ATENCIÓN! La campaña NO volvió a su nombre. Ponele a mano en Mercado Libre el nombre original: "${antes.name}".`);
    return 1;
  }
  linea(`La campaña volvió a "${antes.name}".`);

  const bien = durante.name === temporal && raros.length === 0;
  linea();
  linea("Para anotar en docs/publicidad/api-research.md:");
  linea(`- Fecha: ${new Date().toISOString().slice(0, 10)}. Cuenta piloto, campaña ${args.campanaId}, site ${site}. Autorizó: ${args.autorizadoPor}.`);
  linea(`- PUT /marketplace/advertising/${site}/product_ads/campaigns/{id} (api-version: 2), body { name }: HTTP ${ida.status} al renombrar, HTTP ${vuelta.status} al revertir.`);
  linea(`- ${bien ? "El nombre cambió y ningún otro campo se movió." : "El resultado NO fue el esperado (ver arriba)."}`);
  return bien ? 0 : 1;
}

main()
  .then((codigo) => process.exit(codigo))
  .catch((error) => {
    console.error(`La prueba se detuvo: ${textoErrorCorto(error)}`);
    process.exit(1);
  });
