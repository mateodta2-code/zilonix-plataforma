"use client";

import { useEffect, useState } from "react";
import { Tarjeta } from "@/components/marco/Tarjeta";
import { FormularioPublicar } from "./FormularioPublicar";
import { SeccionesImportar } from "./SeccionesImportar";
import type { Cuenta } from "./CuentasDestino";
import { HistorialPublicaciones, type ProductoHistorial } from "./HistorialPublicaciones";
import { SeccionClip, type ItemClip, type PrefillClip } from "./SeccionClip";
import {
  construirEstadoInicial,
  construirEstadoInicialDesdeImportacion,
  itemImportadoDesdeMensajeExtension,
  type EstadoInicialFormulario,
  type ItemImportado,
} from "./formulario-logica";
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
  itemImportado,
  importarOrigen,
  importarSkuNoEncontrado,
  importarLinkError,
  importarNoDisponible,
  cloudinaryConfigurado,
}: {
  cuentas: Cuenta[];
  historial: ProductoHistorial[];
  prefillNuevo: { titulo: string; precio: string; foto: string };
  prefillClip: PrefillClip;
  itemClip: ItemClip;
  clipHabilitado: boolean;
  itemImportado: ItemImportado | null;
  importarOrigen: string;
  importarSkuNoEncontrado: string;
  importarLinkError: string;
  importarNoDisponible: boolean;
  cloudinaryConfigurado: boolean;
}) {
  const [formInicial, setFormInicial] = useState<EstadoInicialFormulario>(() => {
    // Parte 3, punto A — un ítem importado (por SKU o por link, ya
    // resuelto en page.tsx) tiene prioridad sobre el prefill angosto de
    // Investigación: si llegó acá con ambos a la vez es porque la
    // persona disparó un importador desde esta misma página, el prefill
    // de Investigación es de la visita anterior.
    if (itemImportado) return construirEstadoInicialDesdeImportacion(cuentas.map((c) => c.id), itemImportado);
    return prefillNuevo.titulo || prefillNuevo.precio || prefillNuevo.foto ? estadoInicialDesdePrefill(cuentas, prefillNuevo) : estadoInicialVacio();
  });
  const [formKey, setFormKey] = useState(0);

  function cargarEnFormulario(producto: ProductoHistorial, modo: "reintentar" | "duplicar") {
    setFormInicial(construirEstadoInicial(producto, modo));
    setFormKey((k) => k + 1);
    document.getElementById("formulario-publicar")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  // Parte 3, punto A.3 — el bookmarklet nunca recarga la página (el
  // pegado/parseo es enteramente del cliente): a diferencia de SKU/link
  // (que llegan con itemImportado ya resuelto desde el mount, por el
  // query de un redirect), este camino hidrata el formulario en vivo,
  // igual que "Cargar/Reintentar" del historial.
  function importarEnFormulario(item: ItemImportado) {
    setFormInicial(construirEstadoInicialDesdeImportacion(cuentas.map((c) => c.id), item));
    setFormKey((k) => k + 1);
    document.getElementById("formulario-publicar")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  // Parte 3, punto D ("Importar a Publicar" de la extensión) — mismo
  // mecanismo que extension/marcador-zilonix.js ya usa para "Completar
  // vendidos"/"Importar listado": un content script propio de Zilonix
  // (inyectado SOLO en /panel/publicar* de este mismo dominio, ver
  // manifest.json) reenvía el mensaje con postMessage, origin explícito.
  // Mismo criterio que ya documenta ese archivo: "el panel vuelve a
  // validar todo el payload igual, nunca confía ciegamente en un
  // mensaje" — itemImportadoDesdeMensajeExtension (formulario-logica.ts,
  // con sus propias pruebas) es esa validación.
  useEffect(() => {
    function alRecibirMensaje(evento: MessageEvent) {
      if (evento.source !== window || evento.origin !== window.location.origin) return;
      const datos = evento.data as { fuente?: string; tipo?: string; payload?: unknown } | null;
      if (!datos || datos.fuente !== "zilonix-extension" || datos.tipo !== "importar-publicar") return;
      const item = itemImportadoDesdeMensajeExtension(datos.payload);
      if (item) importarEnFormulario(item);
    }
    window.addEventListener("message", alRecibirMensaje);
    // Issue #44 (revisión de Pablo sobre el PR #290) — "Importar a
    // Publicar abre o enfoca Publicar": extension/marcador-zilonix.js
    // corre con `run_at: "document_start"` (manifest.json) — MUCHO
    // antes de que este efecto monte (recién después de que React
    // hidrata). Si esa pestaña pide el importacionPendiente a
    // background.js apenas carga, la respuesta podría llegar ANTES de
    // que el listener de arriba exista — el postMessage se perdería
    // para siempre (nadie escuchando todavía), y background.js ya lo
    // habría borrado (se entrega una sola vez). Este aviso es la señal
    // real que dispara ese pedido del lado de la extensión — recién
    // DESPUÉS de que el listener ya está montado, nunca antes.
    window.postMessage({ fuente: "zilonix-panel", tipo: "publicar-listo" }, window.location.origin);
    return () => window.removeEventListener("message", alRecibirMensaje);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- importarEnFormulario/cuentas cambian de referencia en cada render (closures de PaginaPublicar) pero el listener solo necesita montarse una vez; lee cuentas/setFormInicial por clausura, no por dependencia
  }, []);

  return (
    <>
      {/* --- Punto 1: aviso fijo --- */}
      <Tarjeta className={styles.seccion}>
        <p style={{ fontSize: 14, margin: 0 }}>
          Elige las cuentas destino — cada una tiene su propio título, descripción y foto de portada. Precio, stock, SKU y el resto de fotos
          son iguales para todas. Publicación tipo Premium con garantía del vendedor de 30 días, siempre.
        </p>
      </Tarjeta>

      {/* --- Punto 2: importadores (Parte 3) --- */}
      <Tarjeta className={styles.seccion}>
        <p className="zx-etiqueta">Importar desde otra publicación</p>
        <SeccionesImportar
          cuentas={cuentas}
          itemImportado={itemImportado}
          importarOrigen={importarOrigen}
          skuNoEncontrado={importarSkuNoEncontrado}
          linkError={importarLinkError}
          noDisponible={importarNoDisponible}
          onImportarBookmarklet={importarEnFormulario}
        />
      </Tarjeta>

      {/* --- Puntos 3-7: el formulario (cuentas, datos, por cuenta, categoría, publicar) --- */}
      <FormularioPublicar key={formKey} cuentas={cuentas} inicial={formInicial} cloudinaryConfigurado={cloudinaryConfigurado} />

      {/* --- Punto 8: historial (y, Parte 3 punto B, el permalink real por cuenta) --- */}
      <HistorialPublicaciones
        productos={historial}
        cuentas={cuentas}
        onCargar={(p) => cargarEnFormulario(p, "reintentar")}
        onDuplicar={(p) => cargarEnFormulario(p, "duplicar")}
      />

      {/* --- Punto 9: Clip --- */}
      {clipHabilitado && <SeccionClip cuentas={cuentas} item={itemClip} prefillClip={prefillClip} />}
    </>
  );
}
