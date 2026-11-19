"use client";

import { useEffect, useRef, useState } from "react";
import { Boton } from "@/components/marco/Boton";
import { generarImagenIAAction } from "../actions";
import styles from "../page.module.css";

// "lista" = la empresa tiene OpenAI o Google conectado.
export type EstadoIAImagen = "lista" | "sin_conexion" | "sin_imagenes";

// Mismo número que COMPOSICIONES_PORTADA (lib/ia/imagen.ts): no se importa
// para no meter ese módulo de servidor en el bundle del navegador.
const COMPOSICIONES = 10;
const CANTIDADES = [1, 4, 10] as const;
const REFERENCIAS_EXTRA = 2;

type Creada = { url: string; numero: number };

// Crea fotos con la IA de la empresa a partir de fotos reales de la
// galería. Portada de venta: cada una con otra composición (hasta 10
// distintas por tanda), una por una para ir viéndolas. Nada entra a la
// galería hasta que la persona lo agrega, y solo llega a Mercado Libre
// con «Guardar fotos».
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
  const [cantidad, setCantidad] = useState<(typeof CANTIDADES)[number]>(4);
  const [indicaciones, setIndicaciones] = useState("");
  const [creadas, setCreadas] = useState<Creada[]>([]);
  const [aviso, setAviso] = useState<{ ok: boolean; texto: string } | null>(null);
  const [progreso, setProgreso] = useState<{ hecho: number; total: number } | null>(null);
  const detener = useRef(false);
  // La siguiente composición: «crear 4» dos veces da 8 distintas.
  const siguiente = useRef(0);

  // Si la foto elegida se quita de la galería, vuelve a la primera.
  useEffect(() => {
    if (!fotos.includes(base)) setBase(fotos[0] ?? "");
  }, [fotos, base]);

  if (estado !== "lista") {
    return (
      <p className={styles.notaNeutra}>
        {estado === "sin_conexion"
          ? "Para crear imágenes con IA, conecta OpenAI o Google en Administración → Conectar IA (lo paga la cuenta de IA de tu empresa)."
          : "La IA conectada en Administración → Conectar IA no crea imágenes. Conecta OpenAI o Google para usar esto."}
      </p>
    );
  }

  const creando = progreso !== null;
  const referencias = fotos.filter((u) => u !== base).slice(0, REFERENCIAS_EXTRA);

  async function crear() {
    if (!base || creando) return;
    const total = tipo === "portada" ? cantidad : 1;
    detener.current = false;
    setAviso(null);
    let fallidas = 0;
    let ultimoError = "";
    for (let i = 0; i < total; i++) {
      if (detener.current) break;
      setProgreso({ hecho: i, total });
      const variante = siguiente.current % COMPOSICIONES;
      if (tipo === "portada") siguiente.current += 1;
      try {
        const r = await generarImagenIAAction({ cuentaMlId, itemId, fotoUrl: base, referencias, tipo, indicaciones, variante });
        if (r.ok) {
          setCreadas((previas) => [...previas, { url: r.url, numero: variante + 1 }]);
        } else {
          fallidas += 1;
          ultimoError = r.aviso;
          // Clave rechazada, sin saldo o sin permiso: las demás fallarían igual.
          if (i === 0) break;
        }
      } catch {
        fallidas += 1;
        ultimoError = "No se pudo crear la imagen. Intenta de nuevo.";
      }
    }
    setProgreso(null);
    if (fallidas === 0) {
      setAviso({ ok: true, texto: "Listo. Revisa cada imagen: si una no se entiende o se ve genérica, descártala y crea otra." });
    } else {
      setAviso({ ok: false, texto: fallidas === total ? ultimoError : `${fallidas} no se pudieron crear. ${ultimoError}` });
    }
  }

  function agregar(creada: Creada, comoPortada: boolean) {
    onAgregar(creada.url, comoPortada);
    setCreadas((previas) => previas.filter((c) => c.url !== creada.url));
    setAviso({ ok: true, texto: "Agregada a la galería. Recuerda «Guardar fotos»." });
  }

  return (
    <div className={styles.iaImagen}>
      <p className={styles.seccion}>Crear imagen con IA</p>
      <p className={styles.notaNeutra}>
        Elige la foto real principal; la IA usa también {referencias.length > 0 ? `otras ${referencias.length} de la galería` : "solo esa"} como referencia. La portada
        de venta va sobre fondo blanco y muestra, sin textos, para qué sirve, cómo se usa y qué incluye; cada una sale con otra composición. Cada imagen tarda
        hasta un minuto y la cobra la cuenta de IA de tu empresa.
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
            {t === "portada" ? "Portada de venta" : "Informativa (con textos)"}
          </button>
        ))}
      </span>
      {tipo === "portada" ? (
        <span className={styles.filtro} role="radiogroup" aria-label="Cuántas portadas">
          {CANTIDADES.map((n) => (
            <button key={n} type="button" role="radio" aria-checked={cantidad === n} className={styles.iaTipo} onClick={() => setCantidad(n)} disabled={creando}>
              {n === 1 ? "1 portada" : `${n} portadas`}
            </button>
          ))}
        </span>
      ) : null}
      <textarea
        className="zx-control"
        rows={3}
        maxLength={600}
        value={indicaciones}
        onChange={(e) => setIndicaciones(e.target.value)}
        placeholder={
          tipo === "portada"
            ? "Qué es, para qué sirve, para quién y qué incluye (ej. kit de 3 brochas + estuche, para maquillaje diario). Sin esto, la IA solo usa el título y las fotos."
            : "Qué destacar (ej. corta a 45°, acero inoxidable, mango antideslizante)"
        }
        aria-label="Información del producto para la IA"
        disabled={creando}
      />
      <div className={styles.iaAcciones}>
        {creando ? (
          <Boton type="button" chico variante="secundario" onClick={() => (detener.current = true)}>
            Detener después de esta
          </Boton>
        ) : (
          <Boton type="button" chico onClick={crear} disabled={!base}>
            {tipo === "portada" ? (cantidad === 1 ? "Crear portada" : `Crear ${cantidad} portadas`) : "Crear imagen"}
          </Boton>
        )}
      </div>
      {progreso ? (
        <p className={styles.notaNeutra} role="status">
          Creando imagen {progreso.hecho + 1} de {progreso.total}…
        </p>
      ) : null}
      {aviso ? (
        <p className={aviso.ok ? styles.avisoOk : styles.avisoError} role="status">
          {aviso.texto}
        </p>
      ) : null}
      {creadas.length > 0 ? (
        <div className={styles.iaResultados}>
          {creadas.map((c) => (
            <div key={c.url} className={styles.iaResultado}>
              <img src={c.url} alt={`Imagen creada con IA, composición ${c.numero}`} width={200} height={200} />
              <div className={styles.iaAcciones}>
                <Boton type="button" chico onClick={() => agregar(c, true)}>
                  Agregar como portada
                </Boton>
                <Boton type="button" chico variante="secundario" onClick={() => agregar(c, false)}>
                  Agregar al final
                </Boton>
                <Boton type="button" chico variante="fantasma" onClick={() => setCreadas((previas) => previas.filter((x) => x.url !== c.url))}>
                  Descartar
                </Boton>
              </div>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
