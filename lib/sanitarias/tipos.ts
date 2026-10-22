// Issue #61 (Z-NV-03a) — tipos compartidos del port de
// lib/alertas-sanitarias.js (zilonix-os, autor Frankie). Reflejan las
// columnas reales de sanitarias_alertas/sanitarias_publicaciones/
// sanitarias_registros en ese repo — acá no hay ninguna tabla propia,
// solo los tipos para que las funciones puras de este módulo compilen.

export type ProductoDeAlerta = {
  producto: string;
  registro: string;
  titular: string;
  lote: string;
};

export type AlertaInvima = {
  slug: string;
  numero: string | null;
  direccion: string | null;
  titulo: string;
  motivo: string | null;
  fecha: string | null;
  pdf: string | null;
  productos: ProductoDeAlerta[];
  problema: string;
  con_detalle: boolean;
  visto?: string | Date | null;
};

export type PublicacionConsumible = {
  item_id: string;
  alias: string;
  sku: string | null;
  titulo: string | null;
  permalink: string | null;
  marca: string | null;
  nombre_comercial: string | null;
  dominio: string | null;
  imagen: string | null;
  registros: string[];
};

export type FilaRegistroInvima = {
  rsynso: string;
  producto: string;
  estado: string;
  vence: string | null;
  titular: string;
  grupo: string;
};

export type RegistroSanitario = {
  registro: string;
  estado: string; // "Vigente" | "Vencido" | "NO_APARECE" | "ERROR"
  filas: FilaRegistroInvima[];
};

export type RevisionManual = { estado: string; nota: string; por?: string | null; cuando?: string | Date };
export type VeredictoFoto = { veredicto: string; explicacion: string; creado?: string | Date };

export type ResumenAlerta = {
  slug: string;
  numero: string | null;
  fecha: string | null;
  motivo: string | null;
  titulo: string;
  direccion: string | null;
  url: string;
  pdf: string | null;
  productos: string[];
  nueva: boolean;
};

export type AlertaPreparada = {
  a: AlertaInvima;
  texto: string;
  regs: Set<string>;
  nombres: string[];
};

export type ProductoPreparado = {
  registros: string[];
  marcas: string[];
  nuestras: Set<string>;
  marcasPropias: string[];
  palabrasNuestras: Set<string>;
};

export type NivelCoincidencia = "seguro" | "marca" | "nombre";
export type Coincidencia = { nivel: NivelCoincidencia; detalle: string };

export type TipoHallazgo = "alerta" | "vencido" | "otroProducto" | "noAparece" | "sinRegistro";
export type NivelHallazgo = "seguro" | "marca" | "raro" | "nombre" | "revisar" | "normal";

export type InvimaResumenFila = { producto: string; titular: string; estado: string; vence: string | null; grupo: string };

export type Hallazgo = {
  clave: string;
  tipo: TipoHallazgo;
  nivel: NivelHallazgo;
  sku: string;
  titulo: string;
  marcas: string[];
  imagen: string | null;
  cuentas: string[];
  publicaciones: Array<{ item_id: string; alias: string; titulo: string | null; permalink: string | null; sku: string | null }>;
  detalle: string;
  alerta: ResumenAlerta | null;
  registro: string | null;
  invima: InvimaResumenFila | null;
  foto: VeredictoFoto | null;
  revision: RevisionManual | null;
};
