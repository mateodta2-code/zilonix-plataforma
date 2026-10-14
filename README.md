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

## Estado

Fase 1 del plan técnico — tarea 1.2 completa (modelo de datos: empresas, usuarios, roles, membresías, permisos_rol, invitaciones, auditoría — las 7 tablas ya están creadas en la base real de staging). Siguiente: tarea 1.3, seguridad por fila (RLS).
