"use client";

import { createContext, useCallback, useContext, useRef, useState } from "react";
import type { EstadoChip } from "@/components/marco/Chip";
import { Toast, type ItemToast } from "@/components/marco/Toast";

type Avisar = (texto: string, estado: EstadoChip) => void;

const ContextoToast = createContext<Avisar>(() => {});

// Una sola pila de avisos para toda la tabla: cada fila llama
// useAvisoOptimizacion() y el aviso sale en la esquina, no dentro de la
// fila.
export function ProveedorToastOptimizacion({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<ItemToast[]>([]);
  const contador = useRef(0);

  const cerrar = useCallback((id: string) => setItems((actuales) => actuales.filter((i) => i.id !== id)), []);
  const avisar = useCallback<Avisar>(
    (texto, estado) => {
      contador.current += 1;
      const id = `aviso-${contador.current}`;
      setItems((actuales) => [...actuales, { id, texto, estado }]);
      setTimeout(() => cerrar(id), 8_000);
    },
    [cerrar]
  );

  return (
    <ContextoToast.Provider value={avisar}>
      {children}
      <Toast items={items} onCerrar={cerrar} />
    </ContextoToast.Provider>
  );
}

export function useAvisoOptimizacion(): Avisar {
  return useContext(ContextoToast);
}
