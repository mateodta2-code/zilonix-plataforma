"use client";

import { useEffect, useState, useTransition } from "react";
import { Boton } from "@/components/marco/Boton";
import { generarImagenIAAction } from "../actions";
import styles from "../page.module.css";

// "lista" = la empresa tiene OpenAI o Google conectado.
export type EstadoIAImagen = "lista" | "sin_conexion" | "sin_imagenes";

// Crea una foto con la IA de la empresa a partir de una foto real de la
// galería. El resultado se muestra primero: solo entra a la galería si
// la persona lo agrega, y solo llega a Mercado Libre con «Guardar fotos».
export function CrearImagenIA({
  cuentaMlId,
  itemId,
  fotos,
  estado,
  onAgregar,
}: {
  cuentaMlId: string;
  itemId: string;
  fotos: string[];
  estado: EstadoIAImagen;
  onAgregar: (url: string, comoPortada: boolean) => void;
}) {
  const [base, setBase] = useState(fotos[0] ?? "");
  const [tipo, setTipo] = useState<"portada" | "informativa">("portada");
  const [indicaciones, setIndicaciones] = useState("");
  const [resultado, setResultado] = useState<string | null>(null);
  const [aviso, setAviso] = useState<{ ok: boolean; texto: string } | null>(null);
  const [creando, iniciar] = useTransition();

  // Si la foto elegida se quita de la galería, vuelve a la primera.
  useEffect(() => {
    if (!fotos.includes(base)) setBase(fotos[0] ?? "");
  }, [fotos, base]);

  if (estado !== "lista") {
    return (
      <p className={styles.notaNeutra}>
        {estado === "sin_conexion"
          ? "Para crear imágenes con IA, conecta OpenAI o Google en Configuración → IA (lo paga la cuenta de IA de tu empresa)."
          : "La IA conectada en Configuración → IA no crea imágenes. Conecta OpenAI o Google para usar esto."}
      </p>
    );
  }

  function crear() {
    if (!base) return;
    setAviso(null);
    setResultado(null);
    iniciar(async () => {
      try {
        const r = await generarImagenIAAction({ cuentaMlId, itemId, fotoUrl: base, tipo, indicaciones });
        setAviso({ ok: r.ok, texto: r.aviso });
        if (r.ok) setResultado(r.url);
      } catch {
        setAviso({ ok: false, texto: "No se pudo crear la imagen. Intenta de nuevo." });
      }
    });
  }

  function agregar(comoPortada: boolean) {
    if (!resultado) return;
    onAgregar(resultado, comoPortada);
    setResultado(null);
    setAviso({ ok: true, texto: "Agregada a la galería. Recuerda «Guardar fotos»." });
  }

  return (
    <div className={styles.iaImagen}>
      <p className={styles.seccion}>Crear imagen con IA</p>
      <p className={styles.notaNeutra}>
        Elige una foto real del producto. La IA crea una portada (fondo blanco, sin textos, como pide Mercado Libre) o una imagen informativa con textos. Tarda
        hasta un minuto y lo cobra la cuenta de IA de tu empresa.
      </p>
      <div className={styles.iaBases} role="radiogroup" aria-label="Foto base">
        {fotos.map((url, i) => (
          <button
            key={url}
            type="button"
            role="radio"
            aria-checked={url === base}
            aria-label={`Usar la foto ${i + 1} como base`}
            className={url === base ? `${styles.iaBase} ${styles.iaBaseElegida}` : styles.iaBase}
            onClick={() => setBase(url)}
            disabled={creando}
          >
            <img src={url} alt="" width={56} height={56} loading="lazy" />
          </button>
        ))}
      </div>
      <span className={styles.filtro} role="radiogroup" aria-label="Tipo de imagen">
        {(["portada", "informativa"] as const).map((t) => (
          <button key={t} type="button" role="radio" aria-checked={tipo === t} className={styles.iaTipo} onClick={() => setTipo(t)} disabled={creando}>
            {t === "portada" ? "Portada (fondo blanco)" : "Informativa (con textos)"}
          </button>
        ))}
      </span>
      <textarea
        className="zx-control"
        rows={2}
        maxLength={300}
        value={indicaciones}
        onChange={(e) => setIndicaciones(e.target.value)}
        placeholder={tipo === "portada" ? "Opcional: algo a cuidar (ej. que se vea el mango naranja)" : "Qué destacar (ej. corta a 45°, acero inoxidable, mango antideslizante)"}
        aria-label="Indicaciones para la IA"
        disabled={creando}
      />
      <Boton type="button" chico onClick={crear} disabled={creando || !base}>
        {creando ? "Creando imagen…" : "Crear imagen"}
      </Boton>
      {aviso ? (
        <p className={aviso.ok ? styles.avisoOk : styles.avisoError} role="status">
          {aviso.texto}
        </p>
      ) : null}
      {resultado ? (
        <div className={styles.iaResultado}>
          <img src={resultado} alt="Imagen creada con IA" width={200} height={200} />
          <div className={styles.iaAcciones}>
            <Boton type="button" chico onClick={() => agregar(true)}>
              Agregar como portada
            </Boton>
            <Boton type="button" chico variante="secundario" onClick={() => agregar(false)}>
              Agregar al final
            </Boton>
            <Boton type="button" chico variante="fantasma" onClick={() => setResultado(null)}>
              Descartar
            </Boton>
          </div>
        </div>
      ) : null}
    </div>
  );
}
