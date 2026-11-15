"use client";

import { useState } from "react";
import { useClerk } from "@clerk/nextjs";
import { Boton } from "@/components/marco/Boton";
import { Campo } from "@/components/marco/Campo";
import { Tarjeta } from "@/components/marco/Tarjeta";
import { borrarMiCuentaAction, exportarMisDatosAction } from "./actions";

const PALABRA_CONFIRMACION = "BORRAR";

// Issue #318 (Ley 1581 de 2012) — mismo patrón de confirmación que
// "Lanzar aprobadas a Mercado Libre" en Promociones: un modal que
// obliga a escribir la palabra a mano, nunca un solo clic, para una
// acción que no tiene vuelta atrás.
export function PaginaMisDatos({ nombre }: { nombre: string }) {
  const { signOut } = useClerk();
  const [exportando, setExportando] = useState(false);
  const [errorExportar, setErrorExportar] = useState<string | null>(null);

  const [confirmando, setConfirmando] = useState(false);
  const [textoConfirmacion, setTextoConfirmacion] = useState("");
  const [borrando, setBorrando] = useState(false);
  const [resultadoBorrar, setResultadoBorrar] = useState<string | null>(null);
  const [bloqueadaPor, setBloqueadaPor] = useState<string[] | null>(null);

  async function exportar() {
    setExportando(true);
    setErrorExportar(null);
    const resultado = await exportarMisDatosAction();
    setExportando(false);
    if (!resultado.ok) {
      setErrorExportar(resultado.error);
      return;
    }
    const blob = new Blob([resultado.json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const enlace = document.createElement("a");
    enlace.href = url;
    enlace.download = `zilonix-mis-datos-${new Date().toISOString().slice(0, 10)}.json`;
    enlace.click();
    URL.revokeObjectURL(url);
  }

  async function confirmarBorrado() {
    setBorrando(true);
    setResultadoBorrar(null);
    setBloqueadaPor(null);
    const resultado = await borrarMiCuentaAction();
    if (!resultado.ok) {
      setBorrando(false);
      if (resultado.motivo === "unico_dueno_con_mas_miembros") {
        setBloqueadaPor(resultado.empresas);
      } else {
        setResultadoBorrar(resultado.error);
      }
      return;
    }

    // Issue #318 (review 5725541731) — la anonimización en la base YA
    // quedó confirmada acá (resultado.ok), pase lo que pase con Clerk.
    // Si la sesión del navegador sigue viva, la siguiente petición
    // (ej. abrir "/") vuelve a llamar obtenerOCrearUsuarioActual() con
    // ese Clerk todavía activo y RECREA una fila de `usuarios` con el
    // email y el nombre reales — por eso el signOut de acá nunca es
    // opcional, ni cuando clerkBorrado quedó en false. El aviso de
    // soporte se muestra DESPUÉS, ya fuera de sesión (home pública,
    // ver app/page.tsx), nunca mientras la sesión sigue abierta.
    const destino = resultado.clerkBorrado ? "/?salida=cuenta-borrada" : "/?salida=cuenta-borrada-soporte";
    try {
      await signOut({ redirectUrl: destino });
    } catch {
      window.location.href = destino;
    }
  }

  return (
    <>
      <Tarjeta>
        <p className="zx-etiqueta">Exportar</p>
        <p style={{ fontSize: 13, color: "var(--texto-suave)", marginTop: 8 }}>
          Un archivo JSON con tu perfil, en qué empresas tienes membresía y con qué rol, y tu propia bitácora de actividad. Nunca incluye
          tokens ni claves de ninguna cuenta de Mercado Libre.
        </p>
        <Boton type="button" variante="secundario" chico disabled={exportando} onClick={exportar} style={{ marginTop: 10 }}>
          {exportando ? "Generando…" : "Exportar mis datos"}
        </Boton>
        {errorExportar && <p style={{ fontSize: 13, color: "var(--kpi-peligro-texto)", marginTop: 8 }}>{errorExportar}</p>}
      </Tarjeta>

      <Tarjeta>
        <p className="zx-etiqueta">Borrar mi cuenta</p>
        <p style={{ fontSize: 13, color: "var(--texto-suave)", marginTop: 8 }}>
          Tu nombre, tu correo y tu acceso de inicio de sesión se borran de verdad — en TODAS las empresas donde participas. Los pedidos,
          ventas y publicaciones de esas empresas no se tocan: tu nombre en ellos queda como &quot;Usuario eliminado&quot;. No hay vuelta
          atrás.
        </p>
        {!confirmando ? (
          <Boton type="button" variante="fantasma" chico onClick={() => setConfirmando(true)} style={{ marginTop: 10 }}>
            Borrar mi cuenta
          </Boton>
        ) : (
          <div style={{ marginTop: 10 }}>
            {bloqueadaPor ? (
              <p style={{ fontSize: 13, color: "var(--kpi-peligro-texto)" }}>
                No podemos borrar tu cuenta todavía: sos el único Dueño de {bloqueadaPor.length === 1 ? "la empresa" : "las empresas"}{" "}
                <strong>{bloqueadaPor.join(", ")}</strong>, que tiene{bloqueadaPor.length === 1 ? "" : "n"} más miembros. Transferí el rol
                de Dueño a otra persona ahí y volvé a intentarlo.
              </p>
            ) : (
              <>
                <p style={{ fontSize: 13 }}>
                  Hola {nombre}. Escribí <strong>{PALABRA_CONFIRMACION}</strong> para confirmar que entendiste que no hay vuelta atrás:
                </p>
                <Campo etiqueta="Confirmación">
                  <input
                    type="text"
                    className="zx-control"
                    style={{ maxWidth: 200 }}
                    value={textoConfirmacion}
                    onChange={(e) => setTextoConfirmacion(e.target.value)}
                    autoComplete="off"
                  />
                </Campo>
              </>
            )}
            <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
              {!bloqueadaPor && (
                <Boton
                  type="button"
                  variante="primario"
                  chico
                  disabled={borrando || textoConfirmacion.trim().toUpperCase() !== PALABRA_CONFIRMACION}
                  onClick={confirmarBorrado}
                >
                  {borrando ? "Borrando…" : "Confirmar y borrar"}
                </Boton>
              )}
              <Boton
                type="button"
                variante="secundario"
                chico
                disabled={borrando}
                onClick={() => {
                  setConfirmando(false);
                  setBloqueadaPor(null);
                  setTextoConfirmacion("");
                }}
              >
                Cancelar
              </Boton>
            </div>
          </div>
        )}
        {resultadoBorrar && <p style={{ fontSize: 13, marginTop: 10 }}>{resultadoBorrar}</p>}
      </Tarjeta>
    </>
  );
}
