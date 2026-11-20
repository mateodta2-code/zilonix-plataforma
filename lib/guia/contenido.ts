// Guía de cada módulo: sale desplegable arriba de la pantalla del
// módulo (components/guia/GuiaModulo.tsx), no hay una guía general.
// Solo texto: no lee datos de ninguna empresa. `ruta` y `otrasRutas`
// deciden en qué pantallas sale (la prueba confirma que existen). Si un
// módulo cambia, se actualiza su guía acá.

export type SeccionGuia = {
  id: string;
  titulo: string;
  ruta: string;
  // Otras pantallas del mismo módulo (prefijos de ruta).
  otrasRutas?: string[];
  paraQue: string;
  pasos: string[];
  // Apartados con su propio paso a paso (ej. «Cómo conectar la IA»).
  apartados?: ApartadoGuia[];
  consejos?: string[];
};

export type ApartadoGuia = { titulo: string; pasos: string[] };

// Mismo apartado en Optimización (donde se usa) y Configuración (donde
// se avisa que ahora se conecta en Administración → Conectar IA).
const CONECTAR_IA: ApartadoGuia = {
  titulo: "Cómo conectar la IA (para crear imágenes)",
  pasos: [
    "Saca una API key de OpenAI o de Google (Anthropic/Claude no crea imágenes).",
    "OpenAI: entra a platform.openai.com → API keys → «Create new secret key» y cópiala. La cuenta necesita saldo en Billing; para imágenes, OpenAI puede pedir verificar la organización en Settings → Organization.",
    "Google: entra a aistudio.google.com → «Get API key» → «Create API key» y cópiala. Para imágenes, la cuenta necesita la facturación activa.",
    "En Zilonix ve a Administración → Conectar IA (necesitas permiso para modificar la configuración).",
    "Pulsa «Agregar IA», elige el proveedor (OpenAI o Google), escribe un nombre y un modelo de texto (por ejemplo gpt-5-mini o gemini-2.5-flash) y pega la API key.",
    "Guarda y usa «Probar conexión». La clave se guarda cifrada y no se vuelve a mostrar.",
    "Vuelve a Optimización → «Ver detalle →» de una publicación → debajo de las fotos aparece «Crear imagen con IA» (recarga la página si ya la tenías abierta).",
  ],
};

export type GrupoGuia = { titulo: string; secciones: SeccionGuia[] };

export const GUIA: GrupoGuia[] = [
  {
    titulo: "Primeros pasos",
    secciones: [
      {
        id: "inicio",
        titulo: "Inicio",
        ruta: "/panel",
        paraQue: "Ver de un vistazo cómo va el día (ventas de hoy, ventas del mes, despachos pendientes, SKU sin vincular) y dejar la empresa lista para trabajar.",
        pasos: [
          "La primera vez: ve a Administración → Conectar marketplaces y conecta tu cuenta de Mercado Libre.",
          "Abre Pedidos para ver tus ventas. Aquí en Inicio, la guía de inicio marca cada paso cuando está hecho.",
          "Si trabajas con más personas, invítalas desde Administración → Invitar persona.",
          "Cada día, revisa las tarjetas: si una muestra pendientes, entra al módulo del menú para resolverlos.",
        ],
        consejos: [
          "Cada módulo tiene su propia guía arriba, en «Guía de este módulo».",
          "Si no ves un módulo en el menú, tu rol no tiene permiso para verlo: pídeselo al dueño de la empresa.",
          "Si tienes más de una empresa, cámbiala desde el selector de empresa en la barra de arriba.",
        ],
      },
      {
        id: "conectar",
        titulo: "Conectar marketplaces",
        ruta: "/panel/conectar-ml",
        otrasRutas: ["/panel/avisos-ml"],
        paraQue: "Unir tus cuentas de Mercado Libre (y Falabella) para que Zilonix lea pedidos, publicaciones y publicidad.",
        pasos: [
          "Haz clic en conectar y entra con el usuario de Mercado Libre de la tienda.",
          "Acepta los permisos: Mercado Libre te devuelve a Zilonix con la cuenta conectada.",
          "Repite por cada cuenta que manejes. Todas quedan en la misma empresa.",
        ],
        consejos: ["Si una cuenta aparece con error, vuelve a conectarla: suele pasar cuando se cambia la clave en Mercado Libre."],
      },
    ],
  },
  {
    titulo: "Vender y despachar",
    secciones: [
      {
        id: "pedidos",
        titulo: "Pedidos",
        ruta: "/panel/pedidos",
        paraQue: "Ver todas las ventas de Mercado Libre y Falabella en un solo lugar, de la más nueva a la más vieja.",
        pasos: ["Filtra por día, cuenta o producto.", "Revisa en cada venta los productos, las cantidades y los montos."],
      },
      {
        id: "despachos",
        titulo: "Despachos",
        ruta: "/panel/despachos",
        paraQue: "Preparar los envíos: órdenes ya pagas, listas para empacar (no incluye Full).",
        pasos: [
          "En «Pendientes» ves lo que falta empacar, con su SKU para copiarlo rápido.",
          "En «Impresión masiva de guías» imprimes las guías de varias órdenes a la vez.",
          "Lo ya enviado queda en «Despachados».",
        ],
        consejos: ["La lista se actualiza sola; si acabas de vender, usa «Sincronizar ahora»."],
      },
      {
        id: "preguntas",
        titulo: "Preguntas y reclamos",
        ruta: "/panel/preguntas",
        paraQue: "Responder las preguntas sin contestar de todas tus cuentas y seguir los reclamos.",
        pasos: [
          "La pestaña «Preguntas» muestra primero la más vieja: respóndela desde ahí mismo.",
          "La pestaña «Reclamos» lista tus reclamos para darles seguimiento.",
        ],
        consejos: ["Mercado Libre califica qué tan rápido respondes: entra varias veces al día."],
      },
    ],
  },
  {
    titulo: "Productos e inventario",
    secciones: [
      {
        id: "productos",
        titulo: "Productos (SKU, inventario, bodegas)",
        ruta: "/panel/inventario",
        otrasRutas: ["/panel/sku", "/panel/bodegas"],
        paraQue: "Llevar tu catálogo y tu stock: qué tienes, dónde está y cuánto se publica en Mercado Libre.",
        pasos: [
          "SKU: crea tus productos (uno por uno o importando un CSV) y vincula cada publicación de Mercado Libre con su SKU.",
          "Bodegas: registra dónde guardas la mercancía. La principal es la primera que se usa para reservar pedidos.",
          "Inventario: ve el stock por bodega y haz ajustes o traslados. «Para ML» es lo que se publica.",
          "Ingresos y Compras: registra la mercancía que llega o lo que le pediste a un proveedor; al recibir, el stock sube solo.",
          "Kardex: el historial de cada movimiento, con quién lo hizo. No se edita ni se borra.",
        ],
        consejos: ["Revisa «Publicaciones sin SKU»: una venta sin SKU no descuenta stock ni entra a la utilidad."],
      },
    ],
  },
  {
    titulo: "Crecer las ventas",
    secciones: [
      {
        id: "investigacion",
        titulo: "Investigación",
        ruta: "/panel/investigacion",
        paraQue: "Analizar un producto o nicho con publicaciones reales antes de invertir en él.",
        pasos: [
          "Escribe el producto y analiza: verás precios, vendidos, Full y facturación estimada de lo que se vende.",
          "Ordena por facturación, más vendidos, calificación o precio para encontrar oportunidades.",
          "En Seguimiento agrega productos, tiendas o competidores para ver cada día su precio, inventario y ventas, con alertas cuando algo cambia.",
        ],
        consejos: [
          "Para leer datos de las páginas (vendidos, competidores, otros marketplaces) necesitas la extensión de Chrome «Zilonix Seller — Investigación», instalada con el enlace que te comparte el equipo de Zilonix y encendida desde su ícono.",
          "Con la extensión, en una publicación de Mercado Libre verás un panel de datos y los botones «Seguir en Zilonix» e «Importar a Publicar».",
          "Si Mercado Libre pide verificar que eres una persona, resuélvelo en esa pestaña y vuelve a intentar. Cuando haya una versión nueva de la extensión, actualízala.",
        ],
      },
      {
        id: "optimizacion",
        titulo: "Optimización",
        ruta: "/panel/optimizacion",
        paraQue: "Mejorar tus publicaciones: visitas, ventas, conversión, calidad y cómo vas frente a la competencia.",
        pasos: [
          "Elige el período (7, 14, 30 o 90 días) y busca la publicación.",
          "Despliega una fila para ver tus competidores. Si no es de catálogo, «Buscar 10 competidores» lo hace con la extensión.",
          "Haz clic en «Ver detalle →» (debajo del nombre de la publicación) para ver las gráficas por día (pasa el cursor para ver el día y las ventas), los costos con su utilidad, la utilidad total de la publicación y el enlace «Ver publicación en Mercado Libre ↗».",
          "Desde el detalle puedes cambiar precio, título y fotos (subir, arrastrar para ordenar, elegir portada). Nada llega a Mercado Libre hasta que guardas.",
          "En el detalle, debajo de las fotos, está «Crear imagen con IA». Ahí eliges la foto base, escribes la ficha técnica del producto y creas portadas de venta (1, 4 o 10, cada una distinta).",
          "Para una imagen informativa, elige cuál de las 10 quieres (modo de uso, características, beneficios, qué incluye, comparación, preguntas frecuentes…), pide la propuesta, revisa y corrige el título y el copy, y solo entonces aprieta «CREAR imagen».",
        ],
        apartados: [CONECTAR_IA],
        consejos: [
          "Cada imagen la cobra la cuenta de IA de tu empresa (unos centavos de dólar). Cambiar el proveedor también cambia la IA de los textos (Promociones).",
          "Si debajo de las fotos solo ves el aviso «Para crear imágenes con IA, conecta OpenAI o Google…», la empresa todavía no tiene IA conectada: sigue «Cómo conectar la IA».",
          "Revisa cada imagen creada: si no se entiende, se ve genérica o el texto salió con errores, descártala y crea otra.",
          "Si el copy trae palabras que Mercado Libre no permite (curar, tratar, garantizado, expertos, antes/después…), Zilonix no deja crear la imagen hasta que las cambies.",
          "Las opiniones deben ser de compradores reales: cópialas de tus calificaciones. La IA nunca las inventa.",
        ],
      },
      {
        id: "publicar",
        titulo: "Publicar",
        ruta: "/panel/publicar",
        paraQue: "Crear publicaciones en una o varias cuentas de Mercado Libre a la vez.",
        pasos: [
          "Elige las cuentas destino. Cada una lleva su propio título, descripción y portada; precio, stock, SKU y demás fotos son iguales.",
          "Para no escribir todo desde cero, pega el link de una publicación y usa «Traer datos de ese link» (necesita la extensión).",
          "Revisa y publica. La publicación sale como Premium con garantía del vendedor de 30 días.",
        ],
      },
      {
        id: "promociones",
        titulo: "Promociones",
        ruta: "/panel/promociones",
        paraQue: "Entrar o salir de las promociones de Mercado Libre sin vender por debajo de tu precio mínimo.",
        pasos: [
          "Revisa el estado real de cada publicación en cada promoción.",
          "Participa o sal de una promoción. El precio mínimo de Finanzas siempre es el límite.",
        ],
        consejos: ["Carga el costo de tus SKU en Finanzas: sin costo no hay precio mínimo que proteja tu margen."],
      },
      {
        id: "publicidad",
        titulo: "Publicidad",
        ruta: "/panel/publicidad",
        paraQue: "Ver si tus Product Ads te dejan ganancia o te cuestan plata.",
        pasos: [
          "Revisa la rentabilidad de cada campaña y la ganancia por producto después de publicidad.",
          "Fija tu meta de margen: el semáforo marca en verde, amarillo o rojo cada producto contra esa meta.",
          "Mira el historial para saber qué cambió en las campañas y cuándo.",
        ],
        consejos: ["Esta pantalla no modifica campañas en Mercado Libre: los cambios se hacen allá."],
      },
    ],
  },
  {
    titulo: "Dinero",
    secciones: [
      {
        id: "finanzas",
        titulo: "Finanzas",
        ruta: "/panel/finanzas",
        paraQue: "Saber cuánto ganas de verdad: ventas, recaudo y utilidad del mes.",
        pasos: [
          "Tabla maestra de SKU: carga costo, packing, envío de agencia y precio mínimo de cada SKU (a mano o importando).",
          "Proveedores y transportadores: el packing se pone una vez y cada SKU lo toma de su proveedor.",
          "Ventas y utilidad: la utilidad de cada venta antes de publicidad (recaudo − comisión − flete − costo − packing − envío).",
          "Falabella: carga el reporte y concilia cada corte de pago.",
        ],
        consejos: ["Revisa «SKU sin costo»: sus ventas quedan fuera de la utilidad hasta que tengan costo. Zilonix no inventa ningún número."],
      },
    ],
  },
  {
    titulo: "Administración",
    secciones: [
      {
        id: "personas",
        titulo: "Personas, invitaciones y roles",
        ruta: "/panel/personas",
        otrasRutas: ["/panel/invitar", "/panel/roles"],
        paraQue: "Dar acceso a tu equipo, cada uno solo a lo que necesita.",
        pasos: [
          "Invitar persona genera un link de un solo uso que vence en 7 días. Nunca se comparte una contraseña.",
          "En Personas ves quién está, con qué rol, y las invitaciones pendientes; desde ahí cambias el rol.",
          "En Ajustar roles decides qué puede ver y hacer cada rol en cada módulo.",
        ],
      },
      {
        id: "configuracion",
        titulo: "Configuración y Actividad",
        ruta: "/panel/configuracion",
        otrasRutas: ["/panel/actividad"],
        paraQue: "Ajustes de la empresa (como la conexión de IA) y el registro de quién hizo qué.",
        pasos: [
          "Administración → Conectar IA: agrega hasta 5 IA (OpenAI, Google, Anthropic, xAI u otra), con su modelo y API key; marca una como principal y elige qué IA usa cada módulo.",
          "Actividad muestra cada cambio con la persona y la hora.",
        ],
        apartados: [CONECTAR_IA],
        consejos: ["Solo OpenAI y Google crean imágenes. La API key se guarda cifrada y nunca se vuelve a mostrar."],
      },
      {
        id: "soporte",
        titulo: "Acceso de soporte y tus datos",
        ruta: "/panel/soporte",
        otrasRutas: ["/panel/mis-datos"],
        paraQue: "Controlar qué ve el equipo de Zilonix y qué datos guardamos de ti.",
        pasos: [
          "Por defecto, soporte solo ve cuántos miembros tiene tu empresa. Si necesitas ayuda, concede un acceso temporal desde Acceso de soporte.",
          "En Mis datos personales puedes exportar todo lo que Zilonix guarda de tu cuenta o pedir que se borre.",
        ],
      },
    ],
  },
  {
    titulo: "Herramientas y ayuda",
    secciones: [
      {
        id: "foro",
        titulo: "Foro de vendedores",
        ruta: "/panel/foro",
        paraQue: "Preguntar y ayudar a otros vendedores de Zilonix.",
        pasos: ["Busca si alguien ya hizo tu pregunta.", "Si no, publícala. Solo se muestra tu nombre, nunca tu empresa ni tus ventas."],
        consejos: ["No compartas datos de tus clientes ni claves."],
      },
    ],
  },
];

export const SECCIONES_GUIA: SeccionGuia[] = GUIA.flatMap((g) => g.secciones);

export function seccionGuia(id: string): SeccionGuia | null {
  return SECCIONES_GUIA.find((s) => s.id === id) ?? null;
}

// La guía del módulo de una pantalla: "/panel" solo exacto (Inicio); el
// resto por prefijo de carpeta, gana el más largo. null en pantallas sin
// guía.
export function seccionDeRuta(ruta: string): SeccionGuia | null {
  const limpia = ruta.replace(/\/+$/, "") || "/";
  if (limpia === "/panel") return seccionGuia("inicio");
  let mejor: { seccion: SeccionGuia; largo: number } | null = null;
  for (const s of SECCIONES_GUIA) {
    for (const prefijo of [s.ruta, ...(s.otrasRutas ?? [])]) {
      if (prefijo === "/panel") continue;
      if ((limpia === prefijo || limpia.startsWith(`${prefijo}/`)) && (!mejor || prefijo.length > mejor.largo)) {
        mejor = { seccion: s, largo: prefijo.length };
      }
    }
  }
  return mejor?.seccion ?? null;
}
