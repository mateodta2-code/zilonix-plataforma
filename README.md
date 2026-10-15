# Zilonix Plataforma

Plataforma multiempresa para vendedores de Mercado Libre (y luego otros marketplaces). Arranca en la tarea 1.1 del plan técnico de Zilonix OS (`zilonix-os-web/docs/plan-tecnico.md`), que sigue siendo el documento de referencia para todo el proyecto — decisiones, fases y criterios de "listo" viven ahí, no se repiten acá.

## Qué es esto, en una frase

Cada negocio real que se registre es una **empresa** aislada (seguridad por fila en Postgres), con sus propias cuentas de Mercado Libre, usuarios y datos — nunca ve nada de otra empresa.

## Stack

- Next.js 14 (App Router) + TypeScript
- Drizzle ORM + Postgres, migraciones versionadas en `db/migrations/`
- Railway (mismo proveedor que Zilonix OS)
- GitHub Actions: compila y corre pruebas en cada Pull Request

## Desarrollo local

Este proyecto todavía no se ha corrido localmente (se armó y se prueba directo contra Railway/staging). Para hacerlo:

```bash
npm install
cp .env.example .env.local   # completar DATABASE_URL con la de staging
npm run dev
```

## Migraciones

```bash
npm run db:generate   # después de cambiar db/schema.ts
npm run db:migrate    # aplica las migraciones pendientes contra DATABASE_URL
```

Para conectarte a la base real sin exponerla a internet: `railway connect Postgres --tunnel-only --environment production --port 55432` abre un túnel privado (necesita `railway login` y una llave SSH registrada con `railway ssh keys add`) — ahí mismo imprime la URL completa para usar en `DATABASE_URL`.

## Dos conexiones a la base, a propósito (tarea 1.3)

- `DATABASE_URL` — el usuario con privilegios totales que da Railway. **Solo** para `npm run db:migrate`. La app nunca lo usa para consultas de negocio.
- `DATABASE_URL_APP` — un usuario restringido (`app_user`) que sí respeta la seguridad por fila (RLS). Es el que usa `db/index.ts`, el único que el resto del código debe importar. Ver `docs/rls.md` para cómo se crea (necesita una contraseña real, se hace a mano, nunca en un archivo de git).

## Estado

Fase 1 del plan técnico — tarea 1.3 en construcción (seguridad por fila: el mecanismo ya está escrito — `db/rls-setup.sql`, `db/empresa-context.ts` — falta correrlo contra la base real, ver `docs/rls.md`). Tarea 1.2 completa.

