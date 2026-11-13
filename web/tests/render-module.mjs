import { existsSync, readFileSync } from "node:fs";
import ts from "typescript";

const compiled = new Map();

export function compiledModule(url) {
  if (compiled.has(url.href)) return compiled.get(url.href);
  const source = readFileSync(url, "utf8");
  const javascript = ts.transpileModule(source, {
    compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText.replace(/from "([^"]+)"/g, (_match, name) => {
    if (!name.startsWith(".")) return `from ${JSON.stringify(import.meta.resolve(name))}`;
    const dependency = [name, `${name}.tsx`, `${name}.ts`].map((path) => new URL(path, url)).find((path) => existsSync(path));
    if (!dependency) throw new Error(`Missing test dependency: ${name}`);
    return `from ${JSON.stringify(compiledModule(dependency))}`;
  });
  const result = `data:text/javascript;base64,${Buffer.from(javascript).toString("base64")}`;
  compiled.set(url.href, result);
  return result;
}
