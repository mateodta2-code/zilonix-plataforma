import type { ModuloIA } from "./modulos";

// Rama feat-promociones, punto 6 — "Conexión de IA" como pieza común
// (para que cualquier módulo futuro la use, no solo Promociones).
export type ProveedorIA = "anthropic" | "openai" | "google" | "xai" | "otro_compatible_openai";

// Nunca incluye la API key — eso es a propósito (ver lib/ia/conexion.ts).
// Esta es la forma segura de pasar por el navegador/UI/logs.
export type ConexionIA = {
  id: string;
  nombre: string;
  proveedor: ProveedorIA;
  baseUrl: string | null;
  modelo: string;
  esPrincipal: boolean;
  actualizadoTs: Date;
};

// Para la pantalla de Administración: la conexión más los módulos
// que tiene asignados (sin key).
export type ConexionIAConModulos = ConexionIA & { modulos: ModuloIA[] };

export type ConexionIAConClave = ConexionIA & { apiKey: string };
