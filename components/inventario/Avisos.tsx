import styles from "@/app/panel/inventario/inventario.module.css";

// Issue #280 — avisos que dejan las Server Actions en la URL (?ok= /
// ?error=). React escapa el texto: un ?error= armado a mano nunca se
// pinta como HTML. Las pestañas del módulo viven en
// components/productos/PestanasProductos.tsx.
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
