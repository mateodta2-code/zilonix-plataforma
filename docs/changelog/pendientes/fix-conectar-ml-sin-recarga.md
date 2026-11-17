- **fix-conectar-ml-sin-recarga** — Con una importación en curso, `/panel/conectar-ml` devolvía al usuario a esa pantalla a los 5 s aunque ya estuviera en otro módulo.

  **Causa**: la página pintaba `<meta http-equiv="refresh" content="5" />`; como el menú navega con el router de Next, ese temporizador del navegador seguía vivo tras salir de la página.

  **Arreglo**: se quita el meta refresh y entra `components/panel/RefrescarImportacion.tsx`, un componente cliente que llama `router.refresh()` cada 5 s solo mientras está montado y limpia el intervalo al desmontar. La página lo pinta únicamente mientras hay importación en curso, así que al terminar deja de refrescar. Con prueba (intervalo limpio al desmontar y sin meta refresh).

  Sin migraciones ni variables nuevas.
