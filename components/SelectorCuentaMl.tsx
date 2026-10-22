"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { CUENTA_TODAS, resolverCuentaSeleccionada, type CuentaMlOpcion } from "@/lib/ml/seleccion-cuenta";

// Issue #54 (Z-MT-08) — selector compartido de cuenta de Mercado Libre
// ("Todas" o una cuenta puntual), para que cada pantalla que filtre por
// cuenta (bandeja, publicar, inventario, despachos) no reinvente su
// propio <select> ni su propia regla de qué pasa con un id inválido en
// la URL — eso ya lo resuelve resolverCuentaSeleccionada().
//
// `cuentas` llega como prop (id + apodo, nunca tokens ni otro dato
// sensible) porque quien usa este componente ya la sacó en el servidor
// con dbComoEmpresa() — este archivo es "use client" (necesita
// useRouter/useSearchParams para no recargar toda la página) y nunca
// debe consultar la base él mismo.
export type { CuentaMlOpcion };

export function SelectorCuentaMl({ cuentas }: { cuentas: CuentaMlOpcion[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const seleccionada = resolverCuentaSeleccionada(searchParams.get("cuenta"), cuentas);

  function cambiarCuenta(valor: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (valor === CUENTA_TODAS) {
      params.delete("cuenta");
    } else {
      params.set("cuenta", valor);
    }
    const query = params.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  }

  if (cuentas.length === 0) return null;

  return (
    <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
      Cuenta de Mercado Libre
      <select
        value={seleccionada}
        onChange={(evento) => cambiarCuenta(evento.target.value)}
        style={{ padding: "6px 10px", borderRadius: 6 }}
      >
        <option value={CUENTA_TODAS}>Todas</option>
        {cuentas.map((cuenta) => (
          <option key={cuenta.id} value={cuenta.id}>
            {cuenta.apodo}
          </option>
        ))}
      </select>
    </label>
  );
}
