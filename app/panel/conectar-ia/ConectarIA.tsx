"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Boton } from "@/components/marco/Boton";
import { Campo } from "@/components/marco/Campo";
import { Chip } from "@/components/marco/Chip";
import { Tarjeta } from "@/components/marco/Tarjeta";
import { MAX_CONEXIONES_IA, MODULOS_IA, type ModuloIA } from "@/lib/ia/modulos";
import styles from "./conectarIa.module.css";

type Proveedor = "anthropic" | "openai" | "google" | "xai" | "otro_compatible_openai";
export type ConexionIAVista = {
  id: string;
  nombre: string;
  proveedor: Proveedor;
  baseUrl: string | null;
  modelo: string;
  esPrincipal: boolean;
  modulos: ModuloIA[];
};

const ETIQUETA_PROVEEDOR: Record<Proveedor, string> = {
  anthropic: "Anthropic (Claude)",
  openai: "OpenAI (ChatGPT)",
  google: "Google (Gemini)",
  xai: "xAI (Grok)",
  otro_compatible_openai: "Otro compatible con OpenAI",
};
const ETIQUETA_MODULO = Object.fromEntries(MODULOS_IA.map((m) => [m.id, m.etiqueta])) as Record<ModuloIA, string>;

// Varias IA por empresa (máx. 5). La API key NUNCA llega acá (el
// servidor solo manda metadatos): el campo arranca vacío y escribir una
// nueva es la única forma de cambiarla.
export function ConectarIA({ conexiones, puedeModificar }: { conexiones: ConexionIAVista[]; puedeModificar: boolean }) {
  const router = useRouter();
  // "nueva" = formulario de alta; un id = editando esa conexión.
  const [editando, setEditando] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState("");
  const [pruebas, setPruebas] = useState<Record<string, { ok: boolean; texto: string }>>({});

  const lleno = conexiones.length >= MAX_CONEXIONES_IA;

  async function llamar(url: string, metodo: string): Promise<{ ok: boolean; datos: Record<string, unknown> }> {
    setOcupado(true);
    setError("");
    const res = await fetch(url, { method: metodo, headers: { "Content-Type": "application/json" } });
    setOcupado(false);
    const datos = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    return { ok: res.ok, datos };
  }

  async function eliminar(c: ConexionIAVista) {
    if (!confirm(`¿Eliminar «${c.nombre}»? Los módulos que la usan pasarán a la IA principal.`)) return;
    const r = await llamar(`/api/configuracion/ia-conexion/${c.id}`, "DELETE");
    if (r.ok) router.refresh();
    else setError(typeof r.datos.error === "string" ? r.datos.error : "No se pudo eliminar.");
  }

  async function hacerPrincipal(c: ConexionIAVista) {
    const r = await llamar(`/api/configuracion/ia-conexion/${c.id}/principal`, "PUT");
    if (r.ok) router.refresh();
    else setError(typeof r.datos.error === "string" ? r.datos.error : "No se pudo cambiar la principal.");
  }

  async function probar(c: ConexionIAVista) {
    const r = await llamar(`/api/configuracion/ia-conexion/${c.id}/probar`, "POST");
    const ok = r.datos.ok === true;
    const texto = ok ? "Conexión correcta" : typeof r.datos.error === "string" ? r.datos.error : "No se pudo probar la conexión.";
    setPruebas((p) => ({ ...p, [c.id]: { ok, texto } }));
  }

  return (
    <Tarjeta className={styles.seccion}>
      <p className="zx-etiqueta">TUS IA CONECTADAS</p>
      <p className={styles.texto}>
        {conexiones.length} de {MAX_CONEXIONES_IA} IA conectadas
      </p>

      {conexiones.length === 0 && <p className={styles.texto}>Aún no conectas ninguna IA. Los módulos funcionan igual, solo con los números.</p>}

      <div className={styles.lista}>
        {conexiones.map((c) =>
          editando === c.id ? (
            <FormularioConexion key={c.id} inicial={c} onListo={() => { setEditando(null); router.refresh(); }} onCancelar={() => setEditando(null)} />
          ) : (
            <div key={c.id} className={styles.conexion}>
              <div className={styles.cabecera}>
                <strong>{c.nombre}</strong>
                <span>
                  {ETIQUETA_PROVEEDOR[c.proveedor]} — modelo <code>{c.modelo}</code>
                </span>
                {c.esPrincipal && <Chip estado="exito">Principal</Chip>}
                <span className={styles.nota}>Llave: Guardada ••••••••</span>
              </div>
              <div className={styles.chips}>
                {c.modulos.length === 0 ? (
                  <span className={styles.nota}>Sin módulos asignados: solo se usa donde sea la principal.</span>
                ) : (
                  c.modulos.map((m) => <Chip key={m}>{ETIQUETA_MODULO[m]}</Chip>)
                )}
              </div>
              {pruebas[c.id] && (
                <p className={styles.resultado}>
                  <Chip estado={pruebas[c.id].ok ? "exito" : "peligro"}>{pruebas[c.id].ok ? "OK" : "Falló"}</Chip>
                  {pruebas[c.id].texto}
                </p>
              )}
              {puedeModificar && (
                <>
                  <Modulos conexion={c} onCambio={() => router.refresh()} />
                  <div className={styles.acciones}>
                    <Boton type="button" variante="secundario" chico disabled={ocupado} onClick={() => setEditando(c.id)}>
                      Editar
                    </Boton>
                    <Boton type="button" variante="secundario" chico disabled={ocupado} onClick={() => probar(c)}>
                      Probar conexión
                    </Boton>
                    {!c.esPrincipal && (
                      <Boton type="button" variante="secundario" chico disabled={ocupado} onClick={() => hacerPrincipal(c)}>
                        Hacer principal
                      </Boton>
                    )}
                    <Boton type="button" variante="secundario" chico disabled={ocupado} onClick={() => eliminar(c)}>
                      Eliminar
                    </Boton>
                  </div>
                </>
              )}
            </div>
          )
        )}
      </div>

      {error && <p className={styles.error}>{error}</p>}

      {puedeModificar ? (
        editando === "nueva" ? (
          <FormularioConexion inicial={null} onListo={() => { setEditando(null); router.refresh(); }} onCancelar={() => setEditando(null)} />
        ) : (
          <div className={styles.acciones}>
            <Boton type="button" variante="primario" chico disabled={lleno || ocupado} onClick={() => setEditando("nueva")}>
              Agregar IA
            </Boton>
            {lleno && <span className={styles.nota}>Puedes conectar hasta {MAX_CONEXIONES_IA} IA</span>}
          </div>
        )
      ) : (
        <p className={styles.nota}>No tienes permiso para cambiar estas conexiones.</p>
      )}
    </Tarjeta>
  );
}

function Modulos({ conexion, onCambio }: { conexion: ConexionIAVista; onCambio: () => void }) {
  const [marcados, setMarcados] = useState<ModuloIA[]>(conexion.modulos);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState("");

  async function guardar(siguiente: ModuloIA[]) {
    setMarcados(siguiente);
    setGuardando(true);
    setError("");
    const res = await fetch(`/api/configuracion/ia-conexion/${conexion.id}/modulos`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ modulos: siguiente }),
    });
    setGuardando(false);
    if (res.ok) onCambio();
    else {
      setMarcados(conexion.modulos);
      setError("No se pudieron guardar los módulos.");
    }
  }

  return (
    <div className={styles.modulos}>
      <span className="zx-etiqueta">MÓDULOS QUE USAN ESTA IA</span>
      {MODULOS_IA.map((m) => (
        <label key={m.id}>
          <input
            type="checkbox"
            checked={marcados.includes(m.id)}
            disabled={guardando}
            onChange={(e) => guardar(e.target.checked ? [...marcados, m.id] : marcados.filter((x) => x !== m.id))}
          />
          {m.etiqueta}
          {(m as { proximamente?: boolean }).proximamente === true && <span className={styles.nota}> — Próximamente: aún no genera imágenes; solo dejas elegida la IA</span>}
        </label>
      ))}
      <span className={styles.nota}>
        Por ejemplo: Grok en Investigación y ChatGPT en Promociones. Lo que no marques usa la IA principal. Un módulo solo puede usar una IA a la vez.
      </span>
      {error && <span className={styles.error}>{error}</span>}
    </div>
  );
}

function FormularioConexion({ inicial, onListo, onCancelar }: { inicial: ConexionIAVista | null; onListo: () => void; onCancelar: () => void }) {
  const [nombre, setNombre] = useState(inicial?.nombre ?? "");
  const [proveedor, setProveedor] = useState<Proveedor>(inicial?.proveedor ?? "anthropic");
  const [modelo, setModelo] = useState(inicial?.modelo ?? "");
  const [baseUrl, setBaseUrl] = useState(inicial?.baseUrl ?? "");
  const [apiKey, setApiKey] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState("");

  async function guardar(e: React.FormEvent) {
    e.preventDefault();
    setGuardando(true);
    setError("");
    const res = await fetch(inicial ? `/api/configuracion/ia-conexion/${inicial.id}` : "/api/configuracion/ia-conexion", {
      method: inicial ? "PUT" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ nombre, proveedor, modelo, baseUrl: baseUrl || null, apiKey }),
    });
    setGuardando(false);
    if (res.ok) {
      setApiKey("");
      onListo();
    } else {
      const data = await res.json().catch(() => ({}));
      setError(data.error || "No se pudo guardar.");
    }
  }

  return (
    <form onSubmit={guardar} className={styles.formulario}>
      <Campo etiqueta="Nombre">
        <input className="zx-control" value={nombre} onChange={(e) => setNombre(e.target.value)} maxLength={60} placeholder="ej. ChatGPT de la empresa" required />
      </Campo>
      <Campo etiqueta="Proveedor">
        <select className="zx-control" value={proveedor} onChange={(e) => setProveedor(e.target.value as Proveedor)}>
          {Object.entries(ETIQUETA_PROVEEDOR).map(([valor, etiqueta]) => (
            <option key={valor} value={valor}>
              {etiqueta}
            </option>
          ))}
        </select>
      </Campo>
      <Campo etiqueta="Modelo">
        <input className="zx-control" value={modelo} onChange={(e) => setModelo(e.target.value)} placeholder="ej. claude-sonnet-5" required />
      </Campo>
      {proveedor === "otro_compatible_openai" && (
        <Campo etiqueta="URL base (compatible con OpenAI)">
          <input className="zx-control" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="https://..." required />
        </Campo>
      )}
      <Campo etiqueta={inicial ? "Nueva API key (déjala vacía para no cambiarla)" : "API key"}>
        <input className="zx-control" type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} autoComplete="off" placeholder={inicial ? "••••••••" : ""} />
      </Campo>
      {error && <p className={styles.error}>{error}</p>}
      <div className={styles.acciones}>
        <Boton type="submit" variante="primario" chico disabled={guardando || !nombre.trim() || !modelo.trim() || (!inicial && !apiKey.trim())}>
          {guardando ? "Guardando…" : "Guardar"}
        </Boton>
        <Boton type="button" variante="secundario" chico disabled={guardando} onClick={onCancelar}>
          Cancelar
        </Boton>
      </div>
    </form>
  );
}
