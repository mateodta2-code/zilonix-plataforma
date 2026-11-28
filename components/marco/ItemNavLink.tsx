"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { iconoDeClave } from "./iconos";
import styles from "./BarraLateral.module.css";
import type { ItemNav, SubitemNav } from "./tipos";

// BarraLateral (y su layout, app/panel/layout.tsx) corren una sola vez
// para TODAS las subrutas de /panel — un layout de servidor no sabe
// en qué subruta está parado. Este componente chico, aparte, es el
// único que necesita usePathname() para resaltar el ítem real.
function esRutaActiva(pathname: string | null, href: string): boolean {
  if (!pathname) return false;
  if (href === "/panel") return pathname === "/panel";
  return pathname === href || pathname.startsWith(`${href}/`);
}

// La sección activa es la de ruta más larga que coincide: en
// /panel/inventario/kardex coinciden "Inventario" y "Kardex", y solo
// Kardex tiene que quedar marcada.
// También cuentan las otrasRutas de cada sección (pantallas sin ítem
// propio), con el largo de la ruta que de verdad coincidió.
function hijoActivo(pathname: string | null, hijos: SubitemNav[]): string | null {
  let mejor: { href: string; largo: number } | null = null;
  for (const h of hijos) {
    for (const ruta of [h.href, ...(h.otrasRutas ?? [])]) {
      if (esRutaActiva(pathname, ruta) && (!mejor || ruta.length > mejor.largo)) mejor = { href: h.href, largo: ruta.length };
    }
  }
  return mejor?.href ?? null;
}

export function ItemNavLink({ item, colapsada }: { item: ItemNav; colapsada: boolean }) {
  const pathname = usePathname();

  if (item.deshabilitada) {
    return (
      <span className={styles.item} data-deshabilitado="true" title={item.titulo}>
        {iconoDeClave(item.icono, { size: 18 })}
        {!colapsada && <span className={styles.etiquetaItem}>{item.etiqueta}</span>}
      </span>
    );
  }

  if (item.hijos?.length) return <ItemConHijos item={item} hijos={item.hijos} colapsada={colapsada} pathname={pathname} />;

  return (
    <Link
      href={item.href}
      className={styles.item}
      data-activo={esRutaActiva(pathname, item.href) ? "true" : "false"}
      title={colapsada ? item.etiqueta : undefined}
    >
      {iconoDeClave(item.icono, { size: 18 })}
      {!colapsada && <span className={styles.etiquetaItem}>{item.etiqueta}</span>}
    </Link>
  );
}

// Módulo con secciones (Productos): al tocarlo se despliega la lista
// debajo, y arranca abierto si ya estás en una de sus pantallas.
// Contraído (o en pantalla angosta, por CSS) no hay lugar para la
// lista: se pinta como un link normal a `href`.
function ItemConHijos({ item, hijos, colapsada, pathname }: { item: ItemNav; hijos: SubitemNav[]; colapsada: boolean; pathname: string | null }) {
  const activo = hijoActivo(pathname, hijos);
  const [abierto, setAbierto] = useState(activo !== null);

  // Al entrar a una de sus pantallas desde otro lado del menú, se abre;
  // al salir del módulo, se cierra (abierto solo dentro de su ruta). Si
  // la persona lo abre a mano desde afuera, `activo` no cambia y queda
  // abierto.
  useEffect(() => {
    setAbierto(activo !== null);
  }, [activo]);

  const idLista = `submenu-${item.href.replace(/\W+/g, "-")}`;

  return (
    <div className={styles.conHijos}>
      <Link
        href={item.href}
        className={`${styles.item} ${colapsada ? "" : styles.soloAngosto}`}
        data-activo={activo !== null ? "true" : "false"}
        title={item.etiqueta}
      >
        {iconoDeClave(item.icono, { size: 18 })}
        {!colapsada && <span className={styles.etiquetaItem}>{item.etiqueta}</span>}
      </Link>
      {!colapsada && (
        <>
          <button
            type="button"
            className={`${styles.item} ${styles.botonDesplegar} ${styles.soloAncho}`}
            data-activo={activo !== null ? "true" : "false"}
            aria-expanded={abierto}
            aria-controls={idLista}
            onClick={() => setAbierto((a) => !a)}
          >
            {iconoDeClave(item.icono, { size: 18 })}
            <span className={styles.etiquetaItem}>{item.etiqueta}</span>
            <svg className={styles.flecha} data-abierto={abierto ? "true" : "false"} width="14" height="14" viewBox="0 0 24 24" aria-hidden="true">
              <path d="m6 9 6 6 6-6" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
          {abierto && (
            <ul id={idLista} className={`${styles.subitems} ${styles.soloAncho}`}>
              {hijos.map((h) => (
                <li key={h.href}>
                  <Link href={h.href} className={styles.subitem} data-activo={h.href === activo ? "true" : "false"} aria-current={h.href === activo ? "page" : undefined}>
                    {h.etiqueta}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}
