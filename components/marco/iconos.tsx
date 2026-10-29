// Íconos de línea, SVG inline — sin librería nueva (lucide-react ni
// ninguna otra). Mismo trazo en todos (stroke actual del texto,
// 1.6px, esquinas redondeadas) para que se vean de la misma familia.
export type IconoProps = { size?: number; className?: string };

const base = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.6,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

function Svg({ size = 18, className, children }: IconoProps & { children: React.ReactNode }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} aria-hidden="true" {...base}>
      {children}
    </svg>
  );
}

export function IconoInicio(props: IconoProps) {
  return (
    <Svg {...props}>
      <path d="M4 11.5 12 4l8 7.5" />
      <path d="M6 10v9h12v-9" />
      <path d="M10 19v-5h4v5" />
    </Svg>
  );
}

export function IconoPedidos(props: IconoProps) {
  return (
    <Svg {...props}>
      <path d="M4 7.5 12 4l8 3.5v9L12 20l-8-3.5z" />
      <path d="M4 7.5 12 11l8-3.5" />
      <path d="M12 11v9" />
    </Svg>
  );
}

export function IconoDespachos(props: IconoProps) {
  return (
    <Svg {...props}>
      <path d="M3 7h10v9H3z" />
      <path d="M13 11h4l3 3v2h-7z" />
      <circle cx="7" cy="18.5" r="1.6" />
      <circle cx="17" cy="18.5" r="1.6" />
    </Svg>
  );
}

export function IconoSku(props: IconoProps) {
  return (
    <Svg {...props}>
      <path d="M11 4h4l6 6-9 9-9-9z" />
      <circle cx="13.5" cy="7.5" r="1.1" fill="currentColor" stroke="none" />
    </Svg>
  );
}

// Issue #280 — bodega: galpón con portón.
export function IconoBodegas(props: IconoProps) {
  return (
    <Svg {...props}>
      <path d="M3 10 12 5l9 5v9H3z" />
      <path d="M7 19v-6h10v6" />
      <path d="M7 16h10" />
    </Svg>
  );
}

// Issue #280 — inventario: cajas apiladas.
export function IconoInventario(props: IconoProps) {
  return (
    <Svg {...props}>
      <rect x="4" y="12" width="7" height="7" rx="1" />
      <rect x="13" y="12" width="7" height="7" rx="1" />
      <rect x="8.5" y="5" width="7" height="7" rx="1" />
    </Svg>
  );
}

export function IconoFinanzas(props: IconoProps) {
  return (
    <Svg {...props}>
      <path d="M4 20V11" />
      <path d="M10 20V6" />
      <path d="M16 20v-8" />
      <path d="M4 20h16" />
    </Svg>
  );
}

export function IconoActividad(props: IconoProps) {
  return (
    <Svg {...props}>
      <path d="M3 12h4l2-6 4 12 2-6h6" />
    </Svg>
  );
}

export function IconoPersonas(props: IconoProps) {
  return (
    <Svg {...props}>
      <circle cx="9" cy="8" r="3" />
      <path d="M3 20c0-3.3 2.7-5.5 6-5.5s6 2.2 6 5.5" />
      <path d="M16.5 7.2c1.3.3 2.3 1.5 2.3 2.8s-1 2.5-2.3 2.8" />
      <path d="M17.5 14.5c2.2.5 3.7 2.2 3.7 4" />
    </Svg>
  );
}

export function IconoInvitar(props: IconoProps) {
  return (
    <Svg {...props}>
      <circle cx="9" cy="8" r="3" />
      <path d="M3 20c0-3.3 2.7-5.5 6-5.5s6 2.2 6 5.5" />
      <path d="M18 8v5" />
      <path d="M15.5 10.5h5" />
    </Svg>
  );
}

export function IconoRoles(props: IconoProps) {
  return (
    <Svg {...props}>
      <path d="M12 3.5 19 6v6c0 4.5-3.2 7-7 8.5-3.8-1.5-7-4-7-8.5V6z" />
      <path d="M9.3 12 11 13.7l3.7-3.9" />
    </Svg>
  );
}

export function IconoSoporte(props: IconoProps) {
  return (
    <Svg {...props}>
      <circle cx="12" cy="12" r="8" />
      <circle cx="12" cy="12" r="3" />
      <path d="M6.3 6.3l3.3 3.3M18 6l-3.3 3.3M18 18l-3.3-3.3M6 18l3.3-3.3" />
    </Svg>
  );
}

export function IconoConectarMl(props: IconoProps) {
  return (
    <Svg {...props}>
      <path d="M9 15 15 9" />
      <path d="M11 6.5 13 4.3a3 3 0 0 1 4.3 4.3L15 10.7" />
      <path d="M13 17.5 11 19.7a3 3 0 0 1-4.3-4.3L9 13.3" />
    </Svg>
  );
}

export function IconoAvisosMl(props: IconoProps) {
  return (
    <Svg {...props}>
      <path d="M4 13 15 6v12L4 11" />
      <path d="M15 8.5h3a2.5 2.5 0 0 1 0 5h-3" />
      <path d="M7 13.2v3.3a1.6 1.6 0 0 0 3.2 0v-1.6" />
    </Svg>
  );
}

export function IconoCuenta(props: IconoProps) {
  return (
    <Svg {...props}>
      <circle cx="12" cy="8.5" r="3.3" />
      <path d="M5 20c0-3.6 3.1-6 7-6s7 2.4 7 6" />
    </Svg>
  );
}

export function IconoCrearEmpresa(props: IconoProps) {
  return (
    <Svg {...props}>
      <path d="M5 20V8l7-4 7 4v12" />
      <path d="M9 20v-5h6v5" />
      <path d="M12 3.5v4" />
      <path d="M10 5.5h4" />
    </Svg>
  );
}

export function IconoSol(props: IconoProps) {
  return (
    <Svg {...props}>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2.5v2.3M12 19.2v2.3M4.4 4.4l1.6 1.6M18 18l1.6 1.6M2.5 12h2.3M19.2 12h2.3M4.4 19.6 6 18M18 6l1.6-1.6" />
    </Svg>
  );
}

export function IconoLuna(props: IconoProps) {
  return (
    <Svg {...props}>
      <path d="M20 14.5A8.5 8.5 0 1 1 9.5 4 7 7 0 0 0 20 14.5z" />
    </Svg>
  );
}

export function IconoContraer(props: IconoProps) {
  return (
    <Svg {...props}>
      <rect x="3.5" y="4.5" width="17" height="15" rx="2" />
      <path d="M9.5 4.5v15" />
      <path d="M6.5 10.5 4.5 12l2 1.5" />
    </Svg>
  );
}

// Pedido de Pablo (tarea Investigación ML): lupa + barritas ascendentes
// adentro, para distinguirla de IconoBuscar (lupa sola, ya usada en la
// barra superior para el buscador de texto) y de IconoFinanzas (barras
// solas, sin lupa) — esta representa "investigar con datos", no un
// buscador de texto genérico ni las finanzas de la empresa.
export function IconoInvestigacion(props: IconoProps) {
  return (
    <Svg {...props}>
      <circle cx="10" cy="10" r="6.5" />
      <path d="M7.3 11.5v-2.3M10 11.5V6.8M12.7 11.5V9" />
      <path d="M19 19l-4.3-4.3" />
    </Svg>
  );
}

// Issue #254 — megáfono chico, distinto de Finanzas (barras) y de
// Investigación (lupa). La pantalla de campañas llega en la fase 2;
// el ítem del menú ya tiene que reconocerse.
export function IconoPublicidad(props: IconoProps) {
  return (
    <Svg {...props}>
      <path d="M4 10v4l8 3V7L4 10z" />
      <path d="M12 8.2c2.2.6 3.5 2 3.5 3.8S14.2 15.2 12 15.8" />
      <path d="M6.5 14.2 7.8 18" />
    </Svg>
  );
}

// ADENDO UX de Publicar — caja (el producto) con una flecha hacia
// arriba saliendo de ella (publicar = mandarlo hacia afuera, a
// Mercado Libre) — distinta de IconoSku (una etiqueta/tag) y de
// IconoPublicidad (megáfono), para que no se confundan en la barra
// lateral.
export function IconoPublicar(props: IconoProps) {
  return (
    <Svg {...props}>
      <path d="M4 10.5h16v9H4z" />
      <path d="M12 10.5V3.5" />
      <path d="M8.5 7 12 3.5 15.5 7" />
    </Svg>
  );
}

export function IconoBuscar(props: IconoProps) {
  return (
    <Svg {...props}>
      <circle cx="11" cy="11" r="6.5" />
      <path d="M20 20l-4.3-4.3" />
    </Svg>
  );
}

export function IconoCampana(props: IconoProps) {
  return (
    <Svg {...props}>
      <path d="M6 10.5a6 6 0 0 1 12 0v4l1.5 2.5h-15L6 14.5z" />
      <path d="M10 19.5a2 2 0 0 0 4 0" />
    </Svg>
  );
}

export function IconoLogo(props: IconoProps) {
  return (
    <Svg {...props}>
      <path d="M5 6h14L6 18h13" />
    </Svg>
  );
}

const MAPA_ICONOS: Record<string, (props: IconoProps) => React.ReactElement> = {
  inicio: IconoInicio,
  pedidos: IconoPedidos,
  despachos: IconoDespachos,
  sku: IconoSku,
  inventario: IconoInventario,
  bodegas: IconoBodegas,
  investigacion: IconoInvestigacion,
  publicar: IconoPublicar,
  finanzas: IconoFinanzas,
  publicidad: IconoPublicidad,
  actividad: IconoActividad,
  personas: IconoPersonas,
  invitar: IconoInvitar,
  roles: IconoRoles,
  soporte: IconoSoporte,
  conectarMl: IconoConectarMl,
  avisosMl: IconoAvisosMl,
  cuenta: IconoCuenta,
  crearEmpresa: IconoCrearEmpresa,
};

export function iconoDeClave(clave: keyof typeof MAPA_ICONOS, props?: IconoProps) {
  const Icono = MAPA_ICONOS[clave];
  return <Icono {...props} />;
}
