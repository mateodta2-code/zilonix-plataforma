"use client";

import { useEffect, useMemo, useState } from "react";
import { Boton } from "@/components/marco/Boton";
import { Campo } from "@/components/marco/Campo";
import { Tarjeta } from "@/components/marco/Tarjeta";
import { crearYPublicarProductoAction } from "./actions";
import { CuentasDestino, type Cuenta } from "./CuentasDestino";
import { GaleriaFotos } from "./GaleriaFotos";
import { SelectorCategoria, type CategoriaElegida } from "./SelectorCategoria";
import { CaracteristicasDinamicas, type CaracteristicaCategoria } from "./CaracteristicasDinamicas";
import { EditorVariantes, type VariantesEditadas } from "./EditorVariantes";
import {
  esRellenoFalsoDimensiones,
  fotosDentroDelLimite,
  serializarCategoriaOverride,
  serializarClaveValor,
  type EstadoInicialFormulario,
} from "./formulario-logica";
import styles from "./publicar.module.css";

const SITE_ID = "MCO"; // único país en alcance — mismo criterio que lib/ml/cliente.ts

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
export function FormularioPublicar({ cuentas, inicial }: { cuentas: Cuenta[]; inicial: EstadoInicialFormulario }) {
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
  const cuentaReferencia = cuentasMarcadas[0]?.id ?? null;
  const tituloReferencia = (cuentaReferencia ? datosPorCuenta[cuentaReferencia]?.titulo : "") || "";

  function actualizarCuenta(id: string, campo: keyof DatosCuenta, valor: string) {
    setDatosPorCuenta((actual) => ({ ...actual, [id]: { ...(actual[id] ?? { titulo: "", descripcion: "", portadaUrl: "" }), [campo]: valor } }));
  }

  async function cargarCaracteristicas(categoriaIdManual?: string) {
    if (!cuentaReferencia || !tituloReferencia.trim()) {
      setErrorCategoria("Elegí al menos una cuenta y escribí un título para esa cuenta antes de detectar la categoría.");
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
    const clave = cuentaReferencia ? `${SITE_ID}::${tituloReferencia}` : "";
    const categoriaYaConocida = clave ? inicial.categoriasOverride[clave] : undefined;
    if (categoriaYaConocida) void cargarCaracteristicas(categoriaYaConocida);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- solo al montar, a propósito (ver comentario arriba)
  }, []);

  function onElegirCategoria(cat: CategoriaElegida) {
    void cargarCaracteristicas(cat.categoryId);
  }

  const candidatosVariante = caracteristicas ? [...caracteristicas.principales, ...caracteristicas.secundarias].filter((c) => c.permiteVariante) : [];

  const categoriaOverrideTexto = categoriaElegida ? serializarCategoriaOverride(SITE_ID, tituloReferencia, categoriaElegida.categoryId) : "";
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
    if (cuentasMarcadas.length === 0) {
      e.preventDefault();
      setErrorEnvio("Elegí al menos una cuenta de Mercado Libre donde publicar.");
      return;
    }
    if (esRellenoFalsoDimensiones(dimensiones)) {
      e.preventDefault();
      setErrorEnvio(
        "Las 4 medidas del paquete están en 1 o menos — parece un relleno sin medir de verdad. Mercado Libre usa esto para calcular el envío real: completá el peso/largo/ancho/alto reales del paquete."
      );
    }
  }

  return (
    <form id="formulario-publicar" action={crearYPublicarProductoAction} onSubmit={onSubmit}>
      {/* --- Punto 3: Cuentas destino --- */}
      <Tarjeta className={styles.seccion}>
        <p className="zx-etiqueta">Cuentas destino</p>
        <CuentasDestino grupos={[{ titulo: "Cuentas", cuentas }]} incluidas={incluidas} onCambiar={setIncluidas} />
      </Tarjeta>

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
        <GaleriaFotos urls={imagenes} onChange={setImagenes} />
        {maxFotos != null && (
          <p style={{ fontSize: 12, color: "var(--texto-suave)", marginTop: 8 }}>
            Esta categoría admite hasta {maxFotos} fotos en Mercado Libre
            {imagenes.length > maxFotos ? " — se van a recortar las que sobren al publicar." : "."}
          </p>
        )}
        <p style={{ fontSize: 12, color: "var(--texto-suave)" }}>
          La primera es la portada si ninguna cuenta tiene una propia. La subida real a Cloudinary llega más adelante — por ahora, URL externa.
        </p>
        <textarea name="imagenes" value={fotosDentroDelLimite(imagenes.filter(Boolean), maxFotos).join("\n")} readOnly hidden />
      </Tarjeta>

      {/* --- Punto 5: título/descripción/portada por cuenta ELEGIDA --- */}
      <Tarjeta className={styles.seccion}>
        <div className={styles.filaAccion}>
          <p className="zx-etiqueta">Título, descripción y portada por cuenta</p>
          {cuentasMarcadas.length >= 2 && (
            <Boton type="button" variante="secundario" chico onClick={copiarPrimeroATodas}>
              Copiar el primero a todas
            </Boton>
          )}
        </div>
        {cuentasMarcadas.length === 0 ? (
          <p style={{ fontSize: 13, color: "var(--texto-suave)", marginTop: 8 }}>Elegí al menos una cuenta destino arriba para completar su título y descripción.</p>
        ) : (
          <div style={{ marginTop: 10 }}>
            {cuentasMarcadas.map((c) => (
              <div key={c.id} className={`${styles.recuadroMarca} ${styles.filaCuentaDetalle}`}>
                <div className={`${styles.recuadroMarca} ${styles.portadaChica}`}>
                  {datosPorCuenta[c.id]?.portadaUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element -- URL externa puesta a mano
                    <img src={datosPorCuenta[c.id].portadaUrl} alt="" className={styles.portadaChicaImg} />
                  ) : null}
                </div>
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
                  <Campo etiqueta={`URL de la foto de portada en ${c.nickname}`}>
                    <input
                      name={`portada_${c.id}`}
                      className="zx-control"
                      value={datosPorCuenta[c.id]?.portadaUrl ?? ""}
                      onChange={(e) => actualizarCuenta(c.id, "portadaUrl", e.target.value)}
                    />
                  </Campo>
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
          título de la primera cuenta elegida; si se equivoca, podés buscarla a mano o navegar el árbol real.
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
        <Boton type="button" variante="secundario" chico onClick={() => cargarCaracteristicas()} disabled={cargando || !cuentaReferencia}>
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
