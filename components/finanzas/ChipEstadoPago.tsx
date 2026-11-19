import { Chip, type EstadoChip } from "@/components/marco/Chip";

// Color del chip según el "Estado de pago" del reporte de Falabella
// (Pagado, Pago programado, Abierto, No pagado). Lo comparten la lista de
// cortes y el detalle de un corte para que se vean igual.
//
// Antes la lista usaba /pagad/i, que pintaba "No pagado" de verde como
// si estuviera pagado: por eso "No pagado" se revisa primero.
export function colorEstadoPago(estado: string): EstadoChip {
  if (/no\s+pagad/i.test(estado)) return "peligro";
  if (/^pagad/i.test(estado.trim())) return "exito";
  return "aviso";
}

export function ChipsEstadoPago({ estados }: { estados: string[] }) {
  if (estados.length === 0) return <>—</>;
  return (
    <>
      {estados.map((e) => (
        <Chip key={e} estado={colorEstadoPago(e)}>
          {e}
        </Chip>
      ))}
    </>
  );
}
