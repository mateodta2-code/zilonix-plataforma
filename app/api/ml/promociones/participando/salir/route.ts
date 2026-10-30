import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { dbComoEmpresa } from "@/db/empresa-context";
import { cuentasMl, promocionesAcciones, promocionesCandidatos } from "@/db/schema";
import { requierePermiso } from "@/lib/permisos";
import { obtenerAccessTokenVigente } from "@/lib/ml/cuentas";
import { leerPromocionesItemMl, salirDePromocionMl } from "@/lib/ml/cliente";
import { puedeSalirPorApi } from "@/lib/ml/promociones";
import { urlPublicaBase } from "@/lib/url-publica";
import { PATRON_UUID, respuestaSiOrigenInvalido, respuestaSiSinPermiso, resolverSesionYEmpresa } from "../../_ayudantes";

// Rama fix-promociones-aprobadas-participando, punto 3 — "Dejar de
// participar". Mismo permiso que lanzar a Mercado Libre ("ejecutar":
// esto SÍ escribe de verdad, un DELETE real) — nunca "aprobar", que es
// para decisiones humanas sobre candidatos nuevos, un concepto
// distinto.
//
// IMPORTANTE (instrucción explícita de Mateo): esta ruta NUNCA se
// ejercita contra Mercado Libre real en pruebas automáticas (ver
// route.test.ts, con mocks) y no se prueba en real hasta que Mateo
// elija un solo ítem puntual para la primera prueba — salirDePromocionMl
// (lib/ml/cliente.ts) ya estaba escrita desde antes pero DOCUMENTADA
// como "sin confirmar contra una cuenta real", igual que esta ruta.
type CuerpoSalir = { cuentaId?: unknown; itemId?: unknown; promotionIdMl?: unknown; tipoPromocion?: unknown };

export async function POST(request: Request) {
  const base = urlPublicaBase();
  const respuestaOrigen = respuestaSiOrigenInvalido(request, new URL(base).origin);
  if (respuestaOrigen) return respuestaOrigen;

  const sesion = await resolverSesionYEmpresa();
  if (sesion instanceof NextResponse) return sesion;
  const { usuario, empresa } = sesion;

  try {
    await requierePermiso(usuario.id, empresa.id, "promociones", "ejecutar");
  } catch (error) {
    const respuestaPermiso = respuestaSiSinPermiso(error);
    if (respuestaPermiso) return respuestaPermiso;
    throw error;
  }

  let cuerpo: CuerpoSalir;
  try {
    cuerpo = await request.json();
  } catch {
    return NextResponse.json({ error: "Faltan datos." }, { status: 400 });
  }
  const { cuentaId, itemId, promotionIdMl, tipoPromocion } = cuerpo;
  if (typeof cuentaId !== "string" || !PATRON_UUID.test(cuentaId)) return NextResponse.json({ error: "Falta la cuenta." }, { status: 400 });
  if (typeof itemId !== "string" || !itemId) return NextResponse.json({ error: "Falta el producto." }, { status: 400 });
  if (typeof tipoPromocion !== "string" || !tipoPromocion) return NextResponse.json({ error: "Falta el tipo de promoción." }, { status: 400 });
  if (promotionIdMl !== null && typeof promotionIdMl !== "string") return NextResponse.json({ error: "Falta el identificador de la promoción." }, { status: 400 });

  // Punto 3 — investigado contra la doc oficial de ML, nunca se asume
  // (TIPOS_SALIR_API, lib/ml/promociones.ts). El cliente ya debería
  // tener el botón deshabilitado para estos tipos — esta es la
  // segunda red de seguridad, del lado del servidor, igual que el
  // resto del módulo nunca confía solo en lo que manda el cliente.
  if (!puedeSalirPorApi(tipoPromocion)) {
    return NextResponse.json({ error: `El tipo "${tipoPromocion}" no se puede dejar por la API de Mercado Libre — hacelo desde la Central de Promociones en Mercado Libre.` }, { status: 400 });
  }

  const [cuenta] = await dbComoEmpresa(empresa.id, (tx) => tx.select().from(cuentasMl).where(eq(cuentasMl.id, cuentaId)));
  if (!cuenta) return NextResponse.json({ error: "Cuenta no encontrada." }, { status: 404 });

  // Review de Pablo (PR #311) — nunca alcanza con que `cuentaId` sea
  // una cuenta real de la empresa (eso ya lo exige RLS en el select de
  // arriba): el `itemId` que manda el cliente tiene que ser uno que
  // esta empresa de verdad vio bajo ESA cuenta puntual (el mismo
  // snapshot que ya alimenta la pestaña Participando) — nunca se
  // confía en la combinación cuentaId+itemId del body a ciegas antes
  // de intentar un DELETE real contra Mercado Libre.
  const [candidatoConocido] = await dbComoEmpresa(empresa.id, (tx) =>
    tx
      .select({ itemId: promocionesCandidatos.itemId })
      .from(promocionesCandidatos)
      .where(and(eq(promocionesCandidatos.empresaId, empresa.id), eq(promocionesCandidatos.cuentaMlId, cuentaId), eq(promocionesCandidatos.itemId, itemId)))
  );
  if (!candidatoConocido) {
    return NextResponse.json({ error: "Este producto no está registrado para esta cuenta — volvé a 'Buscar' e intentá de nuevo." }, { status: 404 });
  }

  const token = await obtenerAccessTokenVigente(empresa.id, cuentaId);

  // Nunca se confía en que sigue started/pending solo porque la
  // pantalla lo mostraba hace un momento — se vuelve a leer fresco
  // justo antes de mandar el DELETE (mismo criterio HIGH 2 de todo el
  // módulo: nunca escribir en Mercado Libre contra un dato que puede
  // estar viejo).
  const resultadoLectura = await leerPromocionesItemMl(itemId, token);
  if (resultadoLectura.estado !== "ok") {
    return NextResponse.json({ error: "No se pudo confirmar el estado real en Mercado Libre antes de salir — probá de nuevo." }, { status: 502 });
  }
  const promoReal = resultadoLectura.promociones.find(
    (p) => (promotionIdMl ? p.id === promotionIdMl : p.type === tipoPromocion) && (p.status === "started" || p.status === "pending")
  );
  if (!promoReal) {
    // Review de Pablo (PR #311) — "ya no participaba" también queda
    // en la auditoría (antes se perdía: ni rastro de que alguien
    // clickeó "Dejar de participar" sobre algo que, al revalidar
    // fresco, ya no estaba activo). Nunca se llamó a Mercado Libre en
    // este caso — por eso resultadoMl lo deja explícito.
    const [filaSinDelete] = await dbComoEmpresa(empresa.id, (tx) =>
      tx
        .insert(promocionesAcciones)
        .values({
          empresaId: empresa.id,
          cuentaMlId: cuentaId,
          itemId,
          tituloProducto: null,
          tipoPromocion,
          promotionIdMl: promotionIdMl ?? null,
          accion: "salir",
          precioAntes: null,
          precioDespues: null,
          estado: "ejecutada",
          aprobadoPor: usuario.id,
          aprobadoTs: new Date(),
          ejecutadoPor: usuario.id,
          ejecutadoTs: new Date(),
          modoSimulacion: false,
          resultadoMl: { ok: true, yaNoParticipaba: true, llamoAMercadoLibre: false },
          error: null,
        })
        .returning()
    );
    return NextResponse.json({ ok: true, yaNoParticipaba: true, accion: filaSinDelete });
  }

  const precioAntes = typeof promoReal.price === "number" ? promoReal.price : null;
  const respuestaMl = await salirDePromocionMl(itemId, token, promotionIdMl ?? String(promoReal.id ?? ""), tipoPromocion);

  const [fila] = await dbComoEmpresa(empresa.id, (tx) =>
    tx
      .insert(promocionesAcciones)
      .values({
        empresaId: empresa.id,
        cuentaMlId: cuentaId,
        itemId,
        tituloProducto: null,
        tipoPromocion,
        promotionIdMl: promotionIdMl ?? (typeof promoReal.id === "string" ? promoReal.id : null),
        accion: "salir",
        precioAntes: precioAntes != null ? String(precioAntes) : null,
        precioDespues: null,
        estado: respuestaMl.ok ? "ejecutada" : "fallida",
        aprobadoPor: usuario.id,
        aprobadoTs: new Date(),
        ejecutadoPor: usuario.id,
        ejecutadoTs: new Date(),
        modoSimulacion: false,
        resultadoMl: { ok: respuestaMl.ok, status: respuestaMl.status },
        error: respuestaMl.ok ? null : `Mercado Libre respondió HTTP ${respuestaMl.status}: ${respuestaMl.textoCrudo.slice(0, 400)}`,
      })
      .returning()
  );

  if (!respuestaMl.ok) {
    return NextResponse.json({ error: fila.error ?? "No se pudo salir de la promoción." }, { status: 502 });
  }
  return NextResponse.json({ ok: true, accion: fila });
}
