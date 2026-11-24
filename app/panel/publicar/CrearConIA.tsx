"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { Boton } from "@/components/marco/Boton";
import { Campo } from "@/components/marco/Campo";
import { Chip, type EstadoChip } from "@/components/marco/Chip";
import { CopiarTexto } from "@/components/marco/CopiarTexto";
import {
  CAMPOS_FICHA,
  camposPorConfirmar,
  fichaConfirmada,
  LARGO_GARANTIA,
  LARGO_INFO_VENDEDOR,
  MAXIMO_FOTOS_ANALISIS,
  type ClaveFicha,
  type Ficha,
  type Origen,
} from "@/lib/publicaciones/ficha";
import { LARGO_TITULO, LARGO_TITULO_CATALOGO, type PalabraClave } from "@/lib/publicaciones/titulos";
import type { Cuenta } from "./CuentasDestino";
import { analizarProductoAction, escribirDescripcionAction, proponerTitulosAction } from "./ia/actions";
import styles from "./publicar.module.css";

const ROTULO_ORIGEN: Record<Origen, { texto: string; estado: EstadoChip }> = {
  foto: { texto: "De la foto", estado: "exito" },
  vendedor: { texto: "Del vendedor", estado: "neutro" },
  supuesto: { texto: "Confirmar", estado: "advertencia" },
};
const ROTULO_PALABRA: Record<PalabraClave["origen"], string> = { tendencia: "Tendencia", vendedor: "Del vendedor", ia: "Sugerida por la IA" };

type Aviso = { texto: string; conectarIA?: boolean } | null;

// Misma ruta que lib/publicaciones/errores.ts (ese módulo es de servidor).
const RUTA_CONECTAR_IA = "/panel/conectar-ia";

// Publicar → «Crear con IA» (PR1, textos). La IA de la empresa analiza
// las fotos del borrador y lo que escribe el vendedor (ficha con el
// origen de cada dato), y con la ficha CONFIRMADA propone títulos y la
// descripción. «Usar en <cuenta>» / «Usar en todas» solo llena el borrador de la
// cuenta o las cuentas elegidas: nada se publica desde acá.
export function CrearConIA({
  cuentas,
  fotos,
  onUsarTitulo,
  onUsarDescripcion,
  onFicha,
  referencias,
  pasoImagenes,
}: {
  cuentas: Cuenta[];
  fotos: string[];
  onUsarTitulo: (cuentaId: string, titulo: string) => void;
  onUsarDescripcion: (cuentaId: string, descripcion: string) => void;
  // La ficha confirmada (o null si se desconfirma): la usa «4. Imágenes».
  onFicha?: (dato: { ficha: Ficha; categoriaId: string | null } | null) => void;
  // «Imágenes de referencia» (1 o 2, solo para la IA): van antes de
  // «Información del producto».
  referencias?: ReactNode;
  // «4. Imágenes» (lo arma FormularioPublicar con GenerarConIA): va al
  // final, después de la descripción (23-nov).
  pasoImagenes?: ReactNode;
}) {
  const [cuentaId, setCuentaId] = useState(cuentas[0]?.id ?? "");
  const [info, setInfo] = useState("");
  const [garantia, setGarantia] = useState("");
  const [ficha, setFicha] = useState<Ficha | null>(null);
  const [confirmada, setConfirmada] = useState(false);
  const [categoria, setCategoria] = useState<{ id: string; nombre: string } | null>(null);
  const [leyoFotos, setLeyoFotos] = useState(true);
  const [titulos, setTitulos] = useState<{ titulos: string[]; catalogo: string | null; palabras: PalabraClave[]; conTendencias: boolean } | null>(null);
  const [descripcion, setDescripcion] = useState("");
  const [ocupado, setOcupado] = useState<null | "analisis" | "titulos" | "descripcion">(null);
  const [aviso, setAviso] = useState<Aviso>(null);
  const [usado, setUsado] = useState<string | null>(null);
  const [copiada, setCopiada] = useState(false);

  const cuenta = cuentas.find((c) => c.id === cuentaId) ?? cuentas[0];
  if (!cuenta) {
    return <p className={styles.ayudaIA}>Marca arriba al menos una cuenta destino para crear los textos con IA en su idioma.</p>;
  }
  const pendientes = ficha ? camposPorConfirmar(ficha) : [];

  async function correr<T extends { ok: boolean }>(paso: "analisis" | "titulos" | "descripcion", llamada: () => Promise<T>, alTerminar: (r: T) => void) {
    setOcupado(paso);
    setAviso(null);
    setUsado(null);
    try {
      const r = await llamada();
      if (r.ok) alTerminar(r);
      else setAviso({ texto: (r as unknown as { aviso: string }).aviso, conectarIA: (r as unknown as { conectarIA?: boolean }).conectarIA });
    } catch {
      setAviso({ texto: "No se pudo completar. Intenta de nuevo." });
    }
    setOcupado(null);
  }

  function analizar() {
    void correr("analisis", () => analizarProductoAction({ cuentaMlId: cuenta.id, fotos: fotos.slice(0, MAXIMO_FOTOS_ANALISIS), info }), (r) => {
      if (!r.ok) return;
      setFicha(r.ficha);
      setCategoria(r.categoria);
      onFicha?.(null);
      setLeyoFotos(r.leyoFotos);
      setConfirmada(false);
      setTitulos(null);
      setDescripcion("");
    });
  }

  // Editar un campo lo vuelve «del vendedor» y desconfirma la ficha.
  function editar(clave: ClaveFicha, texto: string, esLista: boolean) {
    if (!ficha) return;
    const valor = esLista ? texto.split("\n") : texto.trim() ? texto : null;
    setFicha({ ...ficha, [clave]: { valor, origen: "vendedor" } } as Ficha);
    setConfirmada(false);
    onFicha?.(null);
  }

  function aceptar(clave: ClaveFicha) {
    if (!ficha) return;
    setFicha({ ...ficha, [clave]: { ...ficha[clave], origen: "vendedor" } } as Ficha);
  }

  // Al confirmar, las listas se limpian de líneas vacías.
  function confirmar() {
    if (!ficha || !fichaConfirmada(ficha)) return;
    const limpia = { ...ficha } as Record<ClaveFicha, Ficha[ClaveFicha]>;
    for (const c of CAMPOS_FICHA) {
      const campo = ficha[c.clave];
      if (Array.isArray(campo.valor)) limpia[c.clave] = { ...campo, valor: campo.valor.map((v) => v.trim()).filter(Boolean) } as Ficha[ClaveFicha];
    }
    setFicha(limpia as Ficha);
    setConfirmada(true);
    onFicha?.({ ficha: limpia as Ficha, categoriaId: categoria?.id ?? null });
  }

  function pedirTitulos() {
    if (!ficha) return;
    void correr("titulos", () => proponerTitulosAction({ cuentaMlId: cuenta.id, ficha, categoriaId: categoria?.id ?? null, categoriaNombre: categoria?.nombre ?? null, info }), (r) => {
      if (r.ok) setTitulos({ titulos: r.titulos, catalogo: r.catalogo, palabras: r.palabras, conTendencias: r.conTendencias });
    });
  }

  function pedirDescripcion() {
    if (!ficha) return;
    void correr("descripcion", () => escribirDescripcionAction({ cuentaMlId: cuenta.id, ficha, garantia }), (r) => {
      if (r.ok) {
        setDescripcion(r.descripcion);
        setCopiada(false);
      }
    });
  }

  // Cuentas donde se puede usar el texto: las marcadas del MISMO país que
  // la cuenta de destino (el texto se escribió en su idioma).
  const cuentasMismoPais = cuentas.filter((c) => c.siteId === cuenta.siteId);
  const hayOtroPais = cuentasMismoPais.length < cuentas.length;

  function nombres(ids: string[]): string {
    return cuentas
      .filter((c) => ids.includes(c.id))
      .map((c) => c.nickname)
      .join(", ");
  }

  function usarTitulo(t: string, ids: string[]) {
    for (const id of ids) onUsarTitulo(id, t);
    setUsado(`Título puesto en ${ids.length > 1 ? "las cuentas" : "la cuenta"} ${nombres(ids)}. Revísalo abajo.`);
  }

  function usarDescripcion(ids: string[]) {
    for (const id of ids) onUsarDescripcion(id, descripcion);
    setUsado(`Descripción puesta en ${ids.length > 1 ? "las cuentas" : "la cuenta"} ${nombres(ids)}. Revísala abajo.`);
  }

  return (
    <div className={styles.crearIA}>
      <p className={styles.ayudaIA}>
        La IA de tu empresa (Administración → Conectar IA) mira tus imágenes de referencia y lo que escribas, arma la ficha del producto y, cuando la
        confirmas, propone títulos, escribe la descripción y crea imágenes de venta. Lo cobra tu cuenta de IA. Nada se publica desde aquí.
      </p>

      {/* El paso 1 se ve desde el principio: los datos de abajo y, después de «Analizar», la ficha. */}
      <p className="zx-etiqueta">1. Ficha del producto</p>

      {cuentas.length > 1 ? (
        <Campo etiqueta="Cuenta de destino (define el país y el idioma)">
          <select className="zx-control" value={cuenta.id} onChange={(e) => setCuentaId(e.target.value)} disabled={ocupado !== null}>
            {cuentas.map((c) => (
              <option key={c.id} value={c.id}>
                {c.nickname} · {c.siteId}
              </option>
            ))}
          </select>
        </Campo>
      ) : (
        <p className={styles.ayudaIA}>
          Cuenta de destino: <strong>{cuenta.nickname}</strong> · {cuenta.siteId}
        </p>
      )}

      {referencias ? (
        <div>
          <p className="zx-etiqueta">Imágenes de referencia (1 o 2)</p>
          <p className={styles.ayudaIA}>Fotos reales del producto que quieres construir. Solo las usa la IA: no se publican en Mercado Libre.</p>
          {referencias}
        </div>
      ) : null}

      <Campo etiqueta="Información del producto">
        <textarea
          className="zx-control"
          rows={4}
          maxLength={LARGO_INFO_VENDEDOR}
          value={info}
          onChange={(e) => setInfo(e.target.value)}
          placeholder="Qué es, marca y modelo, material, medidas, qué incluye, cómo se usa. La IA no inventa lo que no esté aquí ni en las fotos."
          disabled={ocupado !== null}
        />
      </Campo>
      <p className={styles.ayudaIA}>{fotos.length > 0 ? `Se usarán ${Math.min(fotos.length, MAXIMO_FOTOS_ANALISIS)} foto(s) de referencia.` : "Sin fotos: sube 1 o 2 imágenes de referencia para que la IA las mire."}</p>
      <div>
        <Boton type="button" onClick={analizar} disabled={ocupado !== null}>
          {ocupado === "analisis" ? "Analizando…" : ficha ? "Analizar de nuevo" : "Analizar producto"}
        </Boton>
      </div>

      {aviso ? (
        <p className={styles.avisoIA} role="alert">
          {aviso.texto}
          {aviso.conectarIA ? (
            <>
              {" "}
              <Link href={RUTA_CONECTAR_IA}>Ir a Conectar IA</Link>
            </>
          ) : null}
        </p>
      ) : null}
      {usado ? (
        <p className={styles.okIA} role="status">
          {usado}
        </p>
      ) : null}

      {ficha ? (
        <div className={styles.bloqueIA}>
          {!leyoFotos && fotos.length > 0 ? <p className={styles.ayudaIA}>La IA conectada no lee imágenes: la ficha salió solo de tu texto.</p> : null}
          <p className={styles.ayudaIA}>
            Categoría de Mercado Libre: <strong>{categoria ? categoria.nombre : "no se pudo detectar (la eliges abajo)"}</strong>
          </p>
          <div className={styles.fichaIA}>
            {CAMPOS_FICHA.map((c) => {
              const campo = ficha[c.clave];
              const esLista = Array.isArray(campo.valor);
              const texto = Array.isArray(campo.valor) ? campo.valor.join("\n") : (campo.valor ?? "");
              const rotulo = ROTULO_ORIGEN[campo.origen];
              return (
                <Campo
                  key={c.clave}
                  etiqueta={
                    <span className={styles.etiquetaFichaIA}>
                      {c.etiqueta}
                      {texto ? <Chip estado={rotulo.estado}>{rotulo.texto}</Chip> : null}
                      {campo.origen === "supuesto" && texto ? (
                        <Boton type="button" variante="fantasma" onClick={() => aceptar(c.clave)}>
                          Es correcto
                        </Boton>
                      ) : null}
                    </span>
                  }
                >
                  {esLista ? (
                    <textarea className="zx-control" rows={Math.max(2, Math.min(6, texto.split("\n").length))} value={texto} onChange={(e) => editar(c.clave, e.target.value, true)} />
                  ) : (
                    <input className="zx-control" value={texto} onChange={(e) => editar(c.clave, e.target.value, false)} />
                  )}
                </Campo>
              );
            })}
          </div>
          {pendientes.length > 0 ? (
            <p className={styles.avisoIA}>
              Revisa lo marcado «Confirmar» ({pendientes.length}): corrígelo, bórralo o marca «Es correcto». Lo que la IA supuso no se usa sin tu visto bueno.
            </p>
          ) : null}
          <div>
            <Boton type="button" variante={confirmada ? "secundario" : "primario"} onClick={confirmar} disabled={ocupado !== null || pendientes.length > 0 || !ficha.nombre.valor}>
              {confirmada ? "Ficha confirmada ✓" : "Confirmar ficha"}
            </Boton>
          </div>
        </div>
      ) : null}

      {ficha && confirmada ? (
        <>
          <div className={styles.bloqueIA}>
            <p className="zx-etiqueta">2. Títulos</p>
            <div>
              <Boton type="button" onClick={pedirTitulos} disabled={ocupado !== null}>
                {ocupado === "titulos" ? "Proponiendo…" : titulos ? "Proponer otros" : "Proponer títulos"}
              </Boton>
            </div>
            {titulos ? (
              <>
                {!titulos.conTendencias ? <p className={styles.ayudaIA}>Sin tendencias de la categoría: Mercado Libre no las devolvió (o no hay categoría).</p> : null}
                {[...titulos.titulos.map((t) => ({ t, max: LARGO_TITULO })), ...(titulos.catalogo ? [{ t: titulos.catalogo, max: LARGO_TITULO_CATALOGO }] : [])].map(({ t, max }) => (
                  <div key={t} className={styles.tituloIA}>
                    <span>
                      {max === LARGO_TITULO_CATALOGO ? <Chip>Catálogo</Chip> : null} <CopiarTexto valor={t} etiquetaAria={`Copiar título: ${t}`} />{" "}
                      <span className={styles.contadorIA}>
                        {t.length}/{max}
                      </span>
                    </span>
                    <span className={styles.accionesIA}>
                      {max === LARGO_TITULO ? (
                        <BotonesUsarEn cuentas={cuentasMismoPais} que={`título «${t}»`} onUsar={(ids) => usarTitulo(t, ids)} />
                      ) : null}
                    </span>
                  </div>
                ))}
                {hayOtroPais ? (
                  <p className={styles.ayudaIA}>{`Solo salen las cuentas de ${cuenta.siteId}: el texto está escrito para ese país. Para otro país, elige esa cuenta arriba y pide los títulos de nuevo.`}</p>
                ) : null}
                {titulos.palabras.length > 0 ? (
                  <p className={styles.ayudaIA}>
                    Palabras clave:{" "}
                    {titulos.palabras.map((p) => (
                      <span key={p.palabra} className={styles.palabraIA}>
                        {p.palabra} <Chip estado={p.origen === "tendencia" ? "exito" : p.origen === "vendedor" ? "neutro" : "aviso"}>{ROTULO_PALABRA[p.origen]}</Chip>
                      </span>
                    ))}
                  </p>
                ) : null}
              </>
            ) : null}
          </div>

          <div className={styles.bloqueIA}>
            <p className="zx-etiqueta">3. Descripción</p>
            <Campo etiqueta="Garantía (opcional; si la dejas vacía, la descripción no habla de garantía)">
              <input className="zx-control" maxLength={LARGO_GARANTIA} value={garantia} onChange={(e) => setGarantia(e.target.value)} placeholder="Ej.: Garantía del vendedor: 30 días por defectos de fábrica." />
            </Campo>
            <div>
              <Boton type="button" onClick={pedirDescripcion} disabled={ocupado !== null}>
                {ocupado === "descripcion" ? "Escribiendo…" : descripcion ? "Regenerar" : "Escribir descripción"}
              </Boton>
            </div>
            {descripcion ? (
              <>
                <textarea className="zx-control" rows={14} value={descripcion} onChange={(e) => setDescripcion(e.target.value)} aria-label="Descripción propuesta" />
                <span className={styles.accionesIA}>
                  <Boton
                    type="button"
                    variante="fantasma"
                    onClick={() => {
                      void navigator.clipboard.writeText(descripcion).then(
                        () => setCopiada(true),
                        () => setCopiada(false)
                      );
                    }}
                  >
                    {copiada ? "Copiada ✓" : "Copiar"}
                  </Boton>
                  <BotonesUsarEn cuentas={cuentasMismoPais} que="descripción" onUsar={usarDescripcion} />
                </span>
              </>
            ) : null}
          </div>
        </>
      ) : null}

      {pasoImagenes ? (
        <div className={styles.bloqueIA}>
          <p className="zx-etiqueta">4. Imágenes</p>
          {pasoImagenes}
        </div>
      ) : null}
    </div>
  );
}

// Un botón por cuenta (del mismo país) y «Usar en todas» si hay varias.
// El texto se pone abajo, en «Título, descripción y portada por cuenta».
export function BotonesUsarEn({ cuentas, que, onUsar }: { cuentas: Cuenta[]; que: string; onUsar: (ids: string[]) => void }) {
  if (cuentas.length === 0) return null;
  return (
    <>
      {cuentas.map((c) => (
        <Boton key={c.id} type="button" variante="primario" onClick={() => onUsar([c.id])} aria-label={`Usar ${que} en ${c.nickname}`}>
          {`Usar en ${c.nickname}`}
        </Boton>
      ))}
      {cuentas.length > 1 ? (
        <Boton type="button" variante="secundario" onClick={() => onUsar(cuentas.map((c) => c.id))} aria-label={`Usar ${que} en todas las cuentas`}>
          Usar en todas
        </Boton>
      ) : null}
    </>
  );
}
