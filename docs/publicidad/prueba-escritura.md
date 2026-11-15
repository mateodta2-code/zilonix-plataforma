# Prueba de escritura de Product Ads (Fase 4, paso 0)

Issue #257. Antes de construir cualquier botón que cambie campañas, hay que saber si la API de Mercado Libre deja **modificar** una campaña de un vendedor de Colombia. Hoy la escritura solo está documentada para Global Selling (`api-research.md` §3).

`scripts/probar-escritura-publicidad.ts` hace el cambio más inocuo posible sobre **una** campaña:

1. Le agrega " (prueba)" al **nombre**.
2. Vuelve a leer la campaña y verifica que solo cambió el nombre.
3. La devuelve al nombre original.

No toca presupuesto, estado, ROAS objetivo ni anuncios. Si otro campo aparece cambiado, el script lo marca como **cambio inesperado**.

## Antes de correrla

- **Autorización por escrito** del responsable de la cuenta piloto (MTTIENDA), con el nombre de la campaña elegida. Sin eso no se usa `--aplicar`.
- Elegir una campaña **activa y sin cambios recientes**: un cambio de nombre no debería reiniciar el aprendizaje, pero no está confirmado.
- Correr el script **contra el ambiente donde la cuenta piloto está conectada** (`entornos.md`). El token sale de esa base, y si está por vencer se renueva ahí mismo. Correrlo contra el otro ambiente gastaría un refresh token de un solo uso y desconectaría la cuenta.
- La corren Mateo o Pablo, por el túnel privado, con `DATABASE_URL_APP` de ese ambiente. Nunca se pega la cadena de conexión en un chat ni en un commit.

## Cómo se corre

Primero en modo lectura. No cambia nada: muestra la campaña y el plan.

```bash
DATABASE_URL_APP=... npx tsx scripts/probar-escritura-publicidad.ts \
  --empresa=<uuid de la empresa> --cuenta=<uuid de cuentas_ml> --campana=<id de la campaña en ML>
```

Si el plan es el esperado, se corre la prueba:

```bash
DATABASE_URL_APP=... npx tsx scripts/probar-escritura-publicidad.ts \
  --empresa=<uuid> --cuenta=<uuid> --campana=<id> \
  --aplicar --autorizado-por="Nombre de quien autorizó"
```

## Qué hacer con el resultado

- **Salió bien** (código 0): el script imprime tres líneas para pegar en `api-research.md` §3. Con eso, la ruta queda verificada para MCO y se puede seguir con el paso 1 del issue #257.
- **La ruta respondió error:** la campaña queda igual. **No se prueban otras rutas.** Se anota el código y el mensaje en `api-research.md` y se le pregunta a Mercado Libre.
- **"¡ATENCIÓN! La campaña NO volvió a su nombre":** ponerle a mano, en Mercado Libre, el nombre original que imprime el script.
