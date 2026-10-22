// Alertas sanitarias (Z-NV-03a): solo las funciones puras de
// lib/alertas-sanitarias.js del Zilonix OS. Sin tokens, sin Mercado Libre,
// sin fetch y sin base de datos — eso es Z-NV-03b.

export { esConsumible, type ConfigConsumibles } from "./consumibles";
export { leerDetalleAlerta, leerTarjetasListado, type DetalleAlerta, type ProductoDetalle, type TarjetaListado } from "./html-invima";
export {
  TIPOS,
  calcularHallazgos,
  coincidenciaConAlerta,
  prepararAlertas,
  prepararProducto,
  resumenDeAlerta,
  type AlertaPreparada,
  type CoincidenciaAlerta,
  type EntradaHallazgos,
  type ProductoPreparado,
} from "./hallazgos";
export { clavesDistintivas, extraerRegistros, formatoRaro, normalizar, palabrasDelNombre, partesRegistro } from "./texto";
export type {
  AlertaEntrada,
  FilaRegistroInvima,
  FotoHallazgo,
  Hallazgo,
  InvimaHallazgo,
  ProductoAlerta,
  PublicacionEntrada,
  PublicacionHallazgo,
  RegistroEntrada,
  ResumenAlerta,
  RevisionHallazgo,
} from "./tipos";
