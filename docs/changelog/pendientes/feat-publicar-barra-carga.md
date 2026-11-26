### Publicar — barra azul de avance (Barra-A, refs #617)

- El historial de Publicar muestra la barra azul «Publicando «título»… N de M cuentas» con avance real, sin recargar; al terminar dice «Publicación terminada · N de M cuentas exitosas» y refresca la fila una vez. Solo consulta mientras haya publicaciones en curso, cada 4,5 s, pausa con la pestaña oculta y se detiene a los 10 min.
- `publicarProductoEnCuentas` guarda el resultado parcial después de cada cuenta (sin migración; la publicación en Mercado Libre no cambia).
- Nuevo `GET /api/ml/publicar/estado-publicacion?id=…`: devuelve solo `{ estado, hechos, total }` de una publicación, con permiso de consulta de inventario y RLS por empresa.
- «Crear todas» (imágenes con IA) muestra «Creando imágenes… N de M» e «Imágenes listas».
