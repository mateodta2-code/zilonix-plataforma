### Investigación: «Buscar por foto» (solo Mercado Libre)

- Nuevo botón «Buscar por foto» junto a Analizar: sube, arrastra o pega (Ctrl/Cmd+V) una foto, o elige un cuadro de un video de hasta 30 s. La IA que la empresa conectó en Configuración reconoce el producto; la persona corrige nombre, marca, modelo, atributos y búsquedas, y «Buscar» corre el escaneo de Mercado Libre con la extensión como siempre.
- Al llegar el listado, la foto se compara con hasta 12 miniaturas (una sola llamada a la IA) y se muestran «Se ve igual», «Parecido», «Dudosos» y, con un interruptor, los descartados. Si la comparación falla, el listado sigue completo con un aviso.
- Cada empresa paga con su propia IA (nunca la llave de la plataforma). Si no hay IA conectada o no lee imágenes, se avisa con un mensaje claro.
- Privacidad: la foto solo vive en memoria (navegador y petición del servidor); no se guarda en disco, base de datos, logs ni sessionStorage/localStorage.
- Sin migración.

**Límites:** foto de hasta 5 MB (se reduce a 1280 px en el navegador); 12 miniaturas de ≤ 300 KB por comparación; 20 fotos por hora y 40 comparaciones por hora por empresa (en memoria del proceso).

**Pendientes:** Uruguay y Perú buscan en español neutro y sin símbolo de moneda (no están en SITIOS_ML); AliExpress/Alibaba siguen en pausa; los `money()` fijos a COP de PanelInvestigacion no se tocaron.
