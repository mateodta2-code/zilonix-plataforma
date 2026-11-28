"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Boton } from "@/components/marco/Boton";
import { Campo } from "@/components/marco/Campo";
import { Tarjeta } from "@/components/marco/Tarjeta";
import { crearYPublicarProductoAction } from "./actions";
import { ConectarCanva } from "./ConectarCanva";
import { mensajeErrorConectarCanva } from "./canva-mensajes-error";
import { CuentasDestino, type Cuenta } from "./CuentasDestino";
import { SeccionFalabella } from "./SeccionFalabella";
import { CrearConIA } from "./CrearConIA";
import { GenerarConIA } from "./GenerarConIA";
import { borrarBorradoresIA, CLAVES_BORRADOR_IA, useBorradorIA } from "./ia/borradorIA";
import type { Ficha } from "@/lib/publicaciones/ficha";
import { GaleriaFotos } from "./GaleriaFotos";
import { PortadaCuenta } from "./PortadaCuenta";
import { SelectorCategoria, type CategoriaElegida } from "./SelectorCategoria";
import { CaracteristicasDinamicas, type CaracteristicaCategoria } from "./CaracteristicasDinamicas";
import { EditorVariantes, type VariantesEditadas } from "./EditorVariantes";
import {
  esRellenoFalsoDimensiones,
  fotosDentroDelLimite,
  reemplazarOAgregarFoto,
  serializarCategoriaOverride,
  serializarClaveValor,
  type EstadoInicialFormulario,
} from "./formulario-logica";
import { SITE_ID_DEFECTO } from "@/lib/ml/sitios";
import styles from "./publicar.module.css";

type DatosCuenta = { titulo: string; descripcion: string; portadaUrl: string };
type RespuestaCaracteristicas = {
  categoryId: string;
  categoryName: string;
  principales: CaracteristicaCategoria[];
  secundarias: CaracteristicaCategoria[];
  maxPicturesPerItem: number | null;
};

// Parte 2 (página única, estructura de Zilonix OS) — reemplaza el
// `prefill: {titulo,precio,foto}` angosto de la Parte 1 por un
// `inicial: EstadoInicialFormulario` completo (formulario-logica.ts):
// el mismo tipo que ya usa construirEstadoInicial para Cargar/
// Reintentar y Duplicar. page.tsx/PaginaPublicar.tsx deciden CÓMO se
// armó ese estado (desde el query de Investigación, desde una fila
// del historial, o uno vacío) — este componente ya no sabe de dónde
// vino, solo lo usa como valor inicial. PaginaPublicar.tsx lo
// REMONTA (prop `key`) cada vez que cambia, para que los `useState`
// de abajo arranquen de cero con los valores nuevos — nunca hace
// falta un efecto que "reseedee" el estado a mano.
export function FormularioPublicar({
  cuentas,
  cuentasFalabella,
  inicial,
  cloudinaryConfigurado,
  canva,
  canvaCodigo,
}: {
  cuentas: Cuenta[];
  // Cuentas de Falabella conectadas: van en «Cuentas destino» como otro grupo,
  // pero nunca entran a las secciones por cuenta de Mercado Libre.
  cuentasFalabella: Cuenta[];
  inicial: EstadoInicialFormulario;
  cloudinaryConfigurado: boolean;
  canva: string;
  canvaCodigo: string;
}) {
  // ALTO 2, review PR #372 — /api/canva/conectar y /api/canva/callback
  // redirigen con ?canva=error&codigo=... o ?canva=conectado (ver esos
  // route.ts), pero nadie los leía: la persona quedaba sin ningún aviso.
  const avisoErrorCanva = canva === "error" ? mensajeErrorConectarCanva(canvaCodigo || undefined) : null;
  const avisoExitoCanva = canva === "conectado";

  // BAJO, review 2 del PR #372 — una vez mostrado el aviso (error o
  // éxito), se limpia `canva`/`codigo` de la URL para que no quede
  // colgado ahí (un refresh de la página no debe repetir el aviso).
  // router.replace con la misma ruta, sin navegación completa.
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  useEffect(() => {
    if (canva !== "error" && canva !== "conectado") return;
    const params = new URLSearchParams(searchParams.toString());
    params.delete("canva");
    params.delete("codigo");
    const query = params.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  }, [canva, pathname, router, searchParams]);
  const [incluidas, setIncluidas] = useState<Record<string, boolean>>(() => {
    const mapa: Record<string, boolean> = {};
    for (const id of inicial.cuentasIncluidas) mapa[id] = true;
    return mapa;
  });
  const [datosPorCuenta, setDatosPorCuenta] = useState<Record<string, DatosCuenta>>(() => ({ ...inicial.datosPorCuenta }));

  const [precio, setPrecio] = useState(inicial.precio);
  const [stock, setStock] = useState(inicial.stock);
  const [condicion, setCondicion] = useState<"new" | "used">(inicial.condicion);
  const [envioGratis, setEnvioGratis] = useState(inicial.envioGratis);
  const [sku, setSku] = useState(inicial.sku);
  const [dimensiones, setDimensiones] = useState(inicial.dimensiones);
  const [imagenes, setImagenes] = useState<string[]>(inicial.imagenes);
  const [atributosExtra, setAtributosExtra] = useState<Record<string, string>>(inicial.atributosExtra);
  const [categoriaElegida, setCategoriaElegida] = useState<CategoriaElegida | null>(null);
  const [caracteristicas, setCaracteristicas] = useState<{ principales: CaracteristicaCategoria[]; secundarias: CaracteristicaCategoria[] } | null>(null);
  const [maxFotos, setMaxFotos] = useState<number | null>(null);
  // Zona de fotos: «Subir mis fotos» (lo de siempre) o «Generar con IA» (PR2).
  const [fichaIA, setFichaIA] = useState<{ ficha: Ficha; categoriaId: string | null } | null>(null);
  // Imágenes creadas con IA que ya están en la galería: no se usan como
  // «foto real» de referencia para analizar ni para crear otras.
  const [generadasIA, setGeneradasIA] = useState<string[]>([]);
  const fotosReales = imagenes.filter((u) => u && !generadasIA.includes(u));
  // «Imágenes de referencia» (1 o 2) del generador: solo se usan como
  // referencia para la IA, nunca se publican. Sin ellas, se usan las fotos
  // reales de la galería.
  const [referenciasIA, setReferenciasIA] = useState<string[]>([]);
  // Se guardan 2 horas con el resto del generador (ia/borradorIA.ts).
  useBorradorIA<string[]>(CLAVES_BORRADOR_IA.referencias, referenciasIA, setReferenciasIA);
  // «Empezar de cero»: borra lo guardado y remonta el generador entero.
  const [reinicioIA, setReinicioIA] = useState(0);
  function empezarDeCeroIA() {
    borrarBorradoresIA();
    setReferenciasIA([]);
    setFichaIA(null);
    setReinicioIA((n) => n + 1);
  }
  const fotosParaIA = referenciasIA.filter(Boolean).length > 0 ? referenciasIA.filter(Boolean) : fotosReales;

  // Una imagen creada entra sola a la galería (al regenerar, en el lugar
  // de la anterior). false = galería llena según la categoría.
  // Se crean de a 2 a la vez: se trabaja sobre la lista más reciente (ref)
  // para que una imagen no pise a la otra.
  const imagenesRef = useRef(imagenes);
  imagenesRef.current = imagenes;
  // Desde «Imágenes creadas» (24-nov): nada entra solo a la galería.
  // «Agregar a la galería» la pone al final; false = galería llena.
  function agregarGeneradaAGaleria(url: string): boolean {
    const resultado = reemplazarOAgregarFoto(imagenesRef.current.filter(Boolean), url, null, maxFotos);
    if (!resultado) return false;
    imagenesRef.current = resultado;
    setImagenes(resultado);
    setGeneradasIA((g) => (g.includes(url) ? g : [...g, url]));
    return true;
  }

  // Al regenerar una imagen creada: la nueva toma el lugar de la anterior
  // en la galería y en la portada de las cuentas que la usaban.
  function reemplazarGenerada(anterior: string, nueva: string) {
    const actuales = imagenesRef.current.filter(Boolean);
    if (actuales.includes(anterior)) {
      const resultado = actuales.map((f) => (f === anterior ? nueva : f));
      imagenesRef.current = resultado;
      setImagenes(resultado);
      setGeneradasIA((g) => (g.includes(nueva) ? g : [...g, nueva]));
    }
    setDatosPorCuenta((actual) =>
      Object.fromEntries(Object.entries(actual).map(([id, d]) => [id, d.portadaUrl === anterior ? { ...d, portadaUrl: nueva } : d]))
    );
  }
  const [variantes, setVariantes] = useState<VariantesEditadas | null>(inicial.variantes);
  const [portadasPorVariante, setPortadasPorVariante] = useState<Record<string, string>>(inicial.portadasPorVariante);
  // Punto 7 del pedido — "ACTIVADO por defecto" en una publicación
  // NUEVA; al cargar/duplicar un producto ya guardado, se respeta lo
  // que esa fila tenía (inicial.modoPrueba), nunca se fuerza a true de
  // nuevo encima de una elección ya hecha.
  const [modoPrueba, setModoPrueba] = useState(inicial.modoPrueba);

  const [cargando, setCargando] = useState(false);
  const [errorCategoria, setErrorCategoria] = useState<string | null>(null);
  const [errorEnvio, setErrorEnvio] = useState<string | null>(null);

  const cuentasMarcadas = useMemo(() => cuentas.filter((c) => incluidas[c.id]), [cuentas, incluidas]);
  const falabellaMarcadas = useMemo(() => cuentasFalabella.filter((c) => incluidas[c.id]), [cuentasFalabella, incluidas]);
  const cuentaReferencia = cuentasMarcadas[0]?.id ?? null;
  // Issue #315 — la categoría se detecta/guarda en el site_id REAL de
  // la cuenta de referencia (la primera marcada), nunca "MCO" fijo.
  const siteIdReferencia = cuentasMarcadas[0]?.siteId ?? SITE_ID_DEFECTO;
  const tituloReferencia = (cuentaReferencia ? datosPorCuenta[cuentaReferencia]?.titulo : "") || "";

  function actualizarCuenta(id: string, campo: keyof DatosCuenta, valor: string) {
    setDatosPorCuenta((actual) => ({ ...actual, [id]: { ...(actual[id] ?? { titulo: "", descripcion: "", portadaUrl: "" }), [campo]: valor } }));
  }

  async function cargarCaracteristicas(categoriaIdManual?: string) {
    if (!cuentaReferencia || !tituloReferencia.trim()) {
      setErrorCategoria("Elige al menos una cuenta y escribe un título para esa cuenta antes de detectar la categoría.");
      return;
    }
    setCargando(true);
    setErrorCategoria(null);
    try {
      const params = new URLSearchParams({ cuentaId: cuentaReferencia, titulo: tituloReferencia });
      if (categoriaIdManual) params.set("categoriaId", categoriaIdManual);
      const resp = await fetch(`/api/ml/publicar/caracteristicas?${params.toString()}`);
      const data = (await resp.json()) as RespuestaCaracteristicas & { error?: string };
      if (!resp.ok) throw new Error(data.error ?? "No se pudo detectar la categoría.");
      setCategoriaElegida({ categoryId: data.categoryId, categoryName: data.categoryName });
      setCaracteristicas({ principales: data.principales, secundarias: data.secundarias });
      setMaxFotos(data.maxPicturesPerItem);
    } catch (e) {
      setErrorCategoria(e instanceof Error ? e.message : "No se pudo detectar la categoría.");
    } finally {
      setCargando(false);
    }
  }

  // Punto 8 del pedido ("Cargar/Reintentar") — si la fila ya tenía una
  // categoría resuelta para este mismo título (categoriasOverride,
  // ver construirEstadoInicial), se vuelve a detectar SOLA al montar
  // — nunca hace falta tocar "Detectar según el título" de nuevo solo
  // para ver los mismos atributos que ya se habían llenado. Solo una
  // vez, al montar (nunca en cada tecla) — este componente se REMONTA
  // entero (key) cuando cambia `inicial`, así que un mount real es
  // siempre "se cargó un producto distinto", nunca un re-render común.
  useEffect(() => {
    const clave = cuentaReferencia ? `${siteIdReferencia}::${tituloReferencia}` : "";
    const categoriaYaConocida = clave ? inicial.categoriasOverride[clave] : undefined;
    if (categoriaYaConocida) void cargarCaracteristicas(categoriaYaConocida);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- solo al montar, a propósito (ver comentario arriba)
  }, []);

  function onElegirCategoria(cat: CategoriaElegida) {
    void cargarCaracteristicas(cat.categoryId);
  }

  const candidatosVariante = caracteristicas ? [...caracteristicas.principales, ...caracteristicas.secundarias].filter((c) => c.permiteVariante) : [];

  const categoriaOverrideTexto = categoriaElegida ? serializarCategoriaOverride(siteIdReferencia, tituloReferencia, categoriaElegida.categoryId) : "";
  const atributosExtraTexto = serializarClaveValor(atributosExtra);
  const variantesTexto =
    variantes && variantes.combinaciones.length > 0
      ? JSON.stringify({
          ejes: variantes.ejes,
          ejeFoto: variantes.ejeFoto,
          combinaciones: variantes.combinaciones.map((c) => ({
            valores: c.valores,
            sku: c.sku || undefined,
            stock: c.stock ? Number(c.stock) : undefined,
            precio: c.precio ? Number(c.precio) : undefined,
          })),
        })
      : "";

  // Punto 10 del ADENDO original (Parte 1), vigente acá — "copiar el
  // primero a todas": título/descripción/portada/portadasPorVariante
  // de la primera cuenta MARCADA a las demás marcadas.
  function copiarPrimeroATodas() {
    if (!cuentaReferencia) return;
    const base = datosPorCuenta[cuentaReferencia] ?? { titulo: "", descripcion: "", portadaUrl: "" };
    setDatosPorCuenta((actual) => {
      const nuevo = { ...actual };
      for (const c of cuentasMarcadas) nuevo[c.id] = { ...base };
      return nuevo;
    });
  }

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    setErrorEnvio(null);
    if (cuentasMarcadas.length === 0 && falabellaMarcadas.length === 0) {
      e.preventDefault();
      setErrorEnvio("Elige al menos una cuenta (Mercado Libre o Falabella) donde publicar.");
      return;
    }
    // Las medidas de Mercado Libre solo se exigen si hay una cuenta de Mercado Libre marcada.
    if (cuentasMarcadas.length > 0 && esRellenoFalsoDimensiones(dimensiones)) {
      e.preventDefault();
      setErrorEnvio(
        "Las 4 medidas del paquete están en 1 o menos — parece un relleno sin medir de verdad. Mercado Libre usa esto para calcular el envío real: completá el peso/largo/ancho/alto reales del paquete."
      );
    }
  }

  return (
    <form id="formulario-publicar" action={crearYPublicarProductoAction} onSubmit={onSubmit}>
      {/* --- Primer paso visible: conectar Canva (antes vivía dentro de
      GaleriaFotos.tsx, debajo de las miniaturas — se mueve arriba
      porque resuelve de dónde van a salir las fotos antes de armar el
      resto de la publicación). Gateado por cloudinaryConfigurado: sin
      Cloudinary no hay forma de traer lo que Canva exporte. --- */}
      {cloudinaryConfigurado && (
        <Tarjeta className={styles.seccion}>
          <p className="zx-etiqueta">Conectar Canva</p>
          <p style={{ fontSize: 13, color: "var(--texto-suave)", marginTop: 8 }}>Conecta tu Canva para traer tus diseños como fotos.</p>
          {avisoErrorCanva && <p style={{ fontSize: 13, color: "var(--kpi-peligro-texto)", marginTop: 8 }}>{avisoErrorCanva}</p>}
          {avisoExitoCanva && <p style={{ fontSize: 13, color: "var(--kpi-exito-texto)", marginTop: 8 }}>Canva conectado correctamente.</p>}
          <div style={{ marginTop: 10 }}>
            <ConectarCanva />
          </div>
        </Tarjeta>
      )}

      {/* --- Punto 3: Cuentas destino --- */}
      <Tarjeta className={styles.seccion}>
        <p className="zx-etiqueta">Cuentas destino</p>
        <CuentasDestino
          grupos={[{ titulo: "Mercado Libre", cuentas }, ...(cuentasFalabella.length > 0 ? [{ titulo: "Falabella", cuentas: cuentasFalabella }] : [])]} incluidas={incluidas}
          onCambiar={setIncluidas}
        />
      </Tarjeta>

      {/* --- Publicar en Falabella: solo si hay una cuenta de Falabella marcada --- */}
      {falabellaMarcadas.length > 0 && <SeccionFalabella cuentaId={falabellaMarcadas[0].id} tituloSugerido={tituloReferencia.slice(0, 60)} />}

      {/* --- Punto 4: Datos generales --- */}
      <Tarjeta className={styles.seccion}>
        <p className="zx-etiqueta">Datos generales (iguales para todas)</p>
        <Campo etiqueta="Precio">
          <input name="precio" type="number" step="0.01" required className="zx-control" value={precio} onChange={(e) => setPrecio(e.target.value)} />
        </Campo>
        <Campo etiqueta="Stock (c/u)">
          <input name="stock" type="number" className="zx-control" value={stock} onChange={(e) => setStock(e.target.value)} />
        </Campo>
        <Campo etiqueta="SKU propio (opcional)">
          <input name="sku" className="zx-control" value={sku} onChange={(e) => setSku(e.target.value)} />
        </Campo>
        <Campo etiqueta="Condición">
          <select name="condicion" className="zx-control" value={condicion} onChange={(e) => setCondicion(e.target.value as "new" | "used")}>
            <option value="new">Nuevo</option>
            <option value="used">Usado</option>
          </select>
        </Campo>

        <p className="zx-etiqueta" style={{ marginTop: 16 }}>
          Dimensiones del paquete
        </p>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8 }}>
          <div style={{ flex: "1 1 120px" }}>
            <Campo etiqueta="Peso (g)">
              <input
                name="peso"
                type="number"
                className="zx-control"
                value={dimensiones.peso}
                onChange={(e) => setDimensiones((actual) => ({ ...actual, peso: e.target.value }))}
                placeholder="Ej: 300 = 300g, no kilos"
              />
            </Campo>
          </div>
          {(["largo", "ancho", "alto"] as const).map((campo) => (
            <div key={campo} style={{ flex: "1 1 100px" }}>
              <Campo etiqueta={`${campo[0].toUpperCase()}${campo.slice(1)} (cm)`}>
                <input
                  name={campo}
                  type="number"
                  className="zx-control"
                  value={dimensiones[campo]}
                  onChange={(e) => setDimensiones((actual) => ({ ...actual, [campo]: e.target.value }))}
                />
              </Campo>
            </div>
          ))}
        </div>
        <p style={{ fontSize: 12, color: "var(--texto-suave)", marginTop: 6 }}>
          Mercado Libre las exige siempre para calcular el envío, aunque la categoría no las liste como obligatorias.
        </p>
        {errorEnvio && <p style={{ fontSize: 13, color: "var(--kpi-peligro-texto)" }}>{errorEnvio}</p>}

        <label style={{ fontSize: 13, display: "flex", alignItems: "center", gap: 8, margin: "12px 0" }}>
          <input type="checkbox" name="envioGratis" checked={envioGratis} onChange={(e) => setEnvioGratis(e.target.checked)} /> Envío gratis
        </label>

        <p className="zx-etiqueta" style={{ marginTop: 16 }}>
          Fotos (galería)
        </p>
        {/* Code review de Pablo (sobre 768305e) — se quitó el botón
        "+ Agregar foto (URL)" de acá: empujaba una URL vacía ("") a
        la galería (un hueco real — esa foto vacía podía colarse hasta
        el envío si nadie la completaba); la tarjeta "+" de
        GaleriaFotos.tsx ya cubre lo mismo, pidiendo la URL antes de
        agregar nada. */}
        {/* Las imágenes creadas en «Generación de imágenes para Meli» se agregan a esta galería desde «Imágenes creadas» (botón o arrastrándolas); las portadas van a cada cuenta, no aquí. */}
        <GaleriaFotos urls={imagenes} onChange={setImagenes} cloudinaryConfigurado={cloudinaryConfigurado} limiteFotos={maxFotos} />
        {maxFotos != null && (
          <p style={{ fontSize: 12, color: "var(--texto-suave)", marginTop: 8 }}>
            Esta categoría admite hasta {maxFotos} fotos en Mercado Libre
            {imagenes.length > maxFotos ? " — se van a recortar las que sobren al publicar." : "."}
          </p>
        )}
        <p style={{ fontSize: 12, color: "var(--texto-suave)" }}>
          La primera es la portada si ninguna cuenta tiene una propia. Puedes pegar una URL externa, subir un archivo de tu PC, o traer una exportación de Canva.
        </p>
        <textarea name="imagenes" value={fotosDentroDelLimite(imagenes.filter(Boolean), maxFotos).join("\n")} readOnly hidden />
      </Tarjeta>

      {/* --- «Generación de imágenes para Meli» (antes «Crear con IA», 23-nov):
          imágenes de referencia (solo para la IA), información y 1. ficha
          arriba; debajo, sub pestañas Generar imágenes / Títulos /
          Descripción (24-nov), guardadas 2 horas en la pestaña. «Usar en» llena la cuenta
          de abajo y las imágenes entran a la galería de arriba. --- */}
      <Tarjeta className={styles.seccion}>
        <p className="zx-etiqueta">Generación de imágenes para Meli</p>
        <CrearConIA
          key={reinicioIA}
          cuentas={cuentasMarcadas}
          fotos={fotosParaIA}
          referencias={
            <GaleriaFotos urls={referenciasIA} onChange={setReferenciasIA} cloudinaryConfigurado={cloudinaryConfigurado} limiteFotos={2} conCanva={false} etiquetaPortada={false} />
          }
          onUsarTitulo={(id, titulo) => actualizarCuenta(id, "titulo", titulo)}
          onUsarDescripcion={(id, descripcion) => actualizarCuenta(id, "descripcion", descripcion)}
          onFicha={setFichaIA}
          onEmpezarDeCero={empezarDeCeroIA}
          pasoImagenes={
            <GenerarConIA
              cuentas={cuentasMarcadas}
              ficha={fichaIA?.ficha ?? null}
              categoriaId={categoriaElegida?.categoryId ?? fichaIA?.categoriaId ?? null}
              fotos={fotosParaIA}
              espacioLibre={maxFotos == null ? null : Math.max(0, maxFotos - imagenes.filter(Boolean).length)}
              galeria={imagenes}
              portadas={Object.fromEntries(cuentasMarcadas.map((c) => [c.id, datosPorCuenta[c.id]?.portadaUrl ?? ""]))}
              onAgregarAGaleria={agregarGeneradaAGaleria}
              onUsarPortada={(id, url) => actualizarCuenta(id, "portadaUrl", url)}
              onReemplazar={reemplazarGenerada}
            />
          }
        />
      </Tarjeta>

      {/* --- Punto 5: título/descripción/portada por cuenta ELEGIDA --- */}
      <Tarjeta className={styles.seccion}>
        <div className={styles.filaAccion}>
          <p className="zx-etiqueta">Título, descripción y portada por cuenta</p>
          {cuentasMarcadas.length >= 2 && (
            <Boton type="button" variante="primario" onClick={copiarPrimeroATodas}>
              Copiar el primero a todas
            </Boton>
          )}
        </div>
        {cuentasMarcadas.length === 0 ? (
          <p style={{ fontSize: 13, color: "var(--texto-suave)", marginTop: 8 }}>Elige al menos una cuenta destino arriba para completar su título y descripción.</p>
        ) : (
          <div style={{ marginTop: 10 }}>
            {cuentasMarcadas.map((c) => (
              <div key={c.id} className={`${styles.recuadroMarca} ${styles.filaCuentaDetalle}`}>
                <PortadaCuenta
                  portadaUrl={datosPorCuenta[c.id]?.portadaUrl ?? ""}
                  onChange={(url) => actualizarCuenta(c.id, "portadaUrl", url)}
                  cloudinaryConfigurado={cloudinaryConfigurado}
                  previaGaleria={imagenes[0] ?? null}
                />
                <div style={{ flex: 1 }}>
                  <Campo etiqueta={`Título en ${c.nickname}`}>
                    <input
                      name={`titulo_${c.id}`}
                      className="zx-control"
                      value={datosPorCuenta[c.id]?.titulo ?? ""}
                      onChange={(e) => actualizarCuenta(c.id, "titulo", e.target.value)}
                    />
                  </Campo>
                  <Campo etiqueta={`Descripción en ${c.nickname}`}>
                    <textarea
                      name={`descripcion_${c.id}`}
                      rows={2}
                      className="zx-control"
                      value={datosPorCuenta[c.id]?.descripcion ?? ""}
                      onChange={(e) => actualizarCuenta(c.id, "descripcion", e.target.value)}
                    />
                  </Campo>
                  <input type="hidden" name={`portada_${c.id}`} value={datosPorCuenta[c.id]?.portadaUrl ?? ""} />
                </div>
              </div>
            ))}
          </div>
        )}
        {/* Todas las cuentas CONECTADAS necesitan su propio campo
        oculto para que actions.ts pueda leer incluir_{id} de
        cualquiera (marcada o no) — las no marcadas simplemente no
        tienen fila visible en esta sección. */}
        {cuentas.map((c) => (
          <input key={c.id} type="hidden" name={`portadasPorVariante_${c.id}`} value={JSON.stringify(portadasPorVariante)} />
        ))}
      </Tarjeta>

      {/* --- Punto 6: características de la categoría (variantes adentro) --- */}
      <Tarjeta className={styles.seccion}>
        <p className="zx-etiqueta">Características de la categoría</p>
        <p style={{ fontSize: 13, color: "var(--texto-suave)", marginTop: 8 }}>
          Mercado Libre exige elegir una categoría real y completar sus atributos antes de poder publicar — detectamos la categoría según el
          título de la primera cuenta elegida; si se equivoca, puedes buscarla a mano o navegar el árbol real.
        </p>
        <p style={{ fontSize: 13, marginTop: 8 }}>
          {categoriaElegida ? (
            <>
              Categoría: <strong>{categoriaElegida.categoryName}</strong> <span style={{ color: "var(--texto-suave)" }}>({categoriaElegida.categoryId})</span>
            </>
          ) : (
            <span style={{ color: "var(--texto-suave)" }}>Todavía sin detectar.</span>
          )}
        </p>
        <Boton type="button" variante="primario" onClick={() => cargarCaracteristicas()} disabled={cargando || !cuentaReferencia}>
          {cargando ? "Detectando…" : "Detectar según el título"}
        </Boton>
        {errorCategoria && <p style={{ fontSize: 13, color: "var(--kpi-peligro-texto)", marginTop: 8 }}>{errorCategoria}</p>}
        <SelectorCategoria cuentaId={cuentaReferencia} onElegir={onElegirCategoria} />
        <textarea name="categoriasOverride" value={categoriaOverrideTexto} readOnly hidden />

        {caracteristicas && (
          <>
            <p className="zx-etiqueta" style={{ marginTop: 16 }}>
              Atributos
            </p>
            <CaracteristicasDinamicas
              principales={caracteristicas.principales}
              secundarias={caracteristicas.secundarias}
              valores={atributosExtra}
              onCambiar={(id, valor) => setAtributosExtra((actual) => ({ ...actual, [id]: valor }))}
            />
            <p className="zx-etiqueta" style={{ marginTop: 16 }}>
              Variantes
            </p>
            <EditorVariantes
              candidatos={candidatosVariante}
              value={variantes}
              portadasPorVariante={portadasPorVariante}
              onChange={setVariantes}
              onCambiarPortadas={setPortadasPorVariante}
            />
          </>
        )}
        <textarea name="atributosExtra" value={atributosExtraTexto} readOnly hidden />
        <textarea name="variantes" value={variantesTexto} readOnly hidden />
      </Tarjeta>

      {/* --- Punto 7: modo prueba + publicar --- */}
      <Tarjeta className={styles.seccion}>
        <label style={{ fontSize: 13, display: "flex", alignItems: "flex-start", gap: 8, marginBottom: 16 }}>
          <input type="checkbox" name="modoPrueba" checked={modoPrueba} onChange={(e) => setModoPrueba(e.target.checked)} style={{ marginTop: 3 }} />
          <span>Modo prueba — publicar pausado (se crea de verdad pero nunca queda visible al público, para poder probarlo y borrarlo después)</span>
        </label>

        <Boton type="submit" variante="primario" disabled={cuentasMarcadas.length === 0}>
          Publicar en {cuentasMarcadas.length} cuenta{cuentasMarcadas.length === 1 ? "" : "s"}
        </Boton>
      </Tarjeta>
    </form>
  );
}
