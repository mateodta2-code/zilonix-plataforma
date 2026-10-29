// Rama feat-promociones — tipos espejo de las respuestas JSON de
// app/api/ml/promociones/* para usar del lado del cliente sin
// importar nada del servidor (mismo criterio que
// app/panel/publicar/clip/tipos-cliente.ts).
export type CandidatoClienteCliente = {
  id: string;
  cuentaMlId: string;
  nicknameCuenta: string;
  itemId: string;
  skuCodigo: string | null;
  tituloProducto: string | null;
  thumbnail: string | null;
  tieneVariantes: boolean;
  tipoPromocion: string;
  estadoMl: string;
  esCompartida: boolean;
  soloEnMl: boolean;
  precioOriginal: string | null;
  precioActual: string | null;
  precioMinimo: string | null;
  precioSugerido: string | null;
  gananciaEstimada: string | null;
  cumpleReglas: boolean;
  motivoRevisarManual: string | null;
  actualizadoTs: string;
};

export type EstadoCuentaBusquedaCliente = "en_cola" | "buscando" | "listo" | "error";
export type ProgresoCuentaBusquedaCliente = {
  cuentaId: string;
  nickname: string;
  estado: EstadoCuentaBusquedaCliente;
  productosRevisados: number;
  itemsConPromociones: number;
  // Code review de Pablo — MED 8: true si la paginación por offset de
  // Mercado Libre cortó antes de terminar el catálogo real de esta
  // cuenta (ver listarTodosLosItemsActivos en lib/ml/promociones.ts).
  catalogoIncompleto: boolean;
  error: string | null;
};
export type TrabajoBusquedaCliente = { id: string; empresaId: string; creadoTs: number; terminadoTs: number | null; cuentas: ProgresoCuentaBusquedaCliente[] };

export type ReglasCuentaCliente = {
  cuentaId: string;
  nickname: string;
  descuentoMaximoPct: number;
  participarCompartidas: boolean;
  igualarAlPiso: boolean;
  busquedaAutomaticaHora: string | null;
};

export type AccionHistorialCliente = {
  id: string;
  cuentaMlId: string;
  nicknameCuenta: string;
  itemId: string;
  tituloProducto: string | null;
  tipoPromocion: string;
  accion: "participar" | "modificar" | "salir";
  precioAntes: string | null;
  precioDespues: string | null;
  estado: "pendiente" | "aceptada" | "rechazada" | "ejecutada" | "fallida";
  aprobadoPor: string | null;
  aprobadoTs: string | null;
  ejecutadoTs: string | null;
  modoSimulacion: boolean;
  error: string | null;
  creadoTs: string;
};
