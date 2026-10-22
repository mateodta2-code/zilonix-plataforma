import Link from "next/link";
import { PRIVACIDAD_VERSION } from "@/lib/legal";
import { Completar, MarcoLegal, Seccion } from "../marco";

export const metadata = {
  title: "Política de privacidad — Zilonix",
  description: "Borrador de política de tratamiento de datos de Zilonix, Ley 1581 de 2012.",
};

export default function PrivacidadPage() {
  return (
    <MarcoLegal titulo="Política de tratamiento de datos personales" version={PRIVACIDAD_VERSION}>
      <p>
        Esta política explica qué datos personales trata Zilonix, para qué, quién responde por ellos y cómo puedes
        pedir que los consultemos, los actualicemos, los corrijamos o los borremos. Está escrita para la Ley 1581 de
        2012 y el Decreto 1074 de 2015. Es un borrador y no está vigente.
      </p>

      <Seccion titulo="Quién es el responsable">
        <p>
          De los datos de quien crea una cuenta y de las personas de su equipo, el responsable del tratamiento es{" "}
          <Completar que="razón social" />, NIT <Completar que="NIT" />, domicilio <Completar que="dirección" />,{" "}
          <Completar que="ciudad" />, Colombia. «Zilonix» es el nombre del servicio. La sociedad de arriba es quien
          decide para qué se usan esos datos.
        </p>
        <p>
          Canal para consultas y reclamos: <Completar que="correo de contacto de datos" />. Teléfono:{" "}
          <Completar que="teléfono de contacto" />.
        </p>
        <p>
          Los datos de tus compradores tienen otro responsable: tú. Zilonix, en ese caso, es encargado. Está en el
          anexo de más abajo.
        </p>
      </Seccion>

      <Seccion titulo="Qué datos tratamos">
        <p>De ti y de tu equipo guardamos:</p>
        <ul>
          <li>nombre y correo;</li>
          <li>nombre de la empresa y NIT;</li>
          <li>el rol de cada persona dentro de la empresa;</li>
          <li>el registro de quién hizo qué en la empresa;</li>
          <li>
            los datos de inicio de sesión que guarda Clerk (correo, sesión y, si lo activas, el segundo factor).
            Zilonix no guarda tu contraseña.
          </li>
        </ul>
        <p>De la tienda que conectas a Mercado Libre guardamos hoy:</p>
        <ul>
          <li>el apodo de la cuenta de Mercado Libre y los tokens de acceso, cifrados;</li>
          <li>pedidos: fecha, valor, moneda y estado;</li>
          <li>publicaciones: título, precio y cantidad;</li>
          <li>envíos: tipo de logística y estado, no la dirección del comprador.</li>
        </ul>
        <p>
          Hoy las tablas de Zilonix no guardan el nombre, el documento ni la dirección del comprador. Aun así, al
          consultar Mercado Libre la respuesta puede traer datos del comprador (por ejemplo para una guía) y esos
          datos pasan por los servidores de Zilonix para prestarte el servicio. Esos datos se tratan como dice el
          anexo de encargo.
        </p>
      </Seccion>

      <Seccion titulo="Para qué los usamos">
        <p>Usamos los datos para:</p>
        <ul>
          <li>crear tu cuenta y tu empresa, y dejarte entrar;</li>
          <li>invitar a tu equipo y aplicar los permisos de cada rol;</li>
          <li>mostrarte pedidos, publicaciones y despachos de la cuenta de Mercado Libre que conectes;</li>
          <li>dejar constancia de quién hizo qué, para que tu empresa pueda revisarlo;</li>
          <li>
            atender soporte solo si tú concedes un acceso temporal, como se explica en{" "}
            <Link href="/que-ve-zilonix">qué ve Zilonix</Link>;
          </li>
          <li>avisarte, cuando corresponda, que el periodo gratis se acaba;</li>
          <li>cumplir un deber legal si una autoridad colombiana lo exige.</li>
        </ul>
        <p>No vendemos datos personales. No los usamos para publicidad de terceros.</p>
      </Seccion>

      <Seccion titulo="Autorización expresa">
        <p>
          Los datos de tu cuenta los tratamos porque tú lo autorizas antes, de forma expresa, al marcar la casilla de
          crear empresa. Esa casilla empieza desmarcada. Si no la marcas, la empresa no se crea y no hay autorización.
        </p>
        <p>
          En el registro de actividad de la empresa quedan la versión de esta política ({PRIVACIDAD_VERSION}), la de
          los términos y la del aviso de qué ve Zilonix, y la fecha en que marcaste la casilla.
        </p>
        <p>
          Puedes revocar la autorización escribiendo al canal de contacto. Sin esos datos la cuenta no puede seguir
          funcionando. Revocar la autorización no borra lo que una ley obligue a conservar.
        </p>
      </Seccion>

      <Seccion id="anexo-encargo" titulo="Anexo. Encargo del tratamiento">
        <p>Hay dos papeles, y no se mezclan:</p>
        <ul>
          <li>
            <strong>Datos tuyos y de tu equipo</strong> (cuenta, correo, empresa, NIT, roles, actividad). El
            responsable es <Completar que="razón social" />. Zilonix decide las finalidades de la lista de arriba.
          </li>
          <li>
            <strong>Datos de tus compradores y de la operación de tu tienda</strong> en Mercado Libre. El responsable
            eres tú, el vendedor. Zilonix es el encargado: los trata solo para prestarte el servicio, siguiendo tus
            instrucciones (conectar la cuenta, importar pedidos, preparar despachos) y esta política. Zilonix no
            decide vender esos datos ni usarlos para un fin distinto.
          </li>
        </ul>
        <p>
          Al crear la empresa y, si lo haces, al conectar Mercado Libre, nos encargas ese tratamiento. Tú debes contar
          con la autorización de tus compradores cuando la ley te la exija. Zilonix no se la pide al comprador en tu
          lugar.
        </p>
      </Seccion>

      <Seccion titulo="Datos fuera de Colombia">
        <p>
          Declaramos una transferencia internacional de datos personales hacia dos proveedores que operan fuera de
          Colombia:
        </p>
        <ul>
          <li>
            <strong>Railway</strong>: alojamiento de la aplicación y de la base de datos.
          </li>
          <li>
            <strong>Clerk</strong>: inicio de sesión, verificación de correo y segundo factor.
          </li>
        </ul>
        <p>
          País o región de esos servidores: <Completar que="país o región de los servidores de Railway y de Clerk" />.
        </p>
        <p>
          En la práctica esperamos que Railway y Clerk actúen por instrucción de Zilonix (lo que la ley colombiana
          llama transmisión a un encargado) y, cuando los datos son de tus compradores, por el encargo tuyo. Hay que
          confirmarlo con los contratos:{" "}
          <Completar que="si los contratos de Railway y de Clerk los dejan solo como encargados, o si alguna parte de los datos la deciden ellos como responsables" />
          .
        </p>
        <p>
          Hoy Zilonix no usa Neon. Si más adelante otro proveedor fuera de Colombia guarda datos, esta política se
          actualiza antes de usarlo.
        </p>
      </Seccion>

      <Seccion titulo="Cuánto tiempo los guardamos">
        <p>
          Los guardamos mientras la empresa usa Zilonix. Después de que dejas de usarlo, el tiempo de conservación es{" "}
          <Completar que="cuánto tiempo se conservan los datos después de cancelar" />. Lo que una ley obligue a
          guardar (por ejemplo soportes contables, cuando existan) se conserva el tiempo que esa ley diga y después se
          borra o se anonimiza.
        </p>
      </Seccion>

      <Seccion titulo="Qué pasa si cancelas">
        <p>
          Puedes dejar de usar Zilonix cuando quieras. En el periodo gratis, dejarlo no genera un cobro. Para pedir la
          supresión de los datos de los que Zilonix es responsable, escribe a{" "}
          <Completar que="correo de contacto de datos" />. Hoy no hay un botón de eliminar empresa en el panel.
        </p>
        <p>
          Si los datos son de tus compradores (tú responsable, Zilonix encargado), al terminar el servicio te los
          devolvemos o los borramos cuando nos lo pidas, salvo deber legal de conservarlos.{" "}
          <Completar que="procedimiento de devolución o borrado de los datos encargados" />.
        </p>
      </Seccion>

      <Seccion titulo="Tus derechos">
        <p>Puedes pedirnos, frente a los datos de los que Zilonix es responsable:</p>
        <ul>
          <li>
            <strong>consulta</strong>: saber qué datos tenemos y para qué;
          </li>
          <li>
            <strong>actualización</strong>: que los pongamos al día;
          </li>
          <li>
            <strong>rectificación</strong>: que corrijamos lo que esté mal;
          </li>
          <li>
            <strong>supresión</strong>: que los borremos cuando no haya un deber legal de guardarlos.
          </li>
        </ul>
        <p>También puedes:</p>
        <ul>
          <li>pedir prueba de la autorización que diste;</li>
          <li>que te informemos del uso que les estamos dando;</li>
          <li>revocar la autorización;</li>
          <li>presentar un reclamo por el canal de esta política;</li>
          <li>acudir a la Superintendencia de Industria y Comercio.</li>
        </ul>
        <p>
          En otros países a un grupo parecido de derechos le dicen ARCO (acceso, rectificación, cancelación y
          oposición). En Colombia la Ley 1581 de 2012 habla de consulta, actualización, rectificación y supresión, y
          de los demás derechos de la lista.
        </p>
        <p>
          Frente a los datos de tus compradores, tus clientes ejercen estos derechos ante ti, porque tú eres el
          responsable. Si nos llega una solicitud de un comprador, te la pasamos para que tú respondas. Zilonix, como
          encargado, te ayuda a cumplir lo que tú nos indiques y lo que la ley le exija a un encargado.
        </p>
      </Seccion>

      <Seccion titulo="Canal, consultas y reclamos">
        <p>
          El canal es <Completar que="correo de contacto de datos" />. Escribe tu nombre, tu correo, qué datos
          quieres revisar y qué pides. Si reclamas, cuenta qué pasó.
        </p>
        <p>
          <strong>Consulta.</strong> Respondemos en un máximo de 10 días hábiles contados desde el día en que la
          recibimos. Si no alcanzamos, te decimos por qué y la fecha en que sí responderemos. Esa fecha nueva no puede
          pasar de 5 días hábiles después del primer plazo. Así lo dice el artículo 14 de la Ley 1581 de 2012.
        </p>
        <p>
          <strong>Reclamo</strong> (corregir, actualizar, suprimir, revocar, o avisar un incumplimiento). Respondemos
          en un máximo de 15 días hábiles contados desde el día siguiente a aquel en que recibimos el reclamo. Si no
          alcanzamos, te decimos por qué y la fecha nueva, que no puede pasar de 8 días hábiles después del primer
          plazo. Así lo dice el artículo 15 de la Ley 1581 de 2012.
        </p>
        <p>Días hábiles son los lunes a viernes, sin contar los festivos de Colombia.</p>
        <p>
          Si en el reclamo falta un dato para entenderlo, te lo pedimos dentro de los 5 días siguientes a recibirlo.
          Desde ese pedido tienes dos meses para completarlo. Si no llega, se entiende que desististe. Cuando el
          reclamo queda completo, y el dato está en uso, lo marcamos como reclamo en trámite en un máximo de 2 días
          hábiles, hasta que se decida. Así lo dice el artículo 15 de la Ley 1581 de 2012.
        </p>
        <p>
          Si no estás de acuerdo con la respuesta, puedes acudir a la Superintendencia de Industria y Comercio
          (sic.gov.co).
        </p>
      </Seccion>

      <Seccion titulo="Registro Nacional de Bases de Datos">
        <p>
          <Completar que="si Zilonix debe inscribir sus bases en el Registro Nacional de Bases de Datos de la SIC, y el número de inscripción si ya existe" />
          . Esa inscripción depende del tamaño de los activos y de las demás reglas vigentes. Queda para que la
          confirme un abogado antes de publicar esta política.
        </p>
      </Seccion>

      <Seccion titulo="Vigencia">
        <p>
          Versión {PRIVACIDAD_VERSION}, redactada en octubre de 2026. No rige hasta que un abogado la apruebe y se
          publique la versión definitiva. Fecha de entrada en vigencia:{" "}
          <Completar que="fecha de entrada en vigencia" />.
        </p>
        <p>
          Las bases de datos se mantienen mientras el servicio exista y durante el tiempo de conservación indicado
          arriba.
        </p>
      </Seccion>
    </MarcoLegal>
  );
}
