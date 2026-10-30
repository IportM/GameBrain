export type AllenConnectivityExperiment = {
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

type AllenStructure = {
  id: number;
  acronym: string;
  name: string;
  color: string;
};

type AllenStructureNode = AllenStructure & {
  children?: AllenStructureNode[];
};

let allenStructuresPromise: Promise<AllenStructure[]> | null = null;

async function loadAllenStructures(): Promise<AllenStructure[]> {
  if (!allenStructuresPromise) {
    allenStructuresPromise = fetch("https://api.brain-map.org/api/v2/structure_graph_download/1.json", {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(20_000),
    }).then(async (response) => {
      if (!response.ok) throw new Error(`Allen API: ${response.status}`);
      const payload = await response.json() as { success?: boolean; msg?: unknown };
      if (payload.success === false || !Array.isArray(payload.msg)) {
        throw new Error("Arbre anatomique Allen indisponible");
      }
      const structures: AllenStructure[] = [];
      const visit = (node: AllenStructureNode) => {
        structures.push({
          id: Number(node.id),
          acronym: String(node.acronym),
          name: String(node.name),
          color: String((node as AllenStructureNode & { color_hex_triplet?: string }).color_hex_triplet ?? ""),
        });
        node.children?.forEach(visit);
      };
      (payload.msg as AllenStructureNode[]).forEach(visit);
      return structures.filter((structure) => Number.isSafeInteger(structure.id));
    }).catch((error) => {
      allenStructuresPromise = null;
      throw error;
    });
  }
  return allenStructuresPromise;
}

export async function resolveAllenStructure(query: string): Promise<AllenStructure> {
  const numericId = Number(query);
  const structures = await loadAllenStructures();
  if (Number.isSafeInteger(numericId) && numericId > 0) {
    return structures.find((structure) => structure.id === numericId)
      ?? { id: numericId, acronym: String(numericId), name: "Structure Allen", color: "" };
  }
  const normalized = query.toLocaleLowerCase("en");
  const exact = structures.find((structure) =>
    structure.acronym.toLocaleLowerCase("en") === normalized
    || structure.name.toLocaleLowerCase("en") === normalized,
  );
  if (exact) return exact;
  const partial = structures.filter((structure) =>
    structure.acronym.toLocaleLowerCase("en").startsWith(normalized)
    || structure.name.toLocaleLowerCase("en").startsWith(normalized),
  );
  if (partial.length === 1) return partial[0];
  throw new Error(
    partial.length > 1
      ? "Plusieurs régions correspondent. Utilisez l'acronyme Allen exact."
      : "Région Allen introuvable. Utilisez son nom, son acronyme ou son identifiant.",
  );
}

export function normalizeConnectivityExperiment(
  value: unknown,
  fallbackStructure?: AllenStructure,
): AllenConnectivityExperiment | null {
  if (!value || typeof value !== "object") return null;
  const item = value as Record<string, unknown>;
  const id = Number(item.id ?? item.data_set_id);
  if (!Number.isSafeInteger(id) || id <= 0) return null;
  const structures = Array.isArray(item["injection-structures"])
    ? item["injection-structures"]
        .map((entry) => {
          if (!entry || typeof entry !== "object") return null;
          const structure = entry as Record<string, unknown>;
          const structureId = Number(structure.id);
          if (!Number.isSafeInteger(structureId)) return null;
          return {
            id: structureId,
            acronym: String(structure.abbreviation ?? ""),
            name: String(structure.name ?? ""),
          };
        })
        .filter((entry): entry is NonNullable<typeof entry> => entry !== null)
    : typeof item.injection_structures === "string"
      ? item.injection_structures.split("/").map((structureId) => ({
          id: Number(structureId),
          acronym: "",
          name: "",
        })).filter((structure) => Number.isSafeInteger(structure.id))
      : [];
  const coordinates = Array.isArray(item["injection-coordinates"])
    ? item["injection-coordinates"].map(Number)
    : [item.injection_x, item.injection_y, item.injection_z].map(Number);
  const injectionVolume = Number(item["injection-volume"] ?? item.injection_volume);
  const structureId = Number(item["structure-id"] ?? item.structure_id);
  const transgenicLine = item.transgenic_line && typeof item.transgenic_line === "object"
    ? String((item.transgenic_line as Record<string, unknown>).name ?? "")
    : String(item["transgenic-line"] ?? "");
  return {
    id,
    specimenName: String(item.name ?? item.specimen_name ?? ""),
    primaryStructure: {
      id: Number.isSafeInteger(structureId) ? structureId : null,
      acronym: String(item["structure-abbrev"] ?? item.structure_abbrev ?? fallbackStructure?.acronym ?? ""),
      name: String(item["structure-name"] ?? item.structure_name ?? fallbackStructure?.name ?? ""),
      color: String(item["structure-color"] ?? fallbackStructure?.color ?? ""),
    },
    injectionStructures: structures,
    injectionVolumeMm3: Number.isFinite(injectionVolume) ? injectionVolume : null,
    injectionCoordinatesUm: coordinates.length === 3 && coordinates.every(Number.isFinite)
      ? coordinates as [number, number, number]
      : null,
    transgenicLine,
    sex: String(item.gender ?? ""),
    strain: String(item.strain ?? ""),
  };
}

export async function loadConnectivityExperiment(experimentId: number) {
  const url = "https://api.brain-map.org/api/v2/data/ApiConnectivity/query.json"
    + `?criteria=[id$eq${experimentId}]&num_rows=1`;
  const response = await fetch(url, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error(`Allen API: ${response.status}`);
  const payload = await response.json() as { success?: boolean; msg?: unknown };
  if (payload.success === false || !Array.isArray(payload.msg)) {
    throw new Error("Métadonnées Allen indisponibles");
  }
  return normalizeConnectivityExperiment(payload.msg[0]) ?? null;
}

