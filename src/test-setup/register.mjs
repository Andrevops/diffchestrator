// Registers the vscode-loader.mjs resolve hook. Invoked via
// `node --import ./src/test-setup/register.mjs` in the test script.
import { register } from "node:module";

register("./vscode-loader.mjs", import.meta.url);
