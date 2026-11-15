import { randomUUID } from "crypto";
import { describe, expect, it, beforeAll } from "vitest";
import { dbComoEmpresa } from "@/db/empresa-context";
import {
  cuentasMl,
  publicidadAnuncios,
  publicidadCampanas,
  publicidadCostosItem,
  publicidadMetricasDiarias,
} from "@/db/schema";
import { crearDosEmpresas, type ContextoDosEmpresas } from "@/db/test-utils/aislamiento";
import { cifrarToken } from "@/lib/cifrado";
import { consultarTableroPublicidad } from "@/lib/publicidad/consultas";
import { totalesDeDias, type Periodo } from "@/lib/publicidad/kpis";

// Issue #255 — las consultas del tablero respetan el aislamiento y los
// totales coinciden con la suma de publicidad_metricas_diarias del nivel
// campaña (no el nivel cuenta, que la sincronización puede no guardar).

const PERIODO: Periodo = {
  mes: "2026-10",
  desde: "2026-10-01",
  hasta: "2026-10-02",
  comparacionDesde: "2026-09-01",
  comparacionHasta: "2026-09-02",
  incluyeHoy: false,
  esMesEnCurso: false,
};

const AHORA = new Date("2026-10-29T15:00:00-05:00");

describe("consultas del tablero de publicidad (issue #255)", () => {
  let contexto: ContextoDosEmpresas;
  let cuentaAId: string;
  let cuentaBId: string;

  beforeAll(async () => {
    contexto = await crearDosEmpresas();
    const token = () => ({
      accessTokenCifrado: cifrarToken("access-tablero"),
      refreshTokenCifrado: cifrarToken("refresh-tablero"),
      tokenExpiraTs: new Date(Date.now() + 3_600_000),
    });
    const [cuentaA] = await dbComoEmpresa(contexto.empresaAId, (tx) =>
      tx
        .insert(cuentasMl)
        .values({
          empresaId: contexto.empresaAId,
          cuentaIdExterna: `ml-tablero-a-${randomUUID()}`,
          nickname: "TABLERO_A",
          ...token(),
        })
        .returning({ id: cuentasMl.id })
    );
    const [cuentaB] = await dbComoEmpresa(contexto.empresaBId, (tx) =>
      tx
        .insert(cuentasMl)
        .values({
          empresaId: contexto.empresaBId,
          cuentaIdExterna: `ml-tablero-b-${randomUUID()}`,
          nickname: "TABLERO_B",
          ...token(),
        })
        .returning({ id: cuentasMl.id })
    );
    cuentaAId = cuentaA.id;
    cuentaBId = cuentaB.id;

    await dbComoEmpresa(contexto.empresaAId, (tx) =>
      tx.insert(publicidadCampanas).values([
        {
          empresaId: contexto.empresaAId,
          cuentaMlId: cuentaAId,
          campanaIdMl: "c-activa",
          nombre: "Activa",
          estado: "active",
          roasObjetivo: "2.00",
          presupuestoDiario: "50000.00",
          creadaMlTs: new Date("2026-09-01T12:00:00-05:00"),
          actualizadaMlTs: new Date("2026-09-01T12:00:00-05:00"),
        },
        {
          empresaId: contexto.empresaAId,
          cuentaMlId: cuentaAId,
          campanaIdMl: "c-pausa",
          nombre: "Pausa",
          estado: "paused",
          creadaMlTs: new Date("2026-09-01T12:00:00-05:00"),
          actualizadaMlTs: new Date("2026-09-01T12:00:00-05:00"),
        },
      ])
    );
    await dbComoEmpresa(contexto.empresaBId, (tx) =>
      tx.insert(publicidadCampanas).values({
        empresaId: contexto.empresaBId,
        cuentaMlId: cuentaBId,
        campanaIdMl: "c-b",
        nombre: "De B",
        estado: "active",
      })
    );

    await dbComoEmpresa(contexto.empresaAId, (tx) =>
      tx.insert(publicidadAnuncios).values({
        empresaId: contexto.empresaAId,
        cuentaMlId: cuentaAId,
        adGroupId: "g1",
        campanaIdMl: "c-activa",
        itemId: "MCO123456",
        titulo: "Publicación A",
        precio: null,
      })
    );
    await dbComoEmpresa(contexto.empresaAId, (tx) =>
      tx.insert(publicidadCostosItem).values({
        empresaId: contexto.empresaAId,
        cuentaMlId: cuentaAId,
        itemId: "MCO123456",
        fecha: "2026-10-02",
        precioVentaVigente: "100000.00",
      })
    );

    const metrica = (
      empresaId: string,
      cuentaMlId: string,
      nivel: "cuenta" | "campana" | "anuncio",
      entidadIdMl: string,
      fecha: string,
      costo: string,
      montoTotal: string,
      organico: string,
      clicks: number,
      adGroupId = ""
    ) => ({
      empresaId,
      cuentaMlId,
      nivel,
      entidadIdMl,
      adGroupId,
      fecha,
      costo,
      montoTotal,
      ventasOrganicasMonto: organico,
      clicks,
      impresiones: clicks * 10,
    });

    await dbComoEmpresa(contexto.empresaAId, (tx) =>
      tx.insert(publicidadMetricasDiarias).values([
        metrica(contexto.empresaAId, cuentaAId, "campana", "c-activa", "2026-10-01", "10.00", "40.00", "10.00", 4),
        metrica(contexto.empresaAId, cuentaAId, "campana", "c-activa", "2026-10-02", "15.00", "20.00", "5.00", 6),
        metrica(contexto.empresaAId, cuentaAId, "cuenta", "cuenta", "2026-10-01", "9999.00", "9999.00", "9999.00", 99),
        metrica(contexto.empresaAId, cuentaAId, "anuncio", "MCO123456", "2026-10-01", "4000.00", "0.00", "0.00", 8, "g1"),
      ])
    );
    await dbComoEmpresa(contexto.empresaBId, (tx) =>
      tx.insert(publicidadMetricasDiarias).values([
        metrica(contexto.empresaBId, cuentaBId, "campana", "c-b", "2026-10-01", "999.00", "1.00", "0.00", 1),
      ])
    );
  });

  it("empresa A no ve las filas de B, y los totales son la suma del nivel campaña", async () => {
    const tablero = await consultarTableroPublicidad(contexto.empresaAId, cuentaAId, PERIODO, {
      incluirPausadas: false,
      orden: "inversion",
      dir: "desc",
      ahora: AHORA,
    });
    expect(tablero.campanas.map((c) => c.nombre)).toEqual(["Activa"]);
    expect(tablero.cantidadPausadas).toBe(1);
    expect(tablero.resumen.actual.gasto).toBe("25.00");
    expect(tablero.resumen.actual.ventasPublicidad).toBe("60.00");
    expect(tablero.resumen.actual.ventasOrganicas).toBe("15.00");
    expect(tablero.resumen.actual.ventasTotales).toBe("75.00");
    expect(tablero.resumen.actual.clicks).toBe("10");
    expect(tablero.resumen.actual.roas).toBe("2.40");
    expect(tablero.campanas[0].totales.gasto).toBe("25.00");

    const esperado = totalesDeDias([
      { costo: "10.00", montoTotal: "40.00", ventasOrganicasMonto: "10.00", clicks: 4, impresiones: 40 },
      { costo: "15.00", montoTotal: "20.00", ventasOrganicasMonto: "5.00", clicks: 6, impresiones: 60 },
    ]);
    expect(tablero.resumen.actual).toEqual(esperado);

    const deB = await consultarTableroPublicidad(contexto.empresaBId, cuentaBId, PERIODO, {
      incluirPausadas: true,
      orden: "inversion",
      dir: "desc",
      ahora: AHORA,
    });
    expect(deB.campanas.map((c) => c.nombre)).toEqual(["De B"]);
    expect(deB.resumen.actual.gasto).toBe("999.00");
    expect(deB.campanas.some((c) => c.nombre === "Activa")).toBe(false);

    const cruce = await consultarTableroPublicidad(contexto.empresaBId, cuentaAId, PERIODO, {
      incluirPausadas: true,
      orden: "campana",
      dir: "asc",
      ahora: AHORA,
    });
    expect(cruce.campanas).toEqual([]);
    expect(cruce.resumen.actual.gasto).toBeNull();
    expect(cruce.anunciante).toBeNull();
  });

  it("el anuncio sin precio usa el último precio vigente y no suma su gasto al total de la cuenta", async () => {
    const tablero = await consultarTableroPublicidad(contexto.empresaAId, cuentaAId, PERIODO, {
      incluirPausadas: false,
      orden: "inversion",
      dir: "desc",
      ahora: AHORA,
    });
    const anuncio = tablero.campanas[0].anuncios[0];
    expect(anuncio.itemId).toBe("MCO123456");
    expect(anuncio.precio).toBe("100000.00");
    expect(anuncio.href).toBe("https://articulo.mercadolibre.com.co/MCO-123456");
    expect(anuncio.totales.gasto).toBe("4000.00");
    expect(anuncio.semaforo.estado).toBe("exito");
    expect(tablero.resumen.actual.gasto).toBe("25.00");
  });

  it("con el conmutador apagado la pausada no sale; prendido, sí", async () => {
    const conPausadas = await consultarTableroPublicidad(contexto.empresaAId, cuentaAId, PERIODO, {
      incluirPausadas: true,
      orden: "campana",
      dir: "asc",
      ahora: AHORA,
    });
    expect(conPausadas.campanas.map((c) => c.nombre).sort()).toEqual(["Activa", "Pausa"]);
    expect(conPausadas.campanas.find((c) => c.nombre === "Pausa")?.diagnostico.tipo).toBe("sin_datos");
  });
});
