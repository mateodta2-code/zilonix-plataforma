import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import Link from "next/link";
import { listarEmpresasDeUsuario } from "@/lib/empresas";
import { obtenerMiMembresia } from "@/lib/membresias";
import { obtenerOCrearUsuarioActual } from "@/lib/usuarios";
import { requierePermiso, SinPermisoError } from "@/lib/permisos";
import { listarCuentasConectadas } from "@/lib/ml/cuentas";
import { crearYPublicarProductoAction } from "./actions";

const estilo = {
  campo: { fontSize: 13, display: "block", marginBottom: 10 },
  input: { display: "block", width: "100%", padding: 8, marginTop: 4, boxSizing: "border-box" as const },
  textarea: { display: "block", width: "100%", padding: 8, marginTop: 4, boxSizing: "border-box" as const, fontFamily: "inherit" },
  fieldset: { border: "1px solid #ddd", borderRadius: 6, padding: 12, marginBottom: 10 },
};

// Tarea 2.11 ("Publicar producto y clip") — formulario real. A
// propósito NO es un port pixel a pixel del formulario de 1724 líneas
// del sistema actual (eso es presentación, no la parte que Mateo pidió
// al 100%): cubre todos los campos reales que necesita
// lib/ml/publicar.ts, con atributos/variantes/categoría-override como
// texto estructurado simple en vez de un selector dinámico por
// categoría — la fidelidad del 100% está en la LÓGICA de negocio
// (lib/ml/publicar.ts, lib/ml/publicar-reglas.ts), no en replicar la
// UI vieja característica por característica.
export default async function PublicarNuevoPage() {
  const usuario = await obtenerOCrearUsuarioActual();
  if (!usuario) redirect("/sign-in");

  const propias = await listarEmpresasDeUsuario(usuario.id);
  const empresaId = cookies().get("empresa_actual")?.value;
  const empresa = propias.find((e) => e.id === empresaId) ?? propias[0];
  if (!empresa) redirect("/crear-empresa");

  try {
    await requierePermiso(usuario.id, empresa.id, "inventario", "crear");
  } catch (error) {
    if (!(error instanceof SinPermisoError)) throw error;
    const miMembresia = await obtenerMiMembresia(usuario.id, empresa.id);
    return (
      <main style={{ maxWidth: 480, margin: "0 auto", padding: "48px 24px" }}>
        <p>Tu rol ({miMembresia?.rolNombre ?? "sin rol"}) no tiene acceso a esta pantalla.</p>
        <Link href="/panel/publicar">Volver</Link>
      </main>
    );
  }

  const cuentas = (await listarCuentasConectadas(empresa.id)).filter((c) => !c.desconectadaTs);

  if (cuentas.length === 0) {
    return (
      <main style={{ maxWidth: 480, margin: "0 auto", padding: "48px 24px" }}>
        <p>Todavía no hay ninguna cuenta de Mercado Libre conectada.</p>
        <Link href="/panel/conectar-ml">Conectar una cuenta</Link>
      </main>
    );
  }

  return (
    <main style={{ maxWidth: 640, margin: "0 auto", padding: "48px 24px" }}>
      <h1 style={{ fontSize: 24, fontWeight: 700 }}>Publicar producto nuevo</h1>

      <form action={crearYPublicarProductoAction} style={{ marginTop: 20 }}>
        <h2 style={{ fontSize: 15, fontWeight: 600, marginTop: 0 }}>Cuentas donde publicar</h2>
        {cuentas.map((c) => (
          <fieldset key={c.id} style={estilo.fieldset}>
            <label style={{ fontSize: 14, fontWeight: 600, display: "flex", alignItems: "center", gap: 8 }}>
              <input type="checkbox" name={`incluir_${c.id}`} />
              {c.nickname}
            </label>
            <label style={estilo.campo}>
              Título para esta cuenta (máx. 60 caracteres reales en Mercado Libre)
              <input name={`titulo_${c.id}`} style={estilo.input} />
            </label>
            <label style={estilo.campo}>
              Descripción para esta cuenta
              <textarea name={`descripcion_${c.id}`} rows={2} style={estilo.textarea} />
            </label>
            <label style={estilo.campo}>
              URL de la foto de portada para esta cuenta
              <input name={`portada_${c.id}`} style={estilo.input} />
            </label>
          </fieldset>
        ))}
        <p style={{ fontSize: 12, opacity: 0.7, marginTop: -4 }}>
          Título, descripción y portada son independientes por cada cuenta — si una cuenta marcada no tiene título propio, se usa el de la
          primera cuenta que sí lo tenga.
        </p>

        <h2 style={{ fontSize: 15, fontWeight: 600 }}>Datos del producto (compartidos entre cuentas)</h2>
        <label style={estilo.campo}>
          Precio
          <input name="precio" type="number" step="0.01" required style={estilo.input} />
        </label>
        <label style={estilo.campo}>
          Stock
          <input name="stock" type="number" defaultValue={1} style={estilo.input} />
        </label>
        <label style={estilo.campo}>
          Condición
          <select name="condicion" defaultValue="new" style={estilo.input}>
            <option value="new">Nuevo</option>
            <option value="used">Usado</option>
          </select>
        </label>
        <label style={{ fontSize: 13, display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
          <input type="checkbox" name="envioGratis" /> Envío gratis
        </label>
        <label style={estilo.campo}>
          SKU propio (opcional)
          <input name="sku" style={estilo.input} />
        </label>

        <h3 style={{ fontSize: 14, fontWeight: 600 }}>Dimensiones del paquete</h3>
        <div style={{ display: "flex", gap: 8 }}>
          <label style={{ ...estilo.campo, flex: 1 }}>
            Peso (g)
            <input name="peso" type="number" style={estilo.input} />
          </label>
          <label style={{ ...estilo.campo, flex: 1 }}>
            Largo (cm)
            <input name="largo" type="number" style={estilo.input} />
          </label>
          <label style={{ ...estilo.campo, flex: 1 }}>
            Ancho (cm)
            <input name="ancho" type="number" style={estilo.input} />
          </label>
          <label style={{ ...estilo.campo, flex: 1 }}>
            Alto (cm)
            <input name="alto" type="number" style={estilo.input} />
          </label>
        </div>
        <p style={{ fontSize: 12, opacity: 0.7, marginTop: -4 }}>
          Mercado Libre las exige siempre para calcular el envío, aunque la categoría no las liste como obligatorias.
        </p>

        <label style={estilo.campo}>
          Fotos de la galería (una URL por línea; la primera será la portada si no se puso una por cuenta)
          <textarea name="imagenes" rows={3} style={estilo.textarea} placeholder={"https://.../foto1.jpg\nhttps://.../foto2.jpg"} />
        </label>

        <label style={estilo.campo}>
          Características adicionales de Mercado Libre (una por línea, formato ID=valor — ej. BRAND=Genérica, GTIN=7701234567890,
          SALE_FORMAT=Unidad)
          <textarea name="atributosExtra" rows={3} style={estilo.textarea} placeholder={"BRAND=Genérica\nSALE_FORMAT=Unidad"} />
        </label>

        <label style={estilo.campo}>
          Categoría elegida a mano (opcional — una por línea, formato siteId::título=categoryId; solo hace falta si la detección
          automática por título se equivocó)
          <textarea name="categoriasOverride" rows={2} style={estilo.textarea} placeholder={"MCO::Mi título exacto=MCO1234"} />
        </label>

        <label style={estilo.campo}>
          Variantes (opcional, JSON) — ejes de la variante (ej. Talla, Color) con sus combinaciones reales
          <textarea
            name="variantes"
            rows={4}
            style={estilo.textarea}
            placeholder={JSON.stringify(
              { ejes: ["TALLA"], ejeFoto: null, combinaciones: [{ valores: { TALLA: "S" }, sku: "SKU-S", stock: 5, precio: 50000 }] },
              null,
              2
            )}
          />
        </label>

        <label style={{ fontSize: 13, display: "flex", alignItems: "center", gap: 8, margin: "10px 0 20px" }}>
          <input type="checkbox" name="modoPrueba" /> Modo prueba (se publica y se pausa de inmediato, nunca queda visible al público)
        </label>

        <button type="submit" style={{ padding: "10px 18px", background: "#000", color: "#fff", border: "none", borderRadius: 6, fontSize: 14 }}>
          Publicar
        </button>
      </form>

      <p style={{ marginTop: 24 }}>
        <Link href="/panel/publicar" style={{ fontSize: 13 }}>
          Cancelar
        </Link>
      </p>
    </main>
  );
}
