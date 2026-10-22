import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  // El resto del repo escribe JSX sin `import React` (el runtime
  // automático de Next). Sin esto, un test que renderiza un
  // componente revienta con "React is not defined".
  esbuild: {
    jsx: "automatic",
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
    },
  },
});
