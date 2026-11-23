# Auditoría de seguridad previa al lanzamiento

Refs #556 · base: `main` `564bb8e` · Solo se citan nombres de variables, nunca valores.

Estados: **ok** (cumple) · **falta** (hueco pequeño, arreglado o anotado) · **riesgo** (hueco real que no se arregla aquí).

| # | Punto | Estado | Evidencia | Arreglo |
|---|---|---|---|---|
| 1 | Autenticación | ok | `middleware.ts`, `app/sign-in`, `app/cuenta`; superadmin con cookie HMAC (`lib/superadmin-sesion.ts`, `SUPERADMIN_SESION_SECRETO`), `httpOnly`, `secure` en producción, `sameSite: "strict"` | Ninguno |
| 2 | Claves API fuera del navegador | ok | Claves de IA y tokens de ML cifrados con AES-256-GCM (`lib/cifrado.ts`, `lib/ia/conexion.ts`); la única `NEXT_PUBLIC_*` leída por el código propio es `NEXT_PUBLIC_APP_URL` (más la pública de Clerk, que lo es por diseño) | Ninguno |
| 3 | HTTPS | ok | HSTS `max-age=63072000; includeSubDomains` en `next.config.mjs`; Railway termina TLS | Ninguno. Pendiente menor: agregar `preload` solo si se decide inscribir el dominio |
| 4 | Contraseñas con hash (Clerk) | ok | Delegado a Clerk; no hay columna de contraseña en `db/schema.ts` | Ninguno |
| 5 | Validación en el servidor | ok (parcial) | Server actions validan con `String(formData.get(...))` y comprobaciones propias; `/api` valida (p. ej. `app/api/ml/publicar/fotos/route.ts`) | Sin esquema común de validación; no se unifica aquí (no usar zod). Ver pendiente |
| 6 | XSS | ok | Un solo `dangerouslySetInnerHTML`, en `app/layout.tsx` (script del tema, contenido fijo, sin datos de usuario); React escapa el resto | Ninguno |
| 7 | CSRF | ok (parcial) | Server actions: Next compara `Origin` con `Host`. Cookies `sameSite: "lax"`/`"strict"`. Rutas `/api` con cookie: ver pendiente | Ninguno aquí; revisar `POST` de `/api` con cookie |
| 8 | CORS | ok | No hay `Access-Control-*` en `app/` ni `middleware.ts`; `app/api/extension/nicho/route.ts` sale del service worker de la extensión y su respuesta no es legible desde otro sitio | Ninguno |
| 9 | Cabeceras de seguridad | ok | `next.config.mjs` `headers()` en `/(.*)`: CSP aplicada, HSTS, `nosniff`, `X-Frame-Options: SAMEORIGIN`, `Referrer-Policy`, `Permissions-Policy`. Prueba nueva: `tests/seguridad-cabeceras.test.ts` | Pruebas agregadas. CSP sin tocar (conserva `'unsafe-inline'` que pide Clerk) |
| 10 | Cookies | falta → corregido | `empresa_actual` (`app/crear-empresa/actions.ts`, `app/invitacion/[token]/actions.ts`, `app/panel/actions.ts`) y bodega (`app/invitacion-bodega/[token]/actions.ts`) no tenían `secure` | `secure: process.env.NODE_ENV === "production"` en las 4; nombre y `sameSite` intactos. `app/panel/actions.ts` no estaba en la lista previa, es la misma cookie. Las de borrado (`maxAge: 0`) no llevan datos |
| 11 | Límite de peticiones | ok | `middleware.ts`: 180 por IP y 300 por usuario por minuto (ajustables con `LIMITE_PETICIONES_POR_IP` y `LIMITE_PETICIONES_POR_USUARIO`); 429 puntuales en IA y búsqueda por foto. El límite vive en memoria de cada instancia | Si se escala a varias instancias, pasarlo a un almacén compartido (pendiente) |
| 12 | Subida de archivos | ok | `app/api/ml/publicar/fotos/route.ts`: valida tipo, tamaño (`TAMANO_MAXIMO_FOTO_EXTERNA_BYTES`), bytes mágicos y `Content-Length` | Ninguno |
| 13 | Pagos en el servidor | ok (n/a) | No hay integración de Mercado Pago en `main`; solo un texto «pendiente de conectar» en `app/panel/finanzas/disponible/page.tsx` | Al construirla: confirmar el pago siempre por API con el token, nunca por el contenido del webhook |
| 14 | Dependencias vulnerables | riesgo | `npm audit`: 12 avisos (3 críticos, 3 altos, 6 moderados) en `next`, `drizzle-orm`, `drizzle-kit`, `vitest`/`vite`/`esbuild`/`tinypool`, `postcss`. Todos piden `npm audit fix --force` (salto mayor) | No se cambia nada, por la regla del PR. Ver pendiente |
| 15 | Secretos en Git | ok | gitleaks en `.github/workflows/ci.yml` con `.gitleaks.toml`, escanea el historial | Ninguno |

## Pendiente grande (no se arregla aquí)

1. **Dependencias (punto 14):** subir `next`, `drizzle-orm`/`drizzle-kit`, `vitest` (arrastra `vite`, `esbuild`, `tinypool`) y `postcss`. Cada uno es un salto mayor que exige su propio PR y su prueba en staging. Los críticos de `next` y `tinypool` son lo primero. `vitest`/`vite`/`esbuild`/`tinypool` son solo de desarrollo.
2. **CSP más estricta:** quitar `'unsafe-inline'` con nonce (Clerk lo soporta, falta probar login, 2FA y `/cuenta` en vivo). Se puede probar antes con una `Content-Security-Policy-Report-Only` aparte; no se agrega aquí para no sumar ruido al lanzamiento.
3. **CSRF en `/api` con cookie:** revisar uno por uno los `POST`/`DELETE` de `app/api/**` que dependen de la cookie de Clerk y, si hace falta, verificar `Origin`.
4. **Límite de peticiones compartido:** pasarlo a un almacén común si hay más de una instancia.
5. **Validación común** de entradas en server actions y `/api` (hoy cada una valida a mano).
6. **Pagos:** al construir Mercado Pago, auditar el flujo aparte.
