---
name: ""
about: ""
labels: ""
---

## Contexto

<!-- Por qué hace falta esta tarea: el problema, y la evidencia que lo sostiene (plan técnico, algo visto en staging, o una decisión ya tomada). -->

## Alcance

<!-- Qué entra en esta tarea y qué queda fuera. Una tarea del plan por pull request. -->

## Criterios de aceptación

- [ ]
- [ ]
- [ ]

## Archivos probables

<!-- Rutas que esta tarea va a tocar, si ya se saben. -->

-

## Dependencias

<!-- Issues de los que depende, escritos como `#n`. Si no depende de ninguna: "ninguna". -->

- #

## Estimación

<!-- Por ejemplo: 0,25 d -->

## Riesgo

<!-- Una sola opción: A (alto), M (medio) o B (bajo). Debajo, una línea de por qué. -->

- [ ] A
- [ ] M
- [ ] B

Motivo:

## Migración

<!-- Solo si toca `db/schema.ts`, `db/migrations/**` o `db/rls-setup.sql`. Si no aplica, dejar "no aplica". Ya no hay turnos: mergea cuando el CI esté verde. Antes, actualiza la rama con main; si el número ya está ocupado o el CI marca números repetidos o `when` fuera de orden, borra la migración y vuélvela a generar con drizzle-kit. Nunca un COMMIT dentro del .sql. -->

no aplica

<!-- Nunca pegues secretos, valores de variables, cadenas de conexión ni tokens. -->
