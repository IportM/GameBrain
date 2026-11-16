import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { compiledModule } from "./render-module.mjs";

const { pythonCandidates, createPythonEnvironment } = await import(compiledModule(new URL("../server/pythonEnvironment.ts", import.meta.url)));
const { EnvironmentStatus } = await import(compiledModule(new URL("../src/EnvironmentGate.tsx", import.meta.url)));
const windows = process.platform === "win32";
const probe = (python, extra = {}) => ({ python, version: "3.12.4", compatible: true, verified: false,
  checks: [{ module: "ants", package: "antspyx", status: "available" }], resourcesMissing: [], ...extra });

test("explicit interpreter wins without scanning other environments", () => {
  const result = pythonCandidates("/project", { GAMEBRAIN_PYTHON: "custom/python", PATH: "/other" }, false, () => true);
  assert.deepEqual(result, [resolve("/project", "custom/python")]);
});

test("discovery covers local, active virtual and PATH interpreters with a bound", () => {
  const result = pythonCandidates("/project", { VIRTUAL_ENV: "/active", PATH: "/bin:/bin:/other" }, false, () => true);
  assert.equal(result[0], resolve("/project", ".venv-registration", "bin", "python"));
  assert.ok(result.includes(join("/active", "bin", "python")));
  assert.equal(new Set(result).size, result.length);
  assert.ok(result.length <= 12);
});

test("a complete active environment replaces an incomplete project venv and is runtime-verified", async () => {
  const root = mkdtempSync(join(tmpdir(), "gamebrain-environment-"));
  try {
    const create = (prefix) => {
      const path = resolve(root, prefix, windows ? "Scripts" : "bin", windows ? "python.exe" : "python");
      mkdirSync(resolve(path, ".."), { recursive: true }); writeFileSync(path, ""); return path;
    };
    const local = create(".venv-registration"), active = create("active");
    const calls = [];
    const environment = createPythonEnvironment(root, { VIRTUAL_ENV: resolve(root, "active"), PATH: "" }, windows,
      async (python, _script, verify) => {
        calls.push([python, verify]);
        return probe(python, { verified: verify, checks: [{ module: "ants", package: "antspyx", status: python === local ? "missing" : "available" }] });
      });
    const report = await environment.check();
    assert.equal(report.status, "ready"); assert.equal(report.selected.python, active);
    assert.ok(calls.some(([path, verify]) => path === active && verify));
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("an explicit Python with broken imports remains blocked, not silently substituted", async () => {
  const root = resolve(".");
  const explicit = resolve(root, "chosen-python");
  const environment = createPythonEnvironment(root, { GAMEBRAIN_PYTHON: explicit }, windows,
    async (python, _script, verify) => probe(python, { verified: verify,
      checks: [{ module: "ants", package: "antspyx", status: verify ? "broken" : "available", error: "library cannot load" }] }));
  const report = await environment.check();
  assert.equal(report.status, "blocked"); assert.equal(report.selected.python, explicit);
  assert.equal(report.selected.checks[0].status, "broken"); assert.equal(report.explicit, true);
});

test("missing project resources and unsupported Python versions cannot unlock the viewer", async () => {
  for (const extra of [{ resourcesMissing: ["antsxnet/model.h5"] }, { compatible: false, version: "3.11.9" }]) {
    const environment = createPythonEnvironment(resolve("."), { GAMEBRAIN_PYTHON: "chosen-python" }, windows,
      async (python, _script, verify) => probe(python, { verified: verify, ...extra }));
    assert.equal((await environment.check()).status, "blocked");
  }
});

test("diagnostics show the selected Python, install package name and missing import", () => {
  const html = renderToStaticMarkup(createElement(EnvironmentStatus, { report: { status: "blocked", explicit: false,
    candidates: [], selected: probe("/some/python", { checks: [{ module: "nrrd", package: "pynrrd", status: "missing" }] }) },
    error: null, onRetry() {} }));
  assert.match(html, /\/some\/python/); assert.match(html, /pynrrd/); assert.match(html, /Manquante/);
  assert.match(html, /pnpm run setup/); assert.match(html, /antspyx/); assert.match(html, /Revérifier/);
});
