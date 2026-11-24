import { traducirErrorValidacion, type CausaTraducida } from "@/lib/ml/publicar-errores-validacion";

function Causas({ titulo, causas, color }: { titulo: string; causas: CausaTraducida[]; color: string }) {
  if (!causas.length) return null;
  return (
    <div style={{ marginTop: 6 }}>
      <div style={{ fontSize: 11, letterSpacing: 0.6, textTransform: "uppercase", opacity: 0.75 }}>{titulo}</div>
      <ul style={{ margin: "4px 0 0", paddingLeft: 18, color }}>
        {causas.map((c, i) => (
          <li key={i}>
            {c.campo && <strong>{c.campo}: </strong>}
            {c.mensaje}
            {c.desconocido && c.codigo && <small style={{ opacity: 0.7 }}> ({c.codigo})</small>}
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * Muestra el error de una publicación. Si es un validation_error de ML, lo
 * explica en español (bloqueos y avisos) y deja el JSON solo dentro de un
 * «Ver detalle técnico»; si no, muestra el texto tal cual (mensajes propios
 * como dimensiones del paquete o timeout).
 */
export function ErrorPublicacion({ error }: { error: string }) {
  const traducido = traducirErrorValidacion(error);
  if (!traducido) return <span style={{ color: "var(--peligro-texto)" }}>{error}</span>;
  return (
    <div style={{ fontSize: 13 }}>
      <Causas titulo="Lo que bloquea la publicación" causas={traducido.bloqueos} color="var(--peligro-texto)" />
      <Causas titulo="Avisos" causas={traducido.avisos} color="inherit" />
      <details style={{ marginTop: 6, fontSize: 12 }}>
        <summary>Ver detalle técnico</summary>
        <pre style={{ whiteSpace: "pre-wrap", overflowX: "auto" }}>{error}</pre>
      </details>
    </div>
  );
}
