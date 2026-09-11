/**
 * Zero-build TypeScript loader for the runnable scripts in this directory.
 *
 * The control-plane sources are NodeNext ESM that import siblings with a `.js`
 * specifier (`./validator.js` -> `validator.ts`), and some of them use syntax
 * Node's strip-only TypeScript mode rejects (constructor parameter properties).
 * Rather than adding a build step or a package.json script — neither of which
 * this wave may touch — this module registers two synchronous module hooks:
 *
 *   resolve: rewrite a relative `.js` specifier to the `.ts` file next to it;
 *   load:    transpile `.ts` with the TypeScript compiler already in
 *            node_modules (type-stripping only; no type checking — run
 *            `npx tsc --noEmit` for that).
 *
 * Import this module for its side effect BEFORE dynamically importing any
 * control-plane source:
 *
 *     import { importControlPlane } from "./ts-loader.mjs";
 *     const { AnswerPipeline } = await importControlPlane("src/pipeline/answerPipeline.ts");
 */

import { registerHooks } from "node:module";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import ts from "typescript";

/** control-plane/ as a file:// URL (this file lives in control-plane/scripts/). */
export const CONTROL_PLANE_ROOT = new URL("../", import.meta.url);

const TRANSPILE_OPTIONS = {
  target: ts.ScriptTarget.ES2022,
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  useDefineForClassFields: true,
  isolatedModules: true,
  verbatimModuleSyntax: false,
};

let registered = false;

function register() {
  if (registered) return;
  registered = true;

  registerHooks({
    resolve(specifier, context, nextResolve) {
      const parent = context.parentURL;
      if (
        typeof parent === "string" &&
        parent.endsWith(".ts") &&
        specifier.endsWith(".js") &&
        (specifier.startsWith("./") || specifier.startsWith("../"))
      ) {
        const candidate = path.resolve(
          path.dirname(fileURLToPath(parent)),
          `${specifier.slice(0, -3)}.ts`,
        );
        if (existsSync(candidate)) {
          return nextResolve(pathToFileURL(candidate).href, context);
        }
      }
      return nextResolve(specifier, context);
    },

    load(url, context, nextLoad) {
      if (!url.startsWith("file:") || !url.endsWith(".ts")) {
        return nextLoad(url, context);
      }
      const filePath = fileURLToPath(url);
      const source = readFileSync(filePath, "utf8");
      const { outputText } = ts.transpileModule(source, {
        fileName: filePath,
        compilerOptions: TRANSPILE_OPTIONS,
      });
      return { format: "module", shortCircuit: true, source: outputText };
    },
  });
}

register();

/** Import a control-plane source file by repo-relative path. */
export function importControlPlane(relativePath) {
  return import(new URL(relativePath, CONTROL_PLANE_ROOT).href);
}
