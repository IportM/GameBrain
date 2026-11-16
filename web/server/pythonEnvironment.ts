import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve, join } from "node:path";
import type { EnvironmentReport, PythonProbe } from "../src/environmentTypes";

export function pythonCandidates(root: string, env: Record<string, string | undefined>, windows: boolean, exists = existsSync): string[] {
  if (env.GAMEBRAIN_PYTHON) return [resolve(root, env.GAMEBRAIN_PYTHON)];
  const suffix = windows ? ["Scripts", "python.exe"] : ["bin", "python"];
  const paths = [resolve(root, ".venv-registration", ...suffix)];
  for (const prefix of [env.VIRTUAL_ENV, env.CONDA_PREFIX]) if (prefix) {
    paths.push(windows && prefix === env.CONDA_PREFIX ? join(prefix, "python.exe") : join(prefix, ...suffix));
  }
  const path = Object.entries(env).find(([key]) => key.toLowerCase() === "path")?.[1] ?? "";
  for (const directory of path.split(windows ? ";" : ":").filter(Boolean)) {
    for (const name of windows ? ["python.exe", "python3.exe"] : ["python3.12", "python3", "python"]) paths.push(resolve(directory, name));
  }
  const unique = new Set<string>();
  return paths.filter((path) => {
    if (windows && path.toLowerCase().includes("\\microsoft\\windowsapps\\")) return false;
    const key = windows ? path.toLowerCase() : path;
    if (unique.has(key) || !exists(path)) return false;
    unique.add(key);
    return true;
  }).slice(0, 12);
}

export function probePython(python: string, script: string, verify: boolean): Promise<PythonProbe> {
  return new Promise((done, fail) => {
    const child = spawn(python, [script, ...(verify ? ["--verify"] : [])], {
      windowsHide: true,
      env: { ...process.env, PYTHONUTF8: "1", PYTHONIOENCODING: "utf-8", MPLBACKEND: "Agg", TF_CPP_MIN_LOG_LEVEL: "3" },
    });
    let output = "";
    let diagnostics = "";
    const timer = setTimeout(() => { child.kill(); fail(new Error("Python verification timed out")); }, verify ? 90_000 : 5000);
    child.stdout.on("data", (chunk) => { output = (output + chunk.toString("utf8")).slice(-40_000); });
    child.stderr.on("data", (chunk) => { diagnostics = (diagnostics + chunk.toString("utf8")).slice(-1000); });
    child.once("error", (error) => { clearTimeout(timer); fail(error); });
    child.once("close", (code) => {
      clearTimeout(timer);
      const line = output.split(/\r?\n/).reverse().find((line) => line.startsWith("GAMEBRAIN_ENV="));
      try {
        if (code !== 0 || !line) throw new Error(diagnostics || `Python exited with code ${code}`);
        const parsed = JSON.parse(line.slice("GAMEBRAIN_ENV=".length)) as PythonProbe;
        if (!parsed.python || !Array.isArray(parsed.checks)) throw new Error("Invalid Python report");
        done(parsed);
      } catch (error) { fail(error); }
    });
  });
}

const missing = (report: PythonProbe) => report.checks.filter((entry) => entry.status !== "available").length;

export function createPythonEnvironment(root: string, env = process.env, windows = process.platform === "win32", probe = probePython) {
  let report: EnvironmentReport = { status: "checking", selected: null, candidates: [], explicit: Boolean(env.GAMEBRAIN_PYTHON) };
  let pending: Promise<EnvironmentReport> | null = null;
  const check = (): Promise<EnvironmentReport> => {
    if (pending) return pending;
    report = { status: "checking", selected: null, candidates: [], explicit: Boolean(env.GAMEBRAIN_PYTHON) };
    pending = (async () => {
      const results: PythonProbe[] = [];
      for (const path of pythonCandidates(root, env, windows)) {
        try {
          const result = await probe(path, resolve(root, "registration/src/probe_environment.py"), false);
          if (!results.some((entry) => entry.python === result.python)) results.push(result);
          report.candidates.push({ python: result.python, version: result.version, compatible: result.compatible, missing: missing(result) });
        } catch (error) { report.candidates.push({ python: path, error: String(error).slice(-700) }); }
      }
      results.sort((a, b) => Number(b.compatible) - Number(a.compatible) || missing(a) - missing(b));
      report.selected = results[0] ?? null;
      for (const result of results.filter((entry) => entry.compatible && missing(entry) === 0).slice(0, 2)) {
        try {
          report.selected = await probe(result.python, resolve(root, "registration/src/probe_environment.py"), true);
          if (missing(report.selected) === 0 && report.selected.verified && report.selected.resourcesMissing.length === 0) {
            report.status = "ready";
            return report;
          }
        } catch (error) { report.error = String(error).slice(-700); }
      }
      report.status = "blocked";
      return report;
    })().catch((error) => {
      report.status = "blocked";
      report.error = String(error).slice(-700);
      return report;
    }).finally(() => { pending = null; });
    return pending;
  };
  return { check, getReport: () => report };
}
