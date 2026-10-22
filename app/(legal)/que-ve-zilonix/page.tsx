import Link from "next/link";
import { QUE_VE_ZILONIX_VERSION } from "@/lib/legal";
import { Completar, MarcoLegal, Seccion } from "../marco";

export const metadata = {
  title: "Qué ve Zilonix — Zilonix",
  description: "Borrador: qué puede ver el personal de Zilonix y cómo funciona el acceso temporal.",
};

// El mecanismo que esta página describe es el que ya está en el
// producto (tarea 1.11): /panel/soporte, máximo 360 horas, alcance
// escrito por la empresa, revocable, y cada vista de detalle queda en
// auditoría. Hoy ese detalle es la lista de miembros, no las ventas.
export default function QueVeZilonixPage() {
  return (
    <MarcoLegal titulo="Qué ve el personal de Zilonix" version={QUE_VE_ZILONIX_VERSION}>
      <p style={{ fontSize: 18, fontWeight: 700 }}>
        El personal de Zilonix no ve tus ventas ni tus clientes sin tu permiso.
      </p>
      <p>
        Esta página dice qué sí alcanza a ver una persona de Zilonix, qué no, y cómo funciona el permiso temporal de
        máximo 15 días. Es un borrador, igual que los <Link href="/terminos">términos</Link> y la{" "}
        <Link href="/privacidad">política de privacidad</Link>.
      </p>

      <Seccion titulo="Sin tu permiso">
        <p>Sin un permiso que tú des, el personal de Zilonix solo ve cifras sueltas de cada empresa:</p>
        <ul>
          <li>el nombre de la empresa;</li>
          <li>el NIT;</li>
          <li>cuántas personas tiene el equipo, como un número.</li>
        </ul>
        <p>Sin ese permiso no ve:</p>
        <ul>
          <li>quiénes son las personas del equipo, ni sus correos, ni sus roles;</li>
          <li>tus ventas, pedidos, valores, publicaciones o envíos;</li>
          <li>a tus clientes o compradores.</li>
        </ul>
        <p>
          No es un interruptor que alguien de Zilonix pueda prender por su cuenta. Cada empresa está separada en la
          base de datos, y la cuenta interna de Zilonix no tiene permiso de leer las tablas de ventas, pedidos o
          compradores.
        </p>
      </Seccion>

      <Seccion titulo="El acceso temporal de 15 días">
        <p>
          Si quieres que soporte mire algo más, lo concedes tú (o alguien de tu empresa con permiso para autorizar)
          desde el panel, en Acceso de soporte. El permiso funciona así:
        </p>
        <ul>
          <li>
            Escribes, con tus palabras, qué puede ver soporte. No hay un «sí» genérico: si no dices el alcance, el
            permiso no se crea.
          </li>
          <li>
            Eliges cuántas horas dura. El máximo es 15 días, contados como 360 horas. Al llegar esa hora el permiso se
            apaga solo.
          </li>
          <li>Puedes revocarlo antes, desde la misma pantalla. Revocado, soporte deja de ver el detalle.</li>
          <li>
            Cada vez que alguien de Zilonix abre ese detalle, queda una línea en la actividad de tu empresa: quién
            miró, cuándo, y el texto del alcance que tú habías escrito.
          </li>
        </ul>
        <p>
          Hoy ese detalle es la lista de personas del equipo: nombre, correo y rol. No abre tus ventas ni tus
          clientes. Aunque concedas el permiso, el personal de Zilonix sigue sin ver tus ventas ni tus clientes,
          porque esa pantalla no las muestra y la cuenta interna no puede leer esas tablas.
        </p>
        <p>
          El permiso no es permanente y no se hereda. Cuando vence o lo revocas, soporte vuelve a ver solo el nombre,
          el NIT y el número de personas.
        </p>
      </Seccion>

      <Seccion titulo="Quién cuenta como personal de Zilonix">
        <p>
          Son cuentas internas que Zilonix marca a mano. Nadie se convierte en personal interno al registrarse, ni
          desde un botón del panel. Otra empresa que usa Zilonix nunca ve tus datos: eso es distinto de este permiso.
          El permiso temporal solo se lo das al personal de Zilonix, no a otros vendedores.
        </p>
      </Seccion>

      <Seccion titulo="Dónde se concede">
        <p>
          En el panel, con tu empresa abierta, pantalla Acceso de soporte. Si tu rol no puede autorizar cambios de
          configuración, no ves el formulario. Quien crea la empresa nace con ese permiso.
        </p>
        <p>
          Canal para preguntas sobre este aviso: <Completar que="correo de contacto de datos" />. Versión{" "}
          {QUE_VE_ZILONIX_VERSION}. Fecha de entrada en vigencia: <Completar que="fecha de entrada en vigencia" />.
        </p>
      </Seccion>
    </MarcoLegal>
  );
}
