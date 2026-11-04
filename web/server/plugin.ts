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
  const nativeRegionWorkerScript = resolve(projectRoot, "registration", "src", "native_region_worker.py");
  const connectivityScript = resolve(projectRoot, "registration", "src", "prepare_connectivity_experiment.py");
  const nativeConnectivityScript = resolve(projectRoot, "registration", "src", "map_connectivity_to_image.py");
  const modalityImportScript = resolve(projectRoot, "registration", "src", "prepare_modality_import.py");
  const regionStatisticsScript = resolve(projectRoot, "registration", "src", "compute_region_statistics.py");
  const regionStatisticsExportScript = resolve(projectRoot, "registration", "src", "export_region_statistics.py");
  const importsRoot = resolve(projectRoot, "registration", "imports");
  const connectivityRoot = resolve(projectRoot, "registration", "connectivity");
  let process: ChildProcessWithoutNullStreams | null = null;
  let registrationProcess: ChildProcessWithoutNullStreams | null = null;
  let connectivityProcess: ChildProcessWithoutNullStreams | null = null;
  let nativeConnectivityProcess: ChildProcessWithoutNullStreams | null = null;
  let modalityProcess: ChildProcessWithoutNullStreams | null = null;
  let currentOutput: string | null = null;
  let currentConnectivityOutput: string | null = null;
  let nativeRegionQueue: Promise<unknown> = Promise.resolve();
  const nativeRegionJobs = new Map<string, Promise<boolean>>();
  let nativeRegionWorker: ChildProcessWithoutNullStreams | null = null;
  let nativeRegionWorkerKey = "";
  let nativeRegionWorkerBuffer = "";
  const nativeRegionPending = new Map<string, (success: boolean) => void>();
  const nativePickPending = new Map<string, (regionId: number | null) => void>();
  let nativePickSequence = 0;
  const stopNativeRegionWorker = async () => {
    const worker = nativeRegionWorker;
    nativeRegionWorker = null;
    nativeRegionWorkerKey = "";
    nativeRegionWorkerBuffer = "";
    for (const resolvePending of nativeRegionPending.values()) resolvePending(false);
    nativeRegionPending.clear();
    for (const resolvePending of nativePickPending.values()) resolvePending(null);
    nativePickPending.clear();
    if (!worker || worker.exitCode !== null) return;
    await new Promise<void>((resolveStopped) => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        resolveStopped();
      };
      worker.once("close", finish);
      worker.kill();
      setTimeout(finish, 2_000);
    });
  };

  const clearDirectory = (directory: string) => {
    mkdirSync(directory, { recursive: true });
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      rmSync(resolve(directory, entry.name), {
        recursive: entry.isDirectory(),
        force: true,
        maxRetries: 5,
        retryDelay: 150,
      });
    }
  };
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
  let modalityStatus: "idle" | "uploading" | "completed" | "failed" = "idle";
  let modalityMessage = "Importez une modalité NIfTI 3D";

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

  const startNativeRegionWorker = (
    labels: string,
    volumeCache: string,
    outputDir: string,
  ) => {
    const workerKey = `${labels}|${volumeCache}|${outputDir}`;
    if (nativeRegionWorker && nativeRegionWorkerKey === workerKey) {
      return nativeRegionWorker;
    }
    nativeRegionWorker?.kill();
    for (const resolvePending of nativeRegionPending.values()) resolvePending(false);
    nativeRegionPending.clear();
    nativeRegionWorkerKey = workerKey;
    nativeRegionWorkerBuffer = "";
    nativeRegionWorker = spawn(
      python,
      [
        nativeRegionWorkerScript,
        "--labels",
        labels,
        "--volume-cache",
        volumeCache,
        "--output-dir",
        outputDir,
      ],
      {
        cwd: projectRoot,
        env: { ...processEnv, PYTHONUTF8: "1", PYTHONIOENCODING: "utf-8" },
        windowsHide: true,
      },
    );
    nativeRegionWorker.stdout.on("data", (chunk: Buffer) => {
      nativeRegionWorkerBuffer += chunk.toString("utf8");
      const lines = nativeRegionWorkerBuffer.split(/\r?\n/);
      nativeRegionWorkerBuffer = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const message = JSON.parse(line) as {
            requestId?: string;
            regionId?: number;
            ok?: boolean;
          };
          if (message.requestId !== undefined) {
            nativePickPending.get(message.requestId)?.(
              message.ok && message.regionId !== undefined && message.regionId > 0
                ? message.regionId
                : null,
            );
            nativePickPending.delete(message.requestId);
            continue;
          }
          if (message.regionId === undefined) continue;
          const key = String(message.regionId);
          nativeRegionPending.get(key)?.(Boolean(message.ok));
          nativeRegionPending.delete(key);
        } catch {
          // Ignore non-protocol output from scientific libraries.
        }
      }
    });
    const stopWorker = () => {
      for (const resolvePending of nativeRegionPending.values()) resolvePending(false);
      nativeRegionPending.clear();
      for (const resolvePending of nativePickPending.values()) resolvePending(null);
      nativePickPending.clear();
      nativeRegionWorker = null;
      nativeRegionWorkerKey = "";
    };
    nativeRegionWorker.on("error", stopWorker);
    nativeRegionWorker.on("close", stopWorker);
    return nativeRegionWorker;
  };

  const warmCurrentNativeRegionWorker = () => {
    if (!currentOutput) return;
    const registrationOutput = resolve(currentOutput, "..", "registration");
    const labels = resolve(registrationOutput, "allen_labels_in_input_space.nii.gz");
    const nativeWeb = resolve(registrationOutput, "native-web");
    const volumeCache = resolve(nativeWeb, "detailed-labels.npy");
    if (
      existsSync(labels)
      && existsSync(volumeCache)
      && existsSync(nativeRegionWorkerScript)
    ) {
      startNativeRegionWorker(labels, volumeCache, resolve(nativeWeb, "detailed-regions"));
    }
  };

  const ensureNativeRegionMesh = (
    labels: string,
    volumeCache: string,
    regionId: string,
    output: string,
  ) => {
    if (existsSync(output)) return Promise.resolve(true);
    const existing = nativeRegionJobs.get(output);
    if (existing) return existing;

    const job = nativeRegionQueue.then(() => new Promise<boolean>((resolveJob) => {
      if (existsSync(output)) {
        resolveJob(true);
        return;
      }
      const outputDir = dirname(output);
      const worker = startNativeRegionWorker(labels, volumeCache, outputDir);
      nativeRegionPending.set(regionId, (success) => resolveJob(success && existsSync(output)));
      worker.stdin.write(`${regionId}\n`);
    }));
    nativeRegionQueue = job.catch(() => false);
    nativeRegionJobs.set(output, job);
    void job.finally(() => nativeRegionJobs.delete(output));
    return job;
  };

  const pickNativeRegion = (
    point: [number, number, number],
    direction: [number, number, number],
  ) => {
    if (!currentOutput) return Promise.resolve<number | null>(null);
    const registrationOutput = resolve(currentOutput, "..", "registration");
    const labels = resolve(registrationOutput, "allen_labels_in_input_space.nii.gz");
    const nativeWeb = resolve(registrationOutput, "native-web");
    const volumeCache = resolve(nativeWeb, "detailed-labels.npy");
    if (!existsSync(labels) || !existsSync(volumeCache)) {
      return Promise.resolve<number | null>(null);
    }
    const worker = startNativeRegionWorker(labels, volumeCache, resolve(nativeWeb, "detailed-regions"));
    const requestId = `pick-${++nativePickSequence}`;
    return new Promise<number | null>((resolvePick) => {
      const timeout = setTimeout(() => {
        nativePickPending.delete(requestId);
        resolvePick(null);
      }, 3000);
      nativePickPending.set(requestId, (regionId) => {
        clearTimeout(timeout);
        resolvePick(regionId);
      });
      worker.stdin.write(`${JSON.stringify({ requestId, point, direction })}\n`);
    });
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
  const modalityRoot = () => currentOutput ? resolve(currentOutput, "..", "modalities") : null;
  const modalityBinaryCache = new Map<string, {
    values: Float32Array;
    mask: Uint8Array;
    shape: [number, number, number];
  }>();
  const modalitySlice = (root: string, id: string, plane: string, index: number) => {
    const directory = resolve(root, id);
    let cached = modalityBinaryCache.get(directory);
    if (!cached) {
      const manifest = JSON.parse(readFileSync(resolve(directory, "manifest.json"), "utf8"));
      const valueBuffer = readFileSync(resolve(directory, "volume.float32"));
      const maskBuffer = readFileSync(resolve(directory, "brain-mask.uint8"));
      cached = {
        values: new Float32Array(
          valueBuffer.buffer,
          valueBuffer.byteOffset,
          valueBuffer.byteLength / Float32Array.BYTES_PER_ELEMENT,
        ),
        mask: new Uint8Array(maskBuffer.buffer, maskBuffer.byteOffset, maskBuffer.byteLength),
        shape: manifest.volume_shape,
      };
      modalityBinaryCache.set(directory, cached);
    }
    const [axis0, axis1, axis2] = cached.shape;
    const count = plane === "coronal" ? axis0 : plane === "sagittal" ? axis2 : axis1;
    if (!Number.isInteger(index) || index < 0 || index >= count) return null;
    const width = plane === "sagittal" ? axis0 : axis2;
    const height = plane === "coronal" ? axis1 : plane === "sagittal" ? axis1 : axis0;
    const values = new Float32Array(width * height);
    const mask = new Uint8Array(width * height);
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const a = plane === "coronal" ? index : plane === "sagittal" ? axis0 - 1 - x : y;
        const b = plane === "axial" ? index : y;
        const c = plane === "sagittal" ? index : x;
        const source = (a * axis1 + b) * axis2 + c;
        const target = y * width + x;
        values[target] = cached.values[source];
        mask[target] = cached.mask[source];
      }
    }
    return {
      bytes: Buffer.concat([
        Buffer.from(values.buffer, values.byteOffset, values.byteLength),
        Buffer.from(mask.buffer, mask.byteOffset, mask.byteLength),
      ]),
      width,
      height,
    };
  };
  const currentRareInput = () => {
    if (!currentOutput) return null;
    const job = resolve(currentOutput, "..");
    return [resolve(job, "input.nii.gz"), resolve(job, "input.nii")]
      .find((path) => existsSync(path)) ?? null;
  };
  const modalityRecords = () => {
    const root = modalityRoot();
    if (!root || !existsSync(root)) return [];
    return readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && /^[a-zA-Z0-9_-]+$/.test(entry.name))
      .map((entry) => {
        const manifestPath = resolve(root, entry.name, "manifest.json");
        if (!existsSync(manifestPath)) return null;
        const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
        return {
          id: entry.name,
          name: String(manifest.name),
          sourceFile: String(manifest.source_file),
          geometryStatus: manifest.geometry_status,
          shape: manifest.shape,
          spacingMm: manifest.spacing_mm,
          sourceShape: manifest.source_shape,
          sourceSpacingMm: manifest.source_spacing_mm,
          finiteVoxels: Number(manifest.finite_voxels),
          nonzeroVoxels: Number(manifest.nonzero_voxels),
          valueRange: manifest.value_range,
          percentiles: manifest.percentiles,
          sliceCounts: manifest.slice_counts,
          volumeShape: manifest.volume_shape,
        };
      })
      .filter(Boolean);
  };
  const modalityResponsePayload = () => ({
    status: modalityStatus,
    message: modalityMessage,
    modalities: modalityRecords(),
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
    const nativeManifest = manifest && existsSync(manifest)
      ? JSON.parse(readFileSync(manifest, "utf8"))
      : null;
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
      nativeRegionIds: Array.isArray(nativeManifest?.available_regions)
        ? nativeManifest.available_regions
        : [],
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
      warmCurrentNativeRegionWorker();
      server.middlewares.use(async (request, response, next) => {
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
        if (request.url === "/api/modalities/status" && request.method === "GET") {
          response.setHeader("Content-Type", "application/json; charset=utf-8");
          response.end(JSON.stringify(modalityResponsePayload()));
          return;
        }
        if (request.url === "/api/modalities/import" && request.method === "POST") {
          const rareInput = currentRareInput();
          const brainMask = currentOutput
            ? resolve(currentOutput, "..", "extraction", "brain_mask.nii.gz")
            : null;
          if (!currentOutput || !rareInput || !brainMask || !existsSync(brainMask)) {
            response.statusCode = 409;
            response.setHeader("Content-Type", "application/json; charset=utf-8");
            response.end(JSON.stringify({ ...modalityResponsePayload(), status: "failed", message: "Importez d'abord une RARE" }));
            return;
          }
          if (modalityProcess || process || registrationProcess) {
            response.statusCode = 409;
            response.setHeader("Content-Type", "application/json; charset=utf-8");
            response.end(JSON.stringify({ ...modalityResponsePayload(), message: "Un traitement est déjà en cours" }));
            return;
          }
          const encodedFileName = request.headers["x-file-name"];
          const encodedModalityName = request.headers["x-modality-name"];
          const fileName = basename(
            typeof encodedFileName === "string" ? decodeURIComponent(encodedFileName) : "",
          );
          const requestedName = typeof encodedModalityName === "string"
            ? decodeURIComponent(encodedModalityName).trim().slice(0, 80)
            : "";
          const lowerName = fileName.toLocaleLowerCase();
          if (!fileName || !requestedName || (!lowerName.endsWith(".nii") && !lowerName.endsWith(".nii.gz"))) {
            response.statusCode = 400;
            response.setHeader("Content-Type", "application/json; charset=utf-8");
            response.end(JSON.stringify({ ...modalityResponsePayload(), status: "failed", message: "Nom et fichier NIfTI 3D requis" }));
            return;
          }
          const contentLength = Number(request.headers["content-length"] ?? 0);
          if (!Number.isFinite(contentLength) || contentLength <= 0 || contentLength > 2_000_000_000) {
            response.statusCode = 413;
            response.setHeader("Content-Type", "application/json; charset=utf-8");
            response.end(JSON.stringify({ ...modalityResponsePayload(), status: "failed", message: "Taille de fichier invalide" }));
            return;
          }
          const stem = fileName.replace(/\.nii(?:\.gz)?$/i, "").replace(/[^a-zA-Z0-9_-]+/g, "-");
          const id = `${stem || "modalite"}-${Date.now()}`;
          const root = modalityRoot()!;
          const output = resolve(root, id);
          const extension = lowerName.endsWith(".nii.gz") ? ".nii.gz" : ".nii";
          const input = resolve(output, `source${extension}`);
          mkdirSync(output, { recursive: true });
          modalityStatus = "uploading";
          modalityMessage = "Import et validation de la modalité";
          const destination = createWriteStream(input, { flags: "wx" });
          request.pipe(destination);
          destination.on("finish", () => {
            modalityProcess = spawn(
              python,
              [
                modalityImportScript,
                "--input", input,
                "--reference", rareInput,
                "--mask", brainMask,
                "--output", output,
                "--name", requestedName,
                "--source-name", fileName,
              ],
              {
                cwd: projectRoot,
                env: { ...processEnv, PYTHONUTF8: "1", PYTHONIOENCODING: "utf-8" },
                windowsHide: true,
              },
            );
            let diagnostics = "";
            modalityProcess.stdout.on("data", (chunk: Buffer) => { diagnostics += chunk.toString("utf8"); });
            modalityProcess.stderr.on("data", (chunk: Buffer) => { diagnostics += chunk.toString("utf8"); });
            modalityProcess.on("error", (error) => {
              modalityStatus = "failed";
              modalityMessage = error.message;
              modalityProcess = null;
              if (!response.headersSent) {
                response.statusCode = 500;
                response.setHeader("Content-Type", "application/json; charset=utf-8");
                response.end(JSON.stringify(modalityResponsePayload()));
              }
            });
            modalityProcess.on("close", (code) => {
              const succeeded = code === 0 && existsSync(resolve(output, "manifest.json"));
              modalityStatus = succeeded ? "completed" : "failed";
              modalityMessage = succeeded
                ? "Modalité prête"
                : diagnostics.trim().split(/\r?\n/).filter(Boolean).at(-1) ?? "Validation impossible";
              modalityProcess = null;
              if (!succeeded) rmSync(output, { recursive: true, force: true });
              if (!response.headersSent) {
                response.statusCode = succeeded ? 201 : 422;
                response.setHeader("Content-Type", "application/json; charset=utf-8");
                response.end(JSON.stringify(modalityResponsePayload()));
              }
            });
          });
          destination.on("error", (error) => {
            modalityStatus = "failed";
            modalityMessage = error.message;
            rmSync(output, { recursive: true, force: true });
            if (!response.headersSent) {
              response.statusCode = 500;
              response.setHeader("Content-Type", "application/json; charset=utf-8");
              response.end(JSON.stringify(modalityResponsePayload()));
            }
          });
          return;
        }
        if (request.url?.startsWith("/api/modalities/") && request.method === "POST") {
          const pathname = new URL(request.url, "http://localhost").pathname;
          const exportMatch = pathname.match(
            /^\/api\/modalities\/([a-zA-Z0-9_-]+)\/export-values$/,
          );
          if (exportMatch) {
            let rawBody = "";
            for await (const chunk of request) {
              rawBody += Buffer.from(chunk).toString("utf8");
              if (rawBody.length > 100_000) break;
            }
            let regionIds: number[] = [];
            try {
              const body = JSON.parse(rawBody) as { regionIds?: unknown };
              if (Array.isArray(body.regionIds)) {
                regionIds = [...new Set(body.regionIds
                  .map(Number)
                  .filter((value) => Number.isSafeInteger(value) && value > 0))];
              }
            } catch {
              // Invalid JSON is handled as an empty selection below.
            }
            if (regionIds.length === 0 || regionIds.length > 1000) {
              response.statusCode = 400;
              response.setHeader("Content-Type", "application/json; charset=utf-8");
              response.end(JSON.stringify({ message: "Sélection de régions invalide" }));
              return;
            }
            const root = modalityRoot();
            const directory = root ? resolve(root, exportMatch[1]) : null;
            const input = directory ? resolve(directory, "prepared.nii.gz") : null;
            const manifestPath = directory ? resolve(directory, "manifest.json") : null;
            const labels = currentOutput
              ? resolve(currentOutput, "..", "registration", "allen_labels_in_input_space.nii.gz")
              : null;
            if (
              !directory || !input || !manifestPath || !labels
              || !existsSync(input) || !existsSync(manifestPath) || !existsSync(labels)
            ) {
              response.statusCode = 409;
              response.setHeader("Content-Type", "application/json; charset=utf-8");
              response.end(JSON.stringify({ message: "Modalité ou annotations Allen indisponibles" }));
              return;
            }
            const modalityName = String(JSON.parse(readFileSync(manifestPath, "utf8")).name);
            const result = await new Promise<{ ok: boolean; output: string }>((resolveResult) => {
              let stdout = "";
              let stderr = "";
              const child = spawn(
                python,
                [
                  regionStatisticsExportScript,
                  "--input",
                  input,
                  "--labels",
                  labels,
                  "--modality-name",
                  modalityName,
                  "--region-ids",
                  regionIds.join(","),
                ],
                {
                  cwd: projectRoot,
                  env: { ...processEnv, PYTHONUTF8: "1", PYTHONIOENCODING: "utf-8" },
                  windowsHide: true,
                },
              );
              child.stdout.on("data", (chunk: Buffer) => { stdout += chunk.toString("utf8"); });
              child.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString("utf8"); });
              child.on("error", (error) => resolveResult({ ok: false, output: error.message }));
              child.on("close", (code) => resolveResult({
                ok: code === 0,
                output: code === 0 ? stdout : stderr.trim() || stdout.trim(),
              }));
            });
            if (!result.ok) {
              response.statusCode = 422;
              response.setHeader("Content-Type", "application/json; charset=utf-8");
              response.end(JSON.stringify({ message: result.output || "Export impossible" }));
              return;
            }
            const safeName = modalityName.replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/^-|-$/g, "") || "modalite";
            response.setHeader("Content-Type", "text/csv; charset=utf-8");
            response.setHeader("Content-Disposition", `attachment; filename="gamebrain-${safeName}.csv"`);
            response.end(`\uFEFF${result.output}`);
            return;
          }
        }
        if (request.url?.startsWith("/api/modalities/") && request.method === "GET") {
          const pathname = new URL(request.url, "http://localhost").pathname;
          const statisticsMatch = pathname.match(
            /^\/api\/modalities\/([a-zA-Z0-9_-]+)\/statistics\/(\d+)$/,
          );
          if (statisticsMatch) {
            const root = modalityRoot();
            const labels = currentOutput
              ? resolve(currentOutput, "..", "registration", "allen_labels_in_input_space.nii.gz")
              : null;
            const input = root ? resolve(root, statisticsMatch[1], "prepared.nii.gz") : null;
            if (!root || !labels || !input || !existsSync(labels) || !existsSync(input)) {
              response.statusCode = 409;
              response.setHeader("Content-Type", "application/json; charset=utf-8");
              response.end(JSON.stringify({ message: "Modalité ou annotations Allen indisponibles" }));
              return;
            }
            const result = await new Promise<{ ok: boolean; output: string }>((resolveResult) => {
              let stdout = "";
              let stderr = "";
              const child = spawn(
                python,
                [
                  regionStatisticsScript,
                  "--input",
                  input,
                  "--labels",
                  labels,
                  "--region-id",
                  statisticsMatch[2],
                ],
                {
                  cwd: projectRoot,
                  env: { ...processEnv, PYTHONUTF8: "1", PYTHONIOENCODING: "utf-8" },
                  windowsHide: true,
                },
              );
              child.stdout.on("data", (chunk: Buffer) => { stdout += chunk.toString("utf8"); });
              child.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString("utf8"); });
              child.on("error", (error) => resolveResult({ ok: false, output: error.message }));
              child.on("close", (code) => resolveResult({
                ok: code === 0,
                output: code === 0 ? stdout.trim() : stderr.trim() || stdout.trim(),
              }));
            });
            response.setHeader("Content-Type", "application/json; charset=utf-8");
            if (!result.ok) {
              response.statusCode = 422;
              response.end(JSON.stringify({ message: result.output || "Calcul impossible" }));
              return;
            }
            response.end(result.output);
            return;
          }
        }
        if (request.url?.startsWith("/api/modalities/") && request.method === "DELETE") {
          if (modalityProcess) {
            response.statusCode = 409;
            response.end(JSON.stringify({ ...modalityResponsePayload(), message: "Un import est en cours" }));
            return;
          }
          const id = decodeURIComponent(new URL(request.url, "http://localhost").pathname.slice("/api/modalities/".length));
          const root = modalityRoot();
          if (!root || !/^[a-zA-Z0-9_-]+$/.test(id)) {
            response.statusCode = 400;
            response.end(JSON.stringify({ ...modalityResponsePayload(), message: "Modalité invalide" }));
            return;
          }
          const target = resolve(root, id);
          if (!target.toLocaleLowerCase().startsWith(`${resolve(root).toLocaleLowerCase()}\\`)) {
            response.statusCode = 400;
            response.end(JSON.stringify({ ...modalityResponsePayload(), message: "Chemin invalide" }));
            return;
          }
          modalityBinaryCache.delete(target);
          rmSync(target, { recursive: true, force: true });
          modalityStatus = "idle";
          modalityMessage = "Modalité supprimée";
          response.setHeader("Content-Type", "application/json; charset=utf-8");
          response.end(JSON.stringify(modalityResponsePayload()));
          return;
        }
        if (request.url?.startsWith("/api/modalities/") && request.method === "GET") {
          const pathname = new URL(request.url, "http://localhost").pathname;
          const match = pathname.match(
            /^\/api\/modalities\/([a-zA-Z0-9_-]+)\/((?:slices|slices-masked)\/(coronal|sagittal|axial)\/(?:coronal|sagittal|axial)-\d{3,4}\.webp)$/,
          );
          const volumeMatch = pathname.match(
            /^\/api\/modalities\/([a-zA-Z0-9_-]+)\/(volume\.float32|brain-mask\.uint8)$/,
          );
          const rawSliceMatch = pathname.match(
            /^\/api\/modalities\/([a-zA-Z0-9_-]+)\/raw-slice\/(coronal|sagittal|axial)\/(\d+)$/,
          );
          const root = modalityRoot();
          if ((!match && !volumeMatch && !rawSliceMatch) || !root) {
            response.statusCode = 404;
            response.end("Modalité indisponible");
            return;
          }
          if (rawSliceMatch) {
            const result = modalitySlice(root, rawSliceMatch[1], rawSliceMatch[2], Number(rawSliceMatch[3]));
            if (!result) {
              response.statusCode = 404;
              response.end("Coupe indisponible");
              return;
            }
            response.setHeader("Content-Type", "application/octet-stream");
            response.setHeader("Cache-Control", "private, max-age=3600");
            response.setHeader("X-Slice-Width", String(result.width));
            response.setHeader("X-Slice-Height", String(result.height));
            response.end(result.bytes);
            return;
          }
          const id = match?.[1] ?? volumeMatch![1];
          const asset = match?.[2] ?? volumeMatch![2];
          const path = resolve(root, id, asset);
          if (
            !path.toLocaleLowerCase().startsWith(`${resolve(root, id).toLocaleLowerCase()}\\`)
            || !existsSync(path)
          ) {
            response.statusCode = 404;
            response.end("Coupe indisponible");
            return;
          }
          response.setHeader("Content-Type", match ? "image/webp" : "application/octet-stream");
          response.setHeader("Cache-Control", "no-store");
          response.end(readFileSync(path));
          return;
        }
        if (request.url?.startsWith("/api/allen-registration/pick") && request.method === "GET") {
          const url = new URL(request.url, "http://localhost");
          const values = ["x", "y", "z", "dx", "dy", "dz"].map((name) =>
            Number(url.searchParams.get(name)),
          );
          if (values.some((value) => !Number.isFinite(value) || Math.abs(value) > 100)) {
            response.statusCode = 400;
            response.setHeader("Content-Type", "application/json; charset=utf-8");
            response.end(JSON.stringify({ regionId: null, message: "Coordonnées invalides" }));
            return;
          }
          const regionId = await pickNativeRegion(
            [values[0], values[1], values[2]],
            [values[3], values[4], values[5]],
          );
          response.setHeader("Content-Type", "application/json; charset=utf-8");
          response.setHeader("Cache-Control", "no-store");
          response.end(JSON.stringify({ regionId }));
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
          if (process || registrationProcess || connectivityProcess || nativeConnectivityProcess || modalityProcess) {
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
          modalityBinaryCache.clear();
          await stopNativeRegionWorker();
          try {
            for (const path of safeRoots) clearDirectory(path);
          } catch (error) {
            response.statusCode = 500;
            response.end(JSON.stringify({
              ok: false,
              message: error instanceof Error
                ? `Impossible de supprimer toutes les données : ${error.message}`
                : "Impossible de supprimer toutes les données",
            }));
            return;
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
            if (succeeded) warmCurrentNativeRegionWorker();
          });
          response.statusCode = 202;
          response.setHeader("Content-Type", "application/json; charset=utf-8");
          response.end(JSON.stringify(registrationResponsePayload()));
          return;
        }
        if (request.url === "/api/import/start" && request.method === "POST") {
          if (process || registrationProcess || modalityProcess || state.status === "uploading") {
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
          if (process || registrationProcess || modalityProcess || state.status === "uploading" || state.status === "running") {
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
          modalityBinaryCache.clear();
          currentOutput = null;
          nativeRegionWorker?.kill();
          nativeRegionWorker = null;
          nativeRegionWorkerKey = "";
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
            || /^(?:detailed-masks|detailed-outlines)\/(coronal|sagittal|axial)\/(coronal|sagittal|axial)-\d{3,4}\.(?:png|webp)$/.test(asset)
            || /^(?:regions|detailed-regions)\/\d+\.glb$/.test(asset);
          const path = resolve(currentOutput, "..", "registration", "native-web", asset);
          const detailedRegion = asset.match(/^detailed-regions\/(\d+)\.glb$/);
          if (valid && detailedRegion && !existsSync(path)) {
            const labels = resolve(currentOutput, "..", "registration", "allen_labels_in_input_space.nii.gz");
            const volumeCache = resolve(currentOutput, "..", "registration", "native-web", "detailed-labels.npy");
            if (existsSync(labels) && existsSync(volumeCache) && existsSync(nativeRegionWorkerScript)) {
              await ensureNativeRegionMesh(labels, volumeCache, detailedRegion[1], path);
            }
          }
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

