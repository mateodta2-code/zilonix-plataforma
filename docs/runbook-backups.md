# Runbook — backups de Postgres (Z-MT-11)

Procedimiento para Mateo. El código de este repositorio no activa backups ni restaura nada: Railway no se toca desde un Pull Request. Este archivo dice cómo comprobarlo y cómo anotar el resultado.

Consultado el **2026-10-22** contra la documentación oficial de Railway:

- Backups de volumen: [docs.railway.com/volumes/backups](https://docs.railway.com/volumes/backups)
- Guía de Postgres (volcado lógico y ensayo de restauración): [docs.railway.com/guides/postgres-backups-restores](https://docs.railway.com/guides/postgres-backups-restores)
- Comandos de programación y de backup: [docs.railway.com/cli/postgres](https://docs.railway.com/cli/postgres)

Si la pestaña Backups del dashboard dice otra retención el día que se corre esto, se anota lo que muestra la pestaña. Estas cifras son las de la documentación ese día.

## Qué hace hoy un backup de volumen

El Postgres de Railway guarda los datos en un volumen. El backup de volumen es una foto de ese volumen, incremental y copy-on-write. Se programa por volumen, y se pueden prender varias frecuencias a la vez. Cada una tiene su propia retención, fija por Railway (no es un número que se tipee):

| Programación | Cada cuánto | Cuánto la guarda la documentación de volúmenes |
|---|---|---|
| Diaria | 24 horas | 6 días |
| Semanal | 7 días | 27 días |
| Mensual | 30 días | 89 días |

La guía de Postgres redondea la semanal a "1 month" y la mensual a "3 months". La página de volúmenes es la que trae los días exactos (6, 27 y 89).

También se puede disparar un backup manual desde la misma pestaña. El manual no se repite solo: no reemplaza la programación. Railway limita el backup manual al 50% del tamaño del volumen. Si los datos pasan ese umbral, primero se agranda el volumen.

Borrar el volumen (wipe) borra todos sus backups. Un backup protege de un dato mal escrito, no de borrar el volumen.

## Reglas de este ensayo

1. La restauración de prueba entra en una base **temporal**: un servicio Postgres nuevo, creado solo para esto, con nombre `restore-drill-` más el ambiente y la fecha. Se borra al terminar.
2. El Postgres que ya tiene los datos (staging y producción) solo se lee. No se le hace Restore, no se le corre `pg_restore` y no se le cambia ninguna variable del servicio `web`.
3. El botón **Restore** de un backup de volumen, y el comando `railway postgres pitr backup restore`, restauran **en el mismo servicio**: Railway monta un volumen nuevo en la ruta del volumen actual y desmonta el anterior. El cambio queda staged hasta apretar Deploy. En este ensayo ese botón y ese comando no se usan. Apretar Deploy ahí reemplazaría los datos vivos.
4. Los backups de volumen solo se restauran dentro del mismo proyecto y el mismo ambiente. Eso no cambia la regla anterior: aunque sea el mismo ambiente, el destino del ensayo es un servicio nuevo.
5. **Ninguna cadena de conexión se pega en un issue, un chat, un log, el changelog ni este archivo.** Tampoco un volcado de `railway variables`, ni la salida cruda del túnel, ni el archivo `.dump`. Si un comando falla, no se copia el mensaje completo: se anota el código de salida y, si hace falta, la frase del script de conteos (solo nombres de tabla y conteos).

El usuario de las dos conexiones del ensayo es el `postgres` que imprime el túnel (superusuario de ese servicio). `app_user` respeta RLS y vería solo una empresa: los conteos no coincidirían aunque la restauración estuviera bien.

## 1. Verificar que los backups están activos

Repetir en los dos ambientes, **staging primero** y producción después. En staging el servicio de Postgres figuraba como `Postgres-n8XD` al 2026-10-21 (`docs/ESTADO.md`); confirmar el nombre en el dashboard por si cambió. En producción es el servicio Postgres de ese ambiente, que puede llamarse distinto.

1. Abrir el proyecto en el dashboard de Railway y elegir el ambiente.
2. Abrir el servicio Postgres (no el servicio `web`).
3. Ir a la pestaña **Backups**.
4. Anotar en la tabla del final qué programaciones están prendidas (diaria, semanal, mensual) y la retención que muestra la pantalla.
5. Si no hay ninguna programación prendida, prender **diaria y semanal**. La mensual queda opcional (89 días). Guardar. `railway postgres pitr schedule set` deja activas solo las frecuencias que se le pasan en ese comando; para el mismo resultado por CLI, con el ambiente ya confirmado: `railway postgres pitr schedule set --service <servicio-postgres> --environment <ambiente> --daily --weekly`. No correr esa orden con `--none`.
6. Para confirmar sin depender solo de la pantalla: `railway postgres pitr schedule list --service <servicio-postgres> --environment <ambiente>`. La salida esperada es la lista de frecuencias. Si el JSON trajera algo más que eso, no se pega en el issue.
7. Disparar un backup manual (botón en la misma pestaña, o `railway postgres pitr backup create --service <servicio-postgres> --environment <ambiente> --name ensayo-z-mt-11`) y confirmar que aparece en la lista. No apretar Restore sobre esa fila.
8. Repetir del paso 1 al 7 en el otro ambiente.

Si el CLI no reconoce `postgres pitr`, vale la pestaña Backups. No hace falta actualizar el CLI en medio del ensayo.

## 2. Restaurar en una base temporal

Hacer el ensayo completo en staging. Recién después, el de producción. El origen de producción se lee; el destino sigue siendo un servicio nuevo.

Herramientas locales: `pg_dump` y `pg_restore` (`postgresql-client`). El túnel es el privado de siempre (`railway connect <servicio-postgres> --tunnel-only`). No usar el proxy TCP público.

### 2.1. Crear el destino

En el **mismo ambiente** que el origen de este ensayo, crear un Postgres nuevo y vacío. Nombre: `restore-drill-staging-AAAAMMDD` o `restore-drill-production-AAAAMMDD`. No enlazar el servicio `web` a esa base. No copiar variables del `web` hacia ahí, ni al revés.

### 2.2. Volcar el origen (solo lectura)

Terminal A, túnel al Postgres **vivo** de ese ambiente. Dejarla abierta. Confirmar con `railway status` (o el selector del dashboard) que el ambiente es el que se quiere leer, antes de conectar.

Terminal B. El archivo queda en `$HOME`, fuera del repo. `read -rs` no muestra la contraseña ni la guarda en el historial del shell: se pega ahí lo que imprimió el túnel, y Enter.

```bash
mkdir -p "$HOME/zilonix-restore-drill"
export PGHOST_ORIGEN=127.0.0.1
export PGUSER_ORIGEN=postgres
export PGDATABASE_ORIGEN=railway
printf 'PGPORT_ORIGEN: '; read -r PGPORT_ORIGEN
printf 'PGPASSWORD_ORIGEN: '; read -rs PGPASSWORD_ORIGEN; echo
export PGPORT_ORIGEN PGPASSWORD_ORIGEN

PGHOST="$PGHOST_ORIGEN" PGPORT="$PGPORT_ORIGEN" PGUSER="$PGUSER_ORIGEN" \
PGDATABASE="$PGDATABASE_ORIGEN" PGPASSWORD="$PGPASSWORD_ORIGEN" \
pg_dump --format=custom --no-owner \
  --file="$HOME/zilonix-restore-drill/origen-<ambiente>-<fecha>.dump"
echo "dump exit=$?"
```

No correr `echo`, `env`, `set -x` ni `history` después de cargar esas variables. `pg_dump` no lleva `--clean` y no escribe en la base. Si `dump exit` no es 0, seguir en la sección 4. No abrir el archivo ni pegarlo en ningún lado.

### 2.3. Restaurar en el servicio temporal

Terminal C, otro túnel, ahora al servicio `restore-drill-...`. Otro puerto local. El túnel del origen sigue abierto: el script del paso 3 necesita los dos.

En la misma terminal B, cargar el destino con otros nombres. No reutilizar la contraseña del origen salvo que de verdad sea la de este servicio nuevo.

```bash
export PGHOST_TEMP=127.0.0.1
export PGUSER_TEMP=postgres
export PGDATABASE_TEMP=railway
printf 'PGPORT_TEMP: '; read -r PGPORT_TEMP
printf 'PGPASSWORD_TEMP: '; read -rs PGPASSWORD_TEMP; echo
export PGPORT_TEMP PGPASSWORD_TEMP

PGHOST="$PGHOST_TEMP" PGPORT="$PGPORT_TEMP" PGUSER="$PGUSER_TEMP" \
PGDATABASE="$PGDATABASE_TEMP" PGPASSWORD="$PGPASSWORD_TEMP" \
pg_restore --no-owner --exit-on-error \
  --dbname="$PGDATABASE_TEMP" \
  "$HOME/zilonix-restore-drill/origen-<ambiente>-<fecha>.dump"
echo "restore exit=$?"
```

`--dbname` es el nombre de la base dentro del servicio temporal (`railway`), no una URL. No usar `--clean` ni `--if-exists`: en una base equivocada, eso borraría objetos. El servicio temporal nace vacío, así que no hace falta limpiar nada.

## 3. Comprobar la restauración

Solo si `restore exit=0`. Si no, ir a la sección 4 sin correr el script: un temporal a medias no sirve para anotar `ok`.

Con los dos túneles abiertos y las variables de la terminal B todavía cargadas. Las URLs se arman ahí; no se escriben en el issue y no se imprimen:

```bash
# encodeURIComponent: una contraseña con @ : / # ? o % rompería la URL.
# El resultado queda en la variable; no se imprime.
export DATABASE_URL_ORIGEN="postgresql://${PGUSER_ORIGEN}:$(node -e 'process.stdout.write(encodeURIComponent(process.env.PGPASSWORD_ORIGEN ?? ""))')@${PGHOST_ORIGEN}:${PGPORT_ORIGEN}/${PGDATABASE_ORIGEN}"
export DATABASE_URL_RESTAURADA="postgresql://${PGUSER_TEMP}:$(node -e 'process.stdout.write(encodeURIComponent(process.env.PGPASSWORD_TEMP ?? ""))')@${PGHOST_TEMP}:${PGPORT_TEMP}/${PGDATABASE_TEMP}"

npx tsx scripts/comparar-conteos.ts
echo "conteos exit=$?"
```

No correr `echo $DATABASE_URL_ORIGEN` ni `echo $DATABASE_URL_RESTAURADA`.

El script lista las tablas de `public` y compara `count(*)` de cada una. Imprime una línea por tabla: `nombre filas_origen filas_restaurada`. Un `-` quiere decir que la tabla no existe en ese lado (no es lo mismo que cero filas). No imprime filas ni la URL. Sale con código 1 si alguna difiere, si falta una variable, si las dos conexiones son la misma base, o si no puede leer.

- `conteos exit=0` y una línea por tabla con los dos números iguales: la restauración de este ensayo cuadra. Anotar `ok` en la tabla.
- `conteos exit=1` con líneas de conteo: anotar `falla` y las líneas que no coinciden (son solo nombres y conteos; se pueden copiar). No editar filas para forzar el empate.
- Si el script dice que faltan variables o que las dos conexiones son la misma base: no es un fallo de la restauración. Corregir las variables y volver a correrlo. La frase no trae la URL; se puede pegar tal cual.

Después de anotar, borrar el rastro del ensayo:

```bash
unset DATABASE_URL_ORIGEN DATABASE_URL_RESTAURADA PGPASSWORD PGPASSWORD_ORIGEN PGPASSWORD_TEMP PGHOST PGPORT
rm -rf "$HOME/zilonix-restore-drill"
```

Cerrar los túneles. En el dashboard, borrar el servicio `restore-drill-...`. No borrar el Postgres vivo ni su volumen.

Repetir la sección 2 y esta sección con el origen de producción y un `restore-drill-production-...` nuevo. El servicio temporal de producción también se borra al anotar el resultado.

## 4. Si algo falla

El Postgres vivo no se "arregla" con Restore para salvar el ensayo. El origen de un `pg_dump` no queda modificado cuando el volcado falla.

| Qué pasó | Qué hacer |
|---|---|
| `pg_dump` sale distinto de 0 | Anotar el código, sin el mensaje si puede traer una URL. Reabrir el túnel si se cayó y repetir el volcado. El origen sigue igual. |
| `pg_restore` sale distinto de 0 | El temporal puede haber quedado a medias. Borrar ese servicio, crear otro `restore-drill-...` y repetir solo contra ese. No correr `pg_restore` contra el Postgres de staging ni el de producción. |
| El script sale 1 y los conteos difieren | Anotar las líneas. Revisar que el túnel de origen y el del temporal no estén cruzados, y que el `.dump` sea el de este ensayo (ambiente y fecha en el nombre). No tocar filas. |
| El script dice que las dos conexiones son la misma base | La URL restaurada apunta al origen. Apuntarla al servicio temporal y repetir. |
| El backup manual lo rechaza Railway | Tope oficial: 50% del tamaño del volumen. Agrandar el volumen y repetir el manual. No borrar el volumen. |
| No aparece ninguna programación | Seguir el paso 5 de la sección 1. Un manual suelto no deja los backups activos. |
| Se apretó Restore en el servicio vivo | **No apretar Deploy.** Railway deja el cambio staged (Details, arriba del canvas). Descartar ese cambio. El volumen anterior sigue en el proyecto, desmontado, hasta que se despliegue la restauración. Anotar en la tabla `abortado: Restore staged, sin Deploy`. En el issue #63, esa frase y nada más: sin URLs, sin salida del túnel. |
| Se corrió `railway postgres pitr backup restore` | Ese comando pisa el servicio elegido. Si Railway todavía muestra el cambio como staged, descartarlo y no desplegar. Si el deploy ya corrió, parar y avisar en el issue con la frase `restore in-place desplegado en <ambiente>`, sin cadenas de conexión. No intentar un segundo restore encima. |

PITR (recuperación a un punto en el tiempo) es otra capa: [docs.railway.com/volumes/point-in-time-recovery](https://docs.railway.com/volumes/point-in-time-recovery). Prenderla redeploya el Postgres y crea un bucket. Este ensayo no la prende. Su restore, a diferencia del backup de volumen, crea un servicio al lado y no toca el origen; igual no forma parte de los pasos de arriba.

## 5. Registro

Completar una fila por ensayo. Fecha en UTC. Resultado: `ok`, `falla` (con las líneas de conteo que difieran, si las hay) o `abortado` (con la frase corta de la tabla de arriba). Quién: el nombre de quien lo corrió.

| Fecha (UTC) | Ambiente | Frecuencia | Retención | Resultado | Quién |
|---|---|---|---|---|---|
| | staging | | | | |
| | production | | | | |

Frecuencia y retención son las que mostró la pestaña Backups ese día (por ejemplo `diaria + semanal` y `6 días + 27 días`), no una copia automática de esta página.

Cuando las dos filas estén completas, se pegan en el issue #63 **sin** cadenas de conexión, y recién ahí se puede cerrar el issue. Este runbook no lo cierra solo.
