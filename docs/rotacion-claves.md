# Rotación de la clave de tokens de Mercado Libre

Los tokens de cada cuenta (access y refresh) se guardan cifrados en `cuentas_ml`. La fila recuerda con qué versión de clave se cifró. Los tokens nuevos usan el número de `ML_TOKEN_KEY_ACTUAL`; si esa variable no está, usan la 1. Borrar la clave vieja antes de re-cifrar las filas deja esas cuentas sin poder descifrar, y hay que volver a conectarlas en Mercado Libre.

El script es `npm run tokens:recifrar` (`scripts/recifrar-tokens-ml.ts`). Recorre las filas con alguna versión anterior a la actual, descifra con la clave de esa versión, cifra con la actual y escribe. Cada fila va en su propia transacción. Correrlo de nuevo no cambia lo que ya quedó en la versión actual. `--dry-run` solo cuenta: no descifra ni escribe.

Solo imprime conteos. Nunca tokens, ids de Mercado Libre, apodos ni el valor de una clave.

## Qué rol usa, y por qué

Usa el superusuario de `DATABASE_URL`, el mismo de `npm run db:migrate`. No usa `DATABASE_URL_SUPERADMIN`, `DATABASE_URL_APP` ni `DATABASE_URL_TRABAJADOR`.

- `superadmin_user` no tiene permiso de leer ni de escribir `cuentas_ml`. La decisión D8, además, es que ese rol no ve datos de negocio de una empresa. Un token de Mercado Libre es un dato de negocio.
- `app_user` puede reescribir `cuentas_ml`, pero solo de la empresa fijada en esa transacción. No puede listar todas las empresas.
- `trabajador_user` solo toca `avisos_ml`.
- El superusuario de Postgres se salta la seguridad por fila. Es el único rol que hoy llega a los tokens de todas las empresas sin una migración. El turno de migraciones (0008–0010) no deja crear un rol nuevo para esto.

El script abre esa conexión él solo, igual que `db/migrate.ts`, y la cierra al terminar. La app no la importa.

Antes de escribir comprueba que el rol de verdad se salta RLS. Si `DATABASE_URL` apunta a `app_user`, se detiene y no toca filas: si siguiera, vería cero filas (la política no deja ver ninguna sin empresa activa) y parecería que ya está todo rotado.

## Orden

Staging primero. Recién cuando el paso 5 de staging salió bien, repetir la secuencia en producción. No borrar `ML_TOKEN_KEY_V1` de un ambiente hasta que el paso 5 de ese mismo ambiente haya salido bien.

1. Agregar `ML_TOKEN_KEY_V2` en Railway. Lo hace Mateo (`openssl rand -base64 32`): una clave distinta de la V1 y distinta entre staging y producción. No pegar el valor en un chat, un commit ni un log.
2. Desplegar este código. Mientras `ML_TOKEN_KEY_ACTUAL` no esté, los tokens nuevos siguen saliendo con la versión 1 y lo ya cifrado se sigue descifrando.
3. Fijar `ML_TOKEN_KEY_ACTUAL=2` en el servicio `web` de ese ambiente y dejar que reinicie. A partir de ahí lo nuevo se cifra con V2. Las filas viejas siguen en V1 y se siguen pudiendo descifrar, porque V1 sigue presente.
4. Con el túnel privado a Postgres de ese ambiente (el mismo procedimiento que las migraciones) y con `DATABASE_URL`, `ML_TOKEN_KEY_V1`, `ML_TOKEN_KEY_V2` y `ML_TOKEN_KEY_ACTUAL=2` en el entorno del proceso — sin imprimirlas — correr primero la simulación y después la escritura:

   ```bash
   npm run tokens:recifrar -- --dry-run
   npm run tokens:recifrar
   ```

   Si una cuenta está renovando el token en ese momento, esa fila espera: el candado de renovación se sostiene durante la llamada a Mercado Libre, y saltarla podría pisar el refresh token nuevo con el viejo. Se puede cortar y volver a correr. Lo ya actualizado no se toca. La fila que falle no queda a medias (su transacción se deshace).
5. Verificar. Correr el script otra vez y confirmar `Encontradas atrás: 0` y `Actualizadas: 0`. Después, en la app de ese ambiente, una cuenta conectada tiene que seguir pudiendo operar (el panel de la cuenta, o el trabajador de avisos). Si el descifrado estuviera roto, esa operación falla. No hace falta imprimir ningún token para comprobarlo.
6. Recién entonces borrar `ML_TOKEN_KEY_V1` de ese ambiente.

## Qué no hacer

- No correr el script con `DATABASE_URL_APP`, `DATABASE_URL_SUPERADMIN` ni `DATABASE_URL_TRABAJADOR`.
- No borrar V1 en los dos ambientes el mismo día, antes de verificar cada uno.
- No usar `railway up`.
