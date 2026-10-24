"use server";

import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { listarEmpresasDeUsuario } from "@/lib/empresas";
import { obtenerOCrearUsuarioActual } from "@/lib/usuarios";
import { requierePermiso } from "@/lib/permisos";
import { listarCuentasConectadas } from "@/lib/ml/cuentas";
import { dbComoEmpresa } from "@/db/empresa-context";
import { productosMl } from "@/db/schema";
import { publicarProductoEnCuentas } from "@/lib/ml/publicar";
import type { DatosPorCuenta, VariantesProducto } from "@/lib/ml/publicar-tipos";

async function empresaActivaDe(usuarioId: string) {
  const propias = await listarEmpresasDeUsuario(usuarioId);
  const empresaId = cookies().get("empresa_actual")?.value;
  const empresa = propias.find((e) => e.id === empresaId) ?? propias[0];
  if (!empresa) throw new Error("No se encontró tu empresa activa.");
  return empresa;
}

function parsearLineasClaveValor(texto: string): Record<string, string> {
  const resultado: Record<string, string> = {};
  for (const linea of texto.split("\n")) {
    const limpia = linea.trim();
    if (!limpia) continue;
    const idx = limpia.indexOf("=");
    if (idx === -1) continue;
    const clave = limpia.slice(0, idx).trim();
    const valor = limpia.slice(idx + 1).trim();
    if (clave && valor) resultado[clave] = valor;
  }
  return resultado;
}

export async function crearYPublicarProductoAction(formData: FormData): Promise<void> {
  const usuario = await obtenerOCrearUsuarioActual();
  if (!usuario) redirect("/sign-in");
  const empresa = await empresaActivaDe(usuario.id);

  await requierePermiso(usuario.id, empresa.id, "inventario", "crear");

  const cuentas = (await listarCuentasConectadas(empresa.id)).filter((c) => !c.desconectadaTs);
  const cuentasSeleccionadas = cuentas.filter((c) => formData.get(`incluir_${c.id}`) === "on").map((c) => c.id);
  if (cuentasSeleccionadas.length === 0) {
    throw new Error("Elegí al menos una cuenta de Mercado Libre donde publicar.");
  }

  const porCuenta: Record<string, DatosPorCuenta> = {};
  for (const c of cuentas) {
    const titulo = String(formData.get(`titulo_${c.id}`) ?? "").trim();
    const descripcion = String(formData.get(`descripcion_${c.id}`) ?? "").trim();
    const portadaUrl = String(formData.get(`portada_${c.id}`) ?? "").trim();
    if (titulo || descripcion || portadaUrl) {
      porCuenta[c.id] = { titulo: titulo || undefined, descripcion: descripcion || undefined, portadaUrl: portadaUrl || null };
    }
  }
  if (cuentasSeleccionadas.every((id) => !porCuenta[id]?.titulo) && Object.values(porCuenta).every((d) => !d.titulo)) {
    throw new Error("Poné al menos un título — Mercado Libre lo exige para publicar.");
  }

  const precio = String(formData.get("precio") ?? "").trim();
  if (!precio) throw new Error("El precio es obligatorio.");
  const stock = Number(formData.get("stock") ?? 1) || 1;
  const condicion = String(formData.get("condicion") ?? "new");
  const envioGratis = formData.get("envioGratis") === "on";
  const sku = String(formData.get("sku") ?? "").trim() || null;
  const modoPrueba = formData.get("modoPrueba") === "on";

  const peso = String(formData.get("peso") ?? "").trim();
  const largo = String(formData.get("largo") ?? "").trim();
  const ancho = String(formData.get("ancho") ?? "").trim();
  const alto = String(formData.get("alto") ?? "").trim();
  const dimensiones = { ...(peso && { peso }), ...(largo && { largo }), ...(ancho && { ancho }), ...(alto && { alto }) };

  const imagenes = String(formData.get("imagenes") ?? "")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((url) => ({ url }));

  const atributosExtra = parsearLineasClaveValor(String(formData.get("atributosExtra") ?? ""));
  const categoriasOverride = parsearLineasClaveValor(String(formData.get("categoriasOverride") ?? ""));

  let variantes: VariantesProducto | null = null;
  const variantesTexto = String(formData.get("variantes") ?? "").trim();
  if (variantesTexto) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(variantesTexto);
    } catch {
      throw new Error("Las variantes no son un JSON válido.");
    }
    const v = parsed as Partial<VariantesProducto>;
    if (!Array.isArray(v.ejes) || !Array.isArray(v.combinaciones)) {
      throw new Error('Las variantes necesitan al menos "ejes" (lista) y "combinaciones" (lista).');
    }
    variantes = { ejes: v.ejes, ejeFoto: v.ejeFoto ?? null, combinaciones: v.combinaciones };
  }

  const producto = await dbComoEmpresa(empresa.id, (tx) =>
    tx
      .insert(productosMl)
      .values({
        empresaId: empresa.id,
        precio,
        stock,
        condicion,
        envioGratis,
        sku,
        dimensiones,
        imagenes,
        atributosExtra,
        categoriasOverride,
        variantes,
        porCuenta,
        cuentasSeleccionadas,
        modoPrueba,
        estado: "publicando",
        creadoPorUsuarioId: usuario.id,
      })
      .returning({ id: productosMl.id })
  );

  // Tarea 2.5 (mismo patrón ya probado: ejecutarImportacionInicial) —
  // corre en segundo plano, sin bloquear la respuesta. El servidor es
  // un proceso Node persistente en Railway (nunca serverless), así que
  // la promesa sí llega a completarse aunque la petición ya respondió.
  publicarProductoEnCuentas(empresa.id, producto[0].id).catch((error) => {
    console.error("Error publicando el producto:", error instanceof Error ? error.message : error);
  });

  redirect(`/panel/publicar/${producto[0].id}`);
}
