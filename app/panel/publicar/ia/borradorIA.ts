"use client";

import { useEffect, useState } from "react";

// «Generación de imágenes para Meli» — lo trabajado (referencias,
// información, ficha, títulos, descripción y tarjetas de imágenes) se
// guarda en el navegador para que no se pierda al cambiar de sub pestaña,
// recargar o remontar el formulario (Cargar/Duplicar/importar).
//
// sessionStorage, no localStorage: queda solo en esta pestaña del
// navegador y se borra al cerrarla — en un PC compartido no pasa a otra
// persona ni a otra empresa. Vence a las 2 horas sin cambios (cada
// guardado renueva el plazo). Solo URLs y textos: nunca la imagen en sí.
export const DURACION_BORRADOR_IA_MS = 2 * 60 * 60 * 1000;
const PREFIJO = "zilonix:publicar:ia:";
export const CLAVES_BORRADOR_IA = { textos: "textos", imagenes: "imagenes", referencias: "referencias" } as const;
type ClaveBorrador = (typeof CLAVES_BORRADOR_IA)[keyof typeof CLAVES_BORRADOR_IA];

type Almacen = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function almacen(): Almacen | null {
  try {
    return typeof window === "undefined" ? null : window.sessionStorage;
  } catch {
    // Bloqueado (modo privado estricto, etc.): se trabaja igual, sin guardar.
    return null;
  }
}

export function guardarBorrador(a: Almacen | null, clave: ClaveBorrador, datos: unknown, ahora: number): void {
  if (!a) return;
  try {
    a.setItem(PREFIJO + clave, JSON.stringify({ ts: ahora, datos }));
  } catch {
    // Lleno o bloqueado: no se guarda, la pantalla sigue funcionando.
  }
}

export function leerBorrador<T>(a: Almacen | null, clave: ClaveBorrador, ahora: number): T | null {
  if (!a) return null;
  try {
    const crudo = a.getItem(PREFIJO + clave);
    if (!crudo) return null;
    const { ts, datos } = JSON.parse(crudo) as { ts?: unknown; datos?: T };
    if (typeof ts !== "number" || ahora - ts > DURACION_BORRADOR_IA_MS || ahora < ts || datos == null) {
      a.removeItem(PREFIJO + clave);
      return null;
    }
    return datos;
  } catch {
    return null;
  }
}

export function borrarBorradoresIA(a: Almacen | null = almacen()): void {
  if (!a) return;
  for (const clave of Object.values(CLAVES_BORRADOR_IA)) {
    try {
      a.removeItem(PREFIJO + clave);
    } catch {
      // Nada que hacer.
    }
  }
}

// Al montar, trae lo guardado (si no venció) con `restaurar`; desde ahí
// guarda cada cambio de `datos`. Se lee en un efecto (no en useState)
// porque el servidor no tiene sessionStorage y la hidratación debe
// coincidir. `cargado` es estado (no ref) para que el primer guardado
// llegue en el render siguiente, ya con lo restaurado, y nunca pise el
// borrador con el estado vacío inicial.
export function useBorradorIA<T>(clave: ClaveBorrador, datos: T, restaurar: (guardado: T) => void): void {
  const [cargado, setCargado] = useState(false);
  const serializado = JSON.stringify(datos);

  useEffect(() => {
    const guardado = leerBorrador<T>(almacen(), clave, Date.now());
    if (guardado) restaurar(guardado);
    setCargado(true);
    // Solo al montar: `restaurar` cambia en cada render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clave]);

  useEffect(() => {
    if (cargado) guardarBorrador(almacen(), clave, JSON.parse(serializado), Date.now());
  }, [cargado, clave, serializado]);
}
