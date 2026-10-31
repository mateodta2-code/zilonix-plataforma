# Estructura de carpetas — mapa completo

Movido desde `CLAUDE.md` (issue #320, ahorro de créditos).

```
app/              Next.js App Router — una carpeta por ruta real
  api/            Route Handlers (solo cuando no alcanza una Server Action — ej. devolver un PDF/binario crudo)
  panel/          Pantallas de negocio, una vez con sesión y empresa activa
  sign-in/ sign-up/   Páginas de Clerk
  superadmin/     Panel aparte, otro eje de autorización (requiereSuperadmin(), no requierePermiso())
db/
  schema.ts       Única fuente de verdad del modelo de datos (Drizzle)
  migrations/     Generadas con `npm run db:generate`, nunca escritas a mano
  rls-setup.sql   Usuarios de base + políticas de RLS — script repetible, corrido a mano (tiene contraseñas)
  empresa-context.ts / superadmin-context.ts / trabajador-context.ts   Los únicos puntos de entrada a Postgres
  *.test.ts       Pruebas de aislamiento/RLS contra Postgres real
lib/
  ml/             Todo lo específico de la integración con Mercado Libre (OAuth, pedidos, publicar, despachos...)
  conectores/     Contrato genérico para un marketplace (hoy solo ML lo implementa de verdad)
  permisos.ts, roles.ts, auditoria.ts, membresias.ts, empresas.ts, usuarios.ts   Lógica de negocio transversal
docs/
  CHANGELOG.md    Registro de cada entrega real — qué tarea, qué se construyó, qué quedó pendiente
  ESTADO.md       Foto actual del proyecto (ver arriba)
  plan-tecnico-resumen.md   Tareas de Mercado Libre del plan técnico y su estado en esta plataforma
  modelo-datos.md, rls.md, conectores.md, matriz-permisos.md   Documentación de diseño específica
  claude/         Detalle por tema para Claude Code (este archivo y los demás que referencia CLAUDE.md)
scripts/          Scripts de mantenimiento (generar/verificar la matriz de permisos)
middleware.ts     Toda ruta cerrada por defecto salvo las listadas en lib/rutas-publicas.ts (Clerk + límite de peticiones)
lib/rutas-publicas.ts   Las únicas rutas sin sesión de Clerk — ver docs/claude/rutas-publicas.md
```
