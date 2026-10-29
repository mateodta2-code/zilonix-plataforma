"use client";

import { useState } from "react";
import { Tarjeta } from "@/components/marco/Tarjeta";
import { FormularioPublicar } from "./FormularioPublicar";
import { SeccionesImportarPlaceholder } from "./SeccionesImportarPlaceholder";
import type { Cuenta } from "./CuentasDestino";
import { HistorialPublicaciones, type ProductoHistorial } from "./HistorialPublicaciones";
import { SeccionClip, type ItemClip, type PrefillClip } from "./SeccionClip";
import { construirEstadoInicial, type EstadoInicialFormulario } from "./formulario-logica";
import styles from "./publicar.module.css";

export type { Cuenta };

function estadoInicialVacio(): EstadoInicialFormulario {
  return {
    cuentasIncluidas: [],
    datosPorCuenta: {},
    precio: "",
    stock: "1",
    condicion: "new",
    envioGratis: false,
    sku: "",
    dimensiones: { peso: "", largo: "", ancho: "", alto: "" },
    imagenes: [],
    atributosExtra: {},
    categoriasOverride: {},
    variantes: null,
    portadasPorVariante: {},
    modoPrueba: true,
  };
}

// Punto 1 del pedido original (Investigación → Publicar, vigente
// desde la Parte 1) — título/portada se aplican a TODAS las cuentas
// conectadas por igual (quien llegó desde Investigación todavía no
// elige a mano para cuál cuenta es cada campo); `cuentasIncluidas`
// queda vacío a propósito (punto 3: "todas desmarcadas al inicio").
function estadoInicialDesdePrefill(cuentas: Cuenta[], prefill: { titulo: string; precio: string; foto: string }): EstadoInicialFormulario {
  const datosPorCuenta: Record<string, { titulo: string; descripcion: string; portadaUrl: string }> = {};
  for (const c of cuentas) datosPorCuenta[c.id] = { titulo: prefill.titulo, descripcion: "", portadaUrl: prefill.foto };
  return { ...estadoInicialVacio(), datosPorCuenta, precio: prefill.precio, imagenes: prefill.foto ? [prefill.foto] : [] };
}

// Parte 2 (página única, estructura de Zilonix OS) — orquesta las
// piezas que antes vivían en 4 pantallas sueltas. El único estado que
// de verdad cruza componentes es "qué va cargado en el formulario de
// arriba" (formInicial/formKey — Cargar/Reintentar y Duplicar, desde
// el historial de abajo, lo cambian); todo lo demás (cuentas
// marcadas, atributos, variantes…) sigue viviendo DENTRO de
// FormularioPublicar.tsx, remontado entero cuando formKey cambia.
export function PaginaPublicar({
  cuentas,
  historial,
  prefillNuevo,
  prefillClip,
  itemClip,
  clipHabilitado,
}: {
  cuentas: Cuenta[];
  historial: ProductoHistorial[];
  prefillNuevo: { titulo: string; precio: string; foto: string };
  prefillClip: PrefillClip;
  itemClip: ItemClip;
  clipHabilitado: boolean;
}) {
  const [formInicial, setFormInicial] = useState<EstadoInicialFormulario>(() =>
    prefillNuevo.titulo || prefillNuevo.precio || prefillNuevo.foto ? estadoInicialDesdePrefill(cuentas, prefillNuevo) : estadoInicialVacio()
  );
  const [formKey, setFormKey] = useState(0);

  function cargarEnFormulario(producto: ProductoHistorial, modo: "reintentar" | "duplicar") {
    setFormInicial(construirEstadoInicial(producto, modo));
    setFormKey((k) => k + 1);
    document.getElementById("formulario-publicar")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  return (
    <>
      {/* --- Punto 1: aviso fijo --- */}
      <Tarjeta className={styles.seccion}>
        <p style={{ fontSize: 14, margin: 0 }}>
          Elige las cuentas destino — cada una tiene su propio título, descripción y foto de portada. Precio, stock, SKU y el resto de fotos
          son iguales para todas. Publicación tipo Premium con garantía del vendedor de 30 días, siempre.
        </p>
      </Tarjeta>

      {/* --- Punto 2: importadores (placeholder, Parte 3) --- */}
      <Tarjeta className={styles.seccion}>
        <p className="zx-etiqueta">Importar desde otra publicación</p>
        <SeccionesImportarPlaceholder />
      </Tarjeta>

      {/* --- Puntos 3-7: el formulario (cuentas, datos, por cuenta, categoría, publicar) --- */}
      <FormularioPublicar key={formKey} cuentas={cuentas} inicial={formInicial} />

      {/* --- Punto 8: historial --- */}
      <HistorialPublicaciones
        productos={historial}
        onCargar={(p) => cargarEnFormulario(p, "reintentar")}
        onDuplicar={(p) => cargarEnFormulario(p, "duplicar")}
      />

      {/* --- Punto 9: Clip --- */}
      {clipHabilitado && <SeccionClip cuentas={cuentas} item={itemClip} prefillClip={prefillClip} />}
    </>
  );
}
