# Extensión en la Chrome Web Store

Este documento explica cómo se publica la extensión «Zilonix Seller — Investigación» y qué hace Mateo **una sola vez** para que, después, cada versión nueva se publique sola.

## Cómo funciona después de la configuración

1. Se sube la versión en `extension/manifest.json` y en `extension/version.json` (deben coincidir).
2. El cambio llega a la rama `produccion`.
3. El workflow `.github/workflows/extension-publicar.yml` corre las pruebas de la extensión, arma el ZIP (`npm run extension:zip`), lo sube a la Chrome Web Store con la API v2 y lo manda a revisión.
4. Si esa versión ya está publicada o en revisión, no sube nada.
5. Si falta alguno de los 5 secretos, el workflow termina en verde con un aviso y no publica.

También se puede lanzar a mano desde la pestaña Actions de GitHub (`workflow_dispatch`).

Google revisa cada versión antes de mostrarla; la revisión puede tardar desde horas hasta varios días.

## Pasos de una sola vez (Mateo)

### 1. Cuenta de desarrollador
1. Entrar a <https://chrome.google.com/webstore/devconsole> con la cuenta de Google de la empresa.
2. Pagar el registro único de **5 USD** y aceptar el acuerdo.
3. Anotar el **ID del publicador** (Publisher ID): aparece en la consola, en Cuenta. Será el secreto `CWS_PUBLISHER_ID`.

### 2. Subir a mano la primera versión como «No listada»
La API solo actualiza una extensión que ya existe.
1. En la consola, «Add new item» y subir el ZIP generado con `npm run extension:zip` (queda en `dist/extension/`).
2. Completar la ficha: descripción, capturas, ícono, categoría.
3. En «Privacy», pegar el propósito único y las justificaciones de la sección siguiente. Como URL de la política de privacidad, usar `https://seller.zilonix.com/privacidad`.
4. En «Distribution», elegir visibilidad **«No listada»** y enviar a revisión.
5. Anotar el **ID de la extensión** (32 letras). Será el secreto `CWS_EXTENSION_ID`.

### 3. Habilitar la Chrome Web Store API
1. En <https://console.cloud.google.com> crear un proyecto (por ejemplo «Zilonix Web Store»).
2. En «APIs y servicios» → «Biblioteca», buscar **Chrome Web Store API** y habilitarla.

### 4. Crear el cliente OAuth
1. En «APIs y servicios» → «Pantalla de consentimiento de OAuth», configurar la app (nombre, correo de soporte).
2. **Poner el estado de publicación en «In production».** En «Testing» el refresh token vence a los 7 días y la publicación automática dejaría de funcionar.
3. En «Credenciales» → «Crear credenciales» → «ID de cliente de OAuth», tipo **Aplicación web**.
4. Agregar como URI de redireccionamiento autorizado `https://developers.google.com/oauthplayground`.
5. Guardar el **Client ID** (`CWS_CLIENT_ID`) y el **Client secret** (`CWS_CLIENT_SECRET`).

### 5. Sacar el refresh token
1. Abrir <https://developers.google.com/oauthplayground>.
2. Con el engranaje, marcar «Use your own OAuth credentials» y pegar el Client ID y el Client secret.
3. En el paso 1, escribir el alcance `https://www.googleapis.com/auth/chromewebstore` y pulsar «Authorize APIs». Entrar con la **misma cuenta** de la consola de desarrollador.
4. En el paso 2, pulsar «Exchange authorization code for tokens» y copiar el **Refresh token** (`CWS_REFRESH_TOKEN`).

### 6. Crear los 5 secretos en GitHub
En el repositorio: Settings → Secrets and variables → Actions → «New repository secret». Crear, con estos nombres exactos:

| Secreto | Qué es |
|---|---|
| `CWS_CLIENT_ID` | Client ID del cliente OAuth |
| `CWS_CLIENT_SECRET` | Client secret del cliente OAuth |
| `CWS_REFRESH_TOKEN` | Refresh token del paso 5 |
| `CWS_PUBLISHER_ID` | ID del publicador (paso 1) |
| `CWS_EXTENSION_ID` | ID de la extensión (paso 2) |

Nunca se pegan estos valores en un chat, un issue ni un archivo del repositorio.

### 7. Probar
En Actions, ejecutar a mano «Extensión · publicar en la Chrome Web Store». Si la versión del manifest ya está publicada, el resultado es «Sin cambios»; es la señal de que los secretos funcionan.

## Textos para el formulario de la Chrome Web Store

Se redactaron a partir del `extension/manifest.json` de la versión 0.3.41. Si el manifest cambia de permisos o de dominios, hay que actualizar esta sección y la ficha.

### Propósito único
Investigación de productos para vendedores de Zilonix Seller

### Justificación del permiso `storage`
Guarda en el navegador dos preferencias del propio usuario (si el panel está encendido y a qué instalación de Zilonix Seller debe enviar los datos) y datos temporales de la sesión (colas de lecturas pendientes y avisos para no repetir acciones). No guarda contraseñas ni el contenido de las páginas visitadas.

### Justificación de los dominios (content scripts)
En todos, la extensión solo corre en la página que el usuario tiene abierta y lee los datos visibles de un producto: precio, vendidos, vendedor y calificación. No inicia sesión ni lee contraseñas.

| Dominio | Justificación |
|---|---|
| `mercadolibre.com.co`, `.com.ar`, `.com.mx`, `.cl`, `.com.uy`, `.com.pe` y `mercadolivre.com.br` | Mercado Libre es el marketplace donde vende el usuario. Se lee la publicación abierta para analizarla (precio, vendidos, vendedor, calificación) y se ofrece seguirla en Zilonix Seller. Hay un dominio por país donde opera Mercado Libre. |
| `amazon.com`, `amazon.com.mx` | Se lee el producto abierto para comparar precio y calificación con la competencia antes de invertir. |
| `temu.com` | Igual que Amazon: comparar el producto abierto como fuente de abastecimiento. |
| `aliexpress.com`, `aliexpress.us` | Igual: comparar el producto abierto como fuente de abastecimiento. |
| `shein.com`, `shein.com.co` | Igual: comparar el producto abierto como fuente de abastecimiento. |
| `alibaba.com` | Igual: comparar el producto abierto con proveedores mayoristas. |
| `web-production-af270.up.railway.app` y `web-staging-d979.up.railway.app` (solo `/panel/investigacion*` y `/panel/publicar*`) | Son las páginas de Zilonix Seller. Ahí la extensión marca que está instalada y entrega al panel del usuario los datos leídos. Staging es el ambiente de pruebas. |

> Nota para el siguiente cambio del manifest: los dos últimos dominios son direcciones de Railway. Si la aplicación pasa a un dominio propio, hay que cambiarlos en `manifest.json`, en `extension/background.js`, en `extension/marcador-zilonix.js` y aquí.

### Recursos accesibles (`web_accessible_resources`)
El archivo `panel.css` se expone solo en los dominios listados arriba, para dar estilo al panel flotante que la extensión muestra en esas páginas.

### Uso de datos (declaración)
- Datos de la página abierta (precio, vendidos, vendedor, calificación y datos visibles del producto): se envían únicamente a la cuenta de Zilonix Seller del propio usuario.
- No se venden ni se transfieren a terceros ajenos al propósito único, ni se usan para fines no relacionados con él.
- Política de privacidad: `https://seller.zilonix.com/privacidad` (sección «Extensión de Chrome de Zilonix Seller»).
