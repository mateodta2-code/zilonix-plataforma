import { esES } from "@clerk/localizations";
import type { LocalizationResource } from "@clerk/types";

// esES (@clerk/localizations) cubre login, registro, verificación,
// recuperación de contraseña, 2FA y UserProfile/UserButton. Donde el
// paquete deja un hueco (queda en inglés porque Organizations, Billing,
// API Keys, SSO empresarial, passkeys y web3 no se usan en esta app —
// ver middleware.ts/clerkMiddleware, sin useOrganization ni
// OrganizationSwitcher) no hace falta tocarlo. Esto solo sobreescribe
// las claves que SÍ se alcanzan a ver: la pantalla combinada de
// login/password, el medidor de fuerza de contraseña (zxcvbn, se ve en
// registro y al cambiar contraseña en /cuenta) y los mensajes de
// contraseña comprometida/no confiable.
//
// formFieldInputPlaceholder__signUpPassword (review 5726192613) no se
// agrega acá: no existe ni en el tipo (@clerk/types 4.101.28, vía
// @clerk/shared/types) ni en el runtime (@clerk/clerk-react 5.61.11
// nunca la busca) con @clerk/localizations fijado en 3.37.10 — es una
// clave de una versión de Clerk más nueva que la que usamos. En esta
// versión el campo de contraseña de /sign-up usa el mismo
// formFieldInputPlaceholder__password, que esES ya trae en español.
export const localizacionClerk: LocalizationResource = {
  ...esES,
  signIn: {
    ...esES.signIn,
    start: {
      ...esES.signIn?.start,
      titleCombined: "Continuar a {{applicationName}}",
      subtitleCombined: "Ingresa tu correo y contraseña para continuar",
    },
    passwordCompromised: {
      ...esES.signIn?.passwordCompromised,
      title: "Contraseña comprometida",
    },
    passwordUntrusted: {
      ...esES.signIn?.passwordUntrusted,
      title: "Contraseña no confiable",
    },
  },
  userProfile: {
    ...esES.userProfile,
    emailAddressPage: {
      ...esES.userProfile?.emailAddressPage,
      formHint: "Vas a tener que verificar este correo antes de poder agregarlo a tu cuenta.",
    },
    start: {
      ...esES.userProfile?.start,
      connectedAccountsSection: {
        ...esES.userProfile?.start?.connectedAccountsSection,
        subtitle__disconnected: "Esta cuenta fue desconectada.",
      },
    },
  },
  unstable__errors: {
    ...esES.unstable__errors,
    form_password_compromised__sign_in:
      "Tu contraseña puede estar comprometida. Para proteger tu cuenta, continúa con otro método de inicio de sesión. Vas a tener que cambiarla después de entrar.",
    form_password_untrusted__sign_in:
      "Tu contraseña puede estar comprometida. Para proteger tu cuenta, continúa con otro método de inicio de sesión. Vas a tener que cambiarla después de entrar.",
    form_new_password_matches_current: "La nueva contraseña no puede ser igual a la actual.",
    zxcvbn: {
      ...esES.unstable__errors?.zxcvbn,
      couldBeStronger: "Tu contraseña funciona, pero podría ser más fuerte. Agrega más caracteres.",
      goodPassword: "Tu contraseña cumple con todos los requisitos necesarios.",
      notEnough: "Tu contraseña no es suficientemente fuerte.",
      suggestions: {
        ...esES.unstable__errors?.zxcvbn?.suggestions,
        allUppercase: "Usa mayúsculas en algunas letras, no en todas.",
        anotherWord: "Agrega más palabras, que no sean comunes.",
        associatedYears: "Evita años asociados a ti.",
        capitalization: "Usa mayúsculas en más de la primera letra.",
        dates: "Evita fechas y años asociados a ti.",
        l33t: "Evita sustituciones predecibles como '@' por 'a'.",
        longerKeyboardPattern: "Usa patrones de teclado más largos y cambia de dirección varias veces.",
        noNeed: "Puedes crear contraseñas fuertes sin usar símbolos, números ni mayúsculas.",
        pwned: "Si usas esta contraseña en otro lado, deberías cambiarla.",
        recentYears: "Evita años recientes.",
        repeated: "Evita palabras y caracteres repetidos.",
        reverseWords: "Evita escribir al revés palabras comunes.",
        sequences: "Evita secuencias de caracteres comunes.",
        useWords: "Usa varias palabras, pero evita frases comunes.",
      },
      warnings: {
        ...esES.unstable__errors?.zxcvbn?.warnings,
        common: "Esta es una contraseña muy usada.",
        commonNames: "Los nombres y apellidos comunes son fáciles de adivinar.",
        dates: "Las fechas son fáciles de adivinar.",
        extendedRepeat: 'Los patrones repetidos como "abcabcabc" son fáciles de adivinar.',
        keyPattern: "Los patrones cortos de teclado son fáciles de adivinar.",
        namesByThemselves: "Un solo nombre o apellido es fácil de adivinar.",
        pwned: "Tu contraseña fue expuesta en una filtración de datos en internet.",
        recentYears: "Los años recientes son fáciles de adivinar.",
        sequences: 'Las secuencias comunes como "abc" son fáciles de adivinar.',
        similarToCommon: "Esta contraseña es similar a una muy usada.",
        simpleRepeat: 'Los caracteres repetidos como "aaa" son fáciles de adivinar.',
        straightRow: "Las filas seguidas de teclas en tu teclado son fáciles de adivinar.",
        topHundred: "Esta es una contraseña usada con mucha frecuencia.",
        topTen: "Esta es una contraseña muy usada.",
        userInputs: "No debería haber datos personales ni de la página.",
        wordByItself: "Una sola palabra es fácil de adivinar.",
      },
    },
  },
};
