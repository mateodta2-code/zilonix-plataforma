// Guía de cada módulo del panel superadmin (25-nov). Mismo formato y mismo
// componente que la del vendedor (lib/guia/contenido.ts,
// components/guia/GuiaModulo.tsx con panel="superadmin"). Solo texto: no
// lee datos de ninguna empresa. Si un módulo del superadmin cambia, se
// actualiza su guía acá en el mismo PR. La prueba confirma que cada
// pantalla del menú del superadmin tiene su guía.
import type { GrupoGuia, SeccionGuia } from "./contenido";

const SOLO_CIFRAS = "Solo ves cifras y lo que la empresa te comparte: nunca sus productos, pedidos ni compradores (decisión D8).";

export const GUIA_SUPERADMIN: GrupoGuia[] = [
  {
    titulo: "Plataforma",
    secciones: [
      {
        id: "inicio",
        titulo: "Inicio",
        ruta: "/superadmin",
        paraQue: "Ver de un vistazo cómo está la plataforma: empresas activas y suspendidas, miembros y cuentas de Mercado Libre y Falabella conectadas.",
        pasos: [
          "Revisa las tarjetas: son los totales de toda la plataforma.",
          "Para el detalle por empresa entra a Empresas; para ver cuentas con problemas, a Conexiones; para la evolución, a Métricas.",
        ],
        consejos: [SOLO_CIFRAS, "Cada módulo tiene su propia guía arriba, en «Guía de este módulo»."],
      },
      {
        id: "empresas",
        titulo: "Empresas",
        ruta: "/superadmin/empresas",
        paraQue: "Buscar una empresa, ver sus cifras y cambiar su plan, suspenderla o reactivarla.",
        pasos: [
          "Busca por nombre o filtra por estado y plan, y pulsa «Filtrar».",
          "Pulsa «Ver» en la empresa para abrir su detalle.",
          "Cambiar el plan: elige el plan y pulsa «Cambiar plan» (te pide confirmar).",
          "Suspender: escribe el motivo (obligatorio) y pulsa «Suspender». Sus miembros ven «Tu cuenta está suspendida» y no pueden usar ningún módulo, y sus procesos automáticos con Mercado Libre (avisos de ventas, publicidad, seguimiento) se detienen.",
          "Reactivar: pulsa «Reactivar». Los procesos vuelven solos, pero las ventas que llegaron mientras estuvo suspendida no: pídele al cliente que pulse «Traer ventas de este mes» en Pedidos o en Finanzas → Ventas (trae solo el mes en curso).",
          "Notas internas: escribe lo que el equipo de Zilonix deba saber de esa empresa y pulsa «Guardar notas». La empresa no las ve.",
        ],
        apartados: [
          {
            titulo: "Ver quién trabaja en una empresa (acceso temporal)",
            pasos: [
              "Sin permiso de la empresa solo ves el número de miembros.",
              "Pídele al dueño que entre a Soporte en su panel y te dé un acceso temporal: escribe qué puede ver soporte y por cuántas horas (máximo 15 días).",
              "Mientras el acceso esté vigente, en el detalle de la empresa ves sus miembros: nombre, correo y rol. Cada vista queda en la auditoría.",
            ],
          },
        ],
        consejos: [
          "Por ahora el plan es solo una etiqueta: todavía no limita módulos ni cuentas.",
          "Cada cambio de plan, suspensión, reactivación y nota queda en Auditoría.",
          SOLO_CIFRAS,
        ],
      },
      {
        id: "conexiones",
        titulo: "Conexiones",
        ruta: "/superadmin/conexiones",
        paraQue: "Ver qué empresas tienen Mercado Libre o Falabella con problemas, antes de que el cliente reclame.",
        pasos: [
          "Arriba están los totales de la plataforma. Abajo, solo las empresas con algún problema, primero las que tienen más. «Ver todas las empresas» las muestra todas.",
          "«ML desconectadas»: cuentas de Mercado Libre que alguien desconectó. Si una empresa tiene 0 conectadas, sale en rojo.",
          "«ML por revisar»: cuentas conectadas cuya llave lleva más de 24 h sin renovarse; casi siempre hay que reconectarlas.",
          "«Avisos atrasados»: avisos de Mercado Libre (ventas y otros cambios de la cuenta) sin procesar después de 1 hora.",
          "«Publicidad con error»: cuentas cuya última sincronización de publicidad falló. Se reintenta sola cada hora.",
          "Pulsa «Ver» para abrir el detalle de la empresa.",
        ],
        apartados: [
          {
            titulo: "Qué hacer en cada caso",
            pasos: [
              "Desconectada o por revisar: avisa al cliente que entre a Administración → Conectar marketplaces y vuelva a conectar esa cuenta. Después, que pulse «Traer ventas de este mes» en Pedidos para recuperar las ventas que no entraron mientras estuvo caída (solo trae el mes en curso).",
              "Avisos atrasados que no bajan en un par de horas: avisa al equipo técnico para revisar los registros del servidor.",
              "Publicidad con error durante varios días: avisa al equipo técnico.",
            ],
          },
        ],
        consejos: ["Las empresas suspendidas no cuentan como problema: sus procesos están parados a propósito.", SOLO_CIFRAS],
      },
      {
        id: "bodegas",
        titulo: "Bodegas",
        ruta: "/superadmin/bodegas",
        paraQue: "Dar de alta operadores logísticos (bodegas 3PL), invitar a su administrador y ligarlos a las empresas que atienden.",
        pasos: [
          "Crear: escribe el nombre de la bodega (el NIT es opcional) y pulsa «Crear bodega».",
          "Pulsa «Ver» en la bodega para abrir su detalle.",
          "Invitar al administrador: escribe su correo y pulsa «Invitar administrador». Comparte el link que aparece: sirve una sola vez y vence en 7 días.",
          "Ligar una empresa: elígela en «Ligar una empresa» y pulsa «Ligar empresa». En la lista de empresas que atiende puedes «Pausar» o «Reactivar» cada una.",
          "Suspender: escribe el motivo y pulsa «Suspender»; sus personas no podrán entrar a ningún panel. «Reactivar» la devuelve.",
        ],
        consejos: ["Solo ves cuántas personas hay por rol (admin, operarios, domiciliarios), nunca quiénes son.", "Cada acción queda en Auditoría."],
      },
      {
        id: "foro",
        titulo: "Moderar foro",
        ruta: "/superadmin/foro",
        paraQue: "Revisar lo que se publica en el foro de la comunidad y esconder lo que no corresponda.",
        pasos: [
          "Revisa la lista: son las 100 publicaciones más recientes, preguntas y respuestas juntas, incluso las escondidas.",
          "Si una no cumple las normas, pulsa «Esconder»: deja de verse en el foro.",
          "Si te equivocaste, pulsa «Mostrar» y vuelve a verse.",
        ],
        consejos: ["Esconder nunca borra: siempre se puede volver a mostrar."],
      },
      {
        id: "soporte",
        titulo: "Soporte",
        ruta: "/superadmin/soporte",
        paraQue: "Atender los tickets de soporte de todas las empresas.",
        pasos: [
          "Filtra por estado (Abierto, En curso, Resuelto) con los botones de arriba.",
          "Abre un ticket para ver su conversación, la empresa, el módulo y quién lo escribió.",
          "Escribe en «Respuesta para la empresa» y pulsa «Responder».",
          "Cambia el estado con los botones: «En curso» mientras lo trabajas y «Resuelto» cuando termines.",
        ],
        consejos: [
          "Solo ves el ticket y su conversación, nunca otros datos de la empresa.",
          "Si necesitas ver más para resolverlo (por ejemplo, quién trabaja en la empresa), pídele al cliente un acceso temporal desde su Soporte: ver la guía de Empresas.",
        ],
      },
      {
        id: "metricas",
        titulo: "Métricas",
        ruta: "/superadmin/metricas",
        paraQue: "Ver cómo crece la plataforma: empresas, conexiones, miembros y bodegas.",
        pasos: [
          "Revisa las tarjetas: empresas activas y suspendidas, empresas con Mercado Libre y con Falabella, miembros y bodegas activas.",
          "«Plan»: cuántas empresas hay en cada plan.",
          "«Semana»: cuántas empresas se crearon cada semana (desde el lunes).",
        ],
        consejos: [SOLO_CIFRAS],
      },
    ],
  },
  {
    titulo: "Administración",
    secciones: [
      {
        id: "equipo",
        titulo: "Equipo superadmin",
        ruta: "/superadmin/equipo",
        paraQue: "Ver qué correos pueden entrar al panel superadmin.",
        pasos: [
          "Revisa la lista: los correos salen enmascarados.",
          "Para agregar o quitar a alguien, el equipo técnico cambia la variable SUPERADMIN_CORREOS en Railway (staging y producción). No se cambia desde esta pantalla.",
        ],
        consejos: ["Todas las personas de esta lista tienen los mismos permisos de superadmin."],
      },
      {
        id: "auditoria",
        titulo: "Auditoría",
        ruta: "/superadmin/auditoria",
        paraQue: "Revisar lo que ha hecho el equipo superadmin: cambios de plan, suspensiones, bodegas, notas y vistas con acceso temporal.",
        pasos: [
          "Revisa la tabla: son las últimas 100 acciones, la más reciente primero.",
          "Cada fila dice la fecha (hora UTC), la acción, sobre qué fue, la empresa y el detalle.",
        ],
        consejos: ["Es solo de lectura: nadie puede editar ni borrar una acción registrada."],
      },
      {
        id: "configuracion",
        titulo: "Configuración",
        ruta: "/superadmin/configuracion",
        paraQue: "Ver cómo está protegido el acceso al panel superadmin.",
        pasos: [
          "«2FA exigido»: si para entrar se pide el segundo factor de verificación.",
          "«Sesión»: después de cuántos minutos sin actividad se cierra la sesión sola.",
        ],
        consejos: ["Es solo de lectura: se cambia con variables de entorno en Railway (por ejemplo, SUPERADMIN_EXIGIR_2FA), que maneja el equipo técnico."],
      },
    ],
  },
];

export const SECCIONES_GUIA_SUPERADMIN: SeccionGuia[] = GUIA_SUPERADMIN.flatMap((g) => g.secciones);

// El detalle de una empresa vive en /superadmin/<id de la empresa>.
const DETALLE_EMPRESA = /^\/superadmin\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// La guía del módulo de una pantalla del superadmin: "/superadmin" solo
// exacto (Inicio); el detalle de una empresa, la de Empresas; el resto
// por prefijo de carpeta, gana el más largo. null si no tiene guía.
export function seccionSuperadminDeRuta(ruta: string): SeccionGuia | null {
  const limpia = ruta.replace(/\/+$/, "") || "/";
  const porId = (id: string) => SECCIONES_GUIA_SUPERADMIN.find((s) => s.id === id) ?? null;
  if (limpia === "/superadmin") return porId("inicio");
  if (DETALLE_EMPRESA.test(limpia)) return porId("empresas");
  let mejor: { seccion: SeccionGuia; largo: number } | null = null;
  for (const s of SECCIONES_GUIA_SUPERADMIN) {
    for (const prefijo of [s.ruta, ...(s.otrasRutas ?? [])]) {
      if (prefijo === "/superadmin") continue;
      if ((limpia === prefijo || limpia.startsWith(`${prefijo}/`)) && (!mejor || prefijo.length > mejor.largo)) {
        mejor = { seccion: s, largo: prefijo.length };
      }
    }
  }
  return mejor?.seccion ?? null;
}
