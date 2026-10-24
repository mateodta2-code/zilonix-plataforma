# Extensión de Chrome — Investigación Zilonix Seller

Lee, en la página que ya tenés abierta (Mercado Libre Colombia, Amazon, Temu, AliExpress, Shein o Alibaba), los mismos datos que ves en pantalla: título, precio, precio anterior, descuento, vendidos (cuando el sitio los muestra), vendedor o tienda, calificación y número de opiniones — y en Mercado Libre, además, si es catálogo, Full y envío gratis.

- En una página de **producto**: un panel flotante con esos datos y un botón "Copiar datos (CSV)".
- En una página de **búsqueda o listado**: un resumen (cuántos productos se ven, precio mínimo/promedio/máximo, suma de vendidos visibles) y el top 10 por vendidos, con el mismo botón para copiar.

**Qué NO hace, a propósito**: no navega por su cuenta, no inicia sesión, no abre pestañas, no evade bloqueos ni captchas, y no manda nada a Zilonix Seller ni a ninguna base de datos — solo copia al portapapeles cuando vos apretás el botón. Un dato que el sitio no muestra sale como "No disponible", nunca inventado.

## Instalar en Chrome (modo desarrollador)

1. Abrí Chrome y entrá a `chrome://extensions`.
2. Arriba a la derecha, activá **"Modo de desarrollador"** (el interruptor).
3. Hacé clic en **"Cargar descomprimida"** ("Load unpacked").
4. Elegí la carpeta `extension/` de este repositorio (la que tiene `manifest.json` adentro) — no el ZIP, la carpeta descomprimida.
5. Listo: el ícono de la extensión aparece en la barra de Chrome. Entrá a un producto o una búsqueda en cualquiera de los 6 sitios y el panel aparece solo, abajo a la derecha.

## Cada vez que haya un cambio

Regla de este proyecto (CLAUDE.md): **toda actualización de la extensión necesita reinstalación completa** — nunca alcanza con el botón "Recargar" (↻) de `chrome://extensions`.

1. Confirmá que `extension/version.json` ya tiene la versión nueva.
2. En `chrome://extensions`, quitá la extensión vieja (**"Quitar"**).
3. Volvé a cargarla descomprimida desde cero (pasos 3-4 de arriba).

## Armar el ZIP para repartir

```bash
npm run extension:zip
```

Deja el archivo en `dist/extension/zilonix-investigacion-v<version>.zip` (usa la versión de `extension/version.json`). Quien lo reciba también instala "descomprimido": descomprime el ZIP primero y carga esa carpeta con "Cargar descomprimida" — Chrome no instala un ZIP directamente.

## Pruebas

Los selectores de cada sitio (`extension/lectores/*.js`) y el panel (`extension/content.js`) corren dentro del navegador — no se pueden probar con vitest sin un navegador real. Las funciones de seguridad (`extension/seguridad.js` — escapar HTML, validar que un link sea http(s) real, neutralizar una fórmula de Excel/Sheets en el CSV) sí están separadas justo para poder probarse: `extension/seguridad.test.ts` corre con el resto de `npm test`, igual que cualquier prueba de `lib/`.

## Si un sitio cambió y algún dato dejó de aparecer

Cada sitio tiene su propio archivo en `extension/lectores/<sitio>.js`, con una lista corta de selectores por campo (el primero que encuentra en la página, de arriba hacia abajo). Si un campo empieza a salir "No disponible" en un sitio donde antes sí aparecía, lo más probable es que ese sitio haya cambiado su HTML — hay que abrir la página real, inspeccionar el elemento (clic derecho → Inspeccionar) y agregar el selector nuevo a la lista de ese campo, sin tocar nada de `content.js` ni de los otros lectores.
