"use client";

import type { ReactNode } from "react";

// Pide confirmación antes de enviar una acción del panel superadmin. El
// servidor no se fía de esto: la acción vuelve a validar todo.
export function FormConfirmar({
  action,
  mensaje,
  children,
}: {
  action: (formData: FormData) => void | Promise<void>;
  mensaje: string;
  children: ReactNode;
}) {
  return (
    <form
      action={action}
      onSubmit={(e) => {
        if (!window.confirm(mensaje)) e.preventDefault();
      }}
      style={{ display: "flex", flexDirection: "column", gap: 8 }}
    >
      {children}
    </form>
  );
}
