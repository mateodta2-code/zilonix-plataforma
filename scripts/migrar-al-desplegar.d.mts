// Tipos para importar scripts/migrar-al-desplegar.mjs desde las pruebas.
export declare const AMBIENTES_PERMITIDOS: string[];
export declare const LLAVE_ADVISORY_LOCK: number;
export declare const CARPETA_MIGRACIONES: string;
export declare const RUTA_RLS_SETUP: string;
export declare function decidirMigracion(env: Record<string, string | undefined>): {
  accion: "omitir" | "migrar" | "error";
  motivo: string;
};
export declare function rolesQueCreaRlsSetup(textoSql: string): string[];
export declare function migrarAlDesplegar(opciones: {
  databaseUrl: string;
  log?: (m: string) => void;
  esperaMaximaLockMs?: number;
}): Promise<void>;
