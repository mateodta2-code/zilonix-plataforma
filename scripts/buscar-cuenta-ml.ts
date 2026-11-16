// Solo lectura: imprime los uuid de empresa y de cuentas_ml de una
// cuenta de Mercado Libre por su nickname, para armar los argumentos
// de scripts/probar-escritura-publicidad.ts sin pedirlos a mano.
//
// Usa las conexiones restringidas de siempre, nunca el superusuario:
// publicidad_trabajador_user lista las cuentas (id y empresa, sin
// tokens) y app_user, dentro de dbComoEmpresa, lee el nickname.
//
//   npx tsx scripts/buscar-cuenta-ml.ts --nickname=FMCBIENESTAR

import { and, eq, isNull } from "drizzle-orm";
import { dbComoEmpresa } from "@/db/empresa-context";
import { cuentasMl } from "@/db/schema";
import { dbTrabajadorPublicidad } from "@/db/trabajador-publicidad-context";

async function main(): Promise<number> {
  const arg = process.argv.slice(2).find((a) => a.startsWith("--nickname="));
  const buscado = arg?.slice("--nickname=".length).trim().toLowerCase();
  if (!buscado) {
    console.log("Falta --nickname=<nickname de la cuenta en Mercado Libre>.");
    return 1;
  }
  const cuentas = await dbTrabajadorPublicidad
    .select({ id: cuentasMl.id, empresaId: cuentasMl.empresaId })
    .from(cuentasMl)
    .where(isNull(cuentasMl.desconectadaTs));
  let encontradas = 0;
  for (const cuenta of cuentas) {
    const [fila] = await dbComoEmpresa(cuenta.empresaId, (tx) =>
      tx
        .select({ nickname: cuentasMl.nickname })
        .from(cuentasMl)
        .where(and(eq(cuentasMl.id, cuenta.id), eq(cuentasMl.empresaId, cuenta.empresaId)))
    );
    if (fila && fila.nickname.toLowerCase() === buscado) {
      console.log(`${fila.nickname}: --empresa=${cuenta.empresaId} --cuenta=${cuenta.id}`);
      encontradas += 1;
    }
  }
  if (encontradas === 0) console.log("No hay una cuenta conectada con ese nickname en este ambiente.");
  return encontradas > 0 ? 0 : 1;
}

main()
  .then((codigo) => process.exit(codigo))
  .catch((error: unknown) => {
    console.error(`Error: ${error instanceof Error ? error.message : "desconocido"}`);
    process.exit(1);
  });
