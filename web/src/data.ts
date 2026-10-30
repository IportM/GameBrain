import type { SlicePlane } from "./atlas";

export type RegistrationStatus = "idle" | "uploading" | "running" | "completed" | "failed";

export type AllenRegistrationState = {
  status: "idle" | "running" | "completed" | "failed";
  startedAt: string | null;
  finishedAt: string | null;
  message: string;
  logTail: string[];
  hasNativeAssets: boolean;
};

export type ConnectivityManifest = {
  experiment_id: number;
  resolution_um: number;
  shape: [number, number, number];
  slice_counts: Record<SlicePlane, number>;
  point_cloud_resolution_um?: number;
  volume_resolution_um?: number;
  volume_shape?: [number, number, number];
  injection_marker?: {
    center_mm: [number, number, number];
    radius_mm: number;
  };
};

export type ConnectivitySearchResult = {
  id: number;
  specimenName: string;
  primaryStructure: {
    id: number | null;
    acronym: string;
    name: string;
    color: string;
  };
  injectionStructures: Array<{
    id: number;
    acronym: string;
    name: string;
  }>;
  injectionVolumeMm3: number | null;
  injectionCoordinatesUm: [number, number, number] | null;
  transgenicLine: string;
  sex: string;
  strain: string;
};

export type ConnectivityState = {
  status: "idle" | "running" | "completed" | "failed";
  startedAt: string | null;
  finishedAt: string | null;
  message: string;
  logTail: string[];
  experimentId: number | null;
  hasViewerAssets: boolean;
  viewerManifest: ConnectivityManifest | null;
  metadata: ConnectivitySearchResult | null;
  nativeStatus: "idle" | "running" | "completed" | "failed";
  nativeMessage: string;
  nativeLogTail: string[];
  hasNativeViewerAssets: boolean;
  nativeViewerManifest: {
    experiment_id: number;
    slice_counts: Record<SlicePlane, number>;
    volume_shape?: [number, number, number];
    volume_spacing_mm?: [number, number, number];
    injection_marker?: { center_mm: [number, number, number]; radius_mm: number };
  } | null;
};

export type ConnectivitySearchResponse = {
  message: string;
  results: ConnectivitySearchResult[];
  total: number;
};

export type ImportedPlane = {
  spacing_mm: number;
  width_mm: number;
  height_mm: number;
};

export type ImportedManifest = {
  shape: [number, number, number];
  spacing_mm: [number, number, number];
  size_mm: [number, number, number];
  slice_counts: Record<SlicePlane, number>;
  planes: Record<SlicePlane, ImportedPlane>;
};

export type RegistrationState = {
  status: RegistrationStatus;
  startedAt: string | null;
  finishedAt: string | null;
  message: string;
  logTail: string[];
  hasViewerAssets: boolean;
  fileName: string | null;
  viewerManifest: ImportedManifest | null;
};

export const INITIAL_REGISTRATION_STATE: RegistrationState = {
  status: "idle",
  startedAt: null,
  finishedAt: null,
  message: "Sélectionnez une image NIfTI",
  logTail: [],
  hasViewerAssets: false,
  fileName: null,
  viewerManifest: null,
};

export const INITIAL_ALLEN_REGISTRATION_STATE: AllenRegistrationState = {
  status: "idle",
  startedAt: null,
  finishedAt: null,
  message: "Le recalage Allen n'a pas encore été lancé",
  logTail: [],
  hasNativeAssets: false,
};

export const INITIAL_CONNECTIVITY_STATE: ConnectivityState = {
  status: "idle",
  startedAt: null,
  finishedAt: null,
  message: "Saisissez un identifiant d'expérience Allen",
  logTail: [],
  experimentId: null,
  hasViewerAssets: false,
  viewerManifest: null,
  metadata: null,
  nativeStatus: "idle",
  nativeMessage: "Projetez la carte dans l'image importée",
  nativeLogTail: [],
  hasNativeViewerAssets: false,
  nativeViewerManifest: null,
};

export async function readImportResponse(response: Response): Promise<RegistrationState> {
  const body = await response.text();
  if (!body) {
    throw new Error("Le serveur local d'import ne répond pas. Rechargez la page puis réessayez.");
  }
  try {
    return JSON.parse(body) as RegistrationState;
  } catch {
    throw new Error("La réponse du serveur d'import est invalide. Rechargez la page puis réessayez.");
  }
}

export async function readAllenRegistrationResponse(
  response: Response,
): Promise<AllenRegistrationState> {
  const body = await response.text();
  if (!body) {
    throw new Error("Le serveur local de recalage ne répond pas");
  }
  try {
    return JSON.parse(body) as AllenRegistrationState;
  } catch {
    throw new Error("La réponse du serveur de recalage est invalide");
  }
}

export async function readConnectivityResponse(response: Response): Promise<ConnectivityState> {
  const body = await response.text();
  if (!body) {
    throw new Error("Le serveur de connectivité ne répond pas");
  }
  try {
    const parsed = JSON.parse(body) as Partial<ConnectivityState>;
    return {
      ...INITIAL_CONNECTIVITY_STATE,
      ...parsed,
      nativeLogTail: parsed.nativeLogTail ?? [],
    };
  } catch {
    throw new Error("La réponse du serveur de connectivité est invalide");
  }
}
