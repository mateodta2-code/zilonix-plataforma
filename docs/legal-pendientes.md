# Pendientes legales — Z-MT-15 (borrador)

Texto de partida para que un abogado lo revise **antes del piloto**. No es una política vigente. Las páginas `/terminos`, `/privacidad` y `/que-ve-zilonix` llevan arriba el aviso «Borrador pendiente de revisión legal» y la versión `2026-10-borrador`. Cuando el texto se apruebe hay que cambiar esas constantes en `lib/legal.ts` (si no, la auditoría seguiría diciendo que la gente aceptó el borrador) y quitar el aviso.

El issue #52 pide mandar estos textos al abogado **antes del viernes 6 de noviembre de 2026**. Este archivo no cierra el issue: falta esa revisión.

## Qué tiene que validar el abogado

1. **Ley 1581 de 2012 y Decreto 1074 de 2015.** Que la política traiga el contenido mínimo del reglamento (identidad del responsable, finalidades, derechos, canal, procedimiento de consultas y reclamos, vigencia). Los plazos de la página están tomados de los artículos 14 y 15 de la Ley 1581: consulta en 10 días hábiles, prorrogables 5; reclamo en 15 días hábiles contados desde el día siguiente, prorrogables 8; reclamo incompleto: requerimiento en 5 días y dos meses para subsanar; leyenda de «reclamo en trámite» en 2 días hábiles. Contrastarlo con el texto oficial, no con este resumen.
2. **Autorización previa, expresa e informada.** La casilla de `/crear-empresa` empieza desmarcada, el navegador exige marcarla y el servidor rechaza el alta si no llega el valor `si`. Confirmar si ese texto de la casilla alcanza como autorización, o si hace falta un texto más largo al lado.
3. **Anexo de encargo.** La política dice que el vendedor es responsable de los datos de sus compradores y Zilonix es encargado. Confirmar si el reparto es correcto y si hace falta un contrato de encargo aparte, firmado, además del anexo publicado.
4. **Transferencia y transmisión internacional.** La página declara que los datos salen de Colombia hacia **Railway** (aplicación y base de datos) y **Clerk** (inicio de sesión). Neon **no se usa** en este repositorio: no está declarado como proveedor. Falta el país o la región real de los servidores, y falta leer los contratos para saber si Railway y Clerk solo actúan por instrucción (transmisión a un encargado) o si también deciden ellos sobre una parte de los datos (transferencia a otro responsable). Clerk, en particular, puede tratar datos para su propia seguridad.
5. **Registro Nacional de Bases de Datos de la SIC.** El issue pide verificar si Zilonix está obligada a inscribir sus bases. La respuesta depende del tamaño de los activos (y de las demás reglas vigentes, entre ellas las que salieron del Decreto 1074 de 2015 y de las normas posteriores que ajustaron quién debe registrarse). Este borrador **no afirma** que Zilonix deba o no deba inscribirse, ni inventa un número de inscripción. El abogado tiene que decir: si aplica, el número o el plan para inscribir; si no aplica, la razón, para poder publicarla en la política en vez del marcador.
6. **Precio y aviso de cobro.** El texto dice que el servicio es gratis hasta el 31 de enero de 2027 (31-ene-2027) y que no se cobra sin avisar con al menos 30 días. No hay precio definido, ni canal real de ese aviso: hoy no hay correo automático (las invitaciones se copian a mano) ni un aviso dentro del panel. No prometer un canal que el producto no tiene hasta que exista, o construir el canal antes de que el texto rija.
7. **Límites de responsabilidad y DIAN.** El texto dice que Zilonix no factura ante la DIAN por el vendedor. Eso coincide con el producto de hoy: la fase de finanzas y DIAN no está construida. Falta el tope en dinero. Falta decir si el vendedor entra como consumidor (Ley 1480 de 2011) o como relación mercantil, porque de eso depende qué se puede limitar. Las exclusiones de lucro cesante no deben publicarse como si ya fueran exigibles.
8. **Qué ve el personal de Zilonix.** La página describe el mecanismo que ya está en el código (`/panel/soporte`, `lib/acceso-temporal.ts`, `lib/superadmin.ts`), no uno inventado:
   - Sin permiso: nombre de la empresa, NIT y cuántas personas hay. No nombres, no correos, no ventas, no clientes.
   - Con permiso: la empresa escribe el alcance, elige las horas, máximo 360 (15 días), puede revocar antes, y cada vista queda en auditoría.
   - Hoy ese permiso abre la lista de miembros (nombre, correo, rol). No abre ventas ni clientes: el usuario de base del panel interno no tiene lectura de esas tablas.
   Confirmar si esa descripción le basta al piloto o si el abogado quiere un alcance más estrecho (por ejemplo, ni siquiera el NIT sin permiso).
9. **Cancelar.** No existe un botón de eliminar empresa. La página lo dice. Faltan el plazo de conservación y el procedimiento de devolución o borrado de los datos encargados.
10. **Aceptar de nuevo si el texto cambia.** Hoy la casilla solo se pide al crear la empresa. No hay flujo para volver a pedir aceptación. El texto deja ese hueco marcado.
11. **Tratamiento de «tú».** El resto de la app habla de tú. Si el abogado prefiere usted, se cambia en las tres páginas a la vez.
12. **Datos de compradores que hoy no se guardan.** Las tablas de pedidos y despachos no tienen nombre, documento ni dirección del comprador. La página lo dice, y aun así cubre el encargo porque la respuesta de Mercado Libre puede traer esos datos al pasar por los servidores. Confirmar que no estamos de más ni de menos.
13. **Menores y datos sensibles.** El borrador no abre un capítulo propio. Confirmar si hace falta decir, en una frase, que el servicio no está dirigido a niños y que no se piden datos sensibles.
14. **Vigencia.** Ninguna de las tres páginas rige hasta la fecha que el abogado fije. Hay un marcador en cada una.

## Marcadores `[COMPLETAR]` abiertos

No se inventó ninguno de estos datos. Están visibles en las páginas, resaltados.

| Marcador | Dónde |
|---|---|
| `[COMPLETAR: razón social]` | Términos, privacidad (responsable y anexo) |
| `[COMPLETAR: NIT]` | Términos, privacidad |
| `[COMPLETAR: dirección]` | Términos, privacidad |
| `[COMPLETAR: ciudad]` | Términos, privacidad |
| `[COMPLETAR: correo de contacto de datos]` | Términos, privacidad, qué ve Zilonix |
| `[COMPLETAR: teléfono de contacto]` | Términos, privacidad |
| `[COMPLETAR: precio y cada cuánto se cobra, a partir del 1 de febrero de 2027]` | Términos |
| `[COMPLETAR: canal del aviso de 30 días antes de cobrar]` | Términos |
| `[COMPLETAR: tope de responsabilidad]` | Términos |
| `[COMPLETAR: cómo se pide de nuevo la aceptación si el texto cambia]` | Términos |
| `[COMPLETAR: ciudad de los jueces]` | Términos |
| `[COMPLETAR: país o región de los servidores de Railway y de Clerk]` | Privacidad |
| `[COMPLETAR: si los contratos de Railway y de Clerk los dejan solo como encargados, o si alguna parte de los datos la deciden ellos como responsables]` | Privacidad |
| `[COMPLETAR: cuánto tiempo se conservan los datos después de cancelar]` | Privacidad |
| `[COMPLETAR: procedimiento de devolución o borrado de los datos encargados]` | Privacidad |
| `[COMPLETAR: si Zilonix debe inscribir sus bases en el Registro Nacional de Bases de Datos de la SIC, y el número de inscripción si ya existe]` | Privacidad |
| `[COMPLETAR: fecha de entrada en vigencia]` | Términos, privacidad, qué ve Zilonix |

## Qué ya quedó en el producto, y qué no

- La casilla está en `/crear-empresa`. Empieza desmarcada. El servidor no crea la empresa si no viene marcada.
- Versión y fecha se guardan en la tabla `auditoria` que ya existía: la versión, dentro de `detalle`; la fecha, en `ts` (la hora del insert). Acción `aceptar_terminos_y_datos`, entidad `consentimiento`. Misma transacción que crear la empresa. No hubo migración.
- Si más adelante hace falta consultar «quién aceptó la versión X» como dato estructurado (columna propia, no una frase), eso sí sería una tabla o columna nueva. Hoy no se creó porque la fila de auditoría alcanza para guardar versión y fecha.
- Las tres páginas están exentas de permiso de módulo en `scripts/verificar-permisos.test.ts`.
- **No son públicas todavía.** Este cambio no toca `lib/rutas-publicas.ts` ni `middleware.ts` (los está cambiando el PR #27). Hasta que Mateo agregue las rutas, quien no haya iniciado sesión no puede abrirlas. Quien ya inició sesión y está creando la empresa sí puede abrir los enlaces de la casilla.

Líneas para agregar dentro de `PATRONES_RUTAS_PUBLICAS` en `lib/rutas-publicas.ts` (el archivo entra con el PR #27):

```ts
  "/terminos",
  "/privacidad",
  "/que-ve-zilonix",
```

En `main`, mientras el #27 no esté fusionado, la lista equivalente sigue inline en `middleware.ts`. Este borrador no la edita.
