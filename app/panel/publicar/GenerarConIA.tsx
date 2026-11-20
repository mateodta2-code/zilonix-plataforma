"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { Boton } from "@/components/marco/Boton";
import { Campo } from "@/components/marco/Campo";
import { Chip } from "@/components/marco/Chip";
import type { Asignacion } from "@/lib/ia/prompts/composiciones";
import { TIPOS_EXPERTO_ML } from "@/lib/ia/prompts/estiloExpertoML";
import { NOTA_FOTO_UNO } from "@/lib/ia/prompts/fotoPrincipal";
import { CHECKLIST_CONTENIDO, revisarCopySeguro, TIPOS_CONTENIDO_ZILONIX } from "@/lib/ia/prompts/zilonix-contenido";
import type { Ficha } from "@/lib/publicaciones/ficha";
import type { Cuenta } from "./CuentasDestino";
import { ajustarImagenAction, crearImagenAction, prepararImagenesAction, type PropuestaImagen } from "./ia/imagenes/actions";
import styles from "./publicar.module.css";

type Estilo = "zilonix_portadas" | "zilonix_contenido" | "experto_ml";
type EstadoTarjeta = "propuesta" | "en_cola" | "generando" | "lista" | "error";
type Tarjeta = PropuestaImagen & { estado: EstadoTarjeta; url?: string; avisos?: string[]; mensaje?: string; titulo: string; copy: string; ajuste: string; elegida: boolean };

const ESTILOS: { id: Estilo; nombre: string; ayuda: string }[] = [
  { id: "zilonix_portadas", nombre: "Portadas Zilonix", ayuda: "Una portada distinta por cada cuenta destino; queda como foto 1 de esa cuenta." },
  { id: "zilonix_contenido", nombre: "Contenido Zilonix", ayuda: "Las 10 imágenes de contenido; cada una se aprueba antes de crearla." },
  { id: "experto_ml", nombre: "Estilo experto ML", ayuda: "Imágenes de venta con titular y apoyos cortos." },
];
const RUTA_CONECTAR_IA = "/panel/conectar-ia";
const ESPERA_COLA_MS = 4_000;
const MAXIMO_A_LA_VEZ = 2;
const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Publicar → zona de fotos → «Generar con IA» (PR2). Con la ficha
// confirmada de «Crear con IA», arma propuestas (sin costo), la persona
// las revisa y solo «Crear» gasta. Portadas: cada una va a la foto 1 de
// su cuenta. Contenido y Experto: «Agregar a mis fotos» las suma a la
// misma galería. Máximo 2 generándose a la vez; las demás esperan.
export function GenerarConIA({
  cuentas,
  ficha,
  categoriaId,
  fotos,
  espacioLibre,
  onAgregarFotos,
  onPortadaCuenta,
}: {
  cuentas: Cuenta[];
  ficha: Ficha | null;
  categoriaId: string | null;
  fotos: string[];
  espacioLibre: number | null;
  onAgregarFotos: (urls: string[]) => void;
  onPortadaCuenta: (cuentaId: string, url: string) => void;
}) {
  const [estilo, setEstilo] = useState<Estilo>("zilonix_portadas");
  const [tiposContenido, setTiposContenido] = useState<string[]>(TIPOS_CONTENIDO_ZILONIX.filter((t) => t.porDefecto).map((t) => t.id));
  const [tiposExperto, setTiposExperto] = useState<string[]>(TIPOS_EXPERTO_ML.filter((t) => t.porDefecto).map((t) => t.id));
  const [opiniones, setOpiniones] = useState("");
  const [fotoBlanco, setFotoBlanco] = useState(false);
  const [tarjetas, setTarjetas] = useState<Tarjeta[]>([]);
  const [preparando, setPreparando] = useState(false);
  const [aviso, setAviso] = useState<{ texto: string; conectarIA?: boolean } | null>(null);
  const [omitidas, setOmitidas] = useState<string[]>([]);
  const asignadas = useRef<Record<string, Asignacion>>({});
  const nombreCuenta = (id: string | null) => cuentas.find((c) => c.id === id)?.nickname ?? "";

  if (!ficha) {
    return (
      <p className={styles.ayudaIA}>
        Primero arma y confirma la ficha del producto en «Crear con IA» (más abajo). Las imágenes usan solo los datos confirmados y tus fotos reales.
      </p>
    );
  }
  if (cuentas.length === 0) return <p className={styles.ayudaIA}>Marca al menos una cuenta destino.</p>;
  if (fotos.length === 0) return <p className={styles.ayudaIA}>Sube primero al menos una foto real del producto en «Subir mis fotos»: la IA la usa como referencia.</p>;

  const cambiar = (id: string, cambios: Partial<Tarjeta>) => setTarjetas((ts) => ts.map((t) => (t.id === id ? { ...t, ...cambios } : t)));

  async function preparar() {
    if (!ficha) return;
    setPreparando(true);
    setAviso(null);
    try {
      const r = await prepararImagenesAction({
        estilo,
        cuentaMlIds: cuentas.map((c) => c.id),
        ficha,
        tipos: estilo === "zilonix_contenido" ? tiposContenido : tiposExperto,
        opiniones,
        incluirFotoBlanco: fotoBlanco,
        previas: estilo === "zilonix_portadas" ? asignadas.current : undefined,
      });
      if (!r.ok) {
        setAviso({ texto: r.aviso, conectarIA: r.conectarIA });
      } else {
        for (const img of r.imagenes) {
          const a = (img.propuesta as { asignacion?: Asignacion }).asignacion;
          if (img.cuentaMlId && a) asignadas.current[img.cuentaMlId] = a;
        }
        setOmitidas(r.omitidas);
        setTarjetas(
          r.imagenes.map((img) => {
            const p = img.propuesta as { titulo?: string; copy?: string[] };
            return { ...img, estado: "propuesta", titulo: p.titulo ?? "", copy: (p.copy ?? []).join("\n"), ajuste: "", elegida: true };
          })
        );
      }
    } catch {
      setAviso({ texto: "No se pudieron preparar las propuestas. Intenta de nuevo." });
    }
    setPreparando(false);
  }

  function prohibidasDe(t: Tarjeta): string[] {
    if (t.tipo === "portada" || t.tipo === "foto_principal") return [];
    return revisarCopySeguro([t.titulo, ...t.copy.split("\n")]);
  }

  // Crea una imagen; si la empresa ya tiene 2 generando, espera su turno.
  async function crear(t: Tarjeta) {
    if (prohibidasDe(t).length > 0 || (t.tipo !== "portada" && t.tipo !== "foto_principal" && !t.titulo.trim())) return;
    cambiar(t.id, { estado: "generando", mensaje: undefined });
    const propuesta = t.tipo === "portada" || t.tipo === "foto_principal" ? undefined : { titulo: t.titulo, copy: t.copy.split("\n").filter(Boolean) };
    for (let intento = 0; intento < 150; intento++) {
      let r;
      try {
        r = await crearImagenAction({ imagenId: t.id, propuesta, fotos, categoriaId });
      } catch {
        cambiar(t.id, { estado: "error", mensaje: "No se pudo crear la imagen. Intenta de nuevo." });
        return;
      }
      if (!r.ok) {
        cambiar(t.id, { estado: "error", mensaje: r.aviso });
        if (r.conectarIA) setAviso({ texto: r.aviso, conectarIA: true });
        return;
      }
      if (r.estado === "lista") {
        cambiar(t.id, { estado: "lista", url: r.url, avisos: r.validada ? r.avisos : ["No se pudo validar la imagen con Mercado Libre."] });
        if (t.tipo === "portada" && t.cuentaMlId) onPortadaCuenta(t.cuentaMlId, r.url);
        return;
      }
      cambiar(t.id, { estado: "en_cola" });
      await esperar(ESPERA_COLA_MS);
      cambiar(t.id, { estado: "generando" });
    }
    cambiar(t.id, { estado: "error", mensaje: "La cola tardó demasiado. Intenta de nuevo." });
  }

  // «Crear todas»: de a 2 a la vez (la cola del servidor también lo cuida).
  async function crearTodas() {
    const pendientes = tarjetas.filter((t) => t.estado === "propuesta" || t.estado === "error");
    let i = 0;
    await Promise.all(
      Array.from({ length: MAXIMO_A_LA_VEZ }, async () => {
        while (i < pendientes.length) await crear(pendientes[i++]);
      })
    );
  }

  async function ajustar(t: Tarjeta) {
    cambiar(t.id, { estado: "generando", mensaje: undefined });
    try {
      const r = await ajustarImagenAction({ imagenId: t.id, ajuste: t.ajuste, asignadas: asignadas.current, opiniones });
      if (!r.ok) {
        cambiar(t.id, { estado: "propuesta", mensaje: r.aviso });
        return;
      }
      const p = r.propuesta as { titulo?: string; copy?: string[]; asignacion?: Asignacion };
      if (t.cuentaMlId && p.asignacion) asignadas.current[t.cuentaMlId] = p.asignacion;
      cambiar(t.id, { estado: "propuesta", propuesta: r.propuesta, prompt: r.prompt, titulo: p.titulo ?? t.titulo, copy: (p.copy ?? t.copy.split("\n")).join("\n"), ajuste: "" });
    } catch {
      cambiar(t.id, { estado: "propuesta", mensaje: "No se pudo ajustar. Intenta de nuevo." });
    }
  }

  function agregarElegidas() {
    const urls = tarjetas.filter((t) => t.estado === "lista" && t.elegida && t.tipo !== "portada" && t.url).map((t) => t.url as string);
    onAgregarFotos(espacioLibre === null ? urls : urls.slice(0, Math.max(0, espacioLibre)));
  }

  const listasParaAgregar = tarjetas.filter((t) => t.estado === "lista" && t.tipo !== "portada").length;
  const tipos = estilo === "zilonix_contenido" ? TIPOS_CONTENIDO_ZILONIX : estilo === "experto_ml" ? TIPOS_EXPERTO_ML : [];
  const marcados = estilo === "zilonix_contenido" ? tiposContenido : tiposExperto;
  const alternarTipo = (id: string) => (estilo === "zilonix_contenido" ? setTiposContenido : setTiposExperto)((ts) => (ts.includes(id) ? ts.filter((x) => x !== id) : [...ts, id]));

  return (
    <div className={styles.crearIA}>
      <span className={styles.filtroIA} role="radiogroup" aria-label="Estilo de imagen">
        {ESTILOS.map((e) => (
          <Boton key={e.id} type="button" chico variante={estilo === e.id ? "primario" : "secundario"} onClick={() => setEstilo(e.id)} disabled={preparando}>
            {e.nombre}
          </Boton>
        ))}
      </span>
      <p className={styles.ayudaIA}>{ESTILOS.find((e) => e.id === estilo)?.ayuda}</p>

      {estilo === "zilonix_portadas" ? (
        <p className={styles.ayudaIA}>
          Se crea una portada por cada cuenta marcada ({cuentas.map((c) => c.nickname).join(", ")}), todas distintas. {NOTA_FOTO_UNO}
        </p>
      ) : (
        <div className={styles.tiposIA}>
          {tipos.map((t) => (
            <label key={t.id} className={styles.tipoIA}>
              <input type="checkbox" checked={marcados.includes(t.id)} onChange={() => alternarTipo(t.id)} disabled={preparando} /> {t.nombre}
            </label>
          ))}
        </div>
      )}
      {estilo === "zilonix_contenido" && tiposContenido.includes("opiniones_reales") ? (
        <Campo etiqueta="Opiniones reales de tus compradores (una por línea; si no tienes, déjalo vacío y esa imagen se salta)">
          <textarea className="zx-control" rows={3} value={opiniones} onChange={(e) => setOpiniones(e.target.value)} placeholder="Llegó rápido y bien empacado" disabled={preparando} />
        </Campo>
      ) : null}
      <label className={styles.tipoIA}>
        <input type="checkbox" checked={fotoBlanco} onChange={(e) => setFotoBlanco(e.target.checked)} disabled={preparando} /> Agregar también una foto del producto solo sobre blanco
      </label>
      <div>
        <Boton type="button" chico onClick={preparar} disabled={preparando}>
          {preparando ? "Preparando propuestas…" : tarjetas.length > 0 ? "Preparar de nuevo" : "Preparar propuestas (sin costo)"}
        </Boton>
      </div>
      {aviso ? (
        <p className={styles.avisoIA} role="alert">
          {aviso.texto} {aviso.conectarIA ? <Link href={RUTA_CONECTAR_IA}>Ir a Conectar IA</Link> : null}
        </p>
      ) : null}
      {omitidas.length > 0 ? <p className={styles.ayudaIA}>No se prepararon: {omitidas.join(" · ")}</p> : null}

      {tarjetas.length > 0 ? (
        <>
          <div className={styles.accionesIA}>
            <Boton type="button" chico onClick={crearTodas} disabled={tarjetas.some((t) => t.estado === "generando" || t.estado === "en_cola")}>
              Crear todas las aprobadas
            </Boton>
            {listasParaAgregar > 0 ? (
              <Boton type="button" chico variante="secundario" onClick={agregarElegidas}>
                Agregar a mis fotos
              </Boton>
            ) : null}
            {espacioLibre !== null ? <span className={styles.ayudaIA}>Espacio en la galería: {espacioLibre} foto(s).</span> : null}
          </div>
          <div className={styles.tarjetasIA}>
            {tarjetas.map((t) => {
              const prohibidas = prohibidasDe(t);
              const conTextos = t.tipo !== "portada" && t.tipo !== "foto_principal";
              const ocupada = t.estado === "generando" || t.estado === "en_cola";
              return (
                <div key={t.id} className={styles.tarjetaIA}>
                  <p className="zx-etiqueta">{t.nombre}</p>
                  {t.url ? <img src={t.url} alt={`Imagen creada: ${t.nombre}`} width={180} height={180} className={styles.miniaturaIA} /> : null}
                  {conTextos && t.estado !== "lista" ? (
                    <>
                      <Campo etiqueta="Título">
                        <input className="zx-control" maxLength={60} value={t.titulo} onChange={(e) => cambiar(t.id, { titulo: e.target.value })} disabled={ocupada} />
                      </Campo>
                      <Campo etiqueta="Copy (una línea por texto)">
                        <textarea className="zx-control" rows={3} value={t.copy} onChange={(e) => cambiar(t.id, { copy: e.target.value })} disabled={ocupada} />
                      </Campo>
                    </>
                  ) : null}
                  {t.tipo === "portada" ? <p className={styles.ayudaIA}>Para la cuenta {nombreCuenta(t.cuentaMlId)}.</p> : null}
                  {estilo === "zilonix_contenido" && conTextos ? (
                    <span className={styles.accionesIA}>
                      {CHECKLIST_CONTENIDO.map((c) => (
                        <Chip key={c} estado={c === "Sin palabras prohibidas" && prohibidas.length > 0 ? "peligro" : c === "Aprobado (CREAR)" && t.estado !== "lista" ? "neutro" : "exito"}>
                          {c}
                        </Chip>
                      ))}
                    </span>
                  ) : null}
                  {prohibidas.length > 0 ? <p className={styles.avisoIA}>Mercado Libre no permite: {prohibidas.join(", ")}.</p> : null}
                  <details className={styles.promptIA}>
                    <summary>Ver el prompt final</summary>
                    <p>{t.prompt}</p>
                    <Boton type="button" chico variante="fantasma" onClick={() => void navigator.clipboard.writeText(t.prompt).catch(() => undefined)}>
                      Copiar prompt
                    </Boton>
                  </details>
                  {t.estado === "propuesta" || t.estado === "error" ? (
                    <Campo etiqueta="¿Qué cambio quieres? (para «Ajustar»)">
                      <input className="zx-control" maxLength={300} value={t.ajuste} onChange={(e) => cambiar(t.id, { ajuste: e.target.value })} />
                    </Campo>
                  ) : null}
                  <span className={styles.accionesIA}>
                    {t.estado === "lista" ? (
                      <>
                        {t.tipo !== "portada" ? (
                          <label className={styles.tipoIA}>
                            <input type="checkbox" checked={t.elegida} onChange={(e) => cambiar(t.id, { elegida: e.target.checked })} /> Agregar
                          </label>
                        ) : (
                          <Chip estado="exito">Puesta como foto 1</Chip>
                        )}
                        <Boton type="button" chico variante="secundario" onClick={() => (t.tipo === "portada" ? void ajustar({ ...t, estado: "propuesta" }).then(() => undefined) : void crear(t))}>
                          {t.tipo === "portada" ? "Otra composición" : "Regenerar"}
                        </Boton>
                        <a href={t.url} target="_blank" rel="noopener noreferrer" download className={styles.enlaceIA}>
                          Descargar
                        </a>
                      </>
                    ) : (
                      <>
                        <Boton type="button" chico onClick={() => void crear(t)} disabled={ocupada || prohibidas.length > 0}>
                          {t.estado === "en_cola" ? "En cola…" : t.estado === "generando" ? "Creando…" : "Crear"}
                        </Boton>
                        {t.tipo !== "foto_principal" ? (
                          <Boton type="button" chico variante="fantasma" onClick={() => void ajustar(t)} disabled={ocupada}>
                            Ajustar
                          </Boton>
                        ) : null}
                      </>
                    )}
                  </span>
                  {t.estado === "lista" && t.avisos && t.avisos.length > 0 ? <p className={styles.ayudaIA}>Mercado Libre: {t.avisos.join(" · ")}</p> : null}
                  {t.mensaje ? <p className={styles.avisoIA}>{t.mensaje}</p> : null}
                </div>
              );
            })}
          </div>
        </>
      ) : null}
    </div>
  );
}
