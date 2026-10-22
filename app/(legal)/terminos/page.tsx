import Link from "next/link";
import { TERMINOS_VERSION } from "@/lib/legal";
import { Completar, MarcoLegal, Seccion } from "../marco";

export const metadata = {
  title: "Términos y condiciones — Zilonix",
  description: "Borrador de términos y condiciones de Zilonix Seller.",
};

export default function TerminosPage() {
  return (
    <MarcoLegal titulo="Términos y condiciones" version={TERMINOS_VERSION}>
      <p>
        Estos términos dicen qué puedes esperar de Zilonix y qué no. Van junto con la{" "}
        <Link href="/privacidad">política de privacidad</Link> y con la página{" "}
        <Link href="/que-ve-zilonix">qué ve el personal de Zilonix</Link>. Los tres son un borrador: un abogado tiene
        que revisarlos antes de que rijan.
      </p>

      <Seccion titulo="Quién presta el servicio">
        <p>
          Zilonix es una herramienta en línea para vendedores que operan en Mercado Libre. El servicio lo presta{" "}
          <Completar que="razón social" />, identificada con NIT <Completar que="NIT" />, con domicilio en{" "}
          <Completar que="dirección" />, <Completar que="ciudad" />, Colombia.
        </p>
        <p>
          Canal de contacto: <Completar que="correo de contacto de datos" />. Teléfono:{" "}
          <Completar que="teléfono de contacto" />.
        </p>
      </Seccion>

      <Seccion titulo="Qué incluye hoy">
        <p>Con una empresa en Zilonix puedes:</p>
        <ul>
          <li>crear una empresa (un NIT, aislada de las demás) e invitar a tu equipo con roles;</li>
          <li>conectar una cuenta de Mercado Libre y ver pedidos, publicaciones y despachos que esa cuenta reporte;</li>
          <li>llevar un registro de quién hizo qué dentro de tu empresa.</li>
        </ul>
        <p>
          Zilonix no es Mercado Libre. Lo que Mercado Libre apruebe, rechace, demore o cobre es entre tú y Mercado
          Libre. Zilonix muestra lo que esa plataforma responde.
        </p>
      </Seccion>

      <Seccion titulo="Aceptación">
        <p>
          Estos términos se aceptan al crear una empresa, con una casilla que empieza desmarcada. Si no la marcas, la
          empresa no se crea. La casilla también es la autorización para tratar tus datos personales, como explica la
          política de privacidad.
        </p>
        <p>
          Al crear la empresa guardamos la versión de estos términos ({TERMINOS_VERSION}), la de la política de
          privacidad y la del aviso de qué ve Zilonix, junto con la fecha, en el registro de actividad de esa empresa.
        </p>
      </Seccion>

      <Seccion titulo="Precio: gratis hasta el 31-ene-2027">
        <p>
          El uso de Zilonix es gratis hasta el 31 de enero de 2027 (31-ene-2027). Hasta ese día no hay tarifa que
          pagar por usar el servicio.
        </p>
        <p>
          A partir del 1 de febrero de 2027 el servicio tendrá un precio publicado:{" "}
          <Completar que="precio y cada cuánto se cobra, a partir del 1 de febrero de 2027" />.
        </p>
        <p>
          Zilonix no empieza a cobrar sin avisar con al menos 30 días de anticipación. El canal de ese aviso es{" "}
          <Completar que="canal del aviso de 30 días antes de cobrar" />. Si no aceptas el precio, puedes dejar de usar
          Zilonix antes de que empiece el cobro. El tiempo que usaste mientras era gratis no se cobra.
        </p>
      </Seccion>

      <Seccion titulo="Tu empresa y tu equipo">
        <p>
          Tú respondes por el nombre y el NIT que registras, y por las personas que invitas. Una misma persona puede
          estar en varias empresas. Cada empresa es un NIT distinto y no comparte datos con otra.
        </p>
      </Seccion>

      <Seccion titulo="Datos de tus compradores">
        <p>
          Tú eres el responsable de los datos personales de tus compradores. Zilonix es el encargado: los trata solo
          para prestarte el servicio. El detalle está en el{" "}
          <Link href="/privacidad#anexo-encargo">anexo de encargo</Link> de la política de privacidad. Conectar Mercado
          Libre no le pasa a Zilonix la obligación de pedirle autorización a tus compradores: esa autorización, cuando
          la ley la exige, la consigues tú.
        </p>
      </Seccion>

      <Seccion titulo="Zilonix no factura ante la DIAN por ti">
        <p>
          Zilonix no emite facturas electrónicas ante la DIAN a tu nombre ni en tu representación. No presenta tus
          declaraciones, no es tu facturador y no es tu contador. Facturar, cuando la ley te lo exija, es
          responsabilidad tuya. Hoy el producto no tiene un módulo de facturación electrónica.
        </p>
      </Seccion>

      <Seccion titulo="Límites de responsabilidad">
        <p>
          Durante el periodo gratis el servicio se ofrece tal como está, en construcción. Zilonix no responde por:
        </p>
        <ul>
          <li>decisiones, caídas, cambios de reglas o cobros de Mercado Libre;</li>
          <li>ventas que no se hagan, se demoren o se cancelen;</li>
          <li>errores tuyos o de tu equipo al publicar, empacar, despachar o atender a un comprador;</li>
          <li>impuestos, facturas, reportes o sanciones ante la DIAN;</li>
          <li>datos de compradores que tú no tenías autorización de tratar.</li>
        </ul>
        <p>
          Hasta donde la ley colombiana permita pactarlo, Zilonix no responde por lucro cesante ni por otros daños
          indirectos. El tope máximo de responsabilidad es <Completar que="tope de responsabilidad" />.
        </p>
        <p>Estas limitaciones no cubren lo que una norma colombiana impida limitar o excluir.</p>
      </Seccion>

      <Seccion titulo="Dejar de usar Zilonix">
        <p>
          Puedes dejar de usar el servicio cuando quieras. En el periodo gratis, dejarlo no genera un cobro. Cómo se
          piden la devolución o el borrado de los datos está en la política de privacidad. Hoy no hay un botón de
          eliminar empresa en el panel: la solicitud va al correo de contacto, cuando ese correo quede definido.
        </p>
      </Seccion>

      <Seccion titulo="Cambios de estos términos">
        <p>
          Si el texto cambia, cambia el número de versión de arriba y se publica aquí. Hoy la aceptación se pide al
          crear la empresa. <Completar que="cómo se pide de nuevo la aceptación si el texto cambia" />. El aviso de 30
          días antes de cobrar es aparte y sigue aplicando aunque el resto del texto no cambie.
        </p>
      </Seccion>

      <Seccion titulo="Ley y vigencia">
        <p>
          Estos términos se rigen por las leyes de la República de Colombia. Las diferencias se resuelven ante los
          jueces de <Completar que="ciudad de los jueces" />.
        </p>
        <p>
          Versión {TERMINOS_VERSION}, redactada en octubre de 2026. No entra en vigencia hasta que un abogado la
          apruebe y se publique la versión definitiva. Fecha de entrada en vigencia:{" "}
          <Completar que="fecha de entrada en vigencia" />.
        </p>
      </Seccion>
    </MarcoLegal>
  );
}
