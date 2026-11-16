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

Para sacar los uuid de `--empresa` y `--cuenta` (solo lectura):

```bash
npx tsx scripts/buscar-cuenta-ml.ts --nickname=FMCBIENESTAR
```

En staging se puede correr dentro del servicio web, que ya tiene las variables: `railway ssh --environment staging --service "web " -- npx tsx scripts/...` (el nombre del servicio lleva un espacio al final).

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

### Nombre libre

Con `--nombre="vendedor 2"` el nombre temporal es ese, en vez del sufijo " (prueba)". Sirve para probar un nombre real de las reglas (VENDEDOR). Igual se verifica y **se revierte** al original. Tiene que ser distinto del nombre actual y tener como máximo 100 caracteres: la doc de ML no dice el máximo.

## Resultado del 14/11/2026

Se corrió en staging con FMCBIENESTAR, campaña 358458617, con la autorización de Mateo Barrientos.
- La lectura funcionó.
- El `PUT` respondió **401 `UnauthorizedException · User does not have permission to write`**.
- La campaña no cambió.

Antes de pedirle respuesta a Mercado Libre, se descartan dos causas sin probar rutas nuevas:
1. **Token viejo:** reconectar FMCBIENESTAR (Conectar Mercado Libre → volver a autorizar) y repetir la misma prueba.
2. **Usuario sin permiso:** la reconexión la tiene que hacer el **titular** de la cuenta en Mercado Libre, no un colaborador u operador. Un colaborador puede no tener permiso de publicidad.

Si con la cuenta reconectada por el titular sigue el 401, la pregunta va a Mercado Libre (ver `api-research.md` §3).

## Qué hacer con el resultado

- **Salió bien** (código 0): el script imprime tres líneas para pegar en `api-research.md` §3. Con eso, la ruta queda verificada para MCO y se puede seguir con el paso 1 del issue #257.
- **La ruta respondió error:** la campaña queda igual. **No se prueban otras rutas.** Se anota el código y el mensaje en `api-research.md` y se le pregunta a Mercado Libre.
- **"¡ATENCIÓN! La campaña NO volvió a su nombre":** ponerle a mano, en Mercado Libre, el nombre original que imprime el script.
