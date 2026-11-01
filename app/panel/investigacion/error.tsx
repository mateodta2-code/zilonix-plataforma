"use client";

// Issue #147 — red de seguridad: app/panel/investigacion/page.tsx ya
// atrapa todos los errores conocidos (término inválido, límite de
// búsquedas, sin cuenta conectada, 401/403/5xx de Mercado Libre,
// cuenta desconectada, candado de renovación) con un mensaje claro —
// este error.tsx solo se ve si de verdad pasa algo que no se esperaba.
// Mensaje genérico a propósito (nunca error.message acá): a esta
// altura no se sabe qué fue, así que no hay nada específico seguro que
// mostrar.
export default function InvestigacionError({ reset }: { error: Error; reset: () => void }) {
  return (
    // div, no <main> — esto ya renderiza adentro del <main> del marco
    // (app/panel/layout.tsx); un <main> anidado sería inválido.
    <div style={{ maxWidth: 480, margin: "0 auto", padding: "48px 24px" }}>
      <h1 style={{ fontSize: 20, fontWeight: 700 }}>Algo no salió bien al analizar ese producto o nicho</h1>
      <p style={{ opacity: 0.8, fontSize: 14 }}>
        No se pudo completar la búsqueda. Puede ser algo pasajero — intentá de nuevo en un momento.
      </p>
      <button onClick={() => reset()} style={{ padding: "10px 16px", marginTop: 16 }}>
        Volver a intentar
      </button>
    </div>
  );
}
