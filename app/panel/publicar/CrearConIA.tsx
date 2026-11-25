"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { BarraCarga } from "@/components/marco/BarraCarga";
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
import { LARGO_TITULO, LARGO_TITULO_CATALOGO, type NivelBusqueda, type PalabraClave, type TendenciaConNivel } from "@/lib/publicaciones/titulos";
import { datosSitioMl } from "@/lib/ml/sitios";
import type { Cuenta } from "./CuentasDestino";
import { analizarProductoAction, escribirDescripcionAction, proponerTitulosAction } from "./ia/actions";
import { CLAVES_BORRADOR_IA, useBorradorIA } from "./ia/borradorIA";
import styles from "./publicar.module.css";

const ROTULO_ORIGEN: Record<Origen, { texto: string; estado: EstadoChip }> = {
  foto: { texto: "De la foto", estado: "exito" },
  vendedor: { texto: "Del vendedor", estado: "neutro" },
  supuesto: { texto: "Confirmar", estado: "advertencia" },
};
const ROTULO_PALABRA: Record<PalabraClave["origen"], string> = { tendencia: "Tendencia", vendedor: "Del vendedor", ia: "Sugerida por la IA" };
// Qué tan buscada es, según el nivel de categoría donde sale la tendencia.
const ROTULO_NIVEL: Record<NivelBusqueda, string> = { alta: "Alta", media: "Media", baja: "Baja" };
const LEYENDA_NIVEL: Record<NivelBusqueda, string> = { alta: "Alta (categoría general)", media: "Media (categoría padre)", baja: "Baja (categoría específica)" };
const ESTADO_NIVEL: Record<NivelBusqueda, EstadoChip> = { alta: "exito", media: "advertencia", baja: "neutro" };

type Aviso = { texto: string; conectarIA?: boolean } | null;
type Titulos = {
  titulos: string[];
  catalogo: string | null;
  palabras: PalabraClave[];
  // Estados guardados viejos no las traen: por defecto [].
  keywordsPrincipales?: string[];
  keywordsNoUtilizadas?: string[];
  conTendencias: boolean;
  masBuscados: TendenciaConNivel[];
  rutaCategoria: string[];
  tendenciasSinRelacion: boolean;
};

// Sub pestañas debajo de la ficha (24-nov). Las 3 quedan montadas y solo
// se oculta la inactiva: cambiar de una a otra nunca borra nada, ni corta
// una imagen que se está creando.
type SubPestana = "imagenes" | "titulos" | "descripcion";
const SUB_PESTANAS: { id: SubPestana; nombre: string }[] = [
  { id: "imagenes", nombre: "Generar imágenes" },
  { id: "titulos", nombre: "Títulos" },
  { id: "descripcion", nombre: "Descripción" },
];

// Lo que se guarda por 2 horas (ia/borradorIA.ts); los avisos y lo que
// está «ocupado» no, porque no sobreviven a una recarga.
type BorradorTextos = {
  cuentaId: string;
  info: string;
  garantia: string;
  ficha: Ficha | null;
  confirmada: boolean;
  categoria: { id: string; nombre: string } | null;
  leyoFotos: boolean;
  titulos: Titulos | null;
  // Una descripción por cuenta marcada (id de la cuenta → texto).
  descripciones: Record<string, string>;
  pestana: SubPestana;
};

// Misma ruta que lib/publicaciones/errores.ts (ese módulo es de servidor).
const RUTA_CONECTAR_IA = "/panel/conectar-ia";

const TITULO_CARGA_IA = {
  analisis: "Analizando el producto con IA…",
  titulos: "Proponiendo títulos…",
  descripcion: "Proponiendo descripción…",
} as const;

// Publicar → «Crear con IA» (PR1, textos). La IA de la empresa analiza
// las fotos del borrador y lo que escribe el vendedor (ficha con el
// origen de cada dato), y con la ficha CONFIRMADA propone títulos y la
// descripción. «Usar en <cuenta>» / «Usar en todas» solo llena el borrador de la
// cuenta o las cuentas elegidas: nada se publica desde acá.
// La ficha va fija arriba; imágenes, títulos y descripción, en sub
// pestañas. Todo se guarda 2 horas en esta pestaña del navegador.
export function CrearConIA({
  cuentas,
  fotos,
  onUsarTitulo,
  onUsarDescripcion,
  onFicha,
  referencias,
  pasoImagenes,
  onEmpezarDeCero,
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
  // «Empezar de cero»: borra lo guardado y vuelve a montar la sección.
  onEmpezarDeCero?: () => void;
}) {
  const [cuentaId, setCuentaId] = useState(cuentas[0]?.id ?? "");
  const [info, setInfo] = useState("");
  const [garantia, setGarantia] = useState("");
  const [ficha, setFicha] = useState<Ficha | null>(null);
  const [confirmada, setConfirmada] = useState(false);
  const [categoria, setCategoria] = useState<{ id: string; nombre: string } | null>(null);
  const [leyoFotos, setLeyoFotos] = useState(true);
  const [titulos, setTitulos] = useState<Titulos | null>(null);
  // Una por cuenta marcada (24-nov): mismos datos y secciones, otra redacción.
  const [descripciones, setDescripciones] = useState<Record<string, string>>({});
  const [ocupado, setOcupado] = useState<null | "analisis" | "titulos" | "descripcion">(null);
  const [aviso, setAviso] = useState<Aviso>(null);
  const [usado, setUsado] = useState<string | null>(null);
  const [copiada, setCopiada] = useState<string | null>(null);
  const [pestana, setPestana] = useState<SubPestana>("imagenes");
  // Al confirmar, la ficha se pliega en una línea; se despliega para revisarla.
  const [fichaAbierta, setFichaAbierta] = useState(true);

  useBorradorIA<BorradorTextos>(
    CLAVES_BORRADOR_IA.textos,
    { cuentaId, info, garantia, ficha, confirmada, categoria, leyoFotos, titulos, descripciones, pestana },
    (b) => {
      if (cuentas.some((c) => c.id === b.cuentaId)) setCuentaId(b.cuentaId);
      setInfo(b.info);
      setGarantia(b.garantia);
      setFicha(b.ficha);
      setConfirmada(b.confirmada);
      setCategoria(b.categoria);
      setLeyoFotos(b.leyoFotos);
      setTitulos(b.titulos ? { ...b.titulos, keywordsPrincipales: b.titulos.keywordsPrincipales ?? [], keywordsNoUtilizadas: b.titulos.keywordsNoUtilizadas ?? [] } : null);
      setDescripciones(b.descripciones ?? {});
      setPestana(b.pestana);
      setFichaAbierta(!b.confirmada);
      // «Generar imágenes» necesita la ficha confirmada otra vez.
      if (b.ficha && b.confirmada) onFicha?.({ ficha: b.ficha, categoriaId: b.categoria?.id ?? null });
    }
  );

  const cuenta = cuentas.find((c) => c.id === cuentaId) ?? cuentas[0];
  if (!cuenta) {
    return <p className={styles.ayudaIA}>Marca arriba al menos una cuenta destino para crear los textos con IA en su idioma.</p>;
  }
  const pendientes = ficha ? camposPorConfirmar(ficha) : [];
  // Una cuenta por país (la primera marcada de cada uno).
  const paises = cuentas.filter((c, i) => cuentas.findIndex((x) => x.siteId === c.siteId) === i);

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
      setFichaAbierta(true);
      setCategoria(r.categoria);
      onFicha?.(null);
      setLeyoFotos(r.leyoFotos);
      setConfirmada(false);
      setTitulos(null);
      setDescripciones({});
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
    setFichaAbierta(false);
    onFicha?.({ ficha: limpia as Ficha, categoriaId: categoria?.id ?? null });
  }

  function pedirTitulos() {
    if (!ficha) return;
    void correr("titulos", () => proponerTitulosAction({
          cuentaMlId: cuenta.id,
          ficha,
          categoriaId: categoria?.id ?? null,
          categoriaNombre: categoria?.nombre ?? null,
          info,
        }), (r) => {
      if (r.ok)
        setTitulos({ titulos: r.titulos, catalogo: r.catalogo, palabras: r.palabras, keywordsPrincipales: r.keywordsPrincipales, keywordsNoUtilizadas: r.keywordsNoUtilizadas, conTendencias: r.conTendencias, masBuscados: r.masBuscados, rutaCategoria: r.rutaCategoria, tendenciasSinRelacion: r.tendenciasSinRelacion });
    });
  }

  // Una descripción por cuenta, todas a la vez (la cola de la empresa
  // deja máximo 4 llamadas de texto simultáneas). Cada cuenta recibe la
  // «versión N de M» con su propio enfoque y en el idioma de su país.
  // `soloId`: «Proponer otra» para una sola cuenta.
  async function pedirDescripciones(soloId?: string) {
    if (!ficha) return;
    const destino = soloId ? cuentas.filter((c) => c.id === soloId) : cuentas;
    setOcupado("descripcion");
    setAviso(null);
    setUsado(null);
    const resultados = await Promise.all(
      destino.map(async (c) => {
        const variante = { numero: cuentas.findIndex((x) => x.id === c.id) + 1, total: cuentas.length };
        try {
          return { id: c.id, r: await escribirDescripcionAction({ cuentaMlId: c.id, ficha, garantia, palabrasClave: palabrasParaDescripcion, variante }) };
        } catch {
          return { id: c.id, r: { ok: false as const, aviso: "No se pudo completar. Intenta de nuevo." } };
        }
      })
    );
    const nuevas: Record<string, string> = {};
    for (const { id, r } of resultados) if (r.ok) nuevas[id] = r.descripcion;
    setDescripciones((d) => ({ ...d, ...nuevas }));
    const fallo = resultados.find((x) => !x.r.ok)?.r as { aviso?: string; conectarIA?: boolean } | undefined;
    if (fallo) {
      const nombre = cuentas.find((c) => c.id === resultados.find((x) => !x.r.ok)?.id)?.nickname;
      setAviso({ texto: `${nombre ? `${nombre}: ` : ""}${fallo.aviso ?? "No se pudo completar. Intenta de nuevo."}`, conectarIA: fallo.conectarIA });
    }
    setCopiada(null);
    setOcupado(null);
  }


  // Cuentas donde se puede usar el texto: las marcadas del MISMO país que
  // la cuenta de destino (el texto se escribió en su idioma).
  const cuentasMismoPais = cuentas.filter((c) => c.siteId === cuenta.siteId);
  const hayOtroPais = cuentasMismoPais.length < cuentas.length;
  // La descripción usa las palabras clave de los títulos (si ya se pidieron).
  const palabrasParaDescripcion = titulos
    ? [...new Map([...titulos.palabras.map((p) => p.palabra), ...(titulos.keywordsNoUtilizadas ?? [])].map((p) => [p.toLowerCase(), p])).values()]
    : [];

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

  // Cada cuenta recibe SU descripción.
  function usarDescripcion(ids: string[]) {
    for (const id of ids) if (descripciones[id]) onUsarDescripcion(id, descripciones[id]);
    setUsado(`Descripción puesta en ${ids.length > 1 ? "las cuentas" : "la cuenta"} ${nombres(ids)}. Revísala abajo.`);
  }

  // Avisos de la IA y «Título puesto en…»: bajo «Analizar» mientras no hay
  // ficha; después, justo bajo las sub pestañas (donde se pidió).
  const mensajes = (
    <>
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
    </>
  );
  // Al confirmar se muestra plegada (ver arriba en el return).
  const bloqueFicha = ficha ? (
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
  ) : null;
  const sinFicha = <p className={styles.ayudaIA}>Primero analiza el producto y pulsa «Confirmar ficha» (arriba).</p>;

  return (
    <div className={styles.crearIA}>
      <p className={styles.ayudaIA}>
        La IA de tu empresa (Administración → Conectar IA) mira tus imágenes de referencia y lo que escribas, arma la ficha del producto y, cuando la
        confirmas, propone títulos, escribe la descripción y crea imágenes de venta. Lo cobra tu cuenta de IA. Nada se publica desde aquí.
      </p>
      <p className={styles.ayudaIA}>
        Lo que hagas aquí se guarda 2 horas en esta pestaña del navegador, aunque cambies de sub pestaña o recargues la página.
        {onEmpezarDeCero ? (
          <>
            {" "}
            <Boton type="button" variante="fantasma" onClick={onEmpezarDeCero} disabled={ocupado !== null}>
              Empezar de cero
            </Boton>
          </>
        ) : null}
      </p>

      {/* El paso 1 se ve desde el principio: los datos de abajo y, después de «Analizar», la ficha. */}
      <p className="zx-etiqueta">1. Ficha del producto</p>

      {/* Solo si las cuentas marcadas son de países distintos (25-nov): el
          país define la categoría y el idioma y las tendencias de los títulos.
          Con un solo país no hay nada que elegir. */}
      {paises.length > 1 ? (
        <Campo etiqueta="País para la categoría y los títulos">
          <select className="zx-control" value={paises.find((p) => p.siteId === cuenta.siteId)?.id ?? cuenta.id} onChange={(e) => setCuentaId(e.target.value)} disabled={ocupado !== null}>
            {paises.map((p) => (
              <option key={p.id} value={p.id}>
                {datosSitioMl(p.siteId).nombre} ({p.siteId})
              </option>
            ))}
          </select>
        </Campo>
      ) : null}

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

      {!ficha ? mensajes : null}

      {ficha && confirmada ? (
        <details className={styles.fichaPlegadaIA} open={fichaAbierta} onToggle={(e) => setFichaAbierta(e.currentTarget.open)}>
          <summary>
            <span className={styles.okIA}>Ficha confirmada ✓</span>
            {ficha.nombre.valor ? <span> · {Array.isArray(ficha.nombre.valor) ? ficha.nombre.valor.join(" ") : ficha.nombre.valor}</span> : null}
            <span className={styles.ayudaIA}> — {fichaAbierta ? "ocultar" : "ver o editar"}</span>
          </summary>
          {bloqueFicha}
        </details>
      ) : (
        bloqueFicha
      )}

      <BarraCarga
        estado={ocupado !== null ? "cargando" : "inactiva"}
        titulo={ocupado !== null ? TITULO_CARGA_IA[ocupado] : ""}
        avance={null}
        sticky={false}
      />

      <div className={styles.bloqueIA}>
        <div className={styles.subPestanasIA} role="tablist" aria-label="Qué crear con la IA">
          {SUB_PESTANAS.filter((p) => p.id !== "imagenes" || pasoImagenes).map((p) => (
            <Boton
              key={p.id}
              type="button"
              role="tab"
              id={`subpestana-ia-${p.id}`}
              aria-selected={pestana === p.id}
              aria-controls={`panel-ia-${p.id}`}
              variante={pestana === p.id ? "primario" : "secundario"}
              onClick={() => setPestana(p.id)}
            >
              {p.nombre}
            </Boton>
          ))}
        </div>

        {ficha ? mensajes : null}

        {pasoImagenes ? (
          <div role="tabpanel" id="panel-ia-imagenes" aria-labelledby="subpestana-ia-imagenes" hidden={pestana !== "imagenes"} className={styles.crearIA}>
            {pasoImagenes}
          </div>
        ) : null}

        <div role="tabpanel" id="panel-ia-titulos" aria-labelledby="subpestana-ia-titulos" hidden={pestana !== "titulos"} className={styles.crearIA}>
          {ficha && confirmada ? (
            <>
                <div>
                  <Boton type="button" onClick={pedirTitulos} disabled={ocupado !== null}>
                    {ocupado === "titulos" ? "Proponiendo…" : titulos ? "Proponer otros" : "Proponer títulos"}
                  </Boton>
                </div>
                {titulos ? (
                  <>
                    {titulos.tendenciasSinRelacion ? (
                      <p className={styles.ayudaIA}>
                        Mercado Libre no tiene tendencias para esta categoría, y las de las categorías más generales no se relacionan con tu producto: los títulos
                        salen de tu ficha.
                      </p>
                    ) : !titulos.conTendencias ? (
                      <p className={styles.ayudaIA}>Sin tendencias de la categoría: Mercado Libre no las devolvió (o no hay categoría).</p>
                    ) : null}
                    {titulos.masBuscados.length > 0 ? (
                      <div className={styles.masBuscadosIA}>
                        <p className="zx-etiqueta">{`Más buscados en la categoría (${titulos.masBuscados.length})`}</p>
                        <span className={styles.accionesIA}>
                          {(["alta", "media", "baja"] as const)
                            .filter((n) => titulos.masBuscados.some((t) => t.nivel === n))
                            .map((n) => (
                              <Chip key={n} estado={ESTADO_NIVEL[n]}>
                                {LEYENDA_NIVEL[n]}
                              </Chip>
                            ))}
                        </span>
                        {titulos.rutaCategoria.length > 0 ? <p className={styles.ayudaIA}>Categorías analizadas: {titulos.rutaCategoria.join(" → ")}</p> : null}
                        <span className={styles.accionesIA}>
                          {titulos.masBuscados.map((t) => (
                            <Chip key={t.palabra} estado={ESTADO_NIVEL[t.nivel]}>
                              {t.palabra}
                            </Chip>
                          ))}
                        </span>
                      </div>
                    ) : null}
                    <ol className={styles.listaTitulosIA} aria-label="Títulos sugeridos">
                      {titulos.titulos.map((t, i) => (
                        <li key={t}>
                          <FilaTituloIA t={t} max={LARGO_TITULO} numero={i + 1} acciones={<BotonesUsarEn cuentas={cuentasMismoPais} que={`título «${t}»`} onUsar={(ids) => usarTitulo(t, ids)} />} />
                        </li>
                      ))}
                    </ol>
                    {titulos.catalogo ? <FilaTituloIA t={titulos.catalogo} max={LARGO_TITULO_CATALOGO} catalogo /> : null}
                    <ListaKeywordsIA titulo="Keywords principales" lista={titulos.keywordsPrincipales ?? []} />
                    <ListaKeywordsIA titulo="Keywords no utilizadas (para la descripción)" lista={titulos.keywordsNoUtilizadas ?? []} />
                    {hayOtroPais ? (
                      <p className={styles.ayudaIA}>{`Solo salen las cuentas de ${cuenta.siteId}: el texto está escrito para ese país. Para otro país, elígelo arriba en «País para la categoría y los títulos» y pide los títulos de nuevo.`}</p>
                    ) : null}
                    {titulos.palabras.length > 0 ? (
                      <p className={styles.ayudaIA}>
                        Palabras clave:{" "}
                        {titulos.palabras.map((p) => (
                          <span key={p.palabra} className={styles.palabraIA}>
                            {p.palabra}{" "}
                            <Chip estado={p.origen === "tendencia" ? "exito" : p.origen === "vendedor" ? "neutro" : "aviso"}>
                              {p.nivel ? `${ROTULO_PALABRA[p.origen]} · ${ROTULO_NIVEL[p.nivel]}` : ROTULO_PALABRA[p.origen]}
                            </Chip>
                          </span>
                        ))}
                      </p>
                    ) : null}
                  </>
                ) : null}
            </>
          ) : (
            sinFicha
          )}
        </div>

        <div role="tabpanel" id="panel-ia-descripcion" aria-labelledby="subpestana-ia-descripcion" hidden={pestana !== "descripcion"} className={styles.crearIA}>
          {ficha && confirmada ? (
            <>
                <Campo etiqueta="Garantía (opcional; si la dejas vacía, la descripción no habla de garantía)">
                  <input className="zx-control" maxLength={LARGO_GARANTIA} value={garantia} onChange={(e) => setGarantia(e.target.value)} placeholder="Ej.: Garantía del vendedor: 30 días por defectos de fábrica." />
                </Campo>
                <div>
                  <Boton type="button" onClick={() => void pedirDescripciones()} disabled={ocupado !== null}>
                    {ocupado === "descripcion"
                      ? "Proponiendo…"
                      : cuentas.length > 1
                        ? Object.keys(descripciones).length > 0
                          ? `Proponer otras ${cuentas.length}`
                          : `Proponer ${cuentas.length} descripciones (una por cuenta)`
                        : Object.keys(descripciones).length > 0
                          ? "Proponer otra"
                          : "Proponer descripción"}
                  </Boton>
                </div>
                {cuentas.length > 1 ? (
                  <p className={styles.ayudaIA}>Cada cuenta recibe una descripción distinta, con las mismas secciones y los mismos datos, en el idioma de su país.</p>
                ) : null}
                {cuentas.filter((c) => descripciones[c.id] !== undefined).length > 1 ? (
                  <div>
                    <Boton type="button" variante="secundario" onClick={() => usarDescripcion(cuentas.filter((c) => descripciones[c.id]).map((c) => c.id))} disabled={ocupado !== null}>
                      Usar cada una en su cuenta
                    </Boton>
                  </div>
                ) : null}
                {cuentas
                  .filter((c) => descripciones[c.id] !== undefined)
                  .map((c) => (
                    <div key={c.id} className={styles.crearIA}>
                      <p className="zx-etiqueta">{`Descripción para ${c.nickname} · ${c.siteId}`}</p>
                      <textarea
                        className="zx-control"
                        rows={14}
                        value={descripciones[c.id]}
                        onChange={(e) => setDescripciones((d) => ({ ...d, [c.id]: e.target.value }))}
                        aria-label={`Descripción propuesta para ${c.nickname}`}
                      />
                      <span className={styles.accionesIA}>
                        <Boton
                          type="button"
                          variante="fantasma"
                          onClick={() => {
                            void navigator.clipboard.writeText(descripciones[c.id]).then(
                              () => setCopiada(c.id),
                              () => setCopiada(null)
                            );
                          }}
                        >
                          {copiada === c.id ? "Copiada ✓" : "Copiar"}
                        </Boton>
                        <Boton type="button" variante="primario" onClick={() => usarDescripcion([c.id])} aria-label={`Usar descripción en ${c.nickname}`}>
                          {`Usar en ${c.nickname}`}
                        </Boton>
                        {cuentas.length > 1 ? (
                          <Boton type="button" variante="fantasma" onClick={() => void pedirDescripciones(c.id)} disabled={ocupado !== null}>
                            Proponer otra para esta cuenta
                          </Boton>
                        ) : null}
                      </span>
                    </div>
                  ))}
            </>
          ) : (
            sinFicha
          )}
        </div>
      </div>
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

// Una sugerencia de título con su largo, contado por el código (nunca por la IA).
function FilaTituloIA({ t, max, numero, catalogo, acciones }: { t: string; max: number; numero?: number; catalogo?: boolean; acciones?: ReactNode }) {
  return (
    <div className={styles.tituloIA}>
      <span>
        {numero ? <span aria-hidden="true">{numero}. </span> : null}
        {catalogo ? <Chip>Catálogo</Chip> : null} <CopiarTexto valor={t} etiquetaAria={`Copiar título: ${t}`} />{" "}
        <span className={styles.contadorIA} aria-label={`${t.length} de ${max} caracteres`}>
          {t.length}/{max}
        </span>
        <span className={styles.barraTituloIA} aria-hidden="true">
          <span style={{ width: `${Math.min(100, Math.round((t.length / max) * 100))}%` }} />
        </span>
      </span>
      <span className={styles.accionesIA}>{acciones}</span>
    </div>
  );
}

function ListaKeywordsIA({ titulo, lista }: { titulo: string; lista: string[] }) {
  if (lista.length === 0) return null;
  return (
    <div className={styles.masBuscadosIA}>
      <p className="zx-etiqueta">{`${titulo} (${lista.length})`}</p>
      <ul className={styles.listaKeywordsIA} aria-label={titulo}>
        {lista.map((k) => (
          <li key={k}>
            <Chip>{k}</Chip>
          </li>
        ))}
      </ul>
    </div>
  );
}
