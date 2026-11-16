import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const windows = process.platform === "win32";
const venv = resolve(root, ".venv-registration");
const venvPython = resolve(venv, windows ? "Scripts/python.exe" : "bin/python");
const override = process.env.GAMEBRAIN_PYTHON;
const python = override ? resolve(root, override) : venvPython;
const checkOnly = process.argv.includes("--check");
const versionCheck = "import sys, struct; sys.exit(0 if sys.version_info[:2] == (3,12) and struct.calcsize('P') == 8 else 1)";

function run(executable, args, options = {}) {
  return spawnSync(executable, args, {
    cwd: root,
    env: { ...process.env, PYTHONUTF8: "1", PYTHONIOENCODING: "utf-8", MPLBACKEND: "Agg" },
    windowsHide: true,
    stdio: "inherit",
    ...options,
  });
}

function requireSuccess(result, message) {
  if (result.error || result.status !== 0) {
    throw new Error(`${message}${result.error ? `: ${result.error.message}` : ""}`);
  }
}

try {
  if (!existsSync(python)) {
    if (checkOnly || override) {
      throw new Error(`Python not found: ${python}. Run pnpm run setup, or set GAMEBRAIN_PYTHON to an existing interpreter.`);
    }
    const candidates = windows
      ? [["py", ["-3.12"]], ["python", []], ["python3", []]]
      : [["python3.12", []], ["python3", []], ["python", []]];
    const candidate = candidates.find(([executable, args]) =>
      run(executable, [...args, "-c", versionCheck], { stdio: "ignore" }).status === 0,
    );
    if (!candidate) {
      throw new Error("Install Python 3.12 (64-bit), then rerun setup. On macOS, see the Python installation steps in README.md. On Linux, also install its venv support and libgomp1.");
    }
    console.log("Creating the local Python environment...");
    requireSuccess(run(candidate[0], [...candidate[1], "-m", "venv", venv]),
      "Could not create the environment. On Linux, install python3.12-venv.");
  }
  requireSuccess(run(python, ["-c", versionCheck]), "Python 3.12 (64-bit) is required. Use a compatible interpreter; do not copy a venv from another computer.");
  const runtimeCheck = run(python, [resolve(root, "registration/src/runtime_support.py")], { stdio: "pipe", encoding: "utf8" });
  requireSuccess(runtimeCheck, "Could not identify Python platform.");
  const runtime = JSON.parse(runtimeCheck.stdout);
  if (!runtime.compatible) throw new Error(runtime.compatibilityError);
  if (runtime.profile === "mac-intel") console.log("Mac Intel profile: TensorFlow 2.16.2 and NumPy 1.26.4 (CPU).");
  requireSuccess(run(python, [resolve(root, "registration/src/check_environment.py"), "--resources-only"]),
    "Bundled resources are missing or corrupted. Update the repository before installing libraries.");
  if (!checkOnly) {
    console.log(`Installing scientific libraries with ${python}`);
    requireSuccess(run(python, ["-m", "pip", "install", "--upgrade", "pip"]), "Could not update pip.");
    requireSuccess(run(python, ["-m", "pip", "install", "-r", resolve(root, "registration/requirements-extraction.txt")]),
      "Library installation failed. Review the pip error above.");
    requireSuccess(run(python, ["-m", "pip", "check"]), "Python dependency conflicts detected.");
  }
  requireSuccess(run(python, [resolve(root, "registration/src/check_environment.py")]),
    "Environment verification failed. Review the missing dependency or resource above.");
  console.log("GameBrain is ready. Start the site with pnpm run dev --host 127.0.0.1 --port 5173");
} catch (error) {
  console.error(`\n[ERROR] ${error.message}`);
  process.exitCode = 1;
}
