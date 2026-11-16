// Marco visual del panel — tipos compartidos entre MarcoApp,
// BarraLateral y BarraSuperior. Los ítems de navegación llegan ya
// filtrados por permiso desde app/panel/layout.tsx (misma regla de
// siempre, tienePermiso(...)) — estos componentes solo los pintan,
// nunca deciden quién ve qué.
export type ClaveIcono =
  | "inicio"
  | "pedidos"
  | "despachos"
  | "sku"
  | "productos"
  | "inventario"
  | "bodegas"
  | "investigacion"
  | "publicar"
  | "finanzas"
  | "publicidad"
  | "promociones"
  | "configuracion"
  | "actividad"
  | "personas"
  | "invitar"
  | "roles"
  | "soporte"
  | "foro"
  | "conectarMl"
  | "avisosMl"
  | "cuenta"
  | "crearEmpresa"
  | "empresas"
  | "metricas"
  | "auditoria"
  | "equipoAdmin";

// "activa" no es un campo acá: el layout de servidor que construye
// estos ítems no conoce la ruta real (se repiten en todas las
// subpáginas de /panel) — ItemNavLink.tsx la calcula en el cliente
// con usePathname().
export type ItemNav = {
  etiqueta: string;
  href: string;
  icono: ClaveIcono;
  deshabilitada?: boolean;
  titulo?: string;
  // Un módulo que agrupa varias pantallas (Productos) se despliega en
  // el menú con estas secciones. Con barra contraída o pantalla
  // angosta no hay lugar para la lista: el ítem lleva a `href`.
  hijos?: SubitemNav[];
};

export type SubitemNav = { etiqueta: string; href: string };

export type GrupoNav = {
  // Sin etiqueta = grupo principal, sin encabezado. Con etiqueta
  // ("ADMINISTRACIÓN") se pinta como encabezado chico en mayúsculas.
  etiqueta?: string;
  items: ItemNav[];
};

export type EmpresaSelector = { id: string; nombre: string };

export type DatosUsuario = { nombre: string; imagenUrl: string | null };
