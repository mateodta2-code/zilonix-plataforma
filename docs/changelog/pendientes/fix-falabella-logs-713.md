- Falabella sync (CI): el workflow `sincronizar-falabella.yml` ya no imprime la respuesta del endpoint (IDs de cuenta ni conteos) en los logs; solo un resumen con las cuentas fallidas. Además `permissions: {}` y tope de curl en 240 s. Refs #422.

