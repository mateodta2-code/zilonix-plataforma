"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Boton } from "@/components/marco/Boton";
import { MAX_ADJUNTOS_POR_MENSAJE, MAX_CARACTERES_MENSAJE, validarAdjuntos, validarTextoMensaje, type ReglasAdjunto } from "@/lib/posventa/adjuntos";
import styles from "./ComposerPosventa.module.css";

// Posventa-Mensajes (Refs #645) — caja «Escríbele al comprador» compartida
// por Mensajes y por el reclamo. Valida tipo y tamaño en el navegador (el
// servidor vuelve a validar). La IA solo llena la caja: la persona edita
// y envía.
export type RespuestaEnvio = { ok: boolean; mensaje: string };
export type OpcionSugerida = { titulo: string; texto: string };
export type RespuestaSugerencia = { ok: true; opciones: OpcionSugerida[] } | { ok: false; mensaje: string; sinIA?: boolean };

export const AVISO_DATOS_PERSONALES = "No incluyas datos personales, lenguaje ofensivo, links a redes sociales o Mercado Pago.";

type Props = {
  reglas: ReglasAdjunto;
  enviar: (formData: FormData) => Promise<RespuestaEnvio>;
  // Campos que viajan con el envío (cuentaId, packId/reclamoId…).
  campos: Record<string, string>;
  sugerir?: () => Promise<RespuestaSugerencia>;
  iaConectada?: boolean;
  // Si no se puede escribir: motivo y link para hacerlo en Mercado Libre.
  bloqueadoMotivo?: string | null;
  enlaceMl?: string;
  titulo?: string;
};

const esImagen = (tipo: string) => tipo === "image/jpeg" || tipo === "image/png" || tipo === "image/gif";

export function ComposerPosventa({ reglas, enviar, campos, sugerir, iaConectada = true, bloqueadoMotivo, enlaceMl, titulo = "Escríbele al comprador" }: Props) {
  const router = useRouter();
  const [texto, setTexto] = useState("");
  const [archivos, setArchivos] = useState<File[]>([]);
  const [resultado, setResultado] = useState<{ ok: boolean; mensaje: string } | null>(null);
  const [opciones, setOpciones] = useState<OpcionSugerida[]>([]);
  const [enviando, iniciarEnvio] = useTransition();
  const [sugiriendo, iniciarSugerencia] = useTransition();
  const entrada = useRef<HTMLInputElement>(null);
  const [vistas, setVistas] = useState<string[]>([]);

  // Miniaturas locales; se liberan al quitar o desmontar.
  useEffect(() => {
    const urls = archivos.map((a) => (esImagen(a.type) ? URL.createObjectURL(a) : ""));
    setVistas(urls);
    return () => urls.forEach((u) => u && URL.revokeObjectURL(u));
  }, [archivos]);

  const bloqueado = Boolean(bloqueadoMotivo);
  const id = `composer-${Object.values(campos).join("-")}`;

  function alElegir(e: React.ChangeEvent<HTMLInputElement>) {
    const nuevos = Array.from(e.target.files ?? []);
    e.target.value = "";
    const todos = [...archivos, ...nuevos];
    // Se valida ANTES de aceptar: nada raro queda en la lista.
    const motivo = validarAdjuntos(todos.map((a) => ({ nombre: a.name, tipo: a.type, tamano: a.size })), reglas);
    if (motivo) return setResultado({ ok: false, mensaje: motivo });
    setResultado(null);
    setArchivos(todos);
  }

  function alEnviar() {
    const motivo = validarTextoMensaje(texto, archivos.length > 0);
    if (motivo) return setResultado({ ok: false, mensaje: motivo });
    const datos = new FormData();
    for (const [k, v] of Object.entries(campos)) datos.append(k, v);
    datos.append("texto", texto);
    for (const a of archivos) datos.append("archivos", a);
    iniciarEnvio(async () => {
      try {
        const r = await enviar(datos);
        setResultado(r);
        if (r.ok) {
          setTexto("");
          setArchivos([]);
          setOpciones([]);
          router.refresh();
        }
      } catch {
        setResultado({ ok: false, mensaje: "No se pudo enviar ahora. Intenta de nuevo en un momento." });
      }
    });
  }

  function alSugerir() {
    if (!sugerir) return;
    setResultado(null);
    iniciarSugerencia(async () => {
      try {
        const r = await sugerir();
        if (r.ok) setOpciones(r.opciones);
        else setResultado({ ok: false, mensaje: r.mensaje });
      } catch {
        setResultado({ ok: false, mensaje: "No se pudieron generar sugerencias ahora." });
      }
    });
  }

  return (
    <div className={styles.composer}>
      <label className={styles.titulo} htmlFor={id}>
        {titulo}
      </label>
      {bloqueado && (
        <p className={styles.nota}>
          {bloqueadoMotivo}{" "}
          {enlaceMl && (
            <a href={enlaceMl} target="_blank" rel="noopener noreferrer" className={styles.enlace}>
              Abrir en Mercado Libre
            </a>
          )}
        </p>
      )}
      <textarea id={id} className={styles.caja} rows={4} maxLength={MAX_CARACTERES_MENSAJE} disabled={bloqueado || enviando} value={texto} onChange={(e) => setTexto(e.target.value)} />

      {archivos.length > 0 && (
        <ul className={styles.adjuntos} aria-label="Archivos para adjuntar">
          {archivos.map((a, i) => (
            <li key={`${a.name}-${i}`} className={styles.adjunto}>
              {vistas[i] && /* eslint-disable-next-line @next/next/no-img-element */ <img src={vistas[i]} alt="" className={styles.miniatura} />}
              <span>{a.name}</span>
              <button type="button" className={styles.quitar} onClick={() => setArchivos(archivos.filter((_, j) => j !== i))} aria-label={`Quitar ${a.name}`}>
                Quitar
              </button>
            </li>
          ))}
        </ul>
      )}

      {opciones.length > 0 && (
        <div className={styles.sugerencias} role="group" aria-label="Respuestas sugeridas">
          {opciones.map((o, i) => (
            <button key={i} type="button" className={styles.opcion} onClick={() => setTexto(o.texto)}>
              <span className={styles.opcionTitulo}>{o.titulo}</span>
              {o.texto}
            </button>
          ))}
          <p className={styles.nota}>Elige una para llenar la caja. Revísala y edítala antes de enviar.</p>
        </div>
      )}

      <div className={styles.pie}>
        <div className={styles.herramientas}>
          <input ref={entrada} type="file" hidden multiple accept={reglas.extensiones.map((e) => `.${e}`).join(",")} onChange={alElegir} />
          <Boton type="button" variante="fantasma" chico disabled={bloqueado || enviando || archivos.length >= MAX_ADJUNTOS_POR_MENSAJE} onClick={() => entrada.current?.click()} aria-label="Adjuntar archivo" title={reglas.etiqueta}>
            Adjuntar
          </Boton>
          {sugerir && (
            <Boton type="button" variante="secundario" chico disabled={bloqueado || enviando || sugiriendo || !iaConectada} onClick={alSugerir} title={iaConectada ? undefined : "Conecta una IA en Administración"}>
              {sugiriendo ? "Pensando…" : "Sugerir respuestas"}
            </Boton>
          )}
          <span className={`${styles.contador} ${texto.length >= MAX_CARACTERES_MENSAJE ? styles.contadorLleno : ""}`}>
            {texto.length}/{MAX_CARACTERES_MENSAJE}
          </span>
        </div>
        <Boton type="button" disabled={bloqueado || enviando} onClick={alEnviar}>
          {enviando ? "Enviando…" : "Enviar"}
        </Boton>
      </div>
      {sugerir && !iaConectada && <p className={styles.nota}>Conecta una IA en Administración para ver respuestas sugeridas.</p>}
      <p className={styles.aviso}>{AVISO_DATOS_PERSONALES}</p>
      {resultado && (
        <p className={`${styles.resultado} ${resultado.ok ? styles.resultadoOk : styles.resultadoError}`} role="status">
          {resultado.mensaje}
        </p>
      )}
    </div>
  );
}
