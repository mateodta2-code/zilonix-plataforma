# Changelog — Zilonix Plataforma

Registro de cada entrega a producción, con la versión y qué tarea del plan técnico (`zilonix-os-web/docs/plan-tecnico.md`) la generó. Nada pasa a producción sin pasar por staging primero.

## v0.1.0

- **2026-10-14** — Tarea 1.1 (Repositorio nuevo): Next.js 14 + TypeScript, Drizzle ORM + Postgres, GitHub Actions (compila, tipos, pruebas, build en cada PR), página `/api/version`, desplegado en Railway. Sentry se deja fuera del alcance por ahora, para no sumar una integración a medias.
- **2026-10-14** — Tarea 1.2 (Modelo de datos base): 7 tablas (empresas, usuarios, roles, membresías, permisos_rol, invitaciones, auditoría), diseño en `docs/modelo-datos.md` aprobado por Mateo antes de construir. Primera migración generada y aplicada contra la base real de Railway (vía túnel privado de Railway, sin exponer la base a internet en ningún momento).

