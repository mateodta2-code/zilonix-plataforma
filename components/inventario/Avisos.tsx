import { BotonLink } from "@/components/marco/Boton";
import styles from "@/app/panel/inventario/inventario.module.css";

// Issue #280 — avisos que dejan las Server Actions en la URL (?ok= /
// ?error=) y la barra de secciones de inventario. React escapa el
// texto: un ?error= armado a mano nunca se pinta como HTML.
export function AvisosUrl({ searchParams }: { searchParams: Record<string, string | string[] | undefined> }) {
  const error = typeof searchParams.error === "string" ? searchParams.error.slice(0, 300) : null;
  const ok = typeof searchParams.ok === "string" ? searchParams.ok.slice(0, 300) : null;
  return (
    <>
      {error && (
        <div className={styles.avisoError} role="alert">
          {error}
        </div>
      )}
      {ok && <div className={styles.avisoOk}>{ok}</div>}
    </>
  );
}

const SECCIONES = [
  { href: "/panel/inventario", etiqueta: "Stock" },
  { href: "/panel/inventario/kardex", etiqueta: "Kardex" },
  { href: "/panel/inventario/ingresos", etiqueta: "Ingresos" },
  { href: "/panel/inventario/compras", etiqueta: "Órdenes de compra" },
  { href: "/panel/bodegas", etiqueta: "Bodegas" },
  { href: "/panel/inventario/configuracion", etiqueta: "Configuración" },
] as const;

export function SeccionesInventario({ actual }: { actual: (typeof SECCIONES)[number]["href"] }) {
  return (
    <nav className={styles.subnav} aria-label="Secciones de inventario">
      {SECCIONES.map((s) => (
        <BotonLink key={s.href} href={s.href} variante={s.href === actual ? "primario" : "secundario"} chico>
          {s.etiqueta}
        </BotonLink>
      ))}
    </nav>
  );
}
