import { CUENTA_TODAS, leerCuentaMlDeQuery, PARAM_CUENTA } from "@/lib/ml/selector-cuenta";

// Z-MT-08 — elige "Todas" o una cuenta de Mercado Libre de la empresa
// activa y deja la elección en ?cuenta= (un GET, para que el refresco
// y un link la conserven).
//
// Server Component a propósito. La lista no llega por props: la lee
// leerCuentaMlDeQuery, que pasa por dbComoEmpresa y solo trae id y
// apodo. Si la pantalla armara la lista, un descuido podría colar una
// cuenta de otra empresa o una columna cifrada. Cada pantalla que
// filtre llama el mismo helper por su cuenta — son pocas filas, y las
// dos lecturas quedan detrás de RLS.
//
// Sin onChange: un manejador en un Server Component revienta al
// renderizar (el mismo error de la tarea 1.12 en /panel/invitar/listo).
// El botón "Aplicar" manda el formulario. Bandeja, publicar, inventario
// y despachos lo montan en sus propios issues; este archivo no los toca.

const CLAVE_PARAM = /^[A-Za-z][A-Za-z0-9_-]{0,40}$/;

function valoresOcultos(valor: string | string[] | undefined): string[] {
  if (typeof valor === "string") return [valor];
  if (Array.isArray(valor)) return valor.filter((v): v is string => typeof v === "string");
  return [];
}

export async function SelectorCuentaMl({
  empresaId,
  cuenta,
  parametros,
}: {
  empresaId: string;
  cuenta?: string | string[] | null;
  // El resto del query de la pantalla, para no pisarlo al aplicar.
  // `cuenta` se ignora: lo decide el <select>, ya validado.
  parametros?: Record<string, string | string[] | undefined>;
}) {
  const { cuentas, cuentaId } = await leerCuentaMlDeQuery(empresaId, cuenta);
  const elegido = cuentaId ?? CUENTA_TODAS;

  const ocultos: { clave: string; valor: string }[] = [];
  if (parametros) {
    for (const [clave, valor] of Object.entries(parametros)) {
      if (clave === PARAM_CUENTA || !CLAVE_PARAM.test(clave)) continue;
      for (const v of valoresOcultos(valor)) {
        ocultos.push({ clave, valor: v });
      }
    }
  }

  return (
    <form method="get" style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
      {ocultos.map((campo, i) => (
        <input key={`${campo.clave}-${i}`} type="hidden" name={campo.clave} value={campo.valor} />
      ))}
      <label htmlFor="selector-cuenta-ml" style={{ fontSize: 13, opacity: 0.7 }}>
        Cuenta de Mercado Libre
      </label>
      <select
        id="selector-cuenta-ml"
        name={PARAM_CUENTA}
        key={elegido}
        defaultValue={elegido}
        style={{ flex: 1, padding: 8, minWidth: 180 }}
      >
        <option value={CUENTA_TODAS}>Todas</option>
        {cuentas.map((c) => (
          <option key={c.id} value={c.id}>
            {c.apodo}
          </option>
        ))}
      </select>
      <button type="submit" style={{ padding: "8px 16px" }}>
        Aplicar
      </button>
    </form>
  );
}
