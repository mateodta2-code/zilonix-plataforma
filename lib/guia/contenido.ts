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
    "OpenAI: entra a https://platform.openai.com/api-keys → «Create new secret key» y cópiala. La cuenta necesita saldo en Billing; para imágenes, OpenAI puede pedir verificar la organización en Settings → Organization.",
    "Google: entra a https://aistudio.google.com/app/apikey → «Create API key» y cópiala. Para imágenes, la cuenta necesita la facturación activa.",
    "En Zilonix ve a Administración → Conectar IA (necesitas permiso para modificar la configuración).",
    "Pulsa «Agregar IA», elige el proveedor (OpenAI o Google), escribe un nombre y pega la API key. Zilonix busca los modelos de esa cuenta: elige el modelo de la lista (ya viene el recomendado) o pulsa «Escribir otro modelo».",
    "Guarda y usa «Probar conexión». La clave se guarda cifrada y no se vuelve a mostrar.",
    "Márcala como principal o asígnala al módulo que la va a usar (Optimización para las imágenes de Optimización; en Publicar, Publicaciones para los textos y Generación de imágenes para las imágenes de «Generación de imágenes para Meli»). Lo que no asignes usa la principal.",
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
          "Si arriba de la pantalla ves un aviso de Zilonix (por ejemplo, una falla de Mercado Libre o un mantenimiento), léelo: es para todas las empresas. Ciérralo con la ✕ cuando ya lo leíste.",
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
      {
        id: "conectar-ia",
        titulo: "Conectar IA",
        ruta: "/panel/conectar-ia",
        paraQue: "Conectar la IA de tu empresa con tu propia API key y asignarla a los módulos que la usan.",
        pasos: [
          "Pulsa «Agregar IA» y elige el proveedor (OpenAI, Anthropic, Google o xAI).",
          "Crea tu cuenta en el proveedor o entra a la que ya tienes; si exige saldo, cárgalo.",
          "Crea una clave nueva con el enlace «Crear mi API key» y cópiala (se muestra una sola vez).",
          "Pega la clave y elige el modelo de la lista (ya viene el recomendado); luego guarda.",
          "Usa «Probar conexión» para confirmar que funciona.",
          "Marca la IA como principal y asígnala a los módulos que la van a usar.",
        ],
        consejos: ["La suscripción mensual (ChatGPT Plus, Claude Pro, Gemini o SuperGrok) no sirve aquí: la API se paga aparte, según el uso."],
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
        apartados: [
          {
            titulo: "Entregas Flex con tu domiciliario",
            pasos: [
              "Necesitas una bodega ligada a tu empresa con domiciliarios activos (la liga el equipo de Zilonix).",
              "En «Pendientes», en un pedido ⚡ Flex pulsa «Asignar domiciliario», elige a la persona y escribe nombre de quien recibe, dirección, barrio, ciudad, teléfono y una nota. Mientras no haya salido puedes «Reasignar» o quitarlo.",
              "El domiciliario ve la entrega en su celular, con botones para llamar y para abrir la dirección en Google Maps o Waze, y la marca «En camino», «Entregado» o «No entregado» (con motivo). Tú ves el estado en el mismo pedido.",
              "Al marcar «Entregado» el domiciliario tiene que tomar una foto. Cuando la entrega está entregada, pulsa «Ver foto de la entrega» para verla.",
              "Si algo pasa en el camino (va tarde, el cliente pide reprogramar o no contesta, el paquete se dañó), el domiciliario reporta una «Novedad» sin cerrar la entrega. Las ves debajo del estado, con la hora; si trae foto, pulsa «Ver foto».",
            ],
          },
        ],
        consejos: [
          "La lista se actualiza sola; si acabas de vender, usa «Sincronizar ahora».",
          "Escribe la dirección completa (calle, número, barrio y ciudad): es la que el domiciliario abre en Google Maps o Waze. Si está incompleta, el mapa puede ubicarla mal.",
          "La foto de entrega es privada: solo la ven las personas de tu empresa con acceso a ventas. El domiciliario deja de ver la dirección y la foto cuando cierra la entrega.",
        ],
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
          "Elige la cuenta y el período (7, 14, 30 o 90 días). Arriba de la lista ves el resumen de toda la tienda: ventas brutas, unidades, precios promedio, visitas, conversión, canceladas y devueltas, cada uno comparado con el período anterior.",
          "Busca la publicación por título, SKU o código.",
          "Despliega una fila para ver tus competidores. Si no es de catálogo, «Buscar 10 competidores» lo hace con la extensión.",
          "Haz clic en «Ver detalle →» (debajo del nombre de la publicación) para ver las gráficas por día (pasa el cursor para ver el día y las ventas), los costos con su utilidad (y el % que representa cada costo sobre las ventas), la utilidad total de la publicación y el enlace «Ver publicación en Mercado Libre ↗».",
          "Desde el detalle puedes cambiar precio, título y fotos (subir, arrastrar para ordenar, elegir portada). Nada llega a Mercado Libre hasta que guardas.",
          "En el detalle, la «Bitácora de cambios» guarda cada cambio hecho desde Zilonix (precio, título, fotos, pausar o activar) con la fecha, quién lo hizo y el antes → después. A los 7 días muestra si funcionó: visitas, ventas, conversión y utilidad de la semana antes contra la semana después.",
          "Revisa una vez por semana: en la lista, las publicaciones con «Revisar cambio» tienen un cambio que ya cumplió 7 días. En su bitácora pulsa «Revisar» y marca si sirvió, no sirvió o no cambió nada, con un comentario; el aviso se quita al revisarlo.",
          "También puedes dejar solo un comentario, aunque el cambio siga en medición (por ejemplo, por qué lo hiciste): pulsa «Revisar», escríbelo y «Guardar comentario». El aviso «Revisar cambio» sigue hasta que alguien elija Sirvió, No sirvió o Sin cambio.",
          "Si cambias algo fuera de Zilonix (directo en Mercado Libre, la publicidad, el stock…), anótalo con «Anotar un cambio» y la fecha en que lo hiciste: también se mide a los 7 días.",
          "La pestaña «Bitácora» de Optimización junta los cambios de todas tus publicaciones (últimos 90 días) con filtros por cuenta, tipo, quién, fechas y estado. Pulsa «Ver resultado» en un cambio para comparar, al día 8, los 7 días antes contra los 7 días después.",
          "En el detalle, debajo de las fotos, está «Crear imagen con IA». Ahí eliges la foto base, escribes la ficha técnica del producto y creas portadas de venta (1, 4 o 10, cada una distinta).",
          "Para una imagen informativa, elige cuál de las 10 quieres (modo de uso, características, beneficios, qué incluye, comparación, preguntas frecuentes…), pide la propuesta, revisa y corrige el título y el copy, y solo entonces aprieta «CREAR imagen».",
        ],
        apartados: [CONECTAR_IA],
        consejos: [
          "Cada imagen la cobra la cuenta de IA de tu empresa (unos centavos de dólar). Optimización usa la IA asignada a su módulo en Administración → Conectar IA; si no le asignas ninguna, usa la principal.",
          "El resumen de la tienda cuenta las ventas que Seller ya sincronizó (si una venta todavía no está en Finanzas, sus unidades no suman) y las visitas que da Mercado Libre; los días son de Colombia, así que puede variar un poco frente a Métricas de Mercado Libre.",
          "Si la publicación tiene una promoción activa, el comprador ve el precio de la promoción hasta que termine. El precio que cambias en Zilonix es el normal: Zilonix te avisa y lo verás publicado cuando acabe la promoción.",
          "En las publicaciones nuevas de Mercado Libre («User Products»), el título se cambia a través del nombre del producto: puede tardar unos minutos en verse y se aplica a todas las publicaciones de ese mismo producto. Mercado Libre solo lo permite si ninguna publicación de ese producto tiene ventas; «Ver diagnóstico» muestra las publicaciones del mismo producto y sus ventas.",
          "Al escribir un precio nuevo, Zilonix estima cuánto ganarías por unidad con los costos del período. Si la publicación todavía no tiene ventas (o le faltan costos), no puede estimar la ganancia y te lo dice; igual puedes guardar el precio.",
          "Si un cambio de título o precio no se aplica, un administrador (Dueño o Gerente) puede abrir «Diagnóstico» en el detalle, pulsar «Ver diagnóstico» y «Copiar», y enviárselo a soporte. Es solo lectura: no cambia nada en Mercado Libre.",
          "Si debajo de las fotos solo ves el aviso «Para crear imágenes con IA, conecta OpenAI o Google…», la empresa todavía no tiene IA conectada: sigue «Cómo conectar la IA».",
          "Si crear una imagen falla, el mensaje termina con un código entre paréntesis (por ejemplo «código: moderation_blocked»). Cópialo completo y envíaselo a soporte: con eso se sabe qué rechazó el proveedor.",
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
          "Para no escribir todo desde cero, importa una publicación por SKU o con el botón del navegador (en «Importar desde otra publicación»).",
          "O usa «Generación de imágenes para Meli»: con 1 o 2 imágenes de referencia y lo que escribas del producto, la IA arma la ficha, propone títulos, escribe la descripción y, al final, crea imágenes de venta.",
          "Revisa y publica. La publicación sale como Premium con garantía del vendedor de 30 días.",
        ],
        apartados: [
          {
            titulo: "Generación de imágenes para Meli (ficha, títulos y descripción)",
            pasos: [
              "Marca la cuenta destino. En «Generación de imágenes para Meli» sube 1 o 2 imágenes de referencia del producto: solo las usa la IA, no se publican (si no subes, usa las fotos reales de la galería).",
              "En «Información del producto» escribe lo que sabes del producto: qué es, marca y modelo, material, medidas, qué incluye y cómo se usa.",
              "Si marcaste cuentas de países distintos, elige en «País para la categoría y los títulos» para cuál país se busca la categoría y se escriben los títulos. Con cuentas de un solo país no aparece.",
              "Pulsa «Analizar producto». Cada dato de la ficha dice de dónde salió: «De la foto», «Del vendedor» o «Confirmar».",
              "Revisa lo marcado «Confirmar»: corrígelo, bórralo o marca «Es correcto». Después pulsa «Confirmar ficha». La ficha se pliega en una línea («Ficha confirmada ✓»); púlsala para verla o editarla otra vez.",
              "La ficha queda siempre arriba. Debajo hay 3 sub pestañas: «Generar imágenes» (ver «Generar imágenes con IA»), «Títulos» y «Descripción». Puedes pasar de una a otra sin perder nada.",
              "Todo lo que hagas aquí (imágenes de referencia, información, ficha, títulos, descripción e imágenes) se guarda 2 horas en esa pestaña del navegador, aunque recargues la página. Pasadas 2 horas sin cambios, o al cerrar la pestaña, se borra. Para empezar otro producto pulsa «Empezar de cero».",
              "En la sub pestaña «Títulos» pide los títulos (máximo 60 caracteres). Arriba verás «Más buscados en la categoría»: las búsquedas en tendencia de la categoría general (Alta), la padre (Media) y la específica (Baja). De la general y la padre solo salen las que nombran el tipo de producto de tu categoría (por ejemplo, «bebedero» o «comedero»); cada palabra clave dice de dónde sale y su nivel. Luego elige un título y pulsa «Usar en» la cuenta que quieras (o «Usar en todas»): el título se pone solo abajo, en «Título, descripción y portada por cuenta».",
              "En la sub pestaña «Descripción» (mejor después de pedir los títulos: usa sus palabras clave de forma natural, sin inventar datos), si das garantía, escríbela y pulsa «Proponer descripción». Con varias cuentas marcadas sale una descripción distinta para cada cuenta, con las mismas secciones y los mismos datos, en el idioma de su país. Revísalas y pulsa «Usar en» cada cuenta o «Usar cada una en su cuenta»; «Proponer otra para esta cuenta» cambia solo esa.",
            ],
          },
          {
            titulo: "Generar imágenes con IA",
            pasos: [
              "Primero sube tus imágenes de referencia y confirma la ficha en «Generación de imágenes para Meli».",
              "En la sub pestaña «Generar imágenes», elige el estilo: Portadas Zilonix (por defecto, una portada distinta por cada cuenta marcada; puedes pedir menos, y con una sola cuenta hasta 2 para elegir la mejor), Contenido Zilonix (las 10 imágenes de contenido) o Estilo experto ML. Cada estilo guarda sus propias propuestas: puedes pasar de uno a otro sin perderlas.",
              "Pulsa «Preparar propuestas (sin costo)». Revisa en cada tarjeta el título, el copy y el prompt final; corrige lo que quieras o escribe qué cambiar y pulsa «Ajustar».",
              "Pulsa «Crear» en cada imagen o «Crear todas las aprobadas». Se crean de a 2 a la vez; las demás esperan su turno solas.",
              "Lo que creas no entra solo a la galería: queda abajo, en «Imágenes creadas», junto con todo lo de los otros estilos. «Preparar de nuevo» no lo borra.",
              "Portadas: no van a la galería. Debajo de cada portada elige de qué cuenta es (botón «Portada de», o la lista «Usar como portada de» si tienes más de 3 cuentas), o pulsa «Una portada para cada cuenta» para repartirlas en orden. Queda como portada propia de esa cuenta en «Título, descripción y portada por cuenta».",
              "Las demás imágenes: pulsa «Agregar a la galería» (o «Agregar todas a la galería»), o arrástralas a un lugar exacto de la galería de Fotos. «Quitar» solo las saca de la barra.",
              "Si una no te gusta, «Regenerar» (o «Otra composición» en las portadas) la rehace sin tocar las demás; la nueva toma su lugar en «Imágenes creadas», en la galería y en la portada de las cuentas que la usaban.",
              "«Descargar» baja una imagen y «Descargar todas» las baja una tras otra (el navegador puede preguntar si permites varias descargas).",
              "Si recargas la página, «Imágenes creadas» sigue ahí, pero la galería de Fotos y las portadas de cada cuenta no se guardan: vuelve a agregarlas desde la barra. Si una imagen se estaba creando al recargar, revisa «Imágenes creadas» antes de pulsar «Crear» otra vez.",
            ],
          },
        ],
        consejos: [
          "Necesitas una IA conectada en Administración → Conectar IA, asignada a Publicaciones o como principal. Lo cobra la cuenta de IA de tu empresa.",
          "La IA no inventa: medidas, tiempos, garantía o lo que incluye solo salen si están en tus fotos o en lo que escribiste y los confirmaste.",
          "Nada se publica desde «Generación de imágenes para Meli»: solo llena el título y la descripción de las cuentas que elijas. Solo salen las cuentas del mismo país, porque el texto está escrito en su idioma.",
          "Para imágenes necesitas ChatGPT (OpenAI) o Gemini (Google) en el módulo Generación de imágenes de Conectar IA: Claude no genera imágenes.",
          "La imagen «Opiniones reales» usa solo opiniones verdaderas que pegues de tus compradores; si no tienes, se salta. La IA nunca escribe reseñas.",
          "Las imágenes salen en 500 × 500. Mercado Libre recomienda la primera foto sobre fondo blanco: el diagnóstico te avisa si la modera, pero no bloquea.",
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
          "Ventas y utilidad: la utilidad de cada venta antes de publicidad (recaudo − comisión − flete − costo − packing − envío). Filtra por fechas hasta 1 año de una vez: salen todos los días del rango en una caja con barra para bajar. El nombre del producto se puede seleccionar y copiar; el número de pedido (#…) abre el detalle de la venta. En el detalle, pasa el mouse por el nombre de cada columna para ver qué es; la utilidad sale en verde si ganas y en rojo si pierdes, y en una venta «falta costo» el link «Cargar costo» te lleva a la Tabla maestra con ese SKU.",
          "Falabella: carga el reporte y concilia cada corte de pago.",
        ],
        consejos: [
          "Revisa «SKU sin costo»: sus ventas quedan fuera de la utilidad hasta que tengan costo. Zilonix no inventa ningún número.",
          "Al filtrar meses anteriores salen las ventas que Zilonix ya guardó: las que llegan solas desde que conectaste la cuenta. «Traer ventas de este mes» solo vuelve a leer el mes en curso.",
        ],
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
          "Si alguien se va o ya no debe entrar, el Dueño pulsa «Quitar acceso» en su fila y confirma. Pierde el acceso al instante y sus invitaciones sin aceptar se borran; si vuelve, hay que invitarlo de nuevo. Al Dueño nunca se le quita el acceso.",
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
      {
        id: "tickets",
        titulo: "Tickets de soporte",
        ruta: "/panel/tickets",
        paraQue: "Pedirle ayuda al equipo de Zilonix cuando algo no funciona, y seguir la conversación.",
        pasos: [
          "Escribe un asunto corto, elige el módulo donde pasa el problema y cuenta qué intentabas hacer y qué ocurrió.",
          "Si ayuda, pulsa «Adjuntar imágenes» y agrega hasta 3 capturas de pantalla que muestren el problema. Puedes quitarlas con la ✕ antes de enviar.",
          "Pulsa «Abrir ticket». En la lista ves el estado: Abierto, En curso o Resuelto.",
          "Abre el ticket para ver las respuestas de soporte (a veces con imágenes que te muestran qué hacer) y escribir otro mensaje, también con imágenes. Toca una imagen para verla en grande; ciérrala con la ✕, con Esc o tocando fuera.",
        ],
        consejos: [
          "Las imágenes son privadas: solo las ven las personas de tu empresa y el equipo de soporte de Zilonix.",
          "Un ticket resuelto ya no admite mensajes: si el problema sigue, abre uno nuevo.",
        ],
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
