// Archivo único para editar el contenido de la página de venta (portada
// pública). Copiado de zilonix-seller-web (ese proyecto queda solo como
// referencia visual, no se toca ni se linkea desde acá).
import type { iconoDeClave } from "@/components/marco/iconos";

type ClaveIcono = Parameters<typeof iconoDeClave>[0];

// Número de WhatsApp pendiente de confirmar — no inventar uno (mismo
// criterio que zilonix-seller-web/src/data/enlaces.ts).
export const WHATSAPP_NUMERO = "POR_DEFINIR";
export const WHATSAPP_URL = `https://wa.me/${WHATSAPP_NUMERO}`;

export type Plan = {
  nombre: string;
  precioUsd: number;
  destacado?: boolean;
  incluye: string[];
};

// Nombres y precios son provisionales; "incluye" queda así hasta que el
// equipo cierre el alcance real de cada plan.
export const planes: Plan[] = [
  { nombre: "Emprendedor", precioUsd: 29, incluye: ["Todos los módulos", "Garantía de 14 días"] },
  { nombre: "Pro", precioUsd: 69, destacado: true, incluye: ["Todos los módulos", "Garantía de 14 días"] },
  { nombre: "Elite", precioUsd: 129, incluye: ["Todos los módulos", "Garantía de 14 días"] },
];

export const puntosProblema = [
  {
    titulo: "Demasiadas pestañas abiertas",
    texto:
      "El panel de Mercado Libre, el chat con el cliente, la hoja de cálculo de inventario, la de costos... todo a la vez, todo el día.",
  },
  {
    titulo: "Excel para todo",
    texto:
      "Precios, recompras, seguimiento de despachos: terminan en una hoja de cálculo que alguien tiene que actualizar a mano y que nadie más entiende del todo.",
  },
  {
    titulo: "No sabes la utilidad real",
    texto:
      "Entre comisiones, envíos, publicidad y costos, es difícil saber cuánto deja cada venta de verdad, no solo cuánto factura.",
  },
];

// clave: una de las ya dibujadas en components/marco/iconos.tsx — nunca
// una librería nueva (ver el comentario de ese archivo).
export const modulos: { clave: ClaveIcono; titulo: string; texto: string }[] = [
  { clave: "pedidos", titulo: "Pedidos", texto: "Todos los pedidos de tus cuentas de Mercado Libre, en un solo panel." },
  { clave: "despachos", titulo: "Despachos", texto: "Controla lo que sale a diario y evita despachos atrasados o perdidos." },
  {
    clave: "inventario",
    titulo: "Inventario y bodegas",
    texto: "Stock al día por bodega, con alertas antes de que se te acabe un producto.",
  },
  {
    clave: "investigacion",
    titulo: "Investigación de productos",
    texto: "Encuentra qué vender con datos reales de demanda y competencia.",
  },
  { clave: "publicar", titulo: "Publicar", texto: "Crea publicaciones más rápido, con imágenes directo desde Canva." },
  { clave: "promociones", titulo: "Promociones", texto: "Programa y controla tus promociones sin perder margen por error." },
  { clave: "finanzas", titulo: "Finanzas", texto: "La utilidad real de cada venta, después de comisiones, envío y costos." },
  {
    clave: "publicidad",
    titulo: "Publicidad",
    texto: "Resultados de tu publicidad de Mercado Libre, al lado de tus demás números.",
  },
  { clave: "personas", titulo: "Multiempresa y roles", texto: "Varias empresas o marcas desde una sola cuenta, con permisos por persona." },
];

export const pasosComoFunciona = [
  { numero: "1", titulo: "Crea tu cuenta", texto: "Regístrate en minutos y empieza a configurar tu cuenta." },
  {
    numero: "2",
    titulo: "Conecta tu cuenta de Mercado Libre",
    texto: "Autoriza el acceso de forma segura, directo desde Mercado Libre.",
  },
  {
    numero: "3",
    titulo: "Gestiona todo desde el panel",
    texto: "Pedidos, inventario, precios y finanzas, ya sincronizados y al día.",
  },
];

export const capturas = [
  { id: "pedidos", etiqueta: "Pedidos y despachos" },
  { id: "inventario", etiqueta: "Inventario y bodegas" },
  { id: "finanzas", etiqueta: "Finanzas: utilidad real" },
];

export const preguntasFaq = [
  {
    pregunta: "¿En qué moneda se cobra?",
    respuesta: "El cobro es en dólares (USD), sin importar el país desde el que operes tu tienda de Mercado Libre.",
  },
  {
    pregunta: "¿Qué pasa si no me gusta?",
    respuesta: "Tienes garantía de 14 días desde tu primer pago: si no te gusta, te devolvemos tu dinero.",
  },
  {
    pregunta: "¿En qué países funciona?",
    respuesta:
      "Zilonix Seller está pensado para vendedores de Mercado Libre en Latinoamérica. Si tienes dudas sobre tu país, escríbenos antes de empezar.",
  },
  {
    pregunta: "¿Es seguro conectar mi cuenta de Mercado Libre?",
    respuesta:
      "Sí. La conexión se hace con el método oficial de autorización de Mercado Libre: nunca pedimos ni guardamos tu usuario y contraseña.",
  },
  {
    pregunta: "¿Puedo cancelar cuando quiera?",
    respuesta: "Sí, puedes cancelar tu plan cuando quieras, sin contratos de permanencia.",
  },
];
