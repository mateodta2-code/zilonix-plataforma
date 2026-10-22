// Marco visual del panel — tipos compartidos entre MarcoApp,
// BarraLateral y BarraSuperior. Los ítems de navegación llegan ya
// filtrados por permiso desde app/panel/page.tsx (misma regla de
// siempre, tienePermiso(...)) — estos componentes solo los pintan,
// nunca deciden quién ve qué.
export type ClaveIcono =
  | "inicio"
  | "pedidos"
  | "despachos"
  | "sku"
  | "finanzas"
  | "actividad"
  | "personas"
  | "invitar"
  | "roles"
  | "soporte"
  | "conectarMl"
  | "avisosMl"
  | "cuenta"
  | "crearEmpresa";

export type ItemNav = {
  etiqueta: string;
  href: string;
  icono: ClaveIcono;
  activa: boolean;
  deshabilitada?: boolean;
  titulo?: string;
};

export type GrupoNav = {
  // Sin etiqueta = grupo principal, sin encabezado. Con etiqueta
  // ("ADMINISTRACIÓN") se pinta como encabezado chico en mayúsculas.
  etiqueta?: string;
  items: ItemNav[];
};

export type EmpresaSelector = { id: string; nombre: string };

export type DatosUsuario = { nombre: string; imagenUrl: string | null };
