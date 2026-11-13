- **feat-despachos-reimprimir-masivo** — La pestaña "Impresión masiva de guías" de `/panel/despachos` trae un apartado nuevo **"Ya impresas — reimprimir"**: antes, una guía impresa una vez desaparecía de la impresión masiva y si la hoja se perdía o la impresora se trababa había que reimprimir tarjeta por tarjeta.

  `listarDespachosYaImpresos` (`lib/ml/despachos.ts`): imprimible=true (Mercado Libre todavía deja imprimirla), etiqueta ya impresa y sin marcar despachada, con el nickname de la cuenta (join con `empresa_id` explícito), las más recientes primero (25 en pantalla). El mismo `ImpresionMasivaForm` en `modo="reimprimir"`: casillas desmarcadas, columnas Cuenta e Impresa, botón "Reimprimir seleccionadas". `/api/ml/despachos/etiquetas` recibe `modo=reimprimir` y valida lo elegido contra `listarDespachosYaImpresos` (nunca contra lo que mande el form); misma regla de una sola cuenta por lote y mismo PDF sin la hoja de lista.

  Sin migraciones; `extension/` y `db/schema.ts` sin tocar.

  Verificado: `npm run typecheck` en verde; `npx vitest run app/panel/despachos/ImpresionMasivaForm.test.tsx lib/pdf-etiqueta.test.ts scripts/verificar-permisos.test.ts` en verde (2 pruebas nuevas del form). Las 3 pruebas nuevas de `lib/ml/despachos.test.ts` (aislamiento A/B incluido) necesitan Postgres real — quedan para el CI.
