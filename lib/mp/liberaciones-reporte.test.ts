import { afterEach, describe, expect, it, vi } from "vitest";
import {
  asegurarConfigReporteLiberaciones,
  COLUMNAS_MINIMAS_LIBERACIONES,
  consultarTareaReporteLiberaciones,
  descargarReporteLiberaciones,
  ErrorLiberacionesMp,
  esNombreReporteValido,
  extraerSaldoDeCsvLiberaciones,
  listarReportesLiberaciones,
  montoADosDecimales,
  rangoReporteLiberaciones,
  solicitarReporteLiberaciones,
  URL_REPORTE_LIBERACIONES,
} from "./liberaciones-reporte";

// Issue #422 — Reporte de Liberaciones de Mercado Pago.

describe("extraerSaldoDeCsvLiberaciones", () => {
  it("coma: fila total con BALANCE_AMOUNT", () => {
    const csv = [
      "DATE,SOURCE_ID,DESCRIPTION,RECORD_TYPE,NET_CREDIT_AMOUNT,NET_DEBIT_AMOUNT,BALANCE_AMOUNT,CURRENCY",
      "2026-11-20T10:00:00.000-05:00,1,initial_available_balance,initial_available_balance,0.00,0.00,1000.00,COP",
      "2026-11-21T15:30:00.000-05:00,2,payment,release,500.50,0.00,1500.50,COP",
      ",,,total,500.50,0.00,1500.50,COP",
    ].join("\n");
    expect(extraerSaldoDeCsvLiberaciones(csv)).toEqual({ saldo: "1500.50", moneda: "COP", fecha: "2026-11-21" });
  });

  it("punto y coma, BOM, CRLF y encabezados en minúsculas", () => {
    const csv = "﻿date;record_type;net_credit_amount;net_debit_amount;balance_amount;currency\r\n2026-11-22;release;10,00;0,00;1.234,56;mxn\r\n;Total;10,00;0,00;1.234,56;MXN\r\n";
    expect(extraerSaldoDeCsvLiberaciones(csv)).toEqual({ saldo: "1234.56", moneda: "MXN", fecha: "2026-11-22" });
  });

  it("fila total sin BALANCE_AMOUNT: NET_CREDIT − NET_DEBIT", () => {
    const csv = [
      "DATE,RECORD_TYPE,NET_CREDIT_AMOUNT,NET_DEBIT_AMOUNT,BALANCE_AMOUNT,CURRENCY",
      "2026-11-21,release,300.00,0.00,,COP",
      ",total,300.00,450.25,,COP",
    ].join("\n");
    expect(extraerSaldoDeCsvLiberaciones(csv)).toEqual({ saldo: "-150.25", moneda: "COP", fecha: "2026-11-21" });
  });

  it("sin fila total: último BALANCE_AMOUNT numérico no vacío", () => {
    const csv = [
      "DATE,RECORD_TYPE,BALANCE_AMOUNT,CURRENCY",
      "2026-11-19,release,100,COP",
      "2026-11-20,release,250.5,COP",
      "2026-11-21,withdrawal,,COP",
    ].join("\n");
    expect(extraerSaldoDeCsvLiberaciones(csv)).toEqual({ saldo: "250.50", moneda: "COP", fecha: "2026-11-21" });
  });

  it("sin columna CURRENCY: COP por defecto; con comillas en la descripción", () => {
    const csv = 'DATE,DESCRIPTION,RECORD_TYPE,BALANCE_AMOUNT\n2026-11-21,"Pago, con coma",release,"75.00"\n';
    expect(extraerSaldoDeCsvLiberaciones(csv)).toEqual({ saldo: "75.00", moneda: "COP", fecha: "2026-11-21" });
  });

  it("CURRENCY presente pero inválida: sin datos (no se adivina la moneda)", () => {
    expect(extraerSaldoDeCsvLiberaciones("RECORD_TYPE,BALANCE_AMOUNT,CURRENCY\ntotal,10,pesos\n")).toBeNull();
  });

  it("CSV vacío o inválido: null", () => {
    expect(extraerSaldoDeCsvLiberaciones("")).toBeNull();
    expect(extraerSaldoDeCsvLiberaciones("﻿")).toBeNull();
    expect(extraerSaldoDeCsvLiberaciones("DATE,RECORD_TYPE,BALANCE_AMOUNT\n")).toBeNull();
    expect(extraerSaldoDeCsvLiberaciones("FOO,BAR\n1,2\n")).toBeNull();
    expect(extraerSaldoDeCsvLiberaciones("RECORD_TYPE,BALANCE_AMOUNT\nrelease,abc\n")).toBeNull();
  });

  it("montos: siempre 2 decimales, redondeo y separadores", () => {
    expect(montoADosDecimales("1234")).toBe("1234.00");
    expect(montoADosDecimales("1,234.565")).toBe("1234.57");
    expect(montoADosDecimales("-0.001")).toBe("0.00");
    expect(montoADosDecimales("1.234.567,8")).toBe("1234567.80");
    expect(montoADosDecimales("")).toBeNull();
    expect(montoADosDecimales("1e3")).toBeNull();
  });
});

describe("rangoReporteLiberaciones", () => {
  it("7 días hasta now − 2 min, en UTC y nunca futuro", () => {
    expect(rangoReporteLiberaciones(new Date("2026-11-26T12:00:00.500Z"))).toEqual({
      beginDateIso: "2026-11-19T11:58:00Z",
      endDateIso: "2026-11-26T11:58:00Z",
    });
  });
});

describe("llamadas a Mercado Pago", () => {
  afterEach(() => vi.unstubAllGlobals());

  function respuestas(...lista: Response[]) {
    const fetchMock = vi.fn();
    for (const r of lista) fetchMock.mockResolvedValueOnce(r);
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }

  it("config 200: no se sobreescribe", async () => {
    const fetchMock = respuestas(new Response(JSON.stringify({ columns: [{ key: "DATE" }] }), { status: 200 }));
    await expect(asegurarConfigReporteLiberaciones("tok")).resolves.toBe("existente");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`${URL_REPORTE_LIBERACIONES}/config`);
    expect(init).toMatchObject({ method: "GET", cache: "no-store", headers: { Authorization: "Bearer tok" } });
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it("config 404: POST con columnas mínimas y prefijo zilonix-release", async () => {
    const fetchMock = respuestas(new Response("{}", { status: 404 }), new Response("{}", { status: 201 }));
    await expect(asegurarConfigReporteLiberaciones("tok")).resolves.toBe("creada");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [url, init] = fetchMock.mock.calls[1];
    expect(url).toBe(`${URL_REPORTE_LIBERACIONES}/config`);
    expect(init.method).toBe("POST");
    const body = JSON.parse(init.body);
    expect(body.file_name_prefix).toBe("zilonix-release");
    expect(body.columns.map((c: { key: string }) => c.key)).toEqual([...COLUMNAS_MINIMAS_LIBERACIONES]);
  });

  it("config 404 y POST 409: la configuración ya existía", async () => {
    respuestas(new Response("{}", { status: 404 }), new Response("{}", { status: 409 }));
    await expect(asegurarConfigReporteLiberaciones("tok")).resolves.toBe("existente");
  });

  it("config 404 y POST 400/403: omitida con su status, sin lanzar", async () => {
    respuestas(new Response("{}", { status: 404 }), new Response("{}", { status: 400 }));
    await expect(asegurarConfigReporteLiberaciones("tok")).resolves.toEqual({ estado: "omitida", status: 400 });
    respuestas(new Response("{}", { status: 404 }), new Response("{}", { status: 403 }));
    await expect(asegurarConfigReporteLiberaciones("tok")).resolves.toEqual({ estado: "omitida", status: 403 });
  });

  it("config 404 y POST 500: mp_sin_config con status; 403 en el GET: mp_403 sin POST", async () => {
    respuestas(new Response("{}", { status: 404 }), new Response("{}", { status: 500 }));
    await expect(asegurarConfigReporteLiberaciones("tok")).rejects.toMatchObject({ codigo: "mp_sin_config", status: 500 });
    const fetchMock = respuestas(new Response("{}", { status: 403 }));
    await expect(asegurarConfigReporteLiberaciones("tok")).rejects.toMatchObject({ codigo: "mp_403" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("red caída: mp_red", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("boom")));
    await expect(listarReportesLiberaciones("tok")).rejects.toBeInstanceOf(ErrorLiberacionesMp);
  });

  it("solicitar: devuelve file_name o id de la tarea", async () => {
    const fetchMock = respuestas(
      new Response(JSON.stringify({ file_name: "zilonix-release-1.csv" }), { status: 202 }),
      new Response(JSON.stringify({ id: 987, status: "pending" }), { status: 202 })
    );
    await expect(solicitarReporteLiberaciones("tok", "a", "b")).resolves.toEqual({ fileName: "zilonix-release-1.csv" });
    await expect(solicitarReporteLiberaciones("tok", "a", "b")).resolves.toEqual({ taskId: "987" });
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ begin_date: "a", end_date: "b" });
  });

  it("solicitar: 203 = reporte no creado (error con status); 400 lleva su status", async () => {
    respuestas(new Response("{}", { status: 203 }), new Response("{}", { status: 400 }));
    await expect(solicitarReporteLiberaciones("tok", "a", "b")).rejects.toMatchObject({ codigo: "mp_reporte_no_creado", status: 203 });
    await expect(solicitarReporteLiberaciones("tok", "a", "b")).rejects.toMatchObject({ codigo: "mp_http", status: 400 });
  });

  it("consultar tarea: processed con file_name, pending y failed", async () => {
    const fetchMock = respuestas(
      new Response(JSON.stringify({ id: 987, status: "processed", file_name: "zilonix-release-1.csv" }), { status: 200 }),
      new Response(JSON.stringify({ id: 987, status: "pending" }), { status: 200 }),
      new Response(JSON.stringify({ id: 987, status: "failed" }), { status: 200 })
    );
    await expect(consultarTareaReporteLiberaciones("tok", "987")).resolves.toEqual({ status: "processed", fileName: "zilonix-release-1.csv" });
    await expect(consultarTareaReporteLiberaciones("tok", "987")).resolves.toEqual({ status: "pending", fileName: null });
    await expect(consultarTareaReporteLiberaciones("tok", "987")).resolves.toEqual({ status: "failed", fileName: null });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`${URL_REPORTE_LIBERACIONES}/task/987`);
    expect(init).toMatchObject({ method: "GET", cache: "no-store" });
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it("consultar tarea: error HTTP con status", async () => {
    respuestas(new Response("{}", { status: 404 }));
    await expect(consultarTareaReporteLiberaciones("tok", "987")).rejects.toMatchObject({ codigo: "mp_404", status: 404 });
  });

  it("descargar: rechaza file_name '.', '..' y con '/' sin llamar a Mercado Pago", async () => {
    const fetchMock = respuestas();
    for (const malo of [".", "..", "../config", "a/b.csv", ""]) {
      await expect(descargarReporteLiberaciones("tok", malo)).rejects.toBeInstanceOf(ErrorLiberacionesMp);
    }
    expect(fetchMock).not.toHaveBeenCalled();
    expect(esNombreReporteValido("zilonix-release-2026_11.csv")).toBe(true);
  });

  it("listar: solo reportes con file_name; con status, solo processed está listo", async () => {
    respuestas(
      new Response(
        JSON.stringify([
          { id: 1, file_name: "a.csv", date_created: "2026-11-26T10:00:00Z" },
          { id: 2, file_name: "b.csv", status: "pending" },
          { id: 3 },
          { id: 4, file_name: "c.csv", status: "processed" },
          { id: 5, file_name: "d.csv", status: "processing" },
          { id: 6, file_name: "e.csv", status: "failed" },
          { id: 7, file_name: "f.csv", status: "deleted" },
        ]),
        { status: 200 }
      )
    );
    const lista = await listarReportesLiberaciones("tok");
    expect(lista.map((r) => [r.fileName, r.listo])).toEqual([
      ["a.csv", true],
      ["b.csv", false],
      ["c.csv", true],
      ["d.csv", false],
      ["e.csv", false],
      ["f.csv", false],
    ]);
    expect(lista[0]).toEqual({ id: "1", fileName: "a.csv", creadoTs: new Date("2026-11-26T10:00:00Z"), listo: true });
  });
});
