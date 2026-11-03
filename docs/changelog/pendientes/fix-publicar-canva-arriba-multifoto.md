- **2026-11-03** — Publicar: arregla el 500 al conectar Canva, sube "Conectar Canva" arriba y permite elegir/soltar varias fotos a la vez.

  **Error 500 en `GET /api/canva/conectar`**: `lib/canva/oauth.ts` (`requerirVariable`) ahora hace `.trim()` y trata una variable vacía o solo con espacios como faltante — Railway puede dejar `CANVA_CLIENT_ID`/`CANVA_CLIENT_SECRET` puestas así, y antes pasaban el chequeo `if (!valor)` y tronaban más adelante igual. `app/api/canva/conectar/route.ts` envuelve el armado de la URL de autorización en try/catch: si falla (variable faltante u otro error antes de llegar a Canva), redirige a `/panel/publicar?canva=error&codigo=error_desconocido` (mismo patrón que ya usa `/api/canva/callback`) en vez de un 500 crudo; el error completo solo queda en `console.error`, nunca secretos.

  **"Conectar Canva" ahora es el primer paso visible en Publicar**: el widget (`ConectarCanva.tsx`) se movió de dentro de `GaleriaFotos.tsx` (quedaba debajo de las miniaturas, fácil de no ver) a un recuadro propio arriba del todo en `FormularioPublicar.tsx`, antes de "Cuentas destino". El campo para pegar el link de un diseño de Canva sigue en la galería, sin cambios.

  **Subir varias fotos del escritorio a la vez**: el input de archivo de `GaleriaFotos.tsx` admite `multiple`, y elegir o soltar varios archivos los sube todos, en el orden elegido, máximo 3 en paralelo (`usarSubidaFotoCloudinary.ts` — nueva `subirArchivos`). Respeta el límite de fotos de la categoría (`maxFotos`, detectado en `FormularioPublicar.tsx`): si el lote se pasa, sube solo hasta llenar el cupo y avisa cuántas quedaron fuera. Muestra el progreso ("Subiendo 2 de 5"); si una foto falla, las demás siguen subiendo igual.

  **Tests**: `lib/canva/oauth.test.ts` — nuevo caso para `CANVA_CLIENT_ID` puesta pero vacía/con espacios.

  **No se tocó**: `extension/`, `lib/ml/cliente.ts`, `db/schema.ts` — sin migración. Refs #366.
