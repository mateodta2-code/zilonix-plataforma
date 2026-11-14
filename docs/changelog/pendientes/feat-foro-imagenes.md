- **feat-foro-imagenes** — El foro (`/panel/foro`) permite **adjuntar una imagen** en cada pregunta y en cada respuesta (JPG, PNG o WEBP, máximo 8 MB). Se ve debajo del texto y al tocarla se amplía (`FotoConZoom`). También aparece en la moderación (`/superadmin/foro`) y en la exportación de Mis datos.

  **Solo archivo, nunca un link** (decisión del 14-nov). El botón sube el archivo a la ruta nueva `/api/foro/imagen`, que hace lo mismo que `/api/ml/publicar/fotos`:
  - revisa el origen;
  - rechaza por tamaño antes de leer el cuerpo;
  - confirma la firma binaria real del archivo;
  - lo sube a Cloudinary en la carpeta propia `zilonix-foro`.

  Al publicar, `lib/foro.ts` vuelve a validar que la URL sea de nuestro Cloudinary y de esa carpeta (`esUrlImagenForo`). Una imagen de otro sitio permitiría rastrear quién abre la pregunta o cambiarla después de moderada, por eso se rechaza con un mensaje.

  Para la ruta: un freno propio de 20 subidas cada 10 minutos por persona, y el mismo candado que el resto del foro (`requiereMiembroDeAlgunaEmpresa`). Queda clasificada en `RUTAS_EXENTAS` con ese motivo.

  **Migración `0023_chief_sister_grimm.sql`** (turno confirmado con Pablo): agrega la columna `imagen_url` (opcional) a `foro_preguntas` y `foro_respuestas`. `db/rls-setup.sql` no cambia, porque los GRANT existentes ya cubren la columna nueva. Hay que correrla en staging antes de fusionar, y en el release, en producción.

  Verificado:
  - `npm run typecheck` en verde.
  - `npx vitest run lib/foro-validacion.test.ts scripts/verificar-permisos.test.ts`: 255 pruebas en verde. Incluye las URL rechazadas: otro sitio, otra cuenta de Cloudinary, otra carpeta, http, parámetros y `..`.
  - `db/foro.test.ts` (Postgres real, en CI) prueba que la imagen se guarda en preguntas y respuestas y que una imagen ajena se rechaza.
