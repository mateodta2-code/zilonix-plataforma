import Link from "next/link";
import type { ReactNode } from "react";

// El aviso va en el componente que usan las tres páginas, arriba del
// título, para que un borrador no se publique con cara de texto
// definitivo. La frase es la que pidió el issue #52, tal cual.
export function MarcoLegal({
  titulo,
  version,
  children,
}: {
  titulo: string;
  version: string;
  children: ReactNode;
}) {
  return (
    <main className="texto-legal" style={{ maxWidth: 720, margin: "0 auto", padding: "32px 24px 64px" }}>
      <style>{`
        .texto-legal p { margin: 0 0 12px; }
        .texto-legal ul { margin: 0 0 12px; padding-left: 1.25em; }
        .texto-legal li { margin: 0 0 6px; }
        .texto-legal a { color: inherit; }
      `}</style>
      <p
        style={{
          margin: "0 0 20px",
          padding: "10px 14px",
          border: "1px solid #e6b450",
          borderRadius: 6,
          background: "rgba(230, 180, 80, 0.14)",
          fontSize: 14,
          fontWeight: 700,
        }}
      >
        Borrador pendiente de revisión legal
      </p>
      <h1 style={{ fontSize: 28, fontWeight: 700, margin: "0 0 8px" }}>{titulo}</h1>
      <p style={{ opacity: 0.7, fontSize: 13, marginTop: 0 }}>Versión {version}. Este texto no está vigente.</p>
      <article style={{ fontSize: 16, lineHeight: 1.65 }}>{children}</article>
      <nav style={{ marginTop: 40, fontSize: 14, display: "flex", gap: 16, flexWrap: "wrap" }}>
        <Link href="/terminos">Términos</Link>
        <Link href="/privacidad">Privacidad</Link>
        <Link href="/que-ve-zilonix">Qué ve Zilonix</Link>
      </nav>
    </main>
  );
}

export function Seccion({ id, titulo, children }: { id?: string; titulo: string; children: ReactNode }) {
  return (
    <section id={id} style={{ marginTop: 28 }}>
      <h2 style={{ fontSize: 18, fontWeight: 700, margin: "0 0 8px" }}>{titulo}</h2>
      {children}
    </section>
  );
}

// Marcador visible para el abogado y para quien lea la página: el dato
// no se inventa (NIT, dirección, correo, precio).
export function Completar({ que }: { que: string }) {
  return (
    <mark style={{ background: "rgba(230, 180, 80, 0.28)", color: "inherit", padding: "0 3px" }}>{`[COMPLETAR: ${que}]`}</mark>
  );
}
