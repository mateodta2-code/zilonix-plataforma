import { obtenerProgresoOnboarding } from "@/lib/onboarding";
import { ChecklistOnboardingCliente, type PasoChecklist } from "./ChecklistOnboardingCliente";

type Props = {
  empresaId: string;
  // Si el rol de esta persona no puede entrar a /panel/conectar-ml o a
  // /panel/pedidos, ese paso se pinta sin botón (nada de mandarla a
  // una pantalla que después le va a decir "sin acceso").
  puedeConectarMl: boolean;
  puedeVerPedidos: boolean;
};

// Issue #323 — checklist de los primeros 3 pasos ("crear empresa →
// conectar 1 cuenta de Mercado Libre → ver 1 pedido") arriba de
// /panel, mientras falte alguno. "Crear empresa" nunca se consulta:
// si hay empresaId para preguntar esto es porque la empresa ya
// existe, siempre sale hecho. Una vez completo deja de pintarse —
// no hace falta guardar que "ya se mostró el cartel de listo" para
// algo que no vuelve a faltar en el uso normal.
export async function ChecklistOnboarding({ empresaId, puedeConectarMl, puedeVerPedidos }: Props) {
  const progreso = await obtenerProgresoOnboarding(empresaId);
  if (progreso.completo) return null;

  const pasos: PasoChecklist[] = [
    { clave: "empresa", titulo: "Crea tu empresa", hecho: true },
    {
      clave: "conectar",
      titulo: "Conecta tu primera cuenta de Mercado Libre",
      hecho: progreso.cuentaConectada,
      href: !progreso.cuentaConectada && puedeConectarMl ? "/panel/conectar-ml" : undefined,
      etiquetaBoton: "Conectar cuenta",
    },
    {
      clave: "pedido",
      titulo: "Mira tu primer pedido",
      hecho: progreso.pedidoVisto,
      href: !progreso.pedidoVisto && puedeVerPedidos ? "/panel/pedidos" : undefined,
      etiquetaBoton: "Ver pedidos",
    },
  ];

  return <ChecklistOnboardingCliente empresaId={empresaId} pasos={pasos} />;
}
