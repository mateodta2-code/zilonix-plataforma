# Entornos de Product Ads

Staging y producción de Zilonix Seller usan **la misma app** de Mercado Libre (Zilonix Plataforma, con el permiso "Publicidad de un producto"). No hay una app distinta por ambiente.

El refresh token de una cuenta es de un solo uso: cada renovación invalida el anterior. Si la misma cuenta de vendedor queda conectada en los dos entornos, uno de los dos renueva el token y el otro se queda con uno que Mercado Libre ya no acepta.

Por eso una cuenta real se conecta **en un solo entorno a la vez**. La cuenta piloto se prueba en staging. No se vuelve a conectar en producción mientras staging la esté usando, ni al revés. Desconectarla de un entorno antes de conectarla en el otro.
