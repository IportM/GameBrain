import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { resolve, sep } from "node:path";
import type { AllenConnectivityExperiment } from "./allenApi";

export type DownloadedExperiment = {
  id: number;
  finishedAt: string;
  metadata: AllenConnectivityExperiment | null;
};

const readinessCache = new Map<string, {
  signature: string;
  expiresAt: number;
  entry: DownloadedExperiment;
}>();
const libraryCache = new Map<string, { expiresAt: number; entries: DownloadedExperiment[] }>();

export function invalidateConnectivityLibrary(root: string, id?: number) {
  const directory = resolve(root);
  libraryCache.delete(directory);
  if (id !== undefined) {
    readinessCache.delete(resolve(directory, String(id)));
  } else {
    for (const key of readinessCache.keys()) {
      if (key.startsWith(directory + sep)) readinessCache.delete(key);
    }
  }
}

export function readExperimentMetadata(root: string, id: number): AllenConnectivityExperiment | null {
  try {
    const metadata = JSON.parse(readFileSync(resolve(root, String(id), "metadata.json"), "utf8"));
    return metadata.id === id ? metadata : null;
  } catch {
    return null;
  }
}

export function readyExperiment(root: string, id: number): DownloadedExperiment | null {
  if (!Number.isSafeInteger(id) || id <= 0) return null;
  const key = resolve(root, String(id));
  try {
    const web = resolve(root, String(id), "web");
    const path = resolve(web, "manifest.json");
    const manifestStat = statSync(path);
    const volumeStats = ["projection", "injection"].map((layer) => statSync(resolve(web, "volumes", `${layer}.bin`)));
    const signature = [manifestStat, ...volumeStats].map((stat) => `${stat.mtimeMs}:${stat.size}`).join("|");
    const cached = readinessCache.get(key);
    if (cached && cached.signature === signature && cached.expiresAt > Date.now()) {
      readinessCache.delete(key);
      readinessCache.set(key, cached);
      return cached.entry;
    }
    const manifest = JSON.parse(readFileSync(path, "utf8"));
    if (manifest.experiment_id !== id || manifest.resolution_um !== 50) return null;
    if (!Array.isArray(manifest.volume_shape) || manifest.volume_shape.length !== 3
      || !manifest.volume_shape.every((size: number) => Number.isSafeInteger(size) && size > 0)) return null;
    const volumeLength = manifest.volume_shape.reduce((a: number, b: number) => a * b, 1);
    for (const layer of ["projection", "injection"]) {
      if (statSync(resolve(web, "volumes", `${layer}.bin`)).size !== volumeLength) return null;
      for (const plane of ["coronal", "sagittal", "axial"]) {
        const count = manifest.slice_counts?.[plane];
        if (!Number.isSafeInteger(count) || count <= 0) return null;
        const directory = resolve(web, "overlays", layer, plane);
        for (let index = 0; index < count; index += 1) {
          if (!existsSync(resolve(directory, `${plane}-${String(index).padStart(3, "0")}.webp`))) return null;
        }
      }
    }
    const entry = { id, finishedAt: manifestStat.mtime.toISOString(), metadata: readExperimentMetadata(root, id) };
    readinessCache.set(key, { signature, expiresAt: Date.now() + 60_000, entry });
    while (readinessCache.size > 256) readinessCache.delete(readinessCache.keys().next().value!);
    return entry;
  } catch {
    readinessCache.delete(key);
    return null;
  }
}

export function downloadedExperiments(root: string): DownloadedExperiment[] {
  const key = resolve(root);
  const cached = libraryCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.entries;
  if (!existsSync(root)) return [];
  const entries = readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && /^\d+$/.test(entry.name))
    .map((entry) => readyExperiment(root, Number(entry.name)))
    .filter((entry): entry is DownloadedExperiment => entry !== null)
    .sort((a, b) => b.finishedAt.localeCompare(a.finishedAt));
  libraryCache.set(key, { expiresAt: Date.now() + 2_000, entries });
  while (libraryCache.size > 4) libraryCache.delete(libraryCache.keys().next().value!);
  return entries;
}
