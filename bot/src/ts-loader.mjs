// Lightweight Node.js module resolution hook that maps NodeNext `.js` relative
// imports to `.ts` source files when running with Node's built-in TypeScript
// support (Node 22.15+ / 24+). Avoids platform-specific esbuild binaries.

import { registerHooks } from "node:module";

registerHooks({
  resolve(specifier, context, nextResolve) {
    try {
      return nextResolve(specifier, context);
    } catch (err) {
      if (specifier.endsWith(".js")) {
        try {
          return nextResolve(specifier.slice(0, -3) + ".ts", context);
        } catch {
          // fall through to original error
        }
      }
      throw err;
    }
  },
});
