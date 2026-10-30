import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createWriteStream, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { basename, dirname, extname, resolve } from "node:path";
import { env as processEnv } from "node:process";
import { fileURLToPath } from "node:url";

import type { Plugin } from "vite";

import {
  loadConnectivityExperiment,
  normalizeConnectivityExperiment,
  resolveAllenStructure,
  type AllenConnectivityExperiment,
} from "./allenApi";
import { isLocalApiRequest } from "./security";
type ImportStatus = "idle" | "uploading" | "running" | "completed" | "failed";
type ImportState = {
  status: ImportStatus;
  startedAt: string | null;
  finishedAt: string | null;
  message: string;
  logTail: string[];
  fileName: string | null;
};

type AllenRegistrationState = {
  status: "idle" | "running" | "completed" | "failed";
  startedAt: string | null;
  finishedAt: string | null;
  message: string;
  logTail: string[];
};

type ConnectivityState = {
  status: "idle" | "running" | "completed" | "failed";
  startedAt: string | null;
  finishedAt: string | null;
  message: string;
  logTail: string[];
  experimentId: number | null;
  metadata: AllenConnectivityExperiment | null;
};

type NativeConnectivityState = {
  status: "idle" | "running" | "completed" | "failed";
  message: string;
  logTail: string[];
};

export function importApi(): Plugin {
  const webRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const projectRoot = resolve(webRoot, "..");
  const python = resolve(projectRoot, ".venv-registration", "Scripts", "python.exe");
  const script = resolve(projectRoot, "registration", "src", "prepare_native_import.py");
  const registrationScript = resolve(projectRoot, "registration", "src", "map_allen_to_image.py");
  const nativeLabelsScript = resolve(projectRoot, "registration", "src", "export_native_labels_web.py");
  const connectivityScript = resolve(projectRoot, "registration", "src", "prepare_connectivity_experiment.py");
  const nativeConnectivityScript = resolve(projectRoot, "registration", "src", "map_connectivity_to_image.py");
  const importsRoot = resolve(projectRoot, "registration", "imports");
  const connectivityRoot = resolve(projectRoot, "registration", "connectivity");
  let process: ChildProcessWithoutNullStreams | null = null;
  let registrationProcess: ChildProcessWithoutNullStreams | null = null;
  let connectivityProcess: ChildProcessWithoutNullStreams | null = null;
  let nativeConnectivityProcess: ChildProcessWithoutNullStreams | null = null;
  let currentOutput: string | null = null;
  let currentConnectivityOutput: string | null = null;
  let state: ImportState = {
    status: "idle",
    startedAt: null,
    finishedAt: null,
    message: "Sélectionnez une image NIfTI",
    logTail: [],
    fileName: null,
  };
  let registrationState: AllenRegistrationState = {
    status: "idle",
    startedAt: null,
    finishedAt: null,
    message: "Le recalage Allen n'a pas encore été lancé",
    logTail: [],
  };
  let connectivityState: ConnectivityState = {
    status: "idle",
    startedAt: null,
    finishedAt: null,
    message: "Saisissez un identifiant d'expérience Allen",
    logTail: [],
    experimentId: null,
    metadata: null,
  };
  let nativeConnectivityState: NativeConnectivityState = {
    status: "idle",
    message: "Projetez la carte dans l'image importée",
    logTail: [],
  };

  const viewerManifest = () => {
    if (!currentOutput) return null;
    const path = resolve(currentOutput, "manifest.json");
    return existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : null;
  };

  const restoreLatestImport = () => {
    if (!existsSync(importsRoot)) return;
    const latest = readdirSync(importsRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => resolve(importsRoot, entry.name))
      .filter((path) => existsSync(resolve(path, "web", "manifest.json")))
      .sort((left, right) => statSync(right).mtimeMs - statSync(left).mtimeMs)[0];
    if (!latest) return;
    currentOutput = resolve(latest, "web");
    const manifest = resolve(currentOutput, "manifest.json");
    state = {
      status: "completed",
      startedAt: null,
      finishedAt: statSync(manifest).mtime.toISOString(),
      message: "Image prête dans le visualiseur",
      logTail: [],
      fileName: basename(latest).replace(/-\d{4}-\d{2}-\d{2}T.*$/, ""),
    };
  };
  restoreLatestImport();

  const restoreLatestRegistration = () => {
    if (!currentOutput) return;
    const manifest = resolve(currentOutput, "..", "registration", "registration_manifest.json");
    if (!existsSync(manifest)) return;
    registrationState = {
      status: "completed",
      startedAt: null,
      finishedAt: statSync(manifest).mtime.toISOString(),
      message: "Recalage Allen terminé",
      logTail: [],
    };
  };
  restoreLatestRegistration();

  const restoreLatestConnectivity = () => {
    if (!existsSync(connectivityRoot)) return;
    const latest = readdirSync(connectivityRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => resolve(connectivityRoot, entry.name, "web", "manifest.json"))
      .filter((path) => existsSync(path))
      .sort((left, right) => statSync(right).mtimeMs - statSync(left).mtimeMs)[0];
    if (!latest) return;
    const manifest = JSON.parse(readFileSync(latest, "utf8"));
    currentConnectivityOutput = dirname(latest);
    connectivityState = {
      status: "completed",
      startedAt: null,
      finishedAt: statSync(latest).mtime.toISOString(),
      message: `Expérience Allen ${manifest.experiment_id} prête`,
      logTail: [],
      experimentId: Number(manifest.experiment_id),
      metadata: null,
    };
    void loadConnectivityExperiment(connectivityState.experimentId)
      .then((metadata) => {
        if (connectivityState.experimentId === Number(manifest.experiment_id)) {
          connectivityState = { ...connectivityState, metadata };
        }
      })
      .catch(() => undefined);
  };
  restoreLatestConnectivity();

  const responsePayload = () => ({
    ...state,
    hasViewerAssets: Boolean(viewerManifest()),
    viewerManifest: viewerManifest(),
  });
  const nativeRegistrationManifest = () => currentOutput
    ? resolve(currentOutput, "..", "registration", "native-web", "manifest.json")
    : null;
  const reusableRegistration = (output: string) => {
    const labels = resolve(output, "allen_labels_in_input_space.nii.gz");
    const manifestPath = resolve(output, "registration_manifest.json");
    if (!existsSync(labels) || !existsSync(manifestPath)) return false;
    try {
      const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
      return manifest.transform_type === "antsRegistrationSyN[s]"
        && basename(manifest.template ?? "") === "registration_allen_ccf2017_100um.nii.gz";
    } catch {
      return false;
    }
  };
  const registrationResponsePayload = () => {
    const manifest = nativeRegistrationManifest();
    const registrationOutput = currentOutput ? resolve(currentOutput, "..", "registration") : null;
    const registrationManifest = registrationOutput
      ? resolve(registrationOutput, "registration_manifest.json")
      : null;
    const completedAssets = Boolean(
      !registrationProcess
      && registrationOutput
      && registrationManifest
      && manifest
      && reusableRegistration(registrationOutput)
      && existsSync(manifest)
      && statSync(manifest).mtimeMs >= statSync(registrationManifest).mtimeMs,
    );
    return {
      ...registrationState,
      ...(completedAssets && registrationState.status !== "running"
        ? {
            status: "completed" as const,
            finishedAt: statSync(manifest!).mtime.toISOString(),
            message: "Recalage Allen terminé",
            logTail: [],
          }
        : {}),
      hasNativeAssets: Boolean(manifest && existsSync(manifest)),
    };
  };
  const pushLog = (chunk: Buffer) => {
    const lines = chunk.toString("utf8").split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    state = { ...state, logTail: [...state.logTail, ...lines].slice(-8) };
  };
  const pushRegistrationLog = (chunk: Buffer) => {
    const lines = chunk.toString("utf8").split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    registrationState = {
      ...registrationState,
      logTail: [...registrationState.logTail, ...lines].slice(-12),
    };
  };
  const connectivityResponsePayload = () => {
    const manifestPath = currentConnectivityOutput
      ? resolve(currentConnectivityOutput, "manifest.json")
      : null;
    const nativeOutput = currentOutput && connectivityState.experimentId
      ? resolve(currentOutput, "..", "registration", "native-connectivity", String(connectivityState.experimentId), "web")
      : null;
    const nativeManifest = nativeOutput ? resolve(nativeOutput, "manifest.json") : null;
    return {
      ...connectivityState,
      hasViewerAssets: Boolean(manifestPath && existsSync(manifestPath)),
      viewerManifest: manifestPath && existsSync(manifestPath)
        ? JSON.parse(readFileSync(manifestPath, "utf8"))
        : null,
      nativeStatus: nativeConnectivityState.status,
      nativeMessage: nativeConnectivityState.message,
      nativeLogTail: nativeConnectivityState.logTail,
      hasNativeViewerAssets: Boolean(nativeManifest && existsSync(nativeManifest)),
      nativeViewerManifest: nativeManifest && existsSync(nativeManifest)
        ? JSON.parse(readFileSync(nativeManifest, "utf8"))
        : null,
    };
  };
  const pushConnectivityLog = (chunk: Buffer) => {
    const lines = chunk.toString("utf8").split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    connectivityState = {
      ...connectivityState,
      logTail: [...connectivityState.logTail, ...lines].slice(-10),
    };
  };
  const start = (input: string, output: string, fileName: string) => {
    if (process) return;
    const missing = [python, script, input].find((path) => !existsSync(path));
    if (missing) {
      state = { ...state, status: "failed", finishedAt: new Date().toISOString(), message: `Fichier manquant : ${missing}` };
      return;
    }
    state = {
      status: "running",
      startedAt: new Date().toISOString(),
      finishedAt: null,
      message: "Extraction du cerveau et préparation de l'image",
      logTail: ["Extraction cérébrale en cours"],
      fileName,
    };
    registrationState = {
      status: "idle",
      startedAt: null,
      finishedAt: null,
      message: "Le recalage Allen n'a pas encore été lancé",
      logTail: [],
    };
    process = spawn(python, [script, "--input", input, "--output", output], {
      cwd: projectRoot,
      env: { ...processEnv, PYTHONUTF8: "1", PYTHONIOENCODING: "utf-8" },
      windowsHide: true,
    });
    process.stdout.on("data", pushLog);
    process.stderr.on("data", pushLog);
    process.on("error", (error) => {
      state = { ...state, status: "failed", finishedAt: new Date().toISOString(), message: error.message };
      process = null;
    });
    process.on("close", (code) => {
      const succeeded = code === 0 && existsSync(resolve(output, "manifest.json"));
      if (succeeded) currentOutput = output;
      const lastLogLine = state.logTail[state.logTail.length - 1];
      state = {
        ...state,
        status: succeeded ? "completed" : "failed",
        finishedAt: new Date().toISOString(),
        message: succeeded
          ? "Image prête dans le visualiseur"
          : lastLogLine || `L'import s'est arrêté avec le code ${code ?? "inconnu"}`,
      };
      process = null;
    });
  };

  return {
    name: "gamebrain-import-api",
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        if (request.url?.startsWith("/api/") && !isLocalApiRequest(request)) {
          response.statusCode = 403;
          response.setHeader("Content-Type", "application/json; charset=utf-8");
          response.end(JSON.stringify({ message: "API locale uniquement" }));
          return;
        }
        if (request.url === "/api/import/status" && request.method === "GET") {
          response.setHeader("Content-Type", "application/json; charset=utf-8");
          response.end(JSON.stringify(responsePayload()));
          return;
        }
        if (request.url === "/api/allen-registration/status" && request.method === "GET") {
          response.setHeader("Content-Type", "application/json; charset=utf-8");
          response.end(JSON.stringify(registrationResponsePayload()));
          return;
        }
        if (request.url === "/api/connectivity/status" && request.method === "GET") {
          response.setHeader("Content-Type", "application/json; charset=utf-8");
          response.end(JSON.stringify(connectivityResponsePayload()));
          return;
        }
        if (request.url === "/api/session" && request.method === "DELETE") {
          response.setHeader("Content-Type", "application/json; charset=utf-8");
          if (process || registrationProcess || connectivityProcess || nativeConnectivityProcess) {
            response.statusCode = 409;
            response.end(JSON.stringify({
              ok: false,
              message: "Un traitement est en cours. Attendez sa fin avant de tout réinitialiser.",
            }));
            return;
          }
          const registrationRoot = resolve(projectRoot, "registration");
          const safeRoots = [resolve(importsRoot), resolve(connectivityRoot)];
          if (safeRoots.some((path) => !path.toLocaleLowerCase().startsWith(`${registrationRoot.toLocaleLowerCase()}\\`))) {
            response.statusCode = 500;
            response.end(JSON.stringify({ ok: false, message: "Chemin de réinitialisation invalide" }));
            return;
          }
          for (const path of safeRoots) {
            rmSync(path, { recursive: true, force: true });
            mkdirSync(path, { recursive: true });
          }
          currentOutput = null;
          currentConnectivityOutput = null;
          state = {
            status: "idle",
            startedAt: null,
            finishedAt: null,
            message: "Sélectionnez une image NIfTI",
            logTail: [],
            fileName: null,
          };
          registrationState = {
            status: "idle",
            startedAt: null,
            finishedAt: null,
            message: "Le recalage Allen n'a pas encore été lancé",
            logTail: [],
          };
          connectivityState = {
            status: "idle",
            startedAt: null,
            finishedAt: null,
            message: "Saisissez un identifiant d'expérience Allen",
            logTail: [],
            experimentId: null,
            metadata: null,
          };
          nativeConnectivityState = {
            status: "idle",
            message: "Projetez la carte dans l'image importée",
            logTail: [],
          };
          response.end(JSON.stringify({ ok: true, message: "Session entièrement réinitialisée" }));
          return;
        }
        if (request.url?.startsWith("/api/connectivity/search") && request.method === "GET") {
          const url = new URL(request.url, "http://localhost");
          const structure = url.searchParams.get("structure")?.trim() ?? "";
          response.setHeader("Content-Type", "application/json; charset=utf-8");
          if (!structure || structure.length > 80 || !/^[\p{L}\p{N} .,'()_/-]+$/u.test(structure)) {
            response.statusCode = 400;
            response.end(JSON.stringify({
              message: "Saisissez un nom, un acronyme ou un identifiant de région Allen valide",
              results: [],
              total: 0,
            }));
            return;
          }
          void (async () => {
            try {
              const resolvedStructure = await resolveAllenStructure(structure);
              const allenUrl = "https://api.brain-map.org/api/v2/data/ApiConnectivity/query.json"
                + `?criteria=[structure_id$eq${resolvedStructure.id}]`
                + "&num_rows=24";
              const allenResponse = await fetch(allenUrl, {
                headers: { Accept: "application/json" },
                signal: AbortSignal.timeout(20_000),
              });
              if (!allenResponse.ok) {
                throw new Error(`Allen API: ${allenResponse.status}`);
              }
              const payload = await allenResponse.json() as {
                success?: boolean;
                msg?: unknown;
                total_rows?: number;
              };
              if (payload.success === false || !Array.isArray(payload.msg)) {
                throw new Error(
                  typeof payload.msg === "string" ? payload.msg : "Réponse Allen invalide",
                );
              }
              const results = payload.msg
                .map((item) => normalizeConnectivityExperiment(item, resolvedStructure))
                .filter((item): item is AllenConnectivityExperiment => item !== null)
                .slice(0, 24);
              response.end(JSON.stringify({
                message: results.length > 0
                  ? `${results.length} expériences trouvées pour ${resolvedStructure.acronym}`
                  : `Aucune expérience trouvée pour ${resolvedStructure.acronym}`,
                structure: resolvedStructure,
                results,
                total: Number(payload.total_rows) || results.length,
              }));
            } catch (error) {
              response.statusCode = 502;
              response.end(JSON.stringify({
                message: error instanceof Error
                  ? `Recherche Allen indisponible : ${error.message}`
                  : "Recherche Allen indisponible",
                results: [],
                total: 0,
              }));
            }
          })();
          return;
        }
        if (request.url === "/api/connectivity/start" && request.method === "POST") {
          if (connectivityProcess) {
            response.statusCode = 409;
            response.setHeader("Content-Type", "application/json; charset=utf-8");
            response.end(JSON.stringify(connectivityResponsePayload()));
            return;
          }
          const rawId = request.headers["x-experiment-id"];
          const experimentId = Number(Array.isArray(rawId) ? rawId[0] : rawId);
          if (!Number.isSafeInteger(experimentId) || experimentId <= 0) {
            response.statusCode = 400;
            response.setHeader("Content-Type", "application/json; charset=utf-8");
            response.end(JSON.stringify({
              ...connectivityResponsePayload(),
              status: "failed",
              message: "Identifiant d'expérience Allen invalide",
            }));
            return;
          }
          const output = resolve(connectivityRoot, String(experimentId));
          const missing = [python, connectivityScript].find((path) => !existsSync(path));
          if (missing) {
            connectivityState = {
              status: "failed",
              startedAt: null,
              finishedAt: new Date().toISOString(),
              message: `Fichier manquant : ${missing}`,
              logTail: [],
              experimentId,
              metadata: null,
            };
            response.statusCode = 500;
            response.setHeader("Content-Type", "application/json; charset=utf-8");
            response.end(JSON.stringify(connectivityResponsePayload()));
            return;
          }
          connectivityState = {
            status: "running",
            startedAt: new Date().toISOString(),
            finishedAt: null,
            message: `Chargement de l'expérience Allen ${experimentId}`,
            logTail: ["Téléchargement des cartes de projection et d'injection"],
            experimentId,
            metadata: null,
          };
          void loadConnectivityExperiment(experimentId)
            .then((metadata) => {
              if (connectivityState.experimentId === experimentId) {
                connectivityState = { ...connectivityState, metadata };
              }
            })
            .catch(() => undefined);
          nativeConnectivityState = {
            status: "idle",
            message: "Projetez la carte dans l'image importée",
            logTail: [],
          };
          currentConnectivityOutput = null;
          connectivityProcess = spawn(
            python,
            [
              connectivityScript,
              "--experiment-id",
              String(experimentId),
              "--resolution",
              "50",
              "--output",
              output,
            ],
            {
              cwd: projectRoot,
              env: { ...processEnv, PYTHONUTF8: "1", PYTHONIOENCODING: "utf-8" },
              windowsHide: true,
            },
          );
          connectivityProcess.stdout.on("data", pushConnectivityLog);
          connectivityProcess.stderr.on("data", pushConnectivityLog);
          connectivityProcess.on("error", (error) => {
            connectivityState = {
              ...connectivityState,
              status: "failed",
              finishedAt: new Date().toISOString(),
              message: error.message,
            };
            connectivityProcess = null;
          });
          connectivityProcess.on("close", (code) => {
            const webOutput = resolve(output, "web");
            const manifest = resolve(webOutput, "manifest.json");
            const succeeded = code === 0 && existsSync(manifest);
            if (succeeded) currentConnectivityOutput = webOutput;
            const lastLogLine = connectivityState.logTail[connectivityState.logTail.length - 1];
            connectivityState = {
              ...connectivityState,
              status: succeeded ? "completed" : "failed",
              finishedAt: new Date().toISOString(),
              message: succeeded
                ? `Expérience Allen ${experimentId} prête`
                : lastLogLine || `Le chargement s'est arrêté avec le code ${code ?? "inconnu"}`,
            };
            connectivityProcess = null;
          });
          response.statusCode = 202;
          response.setHeader("Content-Type", "application/json; charset=utf-8");
          response.end(JSON.stringify(connectivityResponsePayload()));
          return;
        }
        if (request.url === "/api/connectivity/native/start" && request.method === "POST") {
          response.setHeader("Content-Type", "application/json; charset=utf-8");
          if (nativeConnectivityProcess) {
            response.statusCode = 409;
            response.end(JSON.stringify(connectivityResponsePayload()));
            return;
          }
          if (!currentOutput || !connectivityState.experimentId || !currentConnectivityOutput) {
            response.statusCode = 400;
            response.end(JSON.stringify({ ...connectivityResponsePayload(), nativeMessage: "Importez et recalez une image, puis chargez une expérience" }));
            return;
          }
          const registration = resolve(currentOutput, "..", "registration");
          const output = resolve(registration, "native-connectivity", String(connectivityState.experimentId));
          const missing = [python, nativeConnectivityScript, resolve(registration, "registration_manifest.json")]
            .find((path) => !existsSync(path));
          if (missing) {
            response.statusCode = 400;
            nativeConnectivityState = { status: "failed", message: `Fichier manquant : ${missing}`, logTail: [] };
            response.end(JSON.stringify(connectivityResponsePayload()));
            return;
          }
          nativeConnectivityState = { status: "running", message: "Projection de la connectivité vers l'image", logTail: [] };
          nativeConnectivityProcess = spawn(python, [
            nativeConnectivityScript,
            "--registration", registration,
            "--connectivity", resolve(currentConnectivityOutput, ".."),
            "--output", output,
          ], {
            cwd: projectRoot,
            env: { ...processEnv, PYTHONUTF8: "1", PYTHONIOENCODING: "utf-8" },
            windowsHide: true,
          });
          const pushNativeLog = (chunk: Buffer) => {
            const lines = chunk.toString("utf8").split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
            nativeConnectivityState.logTail = [...nativeConnectivityState.logTail, ...lines].slice(-10);
          };
          nativeConnectivityProcess.stdout.on("data", pushNativeLog);
          nativeConnectivityProcess.stderr.on("data", pushNativeLog);
          nativeConnectivityProcess.on("error", (error) => {
            nativeConnectivityState = { status: "failed", message: error.message, logTail: nativeConnectivityState.logTail };
            nativeConnectivityProcess = null;
          });
          nativeConnectivityProcess.on("close", (code) => {
            const succeeded = code === 0 && existsSync(resolve(output, "web", "manifest.json"));
            nativeConnectivityState = {
              status: succeeded ? "completed" : "failed",
              message: succeeded ? "Connectivité prête dans l'image importée" : nativeConnectivityState.logTail.at(-1) ?? "Projection native interrompue",
              logTail: nativeConnectivityState.logTail,
            };
            nativeConnectivityProcess = null;
          });
          response.statusCode = 202;
          response.end(JSON.stringify(connectivityResponsePayload()));
          return;
        }
        if (request.url === "/api/allen-registration/start" && request.method === "POST") {
          if (!currentOutput) {
            response.statusCode = 400;
            response.setHeader("Content-Type", "application/json; charset=utf-8");
            response.end(JSON.stringify({ ...registrationResponsePayload(), status: "failed", message: "Importez d'abord une image" }));
            return;
          }
          if (process || registrationProcess) {
            response.statusCode = 409;
            response.setHeader("Content-Type", "application/json; charset=utf-8");
            response.end(JSON.stringify({ ...registrationResponsePayload(), message: "Un traitement est déjà en cours" }));
            return;
          }
          const job = resolve(currentOutput, "..");
          const brain = resolve(job, "extraction", "brain_extracted.nii.gz");
          const output = resolve(job, "registration");
          const existingLabels = resolve(output, "allen_labels_in_input_space.nii.gz");
          const exportOnly = reusableRegistration(output) && !existsSync(resolve(output, "native-web", "manifest.json"));
          const missing = [python, exportOnly ? nativeLabelsScript : registrationScript, exportOnly ? existingLabels : brain]
            .find((path) => !existsSync(path));
          if (missing) {
            registrationState = {
              ...registrationState,
              status: "failed",
              finishedAt: new Date().toISOString(),
              message: `Fichier manquant : ${missing}`,
            };
            response.statusCode = 500;
            response.setHeader("Content-Type", "application/json; charset=utf-8");
            response.end(JSON.stringify(registrationResponsePayload()));
            return;
          }
          registrationState = {
            status: "running",
            startedAt: new Date().toISOString(),
            finishedAt: null,
            message: exportOnly ? "Préparation des régions recalées" : "Recalage complet de la souris vers Allen",
            logTail: [exportOnly ? "Conversion des labels natifs" : "Préparation du recalage SyN complet"],
          };
          const command = exportOnly
            ? [
                nativeLabelsScript,
                "--labels",
                existingLabels,
                "--output",
                resolve(output, "native-web"),
              ]
            : [
                registrationScript,
                "--input",
                brain,
                "--output",
                output,
                "--brain-extracted",
                "--force",
              ];
          registrationProcess = spawn(
            python,
            command,
            {
              cwd: projectRoot,
              env: { ...processEnv, PYTHONUTF8: "1", PYTHONIOENCODING: "utf-8" },
              windowsHide: true,
            },
          );
          registrationProcess.stdout.on("data", pushRegistrationLog);
          registrationProcess.stderr.on("data", pushRegistrationLog);
          registrationProcess.on("error", (error) => {
            registrationState = {
              ...registrationState,
              status: "failed",
              finishedAt: new Date().toISOString(),
              message: error.message,
            };
            registrationProcess = null;
          });
          registrationProcess.on("close", (code) => {
            const manifest = resolve(output, "registration_manifest.json");
            const nativeManifest = resolve(output, "native-web", "manifest.json");
            const succeeded = code === 0 && existsSync(manifest) && existsSync(nativeManifest);
            const lastLogLine = registrationState.logTail[registrationState.logTail.length - 1];
            registrationState = {
              ...registrationState,
              status: succeeded ? "completed" : "failed",
              finishedAt: new Date().toISOString(),
              message: succeeded
                ? "Recalage Allen terminé"
                : lastLogLine || `Le recalage s'est arrêté avec le code ${code ?? "inconnu"}`,
            };
            registrationProcess = null;
          });
          response.statusCode = 202;
          response.setHeader("Content-Type", "application/json; charset=utf-8");
          response.end(JSON.stringify(registrationResponsePayload()));
          return;
        }
        if (request.url === "/api/import/start" && request.method === "POST") {
          if (process || registrationProcess || state.status === "uploading") {
            response.statusCode = 409;
            response.setHeader("Content-Type", "application/json; charset=utf-8");
            response.end(JSON.stringify(responsePayload()));
            return;
          }
          const encodedName = request.headers["x-file-name"];
          const requestedName = typeof encodedName === "string" ? decodeURIComponent(encodedName) : "";
          const fileName = basename(requestedName);
          const lowerName = fileName.toLocaleLowerCase();
          if (!fileName || (!lowerName.endsWith(".nii") && !lowerName.endsWith(".nii.gz"))) {
            response.statusCode = 400;
            response.setHeader("Content-Type", "application/json; charset=utf-8");
            response.end(JSON.stringify({ ...responsePayload(), status: "failed", message: "Format attendu : .nii ou .nii.gz" }));
            return;
          }
          const stamp = new Date().toISOString().replace(/[:.]/g, "-");
          const extension = lowerName.endsWith(".nii.gz") ? ".nii.gz" : extname(fileName);
          const stem = fileName.slice(0, -extension.length).replace(/[^a-zA-Z0-9_-]+/g, "-");
          const job = resolve(importsRoot, `${stem || "image"}-${stamp}`);
          const input = resolve(job, `input${extension}`);
          const output = resolve(job, "web");
          mkdirSync(job, { recursive: true });
          state = {
            status: "uploading",
            startedAt: new Date().toISOString(),
            finishedAt: null,
            message: "Import de l'image",
            logTail: [],
            fileName,
          };
          const destination = createWriteStream(input, { flags: "wx" });
          request.pipe(destination);
          destination.on("finish", () => {
            start(input, output, fileName);
            response.statusCode = state.status === "failed" ? 500 : 202;
            response.setHeader("Content-Type", "application/json; charset=utf-8");
            response.end(JSON.stringify(responsePayload()));
          });
          destination.on("error", (error) => {
            state = { ...state, status: "failed", finishedAt: new Date().toISOString(), message: error.message };
            if (!response.headersSent) {
              response.statusCode = 500;
              response.setHeader("Content-Type", "application/json; charset=utf-8");
              response.end(JSON.stringify(responsePayload()));
            }
          });
          return;
        }
        if (request.url === "/api/import/current" && request.method === "DELETE") {
          if (process || registrationProcess || state.status === "uploading" || state.status === "running") {
            response.statusCode = 409;
            response.setHeader("Content-Type", "application/json; charset=utf-8");
            response.end(JSON.stringify({ ...responsePayload(), message: "Une extraction est en cours" }));
            return;
          }
          if (currentOutput) {
            const job = resolve(currentOutput, "..");
            const importsPrefix = `${resolve(importsRoot).toLocaleLowerCase()}\\`;
            if (!job.toLocaleLowerCase().startsWith(importsPrefix)) {
              response.statusCode = 400;
              response.setHeader("Content-Type", "application/json; charset=utf-8");
              response.end(JSON.stringify({ ...responsePayload(), message: "Chemin d'import invalide" }));
              return;
            }
            rmSync(job, { recursive: true, force: true });
          }
          currentOutput = null;
          state = {
            status: "idle",
            startedAt: null,
            finishedAt: null,
            message: "Sélectionnez une image NIfTI",
            logTail: [],
            fileName: null,
          };
          registrationState = {
            status: "idle",
            startedAt: null,
            finishedAt: null,
            message: "Le recalage Allen n'a pas encore été lancé",
            logTail: [],
          };
          response.setHeader("Content-Type", "application/json; charset=utf-8");
          response.end(JSON.stringify(responsePayload()));
          return;
        }
        if (request.url?.startsWith("/api/allen-registration/viewer/") && request.method === "GET") {
          if (!currentOutput) {
            response.statusCode = 404;
            response.end("Annotations indisponibles");
            return;
          }
          const pathname = new URL(request.url, "http://localhost").pathname;
          const asset = pathname.slice("/api/allen-registration/viewer/".length);
          const valid = /^(?:masks|outlines)\/(coronal|sagittal|axial)\/(coronal|sagittal|axial)-\d{3,4}\.(?:png|webp)$/.test(asset)
            || /^regions\/\d+\.glb$/.test(asset);
          const path = resolve(currentOutput, "..", "registration", "native-web", asset);
          if (!valid || !existsSync(path)) {
            response.statusCode = 404;
            response.end("Annotation indisponible");
            return;
          }
          response.setHeader(
            "Content-Type",
            asset.endsWith(".glb")
              ? "model/gltf-binary"
              : asset.endsWith(".png")
                ? "image/png"
                : "image/webp",
          );
          response.setHeader("Cache-Control", "no-store");
          response.end(readFileSync(path));
          return;
        }
        if (request.url?.startsWith("/api/import/viewer/") && request.method === "GET") {
          if (!currentOutput) {
            response.statusCode = 404;
            response.end("Visualisation indisponible");
            return;
          }
          const pathname = new URL(request.url, "http://localhost").pathname;
          const asset = pathname.slice("/api/import/viewer/".length);
          const valid = asset === "subject.glb" || /^(?:slices(?:-3d)?|mask-outline)\/(coronal|sagittal|axial)\/(coronal|sagittal|axial)-\d{3,4}\.webp$/.test(asset);
          const path = resolve(currentOutput, asset);
          if (!valid || !existsSync(path)) {
            response.statusCode = 404;
            response.end("Ressource indisponible");
            return;
          }
          response.setHeader("Content-Type", asset.endsWith(".glb") ? "model/gltf-binary" : "image/webp");
          response.setHeader("Cache-Control", "no-store");
          response.end(readFileSync(path));
          return;
        }
        if (request.url?.startsWith("/api/connectivity/viewer/") && request.method === "GET") {
          if (!currentConnectivityOutput) {
            response.statusCode = 404;
            response.end("Carte de connectivité indisponible");
            return;
          }
          const pathname = new URL(request.url, "http://localhost").pathname;
          const asset = pathname.slice("/api/connectivity/viewer/".length);
          const valid =
            /^overlays\/(projection|injection)\/(coronal|sagittal|axial)\/(coronal|sagittal|axial)-\d{3,4}\.webp$/.test(asset) ||
            /^point-clouds\/(projection|injection)\.bin$/.test(asset) ||
            /^volumes\/(projection|injection)\.bin$/.test(asset);
          const path = resolve(currentConnectivityOutput, asset);
          if (!valid || !existsSync(path)) {
            response.statusCode = 404;
            response.end("Carte de connectivité indisponible");
            return;
          }
          response.setHeader(
            "Content-Type",
            asset.endsWith(".bin") ? "application/octet-stream" : "image/webp",
          );
          response.setHeader("Cache-Control", "no-store");
          response.end(readFileSync(path));
          return;
        }
        if (request.url?.startsWith("/api/connectivity/native-viewer/") && request.method === "GET") {
          if (!currentOutput || !connectivityState.experimentId) {
            response.statusCode = 404;
            response.end("Connectivité native indisponible");
            return;
          }
          const pathname = new URL(request.url, "http://localhost").pathname;
          const asset = pathname.slice("/api/connectivity/native-viewer/".length);
          const valid = /^overlays\/(projection|injection)\/(coronal|sagittal|axial)\/(coronal|sagittal|axial)-\d{3,4}\.webp$/.test(asset)
            || /^volumes\/(projection|injection)\.bin$/.test(asset);
          const path = resolve(currentOutput, "..", "registration", "native-connectivity", String(connectivityState.experimentId), "web", asset);
          if (!valid || !existsSync(path)) {
            response.statusCode = 404;
            response.end("Connectivité native indisponible");
            return;
          }
          response.setHeader("Content-Type", asset.endsWith(".bin") ? "application/octet-stream" : "image/webp");
          response.setHeader("Cache-Control", "no-store");
          response.end(readFileSync(path));
          return;
        }
        next();
      });
    },
  };
}

