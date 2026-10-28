"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Boton } from "@/components/marco/Boton";
import { Campo } from "@/components/marco/Campo";
import { crearYPublicarProductoAction } from "./actions";
import { SelectorCategoria, type CategoriaElegida } from "./SelectorCategoria";
import { CaracteristicasDinamicas, type CaracteristicaCategoria } from "./CaracteristicasDinamicas";
import { EditorVariantes, type VariantesEditadas } from "./EditorVariantes";
import { esRellenoFalsoDimensiones, fotosDentroDelLimite, serializarCategoriaOverride, serializarClaveValor } from "./formulario-logica";

const SITE_ID = "MCO"; // único país en alcance (Parte 1) — mismo criterio que lib/ml/cliente.ts

type Cuenta = { id: string; nickname: string };
type DatosCuenta = { titulo: string; descripcion: string; portadaUrl: string };
type RespuestaCaracteristicas = {
  categoryId: string;
  categoryName: string;
  principales: CaracteristicaCategoria[];
  secundarias: CaracteristicaCategoria[];
  maxPicturesPerItem: number | null;
};

const estilo = {
  campo: { fontSize: 13, display: "block", marginBottom: 10 },
  input: { display: "block", width: "100%", padding: 8, marginTop: 4, boxSizing: "border-box" as const },
  textarea: { display: "block", width: "100%", padding: 8, marginTop: 4, boxSizing: "border-box" as const, fontFamily: "inherit" },
  fieldset: { border: "1px solid #ddd", borderRadius: 6, padding: 12, marginBottom: 10 },
};

function datosCuentaVacios(): DatosCuenta {
  return { titulo: "", descripcion: "", portadaUrl: "" };
}

// ADENDO UX de Publicar — reemplaza el formulario "texto estructurado
// simple" de la Parte 0 (atributos/variantes/categoría como texto a
// mano) por la UX real que pedía Mateo: buscador/árbol de categoría,
// atributos dinámicos por categoría, editor visual de variantes. La
// LÓGICA de negocio (lib/ml/publicar.ts, lib/ml/publicar-reglas.ts) no
// cambia nada — esto solo llena mejor los mismos campos que
// nuevo/actions.ts ya sabía leer (atributosExtra/categoriasOverride/
// variantes como texto serializado, ver formulario-logica.ts).
export function FormularioPublicar({ cuentas, prefill }: { cuentas: Cuenta[]; prefill: { titulo: string; precio: string; foto: string } }) {
  const [incluidas, setIncluidas] = useState<Record<string, boolean>>({});
  const [datosPorCuenta, setDatosPorCuenta] = useState<Record<string, DatosCuenta>>(() => {
    const inicial: Record<string, DatosCuenta> = {};
    for (const c of cuentas) inicial[c.id] = { ...datosCuentaVacios(), titulo: prefill.titulo, portadaUrl: prefill.foto };
    return inicial;
  });

  const [precio, setPrecio] = useState(prefill.precio);
  const [stock, setStock] = useState("1");
  const [condicion, setCondicion] = useState<"new" | "used">("new");
  const [envioGratis, setEnvioGratis] = useState(false);
  const [sku, setSku] = useState("");
  const [dimensiones, setDimensiones] = useState({ peso: "", largo: "", ancho: "", alto: "" });
  const [imagenes, setImagenes] = useState<string[]>(prefill.foto ? [prefill.foto] : []);
  const [atributosExtra, setAtributosExtra] = useState<Record<string, string>>({});
  const [categoriaElegida, setCategoriaElegida] = useState<CategoriaElegida | null>(null);
  const [caracteristicas, setCaracteristicas] = useState<{ principales: CaracteristicaCategoria[]; secundarias: CaracteristicaCategoria[] } | null>(null);
  const [maxFotos, setMaxFotos] = useState<number | null>(null);
  const [variantes, setVariantes] = useState<VariantesEditadas | null>(null);
  const [portadasPorVariante, setPortadasPorVariante] = useState<Record<string, string>>({});
  // Punto 6 del ADENDO — "modo prueba ACTIVADO por defecto": acá (y no
  // en db/schema.ts) a propósito — el default de la COLUMNA sigue en
  // false (ningún otro camino de creación, ej. una futura importación
  // en lote, se vuelve "modo prueba" sin que nadie lo haya pedido);
  // esto es solo el valor inicial de ESTA pantalla.
  const [modoPrueba, setModoPrueba] = useState(true);

  const [cargando, setCargando] = useState(false);
  const [errorCategoria, setErrorCategoria] = useState<string | null>(null);
  const [errorEnvio, setErrorEnvio] = useState<string | null>(null);

  const cuentasMarcadas = useMemo(() => cuentas.filter((c) => incluidas[c.id]), [cuentas, incluidas]);
  const cuentaReferencia = cuentasMarcadas[0]?.id ?? null;
  const tituloReferencia = (cuentaReferencia ? datosPorCuenta[cuentaReferencia]?.titulo : "") || "";

  function actualizarCuenta(id: string, campo: keyof DatosCuenta, valor: string) {
    setDatosPorCuenta((actual) => ({ ...actual, [id]: { ...(actual[id] ?? datosCuentaVacios()), [campo]: valor } }));
  }

  // Punto 10 del ADENDO — "botón 'copiar el primero a todas'": título,
  // descripción, portada Y portadasPorVariante de la primera cuenta
  // marcada se copian a las demás marcadas — nunca a una cuenta sin
  // marcar (reunión 31/8: título/descripción/portada son
  // independientes por cuenta POR DEFECTO, esto es un atajo explícito,
  // nunca el comportamiento forzado).
  function copiarPrimeroATodas() {
    if (!cuentaReferencia) return;
    const base = datosPorCuenta[cuentaReferencia] ?? datosCuentaVacios();
    setDatosPorCuenta((actual) => {
      const nuevo = { ...actual };
      for (const c of cuentasMarcadas) nuevo[c.id] = { ...base };
      return nuevo;
    });
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

  function onElegirCategoria(cat: CategoriaElegida) {
    void cargarCaracteristicas(cat.categoryId);
  }

  function agregarFoto() {
    setImagenes((actual) => [...actual, ""]);
  }
  function actualizarFoto(i: number, valor: string) {
    setImagenes((actual) => actual.map((f, idx) => (idx === i ? valor : f)));
  }
  function quitarFoto(i: number) {
    setImagenes((actual) => actual.filter((_, idx) => idx !== i));
  }

  const candidatosVariante = caracteristicas ? [...caracteristicas.principales, ...caracteristicas.secundarias].filter((c) => c.permiteVariante) : [];

  const categoriaOverrideTexto = categoriaElegida ? serializarCategoriaOverride(SITE_ID, tituloReferencia, categoriaElegida.categoryId) : "";
  const atributosExtraTexto = serializarClaveValor(atributosExtra);
  // Mismo JSON que ya leía nuevo/actions.ts a mano (VariantesProducto:
  // ejes, ejeFoto, combinaciones:[{valores,sku,stock,precio}]) —
  // armado solo cuando hay al menos una combinación generada.
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

  // Punto 9 del ADENDO — "bloquear si las 4 medidas son <=1 (relleno
  // falso), igual que OS". Chequeo client-side ANTES de postear —
  // nunca reemplaza la validación real de Mercado Libre (el servidor
  // sigue mapeando faltanDimensionesPaquete si de todas formas faltan),
  // solo evita el viaje redondo cuando el error ya se puede ver acá.
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
    <form action={crearYPublicarProductoAction} onSubmit={onSubmit} style={{ marginTop: 20 }}>
      <h2 style={{ fontSize: 15, fontWeight: 600, marginTop: 0 }}>Cuentas donde publicar</h2>
      {cuentas.map((c) => (
        <fieldset key={c.id} style={estilo.fieldset}>
          <label style={{ fontSize: 14, fontWeight: 600, display: "flex", alignItems: "center", gap: 8 }}>
            <input
              type="checkbox"
              name={`incluir_${c.id}`}
              checked={Boolean(incluidas[c.id])}
              onChange={(e) => setIncluidas((actual) => ({ ...actual, [c.id]: e.target.checked }))}
            />
            {c.nickname}
          </label>
          <label style={estilo.campo}>
            Título para esta cuenta (máx. 60 caracteres reales en Mercado Libre)
            <input
              name={`titulo_${c.id}`}
              style={estilo.input}
              value={datosPorCuenta[c.id]?.titulo ?? ""}
              onChange={(e) => actualizarCuenta(c.id, "titulo", e.target.value)}
            />
          </label>
          <label style={estilo.campo}>
            Descripción para esta cuenta
            <textarea
              name={`descripcion_${c.id}`}
              rows={2}
              style={estilo.textarea}
              value={datosPorCuenta[c.id]?.descripcion ?? ""}
              onChange={(e) => actualizarCuenta(c.id, "descripcion", e.target.value)}
            />
          </label>
          <label style={estilo.campo}>
            URL de la foto de portada para esta cuenta
            <input
              name={`portada_${c.id}`}
              style={estilo.input}
              value={datosPorCuenta[c.id]?.portadaUrl ?? ""}
              onChange={(e) => actualizarCuenta(c.id, "portadaUrl", e.target.value)}
            />
          </label>
          {/* Punto 4 del ADENDO — portadasPorVariante va POR CUENTA en
          el contrato real (DatosPorCuenta.portadasPorVariante,
          lib/ml/publicar-tipos.ts); el editor visual arma un solo
          mapeo compartido y se replica a cada cuenta marcada acá, para
          no pedir la misma foto por variante una vez por cuenta. */}
          <input type="hidden" name={`portadasPorVariante_${c.id}`} value={JSON.stringify(portadasPorVariante)} />
        </fieldset>
      ))}
      {cuentasMarcadas.length >= 2 && (
        <p style={{ marginTop: -4, marginBottom: 10 }}>
          <Boton type="button" variante="secundario" chico onClick={copiarPrimeroATodas}>
            Copiar el primero a todas las marcadas
          </Boton>
        </p>
      )}
      <p style={{ fontSize: 12, opacity: 0.7, marginTop: -4 }}>
        Título, descripción y portada son independientes por cada cuenta — si una cuenta marcada no tiene título propio, se usa el de la
        primera cuenta que sí lo tenga.
      </p>

      <h2 style={{ fontSize: 15, fontWeight: 600 }}>Datos del producto (compartidos entre cuentas)</h2>
      <label style={estilo.campo}>
        Precio
        <input name="precio" type="number" step="0.01" required style={estilo.input} value={precio} onChange={(e) => setPrecio(e.target.value)} />
      </label>
      <label style={estilo.campo}>
        Stock
        <input name="stock" type="number" style={estilo.input} value={stock} onChange={(e) => setStock(e.target.value)} />
      </label>
      <label style={estilo.campo}>
        Condición
        <select name="condicion" style={estilo.input} value={condicion} onChange={(e) => setCondicion(e.target.value as "new" | "used")}>
          <option value="new">Nuevo</option>
          <option value="used">Usado</option>
        </select>
      </label>
      <label style={{ fontSize: 13, display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
        <input type="checkbox" name="envioGratis" checked={envioGratis} onChange={(e) => setEnvioGratis(e.target.checked)} /> Envío gratis
      </label>
      <label style={estilo.campo}>
        SKU propio (opcional)
        <input name="sku" style={estilo.input} value={sku} onChange={(e) => setSku(e.target.value)} />
      </label>

      <h3 style={{ fontSize: 14, fontWeight: 600 }}>Dimensiones del paquete</h3>
      <div style={{ display: "flex", gap: 8 }}>
        {(["peso", "largo", "ancho", "alto"] as const).map((campo) => (
          <label key={campo} style={{ ...estilo.campo, flex: 1 }}>
            {campo === "peso" ? "Peso (g)" : `${campo[0].toUpperCase()}${campo.slice(1)} (cm)`}
            <input
              name={campo}
              type="number"
              style={estilo.input}
              value={dimensiones[campo]}
              onChange={(e) => setDimensiones((actual) => ({ ...actual, [campo]: e.target.value }))}
            />
          </label>
        ))}
      </div>
      <p style={{ fontSize: 12, opacity: 0.7, marginTop: -4 }}>
        Mercado Libre las exige siempre para calcular el envío, aunque la categoría no las liste como obligatorias.
      </p>
      {errorEnvio && <p style={{ fontSize: 13, color: "#b00020" }}>{errorEnvio}</p>}

      <h3 style={{ fontSize: 14, fontWeight: 600 }}>Fotos (galería)</h3>
      {imagenes.map((url, i) => (
        <div key={i} style={{ display: "flex", gap: 8, marginBottom: 6 }}>
          <input style={{ ...estilo.input, marginTop: 0 }} value={url} onChange={(e) => actualizarFoto(i, e.target.value)} placeholder="https://.../foto.jpg" />
          <Boton type="button" variante="fantasma" chico onClick={() => quitarFoto(i)}>
            Quitar
          </Boton>
        </div>
      ))}
      <Boton type="button" variante="secundario" chico onClick={agregarFoto} disabled={maxFotos != null && imagenes.length >= maxFotos}>
        + Agregar foto
      </Boton>
      {maxFotos != null && (
        <p style={{ fontSize: 12, opacity: 0.7, marginTop: 6 }}>
          Esta categoría admite hasta {maxFotos} fotos en Mercado Libre
          {imagenes.length > maxFotos ? " — se van a recortar las que sobren al publicar." : "."}
        </p>
      )}
      <p style={{ fontSize: 12, opacity: 0.7 }}>La primera es la portada si ninguna cuenta tiene una propia.</p>
      {/* Mismo textarea que ya leía nuevo/actions.ts (una URL por
      línea) — se mantiene como el campo real que se envía, ahora
      poblado desde los inputs de arriba en vez de escrito a mano.
      Punto 5 del ADENDO — "respetar max_pictures": se recorta ACÁ, al
      enviar, nunca solo en el aviso de texto — para que publicar con
      la galería ya cargada ANTES de detectar la categoría tampoco
      mande de más. */}
      <textarea name="imagenes" value={fotosDentroDelLimite(imagenes.filter(Boolean), maxFotos).join("\n")} readOnly hidden />

      <h2 style={{ fontSize: 15, fontWeight: 600 }}>Categoría de Mercado Libre</h2>
      <p style={{ fontSize: 13 }}>
        {categoriaElegida ? (
          <>
            Categoría: <strong>{categoriaElegida.categoryName}</strong> <span style={{ opacity: 0.6 }}>({categoriaElegida.categoryId})</span>
          </>
        ) : (
          <span style={{ opacity: 0.7 }}>Todavía sin detectar.</span>
        )}
      </p>
      <Boton type="button" variante="secundario" chico onClick={() => cargarCaracteristicas()} disabled={cargando || !cuentaReferencia}>
        {cargando ? "Detectando…" : "Detectar categoría y características"}
      </Boton>
      {errorCategoria && <p style={{ fontSize: 13, color: "#b00020", marginTop: 8 }}>{errorCategoria}</p>}
      <SelectorCategoria cuentaId={cuentaReferencia} onElegir={onElegirCategoria} />
      {/* Mismo textarea/formato que ya leía nuevo/actions.ts
      (siteId::título=categoryId) — ahora se llena solo al elegir
      categoría arriba, nunca a mano. */}
      <textarea name="categoriasOverride" value={categoriaOverrideTexto} readOnly hidden />

      {caracteristicas && (
        <>
          <h3 style={{ fontSize: 14, fontWeight: 600 }}>Características de la categoría</h3>
          <CaracteristicasDinamicas
            principales={caracteristicas.principales}
            secundarias={caracteristicas.secundarias}
            valores={atributosExtra}
            onCambiar={(id, valor) => setAtributosExtra((actual) => ({ ...actual, [id]: valor }))}
          />
          <EditorVariantes
            candidatos={candidatosVariante}
            value={variantes}
            portadasPorVariante={portadasPorVariante}
            onChange={setVariantes}
            onCambiarPortadas={setPortadasPorVariante}
          />
        </>
      )}
      {/* Mismos 2 campos que ya leía nuevo/actions.ts (ID=valor por
      línea / JSON) — llenados por la UI dinámica de arriba. */}
      <textarea name="atributosExtra" value={atributosExtraTexto} readOnly hidden />
      <textarea name="variantes" value={variantesTexto} readOnly hidden />

      <label style={{ fontSize: 13, display: "flex", alignItems: "center", gap: 8, margin: "16px 0 20px" }}>
        <input type="checkbox" name="modoPrueba" checked={modoPrueba} onChange={(e) => setModoPrueba(e.target.checked)} /> Modo prueba (se publica y
        se pausa de inmediato, nunca queda visible al público)
      </label>

      <button type="submit" style={{ padding: "10px 18px", background: "#000", color: "#fff", border: "none", borderRadius: 6, fontSize: 14 }}>
        Publicar
      </button>

      <p style={{ marginTop: 24 }}>
        <Link href="/panel/publicar" style={{ fontSize: 13 }}>
          Cancelar
        </Link>
      </p>
    </form>
  );
}
