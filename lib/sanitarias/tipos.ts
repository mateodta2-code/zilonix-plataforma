// Formas que ya usa el OS al calcular hallazgos. Los nombres de campo
// siguen el de las filas (con_detalle, nombre_comercial) para que la tarea
// que guarde en Postgres pueda pasarlas sin renombrar.

export type ProductoAlerta = {
  producto?: string | null;
  registro?: string | null;
  titular?: string | null;
  lote?: string | null;
};

export type AlertaEntrada = {
  slug: string;
  numero?: string | null;
  direccion?: string | null;
  titulo?: string | null;
  tipo?: string | null;
  motivo?: string | null;
  fecha?: string | null;
  pdf?: string | null;
  productos?: ProductoAlerta[] | null;
  problema?: string | null;
  con_detalle?: boolean | null;
  visto?: string | Date | null;
};

export type PublicacionEntrada = {
  item_id: string;
  alias?: string | null;
  sku?: string | null;
  titulo?: string | null;
  permalink?: string | null;
  marca?: string | null;
  nombre_comercial?: string | null;
  dominio?: string | null;
  imagen?: string | null;
  registros?: string[] | null;
};

export type FilaRegistroInvima = {
  rsynso?: string | null;
  producto?: string | null;
  estado?: string | null;
  vence?: string | null;
  titular?: string | null;
  grupo?: string | null;
};

export type RegistroEntrada = {
  registro: string;
  estado: string;
  filas?: FilaRegistroInvima[] | null;
};

export type RevisionHallazgo = {
  estado: string;
  nota?: string;
  por?: string | null;
  cuando?: string | Date | null;
};

export type FotoHallazgo = {
  veredicto: string;
  explicacion?: string;
  creado?: string | Date | null;
  modelo?: string | null;
};

export type ResumenAlerta = {
  slug: string;
  numero: string | null | undefined;
  fecha: string | null | undefined;
  motivo: string | null | undefined;
  titulo: string | null | undefined;
  direccion: string | null | undefined;
  url: string;
  pdf: string | null;
  productos: string[];
  nueva: boolean;
};

export type PublicacionHallazgo = {
  item_id: string;
  alias: string | null | undefined;
  titulo: string | null | undefined;
  permalink: string | null | undefined;
  sku: string | null | undefined;
};

export type InvimaHallazgo = {
  producto: string | null | undefined;
  titular: string | null | undefined;
  estado: string | null | undefined;
  vence: string | null | undefined;
  grupo: string | null | undefined;
};

export type Hallazgo = {
  clave: string;
  tipo: string;
  nivel: string;
  sku: string;
  titulo: string;
  marcas: string[];
  imagen: string | null;
  cuentas: string[];
  publicaciones: PublicacionHallazgo[];
  detalle: string;
  alerta: ResumenAlerta | null;
  registro: string | null;
  invima: InvimaHallazgo | null;
  foto: FotoHallazgo | null;
  revision: RevisionHallazgo | null;
};
