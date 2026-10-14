# Changelog — Zilonix Plataforma

Registro de cada entrega a producción, con la versión y qué tarea del plan técnico (`zilonix-os-web/docs/plan-tecnico.md`) la generó. Nada pasa a producción sin pasar por staging primero.

## v0.1.0

- **2026-10-14** — Tarea 1.1 (Repositorio nuevo): Next.js 14 + TypeScript, Drizzle ORM + Postgres, GitHub Actions (compila, tipos, pruebas, build en cada PR), página `/api/version`. Pendiente dentro de la misma tarea: generar la primera migración de Drizzle (necesita Node local), desplegar a staging en Railway, y decidir si/cuándo se activa Sentry (se dejó fuera del alcance inicial para no sumar una integración a medias).

