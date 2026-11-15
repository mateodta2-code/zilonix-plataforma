- **2026-11-03** — Refs #365: "Buscar categoría a mano" en Publicar buscaba con `domain_discovery` (el mismo predictor de TÍTULO de producto que usa "Detectar según el título"), por eso un texto corto como "Belleza" devolvía dominios sin relación (sets de belleza para niños, pinturas corporales, postes de barbero…). Ahora busca por NOMBRE real de categoría en el árbol del sitio de la cuenta elegida (`obtenerSitioDeCuenta`, nunca un site fijo).

  **`lib/ml/publicar.ts`**: `buscarCategorias` (domain_discovery) se reemplaza por `buscarCategoriasPorNombre(siteId, texto, token)` — recorre TODO el árbol real del sitio por niveles (`leerCategoriasRaizMl` + `leerCategoriaMl`, ambos ya existentes en `lib/ml/cliente.ts`, sin tocar ese archivo), compara nombres sin tildes/mayúsculas y devuelve la ruta completa (`pathFromRoot`) y si cada resultado es hoja (`esHoja`, mismo criterio que `leerArbolCategorias`: `children_categories` vacío). El árbol se cachea en memoria por `siteId` con expiración de 24h (las categorías de Mercado Libre cambian muy poco); pedidos concurrentes al mismo sitio mientras se construye comparten la misma promesa en vez de recorrerlo dos veces.

  **`app/api/ml/publicar/categorias/buscar/route.ts`** — mismo contrato de ruta, ahora llama a `buscarCategoriasPorNombre`.

  **`app/panel/publicar/SelectorCategoria.tsx`** — la búsqueda ahora dispara mientras se escribe (debounce 350ms), muestra la ruta completa de cada resultado ("Belleza y Cuidado Personal › Manicure y Pedicure") y, si el resultado no es hoja, el botón es "Entrar ›" (pasa a navegar el árbol real desde esa categoría) en vez de "Elegir" — igual que Zilonix OS. "Detectar según el título" sigue igual, sin tocar `resolverCategoria`.

  Textos de esta sección pasados a español neutro ("podés"/"escribí" → "puedes"/"escribe"): `SelectorCategoria.tsx` y la línea de `FormularioPublicar.tsx` que menciona "buscarla a mano".

  **No se tocó**: `lib/ml/cliente.ts` (las funciones de categorías ya existían ahí), `extension/`, `db/schema.ts`, `GaleriaFotos.tsx`. Sin migración.
