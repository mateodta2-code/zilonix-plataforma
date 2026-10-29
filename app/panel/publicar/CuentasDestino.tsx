"use client";

import { Boton } from "@/components/marco/Boton";
import styles from "./publicar.module.css";

export type Cuenta = { id: string; nickname: string };
// Punto 3 del pedido — "dejá el componente preparado para mostrar
// grupos con título y contador '(N elegidas)', pero por ahora un solo
// grupo 'Cuentas' (los grupos reales por empresa vienen en la Parte 4;
// NO hardcodear Johnny/Melissa)". `GrupoCuentas` es la forma real que
// va a necesitar la Parte 4 (varios grupos, cada uno con su propio
// título) — este componente ya la acepta, aunque hoy page.tsx solo le
// pase un array de un elemento.
export type GrupoCuentas = { titulo: string; cuentas: Cuenta[] };

export function CuentasDestino({
  grupos,
  incluidas,
  onCambiar,
}: {
  grupos: GrupoCuentas[];
  incluidas: Record<string, boolean>;
  onCambiar: (incluidas: Record<string, boolean>) => void;
}) {
  const todasLasCuentas = grupos.flatMap((g) => g.cuentas);
  const totalElegidas = todasLasCuentas.filter((c) => incluidas[c.id]).length;

  function marcarTodas(valor: boolean) {
    const nuevo: Record<string, boolean> = { ...incluidas };
    for (const c of todasLasCuentas) nuevo[c.id] = valor;
    onCambiar(nuevo);
  }

  return (
    <div>
      <div style={{ display: "flex", gap: 8 }}>
        <Boton type="button" variante="secundario" chico onClick={() => marcarTodas(true)}>
          Marcar todas
        </Boton>
        <Boton type="button" variante="secundario" chico onClick={() => marcarTodas(false)}>
          Desmarcar todas
        </Boton>
      </div>

      {grupos.map((grupo) => {
        const elegidasDelGrupo = grupo.cuentas.filter((c) => incluidas[c.id]).length;
        return (
          <div key={grupo.titulo} style={{ marginTop: 14 }}>
            <div className="zx-etiqueta" style={{ display: "flex", justifyContent: "space-between" }}>
              <span>{grupo.titulo}</span>
              <span>({elegidasDelGrupo} elegidas)</span>
            </div>
            <div style={{ marginTop: 8 }}>
              {grupo.cuentas.map((c) => (
                <label key={c.id} className={`${styles.recuadroMarca} ${styles.filaCuenta}`} style={{ fontSize: 14, cursor: "pointer" }}>
                  <input
                    type="checkbox"
                    name={`incluir_${c.id}`}
                    checked={Boolean(incluidas[c.id])}
                    onChange={(e) => onCambiar({ ...incluidas, [c.id]: e.target.checked })}
                  />
                  {c.nickname}
                </label>
              ))}
            </div>
            {grupo.cuentas.length === 0 && <p style={{ fontSize: 13, color: "var(--texto-suave)" }}>Sin cuentas conectadas en este grupo.</p>}
          </div>
        );
      })}

      <p style={{ fontSize: 12, color: "var(--texto-suave)", marginTop: 10 }}>{totalElegidas} cuenta(s) elegida(s) en total.</p>
    </div>
  );
}
