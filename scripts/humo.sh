#!/usr/bin/env bash
# Z-MT-10 (issue #45) — comprobación de humo contra un origen, sin
# credenciales. Codifica la tabla de aceptación del issue (código y
# tiempo máximo de cada ruta) más /api/salud = 200 y /api/version = 200.
#
# Sale con 0 si todo coincide, 1 si alguna fila no, 2 si la invocación
# está mal. Imprime la tabla igual cuando hay fallos, para verlos juntos.
#
# /api/ml/webhooks tiene 500 ms y no 1 s: Mercado Libre reintenta y
# puede desactivar el callback si la respuesta tarda. El resto de la
# tabla, 1 s. /api/salud espera hasta 3 s porque el propio endpoint le
# da 2 s a la base antes de responder 503 — un tope de 1 s convertiría
# una base lenta pero viva en un corte de curl, sin llegar a leer el
# estado.
#
# Si /api/salud trae trabajos_muertos > 0, o la edad del último trabajo
# procesado es de más de 10 min (600 s), esta corrida falla. null en
# esos campos es "la cola todavía no existe" (issue #49), no un fallo.

set -u

if [[ $# -ne 1 || -z "${1:-}" ]]; then
  echo "Uso: scripts/humo.sh <URL>" >&2
  exit 2
fi

BASE="${1%/}"

if [[ "$BASE" == *"@"* ]]; then
  echo "La URL no puede incluir usuario ni contraseña." >&2
  exit 2
fi

if [[ ! "$BASE" =~ ^https?://[^/]+$ ]]; then
  echo "Uso: scripts/humo.sh <URL>" >&2
  echo "La URL tiene que ser un origen http(s), sin ruta." >&2
  exit 2
fi

# Segundos que curl espera como máximo antes de rendirse. Va por encima
# del tope de la fila para alcanzar a leer un código tardío y marcarlo
# como tiempo vencido, en vez de quedarnos 30 s en el handshake de Clerk.
tope_curl() {
  awk -v max_ms="$1" 'BEGIN { printf "%.3f", (max_ms / 1000) + 1 }'
}

en_ms() {
  awk -v t="${1:-0}" 'BEGIN { printf "%d", (t + 0) * 1000 }'
}

# $1 valor ya sin comillas. null es válido (cola aún no existe).
es_numero() {
  [[ "$1" =~ ^[0-9]+([.][0-9]+)?$ ]]
}

valor_json() {
  local cuerpo="$1" clave="$2" crudo
  crudo=$(printf '%s' "$cuerpo" | tr -d '\n' | sed -n -E "s/.*\"${clave}\"[[:space:]]*:[[:space:]]*([^,}]+).*/\1/p")
  crudo=${crudo#\"}
  crudo=${crudo%\"}
  printf '%s' "$crudo"
}

va_a_login() {
  [[ "$1" =~ /sign-in([/?#]|$) || "$1" =~ /login([/?#]|$) ]]
}

cuerpo=$(mktemp)
error_curl=$(mktemp)
trap 'rm -f "$cuerpo" "$error_curl"' EXIT

fallos=0

# resultado queda en la variable global RESULTADO (ok | FALLO …).
# codigo, tiempo_s y redir_url quedan en CODIGO, TIEMPO_S, REDIR.
pedir() {
  local metodo="$1" ruta="$2" max_ms="$3" acepta="$4"
  local max_curl args linea rc
  max_curl=$(tope_curl "$max_ms")
  args=(-sS --http1.1 --connect-timeout 2 --max-redirs 0 --max-time "$max_curl" -o "$cuerpo" -w "%{http_code} %{time_total} %{redirect_url}" -X "$metodo")
  if [[ "$acepta" == "html" ]]; then
    # /login y /panel son de navegador. Sin Accept: text/html, Clerk
    # trata la petición como de máquina (issue de middleware, PR #27).
    args+=(-H "Accept: text/html")
  fi
  if [[ "$metodo" == "POST" ]]; then
    # Cuerpo vacío a propósito: un JSON con forma de aviso de Mercado
    # Libre haría que /api/ml/webhooks intente guardarlo. El 200 de la
    # tabla es el de "nadie autenticado", no el de un aviso real.
    args+=(--data "")
  fi

  rc=0
  linea=$(curl "${args[@]}" "${BASE}${ruta}" 2>"$error_curl") || rc=$?
  if [[ $rc -ne 0 && ! "$linea" =~ ^[0-9]{3}[[:space:]] ]]; then
    CODIGO="000"
    TIEMPO_S="$max_curl"
    REDIR=""
    return
  fi
  read -r CODIGO TIEMPO_S REDIR <<<"$linea"
  REDIR=${REDIR:-}
  TIEMPO_S=${TIEMPO_S:-0}
}

anotar() {
  local ruta="$1" metodo="$2" espera="$3" real="$4" ms="$5" max_ms="$6" resultado="$7"
  printf '%-28s %-6s %-7s %-7s %6s %6s  %s\n' "$ruta" "$metodo" "$espera" "$real" "$ms" "$max_ms" "$resultado"
  if [[ "$resultado" != ok ]]; then
    fallos=$((fallos + 1))
  fi
}

# Comprueba código y tiempo. Si extra=login, el 307 tiene que ir a la
# página de login (/sign-in o /login).
comprobar() {
  local ruta="$1" metodo="$2" espera="$3" max_ms="$4" acepta="$5" extra="${6:-}"
  pedir "$metodo" "$ruta" "$max_ms" "$acepta"
  local ms resultado
  ms=$(en_ms "$TIEMPO_S")
  resultado="ok"
  if [[ "$CODIGO" == "000" ]]; then
    resultado="FALLO sin respuesta"
  elif [[ "$CODIGO" != "$espera" ]]; then
    resultado="FALLO código ${CODIGO}"
  elif awk -v t="$TIEMPO_S" -v m="$max_ms" 'BEGIN { exit !((t + 0) * 1000 > m) }'; then
    resultado="FALLO tiempo ${ms} ms"
  elif [[ "$extra" == "login" ]] && ! va_a_login "$REDIR"; then
    resultado="FALLO no redirige a login"
  fi
  anotar "$ruta" "$metodo" "$espera" "$CODIGO" "$ms" "$max_ms" "$resultado"
}

comprobar_salud() {
  local max_ms=3000
  pedir GET "/api/salud" "$max_ms" "json"
  local ms resultado cuerpo_txt edad muertos base ok_json
  ms=$(en_ms "$TIEMPO_S")
  resultado="ok"
  if [[ "$CODIGO" == "000" ]]; then
    resultado="FALLO sin respuesta"
  elif [[ "$CODIGO" != "200" ]]; then
    resultado="FALLO código ${CODIGO}"
  elif awk -v t="$TIEMPO_S" -v m="$max_ms" 'BEGIN { exit !((t + 0) * 1000 > m) }'; then
    resultado="FALLO tiempo ${ms} ms"
  else
    cuerpo_txt=$(cat "$cuerpo")
    if printf '%s' "$cuerpo_txt" | grep -Eq 'postgres(ql)?://|password|DATABASE_URL'; then
      resultado="FALLO el cuerpo parece traer datos de conexión"
    else
      ok_json=$(valor_json "$cuerpo_txt" "ok")
      base=$(valor_json "$cuerpo_txt" "base")
      edad=$(valor_json "$cuerpo_txt" "edad_ultimo_trabajo_s")
      muertos=$(valor_json "$cuerpo_txt" "trabajos_muertos")
      if [[ "$ok_json" != "true" || "$base" != "ok" ]]; then
        resultado="FALLO estado inesperado"
      elif [[ -z "$edad" || -z "$muertos" ]]; then
        resultado="FALLO faltan campos de trabajos"
      elif ! { [[ "$edad" == "null" ]] || es_numero "$edad"; }; then
        resultado="FALLO edad no numérica"
      elif ! { [[ "$muertos" == "null" ]] || es_numero "$muertos"; }; then
        resultado="FALLO trabajos_muertos no numérico"
      elif [[ "$muertos" != "null" ]] && awk -v n="$muertos" 'BEGIN { exit !(n + 0 > 0) }'; then
        resultado="FALLO hay trabajos muertos"
      elif [[ "$edad" != "null" ]] && awk -v n="$edad" 'BEGIN { exit !(n + 0 > 600) }'; then
        resultado="FALLO último trabajo hace más de 10 min"
      fi
    fi
  fi
  anotar "/api/salud" "GET" "200" "$CODIGO" "$ms" "$max_ms" "$resultado"
}

echo "Humo contra ${BASE}"
echo
printf '%-28s %-6s %-7s %-7s %6s %6s  %s\n' "RUTA" "METODO" "ESPERA" "REAL" "MS" "MAX" "RESULTADO"

# Tabla del issue, en el mismo orden. /login y /panel piden HTML de
# navegador; el resto no manda sesión, cookie ni encabezado de trabajador.
comprobar "/login" GET 307 1000 html
comprobar "/panel" GET 307 1000 html login
comprobar "/api/ml/despachos/etiquetas" GET 401 1000 json
comprobar "/api/ml/conectar" GET 401 1000 json
comprobar "/api/ml/webhooks" POST 200 500 json
comprobar "/api/ml/trabajador" POST 401 1000 json
comprobar "/api/ml/callback" GET 307 1000 json
comprobar_salud
comprobar "/api/version" GET 200 1000 json

echo
if [[ "$fallos" -eq 0 ]]; then
  echo "Todo coincidió."
  exit 0
fi
echo "${fallos} comprobación(es) fallaron."
exit 1
