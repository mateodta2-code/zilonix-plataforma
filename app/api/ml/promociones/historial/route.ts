import { and, desc, eq, gte, inArray, lt, or, sql, type SQL } from "drizzle-orm";
import { NextResponse } from "next/server";
import { dbComoEmpresa } from "@/db/empresa-context";
import { cuentasMl, promocionesAcciones, usuarios } from "@/db/schema";
import { leerPisosYCostosFrescos } from "@/lib/ml/promociones";
import { resumirResultadoMl } from "@/lib/ml/promocionesBitacora";
import { requierePermiso } from "@/lib/permisos";
import { PATRON_UUID, respuestaSiSinPermiso, resolverSesionYEmpresa } from "../_ayudantes";

// Rama feat-promociones, pestaña Historial — "quién aprobó, cuándo,
// precio antes y después, resultado de ML y error si lo hubo".
const ACCIONES = ["participar", "modificar", "salir"] as const;
const TAMANO_PAGINA = 50;
const ESTADOS = ["pendiente", "aceptada", "rechazada", "ejecutada", "fallida"] as const;
// Pestaña «Auditar»: tope de filas ejecutadas que se revisan contra el piso por consulta.
const TOPE_CANDIDATAS_BAJO_PISO = 5000;
const RESULTADOS = ["ok", "error", "no-aplicada", "bajo-piso"] as const;

export async function GET(request: Request) {
  const sesion = await resolverSesionYEmpresa();
  if (sesion instanceof NextResponse) return sesion;
  const { usuario, empresa } = sesion;

  try {
    await requierePermiso(usuario.id, empresa.id, "promociones", "consultar");
  } catch (error) {
    const respuestaPermiso = respuestaSiSinPermiso(error);
    if (respuestaPermiso) return respuestaPermiso;
    throw error;
  }

  const { searchParams } = new URL(request.url);
  const cuentaId = searchParams.get("cuentaId");
  if (cuentaId && !PATRON_UUID.test(cuentaId)) return NextResponse.json({ error: "cuentaId inválido." }, { status: 400 });
  const estadoCrudo = searchParams.get("estado");
  const estado = estadoCrudo && (ESTADOS as readonly string[]).includes(estadoCrudo) ? estadoCrudo : null;
  const accionCruda = searchParams.get("accion");
  const accion = accionCruda && (ACCIONES as readonly string[]).includes(accionCruda) ? accionCruda : null;
  const resultadoCrudo = searchParams.get("resultado");
  const resultado = resultadoCrudo && (RESULTADOS as readonly string[]).includes(resultadoCrudo) ? (resultadoCrudo as (typeof RESULTADOS)[number]) : null;
  // «Auditar» (antes «Bitácora»): solo lo que hay que revisar a mano.
  const vista = searchParams.get("vista");
  const auditar = vista === "auditar";
  const desde = leerFecha(searchParams.get("desde"));
  const hasta = leerFecha(searchParams.get("hasta"));
  if (searchParams.get("desde") && !desde) return NextResponse.json({ error: "desde inválido (AAAA-MM-DD)." }, { status: 400 });
  if (searchParams.get("hasta") && !hasta) return NextResponse.json({ error: "hasta inválido (AAAA-MM-DD)." }, { status: 400 });
  const pagina = Math.max(1, Math.floor(Number(searchParams.get("pagina"))) || 1);

  const loteCrudo = searchParams.get("lote");
  if (loteCrudo && !PATRON_UUID.test(loteCrudo)) return NextResponse.json({ error: "lote inválido." }, { status: 400 });
  // Las filas de UNA tanda (al desplegar): el lote, o la fila suelta sin lote.
  const condicionLote = (): SQL | null =>
    loteCrudo ? (or(sql`${promocionesAcciones.resultadoMl}->>'lote' = ${loteCrudo}`, sql`${promocionesAcciones.id}::text = ${loteCrudo}`) as SQL) : null;

  // Auditar — filas ejecutadas que hoy quedan por debajo del piso. Solo las de
  // reglas SIN piso (limite "ninguno" o "tope": reglas «todas» y «máximo»);
  // con limite "piso" el piso ya se respetó al aplicar. OJO: se compara contra
  // el piso VIGENTE de costos_sku (misma lectura que el motor), no contra el
  // piso del día en que se aplicó, y contra el precio que se mandó a ML
  // (precio_despues), sin llamar a Mercado Libre.
  const pisoPorFila = new Map<string, { piso: number; precio: number }>();
  const buscarBajoPiso = auditar && (resultado === null || resultado === "bajo-piso");
  if (buscarBajoPiso) {
    const candidatas = await dbComoEmpresa(empresa.id, (tx) => {
      const condiciones: SQL[] = [
        eq(promocionesAcciones.empresaId, empresa.id),
        eq(promocionesAcciones.estado, "ejecutada"),
        eq(promocionesAcciones.modoSimulacion, false),
        sql`${promocionesAcciones.accion} in ('participar', 'modificar')`,
        sql`${promocionesAcciones.resultadoMl}->>'limite' in ('ninguno', 'tope')`,
        sql`coalesce(${promocionesAcciones.resultadoMl}->>'sku', '') <> ''`,
        sql`${promocionesAcciones.precioDespues} is not null`,
      ];
      if (cuentaId) condiciones.push(eq(promocionesAcciones.cuentaMlId, cuentaId));
      if (accion) condiciones.push(eq(promocionesAcciones.accion, accion as (typeof ACCIONES)[number]));
      if (desde) condiciones.push(gte(promocionesAcciones.creadoTs, new Date(`${desde}T00:00:00-05:00`)));
      if (hasta) condiciones.push(lt(promocionesAcciones.creadoTs, new Date(new Date(`${hasta}T00:00:00-05:00`).getTime() + 86_400_000)));
      const lote = condicionLote();
      if (lote) condiciones.push(lote);
      return tx
        .select({ id: promocionesAcciones.id, sku: sql<string>`${promocionesAcciones.resultadoMl}->>'sku'`, precioDespues: promocionesAcciones.precioDespues })
        .from(promocionesAcciones)
        .where(and(...condiciones))
        .orderBy(desc(promocionesAcciones.creadoTs))
        .limit(TOPE_CANDIDATAS_BAJO_PISO);
    });
    if (candidatas.length > 0) {
      // Una sola consulta por tanda/página para todos los SKU.
      const pisos = await leerPisosYCostosFrescos(empresa.id, [...new Set(candidatas.map((c) => c.sku))]);
      for (const c of candidatas) {
        const piso = pisos.get(c.sku)?.precioMinimo;
        const precio = Number(c.precioDespues);
        if (piso != null && Number.isFinite(precio) && precio < piso) pisoPorFila.set(c.id, { piso, precio });
      }
    }
  }
  const idsBajoPiso = [...pisoPorFila.keys()];
  // Sin ninguna fila bajo el piso, la condición nunca se cumple.
  const condicionBajoPiso = (): SQL => (idsBajoPiso.length > 0 ? inArray(promocionesAcciones.id, idsBajoPiso) : sql`false`);

  const condicionesFiltro = (empresaId: string): SQL[] => {
    const condiciones: SQL[] = [eq(promocionesAcciones.empresaId, empresaId)];
    if (cuentaId) condiciones.push(eq(promocionesAcciones.cuentaMlId, cuentaId));
    if (estado) condiciones.push(eq(promocionesAcciones.estado, estado as (typeof ESTADOS)[number]));
    if (accion) condiciones.push(eq(promocionesAcciones.accion, accion as (typeof ACCIONES)[number]));
    if (auditar) {
      // Nunca una ejecutada con éxito, salvo las que quedaron bajo el piso.
      const sinAplicar = inArray(promocionesAcciones.estado, ["pendiente", "aceptada", "rechazada"]);
      if (resultado === "error") condiciones.push(eq(promocionesAcciones.estado, "fallida"));
      else if (resultado === "no-aplicada") condiciones.push(sinAplicar);
      else if (resultado === "bajo-piso") condiciones.push(condicionBajoPiso());
      else condiciones.push(or(sinAplicar, eq(promocionesAcciones.estado, "fallida"), condicionBajoPiso()) as SQL);
    } else {
      if (resultado === "ok") condiciones.push(eq(promocionesAcciones.estado, "ejecutada"));
      if (resultado === "error") condiciones.push(eq(promocionesAcciones.estado, "fallida"));
    }
    // Rango por día calendario de Colombia (UTC-5, sin horario de verano).
    if (desde) condiciones.push(gte(promocionesAcciones.creadoTs, new Date(`${desde}T00:00:00-05:00`)));
    if (hasta) condiciones.push(lt(promocionesAcciones.creadoTs, new Date(new Date(`${hasta}T00:00:00-05:00`).getTime() + 86_400_000)));
    return condiciones;
  };

  // Promo-E — clave de tanda: el lote guardado en resultado_ml, o el id de la
  // fila para lo anterior sin lote (cada una su propia tanda).
  const claveTanda = sql<string>`coalesce(${promocionesAcciones.resultadoMl}->>'lote', ${promocionesAcciones.id}::text)`;
  const fechaTanda = sql`min(coalesce(${promocionesAcciones.ejecutadoTs}, ${promocionesAcciones.creadoTs}))`;

  if ((vista === "tandas" || auditar) && !loteCrudo) {
    const tandas = await dbComoEmpresa(empresa.id, (tx) =>
      tx
        .select({
          clave: claveTanda,
          total: sql<number>`count(*)`.mapWith(Number),
          participo: sql<number>`count(*) filter (where ${promocionesAcciones.estado} = 'ejecutada' and ${promocionesAcciones.accion} = 'participar')`.mapWith(Number),
          modifico: sql<number>`count(*) filter (where ${promocionesAcciones.estado} = 'ejecutada' and ${promocionesAcciones.accion} = 'modificar')`.mapWith(Number),
          salio: sql<number>`count(*) filter (where ${promocionesAcciones.estado} = 'ejecutada' and ${promocionesAcciones.accion} = 'salir')`.mapWith(Number),
          conError: sql<number>`count(*) filter (where ${promocionesAcciones.estado} = 'fallida')`.mapWith(Number),
          // Auditar: los demás conteos cuadran con el total (ejecutadas = solo las bajo el piso).
          bajoPiso: sql<number>`count(*) filter (where ${promocionesAcciones.estado} = 'ejecutada')`.mapWith(Number),
          pendientes: sql<number>`count(*) filter (where ${promocionesAcciones.estado} in ('pendiente', 'aceptada'))`.mapWith(Number),
          noApi: sql<number>`count(*) filter (where ${promocionesAcciones.estado} = 'rechazada' and ${promocionesAcciones.resultadoMl}->>'regla' = 'salir')`.mapWith(Number),
          omitidas: sql<number>`count(*) filter (where ${promocionesAcciones.estado} = 'rechazada' and coalesce(${promocionesAcciones.resultadoMl}->>'regla', '') <> 'salir')`.mapWith(Number),
          simulada: sql<boolean>`bool_or(${promocionesAcciones.modoSimulacion})`,
          regla: sql<string | null>`max(${promocionesAcciones.resultadoMl}->>'regla')`,
          usuarioNombre: sql<string | null>`max(coalesce(${usuarios.nombre}, ${usuarios.email}))`,
          cuentaMlId: sql<string>`min(${promocionesAcciones.cuentaMlId}::text)`,
          nicknameCuenta: sql<string>`min(${cuentasMl.nickname})`,
          fecha: sql<string>`${fechaTanda}`,
        })
        .from(promocionesAcciones)
        .innerJoin(cuentasMl, eq(cuentasMl.id, promocionesAcciones.cuentaMlId))
        .leftJoin(usuarios, eq(usuarios.id, promocionesAcciones.ejecutadoPor))
        .where(and(...condicionesFiltro(empresa.id)))
        .groupBy(claveTanda)
        .orderBy(desc(fechaTanda))
        .limit(TAMANO_PAGINA + 1)
        .offset((pagina - 1) * TAMANO_PAGINA)
    );
    return NextResponse.json({ tandas: tandas.slice(0, TAMANO_PAGINA), pagina, tamanoPagina: TAMANO_PAGINA, hayMas: tandas.length > TAMANO_PAGINA });
  }

  const filas = await dbComoEmpresa(empresa.id, (tx) => {
    const condiciones = condicionesFiltro(empresa.id);
    const lote = condicionLote();
    if (lote) condiciones.push(lote);
    return tx
      .select({
        id: promocionesAcciones.id,
        cuentaMlId: promocionesAcciones.cuentaMlId,
        nicknameCuenta: cuentasMl.nickname,
        itemId: promocionesAcciones.itemId,
        tituloProducto: promocionesAcciones.tituloProducto,
        tipoPromocion: promocionesAcciones.tipoPromocion,
        promotionIdMl: promocionesAcciones.promotionIdMl,
        accion: promocionesAcciones.accion,
        precioAntes: promocionesAcciones.precioAntes,
        precioDespues: promocionesAcciones.precioDespues,
        estado: promocionesAcciones.estado,
        aprobadoPor: promocionesAcciones.aprobadoPor,
        aprobadoTs: promocionesAcciones.aprobadoTs,
        ejecutadoPor: promocionesAcciones.ejecutadoPor,
        ejecutadoPorNombre: sql<string | null>`coalesce(${usuarios.nombre}, ${usuarios.email})`,
        ejecutadoTs: promocionesAcciones.ejecutadoTs,
        modoSimulacion: promocionesAcciones.modoSimulacion,
        resultadoMl: promocionesAcciones.resultadoMl,
        error: promocionesAcciones.error,
        creadoTs: promocionesAcciones.creadoTs,
      })
      .from(promocionesAcciones)
      .innerJoin(cuentasMl, eq(cuentasMl.id, promocionesAcciones.cuentaMlId))
      .leftJoin(usuarios, eq(usuarios.id, promocionesAcciones.ejecutadoPor))
      .where(and(...condiciones))
      .orderBy(desc(promocionesAcciones.creadoTs))
      .limit(TAMANO_PAGINA + 1)
      .offset((pagina - 1) * TAMANO_PAGINA);
  });

  const hayMas = filas.length > TAMANO_PAGINA;
  const visibles = filas.slice(0, TAMANO_PAGINA).map(({ resultadoMl, error, ...resto }) => ({
    ...resto,
    // Solo en Auditar: piso vigente y precio de las filas que quedaron por debajo.
    bajoPiso: pisoPorFila.has(resto.id) ? { ...pisoPorFila.get(resto.id)!, diferencia: pisoPorFila.get(resto.id)!.precio - pisoPorFila.get(resto.id)!.piso } : null,
    // Nunca el JSON crudo de ML ni más de 500 caracteres del cuerpo.
    detalle: resumirResultadoMl(resultadoMl),
    error: error ? error.slice(0, 500) : null,
  }));

  return NextResponse.json({ filas: visibles, pagina, tamanoPagina: TAMANO_PAGINA, hayMas });
}

function leerFecha(valor: string | null): string | null {
  if (!valor || !/^\d{4}-\d{2}-\d{2}$/.test(valor)) return null;
  return Number.isNaN(new Date(`${valor}T00:00:00-05:00`).getTime()) ? null : valor;
}
