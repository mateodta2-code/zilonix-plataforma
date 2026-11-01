import Link from "next/link";
import { cambiarEmpresaActiva } from "@/app/panel/actions";
import { BotonCerrarSesion } from "./BotonCerrarSesion";
import { IconoBuscar, iconoDeClave } from "./iconos";
import { SaludoHeader } from "./SaludoHeader";
import { SelectorTema } from "./SelectorTema";
import styles from "./BarraSuperior.module.css";
import type { DatosUsuario, EmpresaSelector } from "./tipos";

export function BarraSuperior({
  empresaActivaId,
  empresasPropias,
  usuario,
  mostrarCampana,
}: {
  empresaActivaId: string;
  empresasPropias: EmpresaSelector[];
  usuario: DatosUsuario;
  mostrarCampana: boolean;
}) {
  return (
    <header className={styles.barra}>
      <div className={styles.izquierda}>
        {/* Corrección (fix-ui-claro-sidebar-marca, punto 1): el
            saludo vive acá (header) pero solo se pinta en /panel
            exacto — SaludoHeader decide con usePathname(), ver ese
            archivo. En cualquier otra subruta no ocupa espacio
            (return null), el selector de empresa sigue solo acá. */}
        <SaludoHeader nombre={usuario.nombre} />

        {empresasPropias.length > 1 && (
          // Mismo form y misma server action de siempre
          // (app/panel/actions.ts) — solo se ve más compacto acá.
          <form action={cambiarEmpresaActiva} className={styles.formEmpresa}>
            <select name="empresaId" defaultValue={empresaActivaId} className={styles.select}>
              {empresasPropias.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.nombre}
                </option>
              ))}
            </select>
            <button type="submit" className={styles.botonCambiar}>
              Cambiar
            </button>
          </form>
        )}
      </div>

      <div className={styles.derecha}>
        {/* Corrección: antes vivía centrado en TODA la barra (su
            propio bloque flex:1); ahora queda pegado a la izquierda
            del grupo avisos/tema/usuario, dentro de ese mismo grupo
            de la derecha. Deshabilitada a propósito — no hay índice
            de búsqueda todavía, y un campo que no busca nada es peor
            que no tener campo. */}
        <button type="button" disabled className={styles.buscar} title="Pendiente de conectar">
          <IconoBuscar size={16} />
          <span className={styles.buscarTexto}>Buscar…</span>
        </button>

        {mostrarCampana && (
          <Link href="/panel/avisos-ml" className={styles.botonIcono} title="Avisos de Mercado Libre">
            {iconoDeClave("avisosMl", { size: 18 })}
          </Link>
        )}
        <SelectorTema />
        <Link href="/cuenta" className={styles.usuario} title="Mi cuenta">
          {usuario.imagenUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- la
            // app no usa next/image a propósito (next.config.mjs,
            // tarea de seguridad del upgrade de Clerk): sin carpeta
            // public/ ni sharp, y esta imagen ya viene optimizada
            // desde img.clerk.com.
            <img src={usuario.imagenUrl} alt="" width={30} height={30} className={styles.avatar} />
          ) : (
            <span className={styles.avatarRespaldo}>{usuario.nombre.slice(0, 1).toUpperCase()}</span>
          )}
          <span className={styles.nombreUsuario}>{usuario.nombre}</span>
        </Link>
        <BotonCerrarSesion variante="barra" />
      </div>
    </header>
  );
}
