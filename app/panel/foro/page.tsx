import Link from "next/link";
import { obtenerContextoPanel } from "@/lib/panel-contexto";
import { listarPreguntas, TAMANO_PAGINA_FORO } from "@/lib/foro";
import { Boton } from "@/components/marco/Boton";
import { EncabezadoPagina } from "@/components/marco/EncabezadoPagina";
import { EstadoVacio } from "@/components/marco/EstadoVacio";
import { FilaLista, ListaFilas } from "@/components/marco/ListaFilas";
import { Tarjeta } from "@/components/marco/Tarjeta";
import { FormPregunta } from "./FormPregunta";
import { formatoFechaForo } from "./formato";
import styles from "./page.module.css";

// Foro de la comunidad (14-nov) — compartido entre TODAS las empresas
// de Zilonix. obtenerContextoPanel() ya manda a /crear-empresa a quien
// no tiene ninguna: ese es el candado (no es un módulo de una empresa,
// así que no hay requierePermiso — ver RUTAS_EXENTAS).
export default async function ForoPage({ searchParams }: { searchParams: { q?: string } }) {
  await obtenerContextoPanel();
  const busqueda = typeof searchParams.q === "string" ? searchParams.q.trim().slice(0, 100) : "";
  const preguntas = await listarPreguntas({ busqueda });

  return (
    <>
      <EncabezadoPagina
        titulo="Foro de vendedores"
        descripcion="Pregunta y ayuda a otros vendedores de Zilonix. Solo se muestra tu nombre, nunca tu empresa ni tus datos de ventas."
      />

      <Tarjeta>
        <h2 className={styles.tituloSeccion}>Hacer una pregunta</h2>
        <p className={styles.aviso}>Lo que publiques lo ven todos los vendedores de Zilonix. No compartas datos de tus clientes ni claves.</p>
        <FormPregunta />
      </Tarjeta>

      <form className={styles.buscador} role="search">
        <input name="q" defaultValue={busqueda} placeholder="Buscar en el foro" className="zx-control" maxLength={100} aria-label="Buscar en el foro" />
        <Boton type="submit" variante="secundario">
          Buscar
        </Boton>
      </form>

      <div>
        <h2 className={styles.tituloSeccion}>{busqueda ? `Resultados para "${busqueda}"` : "Preguntas recientes"}</h2>
        {preguntas.length === 0 ? (
          <EstadoVacio>{busqueda ? "No hay preguntas que coincidan con tu búsqueda." : "Todavía no hay preguntas. ¡Haz la primera!"}</EstadoVacio>
        ) : (
          <ListaFilas>
            {preguntas.map((p) => (
              <FilaLista key={p.id}>
                <Link href={`/panel/foro/${p.id}`} className={styles.fila}>
                  <span className={styles.tituloPregunta}>
                    {p.titulo}
                    <span className={styles.meta}>
                      {p.autorNombre} · {formatoFechaForo(p.creadoTs)}
                    </span>
                  </span>
                  <span className={styles.respuestas}>
                    {p.respuestas} {p.respuestas === 1 ? "respuesta" : "respuestas"}
                  </span>
                </Link>
              </FilaLista>
            ))}
          </ListaFilas>
        )}
        {preguntas.length === TAMANO_PAGINA_FORO && (
          <p className={styles.aviso}>Se muestran las {TAMANO_PAGINA_FORO} más recientes. Usa el buscador para encontrar una más vieja.</p>
        )}
      </div>
    </>
  );
}
