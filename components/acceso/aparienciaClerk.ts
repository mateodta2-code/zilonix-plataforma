// Identidad de marca sobre los componentes ya hechos de Clerk
// (<SignIn/>, <SignUp/>, decisión D3) — nunca se reconstruyen a mano,
// solo se personalizan con la prop "appearance" que Clerk ya expone.
//
// Todos los valores son referencias a las variables CSS de
// app/globals.css ("var(--token)"), nunca un color/tamaño fijo: Clerk
// las inyecta como CSS normal, así que las resuelve el navegador en el
// momento de pintar — el mismo <html data-tema="..."> que ya cambia el
// resto de la app (SelectorTema, localStorage "zilonix-tema") cambia
// también el formulario de Clerk, sin ninguna lógica de tema nueva acá.
//
// Logo: layout.logoImageUrl + logoPlacement "outside" es el mecanismo
// nativo de Clerk para esto (ver @clerk/types) — nunca un <img> aparte
// superpuesto a mano sobre la tarjeta. El logo plata se queda igual en
// los dos temas (el manual de marca lo permite explícitamente sobre
// fondo blanco), así que no hace falta una URL distinta por tema.
export const aparienciaClerk = {
  layout: {
    logoPlacement: "outside" as const,
    logoImageUrl: "/marca/zilonix-seller-logo.svg",
    logoLinkUrl: "/",
  },
  variables: {
    colorPrimary: "var(--acento)",
    colorBackground: "var(--superficie)",
    colorText: "var(--texto)",
    colorTextSecondary: "var(--texto-suave)",
    colorInputBackground: "var(--superficie-2)",
    colorInputText: "var(--texto)",
    colorDanger: "var(--peligro)",
    colorSuccess: "var(--exito)",
    borderRadius: "var(--radio-boton)",
    fontFamily: "var(--fuente-texto)",
  },
  elements: {
    // El logo "arriba del formulario" (layout.logoImageUrl, arriba) —
    // mínimo 260px de ancho, con height "auto" para que nunca se
    // estire ni se deforme; margen = área de protección (mismo
    // criterio que el logo de la barra lateral, feat-ui-marca).
    logoBox: { marginBottom: 24 },
    logoImage: { width: "260px", minWidth: "260px", height: "auto" },

    cardBox: { boxShadow: "none", border: "1px solid var(--borde)", backgroundColor: "var(--superficie)" },
    card: { backgroundColor: "var(--superficie)", boxShadow: "none" },
    headerTitle: { fontFamily: "var(--fuente-titulos)", color: "var(--texto)", fontWeight: 700 },
    headerSubtitle: { color: "var(--texto-suave)" },

    formFieldLabel: { color: "var(--texto-suave)" },
    formFieldInput: {
      backgroundColor: "var(--superficie-2)",
      borderColor: "var(--borde)",
      color: "var(--texto)",
      "&:focus": { borderColor: "var(--acento)" },
    },
    formFieldAction: { color: "var(--acento)" },

    // Botón principal — el azul de estados interactivos (--acento),
    // nunca el plata del logo. Hover/focus con la misma transición que
    // ya usa el resto del marco (var(--transicion-color)).
    formButtonPrimary: {
      backgroundColor: "var(--acento)",
      color: "#ffffff",
      fontFamily: "var(--fuente-texto)",
      fontWeight: 600,
      boxShadow: "none",
      transition: "var(--transicion-color), var(--transicion-transform)",
      "&:hover": { backgroundColor: "var(--acento-fuerte)", transform: "translateY(-1px)" },
      "&:focus-visible": { outline: "2px solid var(--acento)", outlineOffset: "2px" },
    },

    socialButtonsBlockButton: {
      borderColor: "var(--borde)",
      backgroundColor: "var(--superficie-2)",
      color: "var(--texto)",
      transition: "var(--transicion-color)",
      "&:hover": { borderColor: "var(--plata-2)", backgroundColor: "var(--superficie-2)" },
    },
    socialButtonsIconButton: {
      borderColor: "var(--borde)",
      backgroundColor: "var(--superficie-2)",
      transition: "var(--transicion-color)",
      "&:hover": { borderColor: "var(--plata-2)" },
    },

    dividerLine: { backgroundColor: "var(--borde)" },
    dividerText: { color: "var(--texto-suave)" },

    footerActionText: { color: "var(--texto-suave)" },
    footerActionLink: {
      color: "var(--acento)",
      transition: "var(--transicion-color)",
      "&:hover": { color: "var(--acento-fuerte)" },
    },

    identityPreview: { backgroundColor: "var(--superficie-2)", borderColor: "var(--borde)" },
    identityPreviewText: { color: "var(--texto)" },
    identityPreviewEditButton: { color: "var(--acento)" },
  },
};
