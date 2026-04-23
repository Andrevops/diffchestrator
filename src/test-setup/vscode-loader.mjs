// Node ESM resolve hook: redirect `import ... from "vscode"` to the local
// stub so unit tests can load modules that depend on the vscode API.
// Registered via `--import ./src/test-setup/register.mjs` in the test script.
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, resolve as resolvePath } from "node:path";
import { existsSync } from "node:fs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const STUB_URL = pathToFileURL(resolvePath(__dirname, "vscode-stub.mjs")).href;

export async function resolve(specifier, context, nextResolve) {
  if (specifier === "vscode") {
    return { url: STUB_URL, shortCircuit: true, format: "module" };
  }

  // Source modules import relative paths without the `.ts` extension
  // (esbuild rewrites them at build time). Node's ESM loader needs an
  // explicit extension, so rewrite extensionless relative imports to `.ts`
  // and fall through so --experimental-strip-types still applies.
  if ((specifier.startsWith("./") || specifier.startsWith("../")) && !/\.[a-z]+$/i.test(specifier)) {
    const parentDir = dirname(fileURLToPath(context.parentURL));
    const asTs = resolvePath(parentDir, specifier + ".ts");
    if (existsSync(asTs)) {
      return nextResolve(specifier + ".ts", context);
    }
  }

  return nextResolve(specifier, context);
}
