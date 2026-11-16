import { useI18n } from "./i18n";
import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type WheelEvent,
} from "react";

import InteractiveSlice, { type ConnectivityInspection } from "./InteractiveSlice";
import SliceComparison from "./SliceComparison";
import ModalityAlignment, { SessionImport, modalityAlignmentConfirmed, type ModalitySession } from "./ModalityAlignment";
import RegionTooltip from "./RegionTooltip";
import ExperimentExplorerPanel from "./ExperimentExplorerPanel";
import ConnectivityLibrary from "./ConnectivityLibrary";
import { clearConnectivitySliceCache } from "./connectivitySliceCache";
import type { DownloadedConnectivityExperiment } from "./data";
import { ConnectivityReadout, SliceToolbar } from "./SliceToolbar";
import type { ViewerSource } from "./AtlasScene";
import {
  INITIAL_ALLEN_REGISTRATION_STATE,
  INITIAL_CONNECTIVITY_STATE,
  INITIAL_MODALITY_STATE,
  INITIAL_REGISTRATION_STATE,
  readAllenRegistrationResponse,
  readConnectivityResponse,
  readImportResponse,
  readModalityResponse,
  type AllenRegistrationState,
  type ConnectivitySearchResponse,
  type ConnectivitySearchResult,
  type ConnectivityState,
  type ModalityState,
  type RegistrationState,
} from "./data";
import {
  ATLAS_VOLUME_CENTER_MM,
  REGION_BY_ID,
  REGIONS,
  SLICE_PLANES,
  SLICE_PLANE_ORDER,
  resolutionMm,
  sliceCount,
  sliceMaskUrl,
  sliceUrl,
  type ClipDirection,
  type Slice3DMode,
  type SlicePlane,
  type SliceResolution,
} from "./atlas";
import {
  connectivityOverlayUrl,
  connectivityVolumeUrl,
  nativeConnectivityOverlayUrl,
  nativeConnectivityVolumeUrl,
  modalitySliceUrl,
  subjectAllenMaskUrl,
  subjectAllenDetailedMaskUrl,
  subjectAllenDetailedOutlineUrl,
  subjectMaskOutlineUrl,
  subjectSlice3DUrl,
  subjectSliceUrl,
} from "./viewerUrls";
import { preloadImages } from "./imagePreload";
import {
  loadModalitySlice,
  type ModalityPalette,
  type ModalitySlice,
} from "./modalityVolume";
import RegionTree from "./RegionTree";
import Workspace from "./Workspace";
import { ImageWorkflow, WorkflowStatus, type ImageTask } from "./ImageWorkflow";
import { useDialogFocus } from "./useDialogFocus";
import { ChevronLeft, ChevronRight, Focus, LockKeyhole, MousePointer2, RotateCcw, X } from "lucide-react";
import {
  detailedAnnotationMaskUrl,
  detailedAnnotationOutlineUrl,
  type DetailedAnnotationManifest,
  type DetailedAnnotationStructure,
} from "./detailedAnnotations";

const AtlasScene = lazy(() => import("./AtlasScene"));
const MAJOR_REGION_IDS = new Set(REGIONS.map((region) => region.id));
const SUBJECT_VOLUME_CENTER_MM: [number, number, number] = [0, 0, 0];
const DEFAULT_SUBJECT_VOLUME_SPACING_MM: [number, number, number] = [0.1, 0.1, 0.1];

type RegionStatistics = {
  region_id: number;
  region_name: string;
  region_acronym: string;
  descendant_count: number;
  region_voxels: number;
  valid_voxels: number;
  excluded_voxels: number;
  voxel_volume_mm3: number;
  sampled_volume_mm3: number;
  statistics: null | {
    mean: number;
    std: number;
    median: number;
    min: number;
    max: number;
    p05: number;
    p95: number;
  };
};

function majorRegionIdFor(structure: DetailedAnnotationStructure) {
  return [...structure.path].reverse().find((id) => MAJOR_REGION_IDS.has(id)) ?? null;
}

function formatMeasurement(value: number, language: "fr" | "en") {
  return value.toLocaleString(language === "fr" ? "fr-FR" : "en-GB", { maximumSignificantDigits: 6 });
}

export default function App() {
  const { t, language, setLanguage } = useI18n();
  const formatValue = (value: number) => formatMeasurement(value, language);
  const [tooltipRegionId, setTooltipRegionId] = useState<number | null>(null);
  const [hoveredRegionId, setHoveredRegionId] = useState<number | null>(null);
  const [menuHoveredRegionId, setMenuHoveredRegionId] = useState<number | null>(null);
  const [lastInspectedRegionId, setLastInspectedRegionId] = useState<number | null>(null);
  const [selectedRegionId, setSelectedRegionId] = useState<number | null>(null);
  const [isolatedRegionId, setIsolatedRegionId] = useState<number | null>(null);
  const [activePlane, setActivePlane] = useState<SlicePlane>("coronal");
  const [sliceResolution, setSliceResolution] = useState<SliceResolution>(25);
  const [sliceIndexesBySource, setSliceIndexesBySource] = useState<
    Record<ViewerSource, Record<SlicePlane, number>>
  >(() => {
    const centeredAllenIndexes = Object.fromEntries(
      SLICE_PLANE_ORDER.map((plane) => [plane, Math.floor(sliceCount(plane, 25) / 2)]),
    ) as Record<SlicePlane, number>;
    return {
      allen: centeredAllenIndexes,
      subject: { ...centeredAllenIndexes },
    };
  });
  const [slice3DMode, setSlice3DMode] = useState<Slice3DMode>("none");
  const [clipDirection, setClipDirection] = useState<ClipDirection>("positive");
  const [brainOpacity, setBrainOpacity] = useState(0.35);
  const [wholeBrainVisible, setWholeBrainVisible] = useState(true);
  const [regionSearch, setRegionSearch] = useState("");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [sceneResetKey, setSceneResetKey] = useState(0);
  const [cameraResetRevision, setCameraResetRevision] = useState(0);
  const [sceneReady, setSceneReady] = useState(false);
  const [registrationOpen, setRegistrationOpen] = useState(false);
  const [allenRegistrationOpen, setAllenRegistrationOpen] = useState(false);
  const [connectivityOpen, setConnectivityOpen] = useState(false);
  const [downloadedConnectivity, setDownloadedConnectivity] = useState<DownloadedConnectivityExperiment[]>([]);
  const [connectivityLibraryError, setConnectivityLibraryError] = useState<string | null>(null);
  const [experimentExplorerEnabled, setExperimentExplorerEnabled] = useState(false);
  const [experimentCatalogue, setExperimentCatalogue] = useState<ConnectivitySearchResult[]>([]);
  const [experimentCatalogueLoading, setExperimentCatalogueLoading] = useState(false);
  const [experimentCatalogueError, setExperimentCatalogueError] = useState<string | null>(null);
  const [experimentCatalogueRetry, setExperimentCatalogueRetry] = useState(0);
  const lastExperimentCatalogueLoad = useRef({ time: 0, retry: -1 });
  const [experimentFilterRegion, setExperimentFilterRegion] = useState(false);
  const [hoveredExperiment, setHoveredExperiment] = useState<ConnectivitySearchResult | null>(null);
  const [selectedExperiment, setSelectedExperiment] = useState<ConnectivitySearchResult | null>(null);
  const [modalitiesOpen, setModalitiesOpen] = useState(false);
  const [connectivityExperimentId, setConnectivityExperimentId] = useState("100140756");
  const [connectivityLoadMode, setConnectivityLoadMode] = useState<"region" | "id">("region");
  const [connectivityRegionQuery, setConnectivityRegionQuery] = useState("Isocortex");
  const [connectivitySearchStatus, setConnectivitySearchStatus] =
    useState<"idle" | "loading" | "completed" | "failed">("idle");
  const [connectivitySearchMessage, setConnectivitySearchMessage] = useState(
    "Recherchez une région d'injection Allen",
  );
  const [connectivitySearchResults, setConnectivitySearchResults] =
    useState<ConnectivitySearchResult[]>([]);
  const [connectivityVisible, setConnectivityVisible] = useState(false);
  const [projectionVisible, setProjectionVisible] = useState(true);
  const [injectionVisible, setInjectionVisible] = useState(true);
  const [connectivityOpacity, setConnectivityOpacity] = useState(0.85);
  const [connectivityThreshold, setConnectivityThreshold] = useState(0.05);
  const [connectivityHoverInspection, setConnectivityHoverInspection] =
    useState<ConnectivityInspection | null>(null);
  const [connectivityPinnedInspection, setConnectivityPinnedInspection] =
    useState<ConnectivityInspection | null>(null);
  const [registrationPending, setRegistrationPending] = useState(false);
  const [registrationFile, setRegistrationFile] = useState<File | null>(null);
  const [modalityFile, setModalityFile] = useState<File | null>(null);
  const [modalityName, setModalityName] = useState("");
  const [modalitySession, setModalitySession] = useState<ModalitySession>("");
  const [modalityAligned, setModalityAligned] = useState(false);
  const [selectedSessionId, setSelectedSessionId] = useState("");
  const [modalityTask, setModalityTask] = useState<"modality" | "session">("modality");
  const [modalityState, setModalityState] = useState<ModalityState>(INITIAL_MODALITY_STATE);
  const [activeModalityId, setActiveModalityId] = useState<string | null>(null);
  const [compareSlices, setCompareSlices] = useState(false);
  const [registrationQC, setRegistrationQC] = useState(false);
  const [loadedModalitySlice, setLoadedModalitySlice] = useState<{
    key: string;
    data: ModalitySlice;
  } | null>(null);
  const [modalityMin, setModalityMin] = useState(0);
  const [modalityMax, setModalityMax] = useState(1);
  const [modalityPalette, setModalityPalette] = useState<ModalityPalette>("gray");
  const [modalityInverted, setModalityInverted] = useState(false);
  const [regionStatisticsPending, setRegionStatisticsPending] = useState(false);
  const [regionStatistics, setRegionStatistics] = useState<RegionStatistics | null>(null);
  const [regionStatisticsError, setRegionStatisticsError] = useState<string | null>(null);
  const [regionExportOpen, setRegionExportOpen] = useState(false);
  const [regionExportSearch, setRegionExportSearch] = useState("");
  const [regionExportIds, setRegionExportIds] = useState<Set<number>>(() => new Set());
  const [regionExportPending, setRegionExportPending] = useState(false);
  const [regionExportError, setRegionExportError] = useState<string | null>(null);
  const [registrationState, setRegistrationState] = useState<RegistrationState>(
    INITIAL_REGISTRATION_STATE,
  );
  const [allenRegistrationState, setAllenRegistrationState] =
    useState<AllenRegistrationState>(INITIAL_ALLEN_REGISTRATION_STATE);
  const [connectivityState, setConnectivityState] =
    useState<ConnectivityState>(INITIAL_CONNECTIVITY_STATE);
  const [viewerSource, setViewerSource] = useState<ViewerSource>("allen");
  const experimentExplorerActive = experimentExplorerEnabled && viewerSource === "allen";

  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/connectivity/library", { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const payload = await response.json() as { results?: DownloadedConnectivityExperiment[] };
        if (!response.ok || !Array.isArray(payload.results)) throw new Error("Liste des expériences indisponible");
        if (!controller.signal.aborted) {
          setDownloadedConnectivity(payload.results);
          setConnectivityLibraryError(null);
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) setConnectivityLibraryError("Liste des expériences indisponible");
      });
    return () => controller.abort();
  }, [connectivityState.finishedAt, connectivityState.nativeStatus, registrationState.finishedAt, connectivityOpen]);
  const [showAllenRegionColors, setShowAllenRegionColors] = useState(true);
  const [showBrainOnly, setShowBrainOnly] = useState(true);
  const [showImportedMask, setShowImportedMask] = useState(true);
  const [showImportedAnnotations, setShowImportedAnnotations] = useState(true);
  const [detailedAnnotations, setDetailedAnnotations] =
    useState<DetailedAnnotationManifest | null>(null);
  const [hoveredDetailedRegionId, setHoveredDetailedRegionId] = useState<number | null>(null);
  const [selectedDetailedRegionId, setSelectedDetailedRegionId] = useState<number | null>(null);
  const [displayedDetailedRegionIds, setDisplayedDetailedRegionIds] = useState<Set<number>>(
    () => new Set(),
  );
  const [regionVisibilityMode, setRegionVisibilityMode] = useState(false);
  const [nativeSceneDetailedRegionId, setNativeSceneDetailedRegionId] = useState<number | null>(null);
  const activatedSubjectRevision = useRef<string | null>(null);
  const imageMenuRef = useRef<HTMLDetailsElement>(null);
  const sessionMenuRef = useRef<HTMLDetailsElement>(null);
  const regionExportListRef = useRef<HTMLDivElement>(null);
  const sliceWheelDelta = useRef(0);
  const pendingWheelSteps = useRef(0);
  const sliceWheelFrame = useRef<number | null>(null);
  const pendingSliderIndex = useRef<number | null>(null);
  const sliceSliderFrame = useRef<number | null>(null);
  const previousSlicePosition = useRef<{
    index: number;
    plane: SlicePlane;
    resolution: SliceResolution;
    source: ViewerSource;
  } | null>(null);
  const [visibility, setVisibility] = useState<Record<number, boolean>>(() =>
    Object.fromEntries(REGIONS.map((region) => [region.id, true])),
  );
  const [isolationSnapshot, setIsolationSnapshot] = useState<{
    displayedDetailedRegionIds: Set<number>;
    regionVisibilityMode: boolean;
    visibility: Record<number, boolean>;
    wholeBrainVisible: boolean;
  } | null>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => setSceneReady(true), 80);
    return () => window.clearTimeout(timer);
  }, []);

  const hasRegionSelection = selectedRegionId !== null || selectedDetailedRegionId !== null;
  const activeRegionId = hasRegionSelection
    ? selectedRegionId
    : menuHoveredRegionId ?? hoveredRegionId;
  const sceneHoveredRegionId = hasRegionSelection
    ? selectedRegionId
    : slice3DMode === "clip"
      ? menuHoveredRegionId ?? hoveredRegionId
      : activeRegionId;
  const activeRegion = activeRegionId === null ? null : REGION_BY_ID.get(activeRegionId) ?? null;
  const detailedStructureById = useMemo(
    () => new Map(detailedAnnotations?.structures.map((structure) => [structure.id, structure]) ?? []),
    [detailedAnnotations],
  );
  const inspectSceneRegion = useCallback((regionId: number | null) => {
    const structure = regionId === null ? null : detailedStructureById.get(regionId);
    setTooltipRegionId(structure ? majorRegionIdFor(structure) ?? regionId : regionId);
  }, [detailedStructureById]);
  const tooltipRegion = tooltipRegionId === null
    ? null
    : detailedStructureById.get(tooltipRegionId) ?? REGION_BY_ID.get(tooltipRegionId);
  const detailedMaskValueToRegionId = useMemo(
    () => new Map(
      detailedAnnotations?.structures.map((structure) => [structure.maskValue, structure.id]) ?? [],
    ),
    [detailedAnnotations],
  );
  const activeDetailedRegionId = hasRegionSelection
    ? selectedDetailedRegionId
    : hoveredDetailedRegionId ?? selectedDetailedRegionId;
  const activeDetailedRegion = activeDetailedRegionId === null
    ? null
    : detailedStructureById.get(activeDetailedRegionId) ?? null;
  const nativeSceneDetailedRegion = nativeSceneDetailedRegionId === null
    ? null
    : detailedStructureById.get(nativeSceneDetailedRegionId) ?? null;
  const detailRegion = activeDetailedRegion ?? activeRegion ?? (
    lastInspectedRegionId === null ? null : REGION_BY_ID.get(lastInspectedRegionId) ?? null
  );
  const selectedRegion =
    selectedRegionId === null ? null : REGION_BY_ID.get(selectedRegionId) ?? null;
  const selectedDetailedRegion = selectedDetailedRegionId === null
    ? null
    : detailedStructureById.get(selectedDetailedRegionId) ?? null;
  const experimentFilterId = selectedDetailedRegionId ?? selectedRegionId;
  const coloredExperimentCatalogue = useMemo(() => experimentCatalogue.map((experiment) => {
    const id = experiment.primaryStructure.id;
    const structure = id === null ? undefined : detailedStructureById.get(id);
    return {
      ...experiment,
      primaryStructure: {
        ...experiment.primaryStructure,
        color: structure?.color ?? experiment.primaryStructure.color,
      },
    };
  }), [experimentCatalogue, detailedStructureById]);
  const visibleExperiments = useMemo(() => {
    if (!experimentFilterRegion) return coloredExperimentCatalogue;
    if (experimentFilterId === null) return [];
    return coloredExperimentCatalogue.filter((experiment) => (
      [experiment.primaryStructure.id, ...experiment.injectionStructures.map((structure) => structure.id)]
        .some((id) => id === experimentFilterId || (
          id !== null && detailedStructureById.get(id)?.path.includes(experimentFilterId)
        ))
    ));
  }, [coloredExperimentCatalogue, experimentFilterRegion, experimentFilterId, detailedStructureById]);

  useEffect(() => {
    setExperimentFilterRegion(experimentFilterId !== null);
    if (experimentExplorerActive && experimentFilterId === null) {
      setSelectedExperiment(null);
      setHoveredExperiment(null);
      setConnectivityVisible(false);
    }
  }, [experimentFilterId, experimentExplorerActive]);

  useEffect(() => {
    setHoveredExperiment(null);
    setSelectedExperiment((current) => current && visibleExperiments.some((item) => item.id === current.id)
      ? current : null);
  }, [visibleExperiments, experimentExplorerActive]);

  useEffect(() => {
    if (experimentExplorerActive && connectivityVisible) {
      setExperimentExplorerEnabled(false);
      setHoveredExperiment(null);
    }
  }, [experimentExplorerActive, connectivityVisible]);

  useEffect(() => {
    if (!experimentExplorerActive) return;
    if (experimentCatalogue.length > 0
      && lastExperimentCatalogueLoad.current.retry === experimentCatalogueRetry
      && Date.now() - lastExperimentCatalogueLoad.current.time < 10 * 60 * 1000) {
      setExperimentCatalogueLoading(false);
      return;
    }
    const controller = new AbortController();
    setExperimentCatalogueLoading(true);
    setExperimentCatalogueError(null);
    void fetch("/api/connectivity/experiments", { signal: controller.signal })
      .then(async (response) => {
        const payload = await response.json() as { results?: ConnectivitySearchResult[]; message?: string };
        if (!response.ok || !Array.isArray(payload.results)) {
          throw new Error(payload.message ?? "Catalogue Allen indisponible");
        }
        if (!controller.signal.aborted) {
          lastExperimentCatalogueLoad.current = { time: Date.now(), retry: experimentCatalogueRetry };
          setExperimentCatalogue(payload.results);
        }
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) {
          setExperimentCatalogueError(error instanceof Error ? error.message : "Catalogue Allen indisponible");
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setExperimentCatalogueLoading(false);
      });
    return () => controller.abort();
  }, [experimentExplorerActive, experimentCatalogueRetry]);
  const displayedDetailedRegions = useMemo(
    () => [...displayedDetailedRegionIds]
      .filter((regionId) => !MAJOR_REGION_IDS.has(regionId))
      .map((regionId) => detailedStructureById.get(regionId))
      .filter((structure): structure is DetailedAnnotationStructure => Boolean(structure)),
    [detailedStructureById, displayedDetailedRegionIds],
  );
  const treeDisplayedRegionIds = useMemo(() => regionVisibilityMode
    ? new Set([
        ...displayedDetailedRegionIds,
        ...REGIONS.filter((region) => visibility[region.id]).map((region) => region.id),
      ])
    : new Set<number>(), [displayedDetailedRegionIds, regionVisibilityMode, visibility]);
  const activeSlice = SLICE_PLANES[activePlane];
  const activeModality = activeModalityId === null
    ? null
    : modalityState.modalities.find((modality) => modality.id === activeModalityId) ?? null;
  const activeModalitySliceKey = activeModality
    ? `${activeModality.id}:${activePlane}:${sliceIndexesBySource.subject[activePlane]}`
    : null;
  const activeModalitySlice = activeModalitySliceKey !== null
    && loadedModalitySlice?.key === activeModalitySliceKey
    ? loadedModalitySlice.data
    : null;
  const measuredRegionId = selectedDetailedRegionId ?? selectedRegionId;
  const modalityWindow = useMemo<[number, number]>(
    () => [modalityMin, modalityMax],
    [modalityMax, modalityMin],
  );
  const importedManifest = registrationState.viewerManifest;
  const subjectAnnotationsAvailable =
    allenRegistrationState.status === "completed" &&
    Boolean(allenRegistrationState.hasNativeAssets);
  const scenePersistentDetailedRegions = useMemo(
    () => displayedDetailedRegions.filter((structure) => (
      viewerSource === "allen"
        ? structure.meshAvailable
        : subjectAnnotationsAvailable
          && allenRegistrationState.nativeRegionIds.includes(structure.id)
    )),
    [
      allenRegistrationState.nativeRegionIds,
      displayedDetailedRegions,
      subjectAnnotationsAvailable,
      viewerSource,
    ],
  );
  const exportableRegions = useMemo(() => {
    if (!detailedAnnotations) return [];
    const available = new Set(allenRegistrationState.nativeRegionIds);
    return detailedAnnotations.structures.filter((structure) => (
      structure.id !== 997 && (available.size === 0 || available.has(structure.id))
    ));
  }, [allenRegistrationState.nativeRegionIds, detailedAnnotations]);
  const filteredExportRegions = useMemo(() => {
    const query = regionExportSearch.trim().toLocaleLowerCase("fr");
    if (!query) return exportableRegions;
    return exportableRegions.filter((structure) => (
      `${structure.name} ${structure.acronym} ${structure.id}`
        .toLocaleLowerCase("fr")
        .includes(query)
    ));
  }, [exportableRegions, regionExportSearch]);

  useEffect(() => {
    if (viewerSource !== "subject") {
      setNativeSceneDetailedRegionId(null);
      return;
    }
    const targetId = hasRegionSelection
      ? selectedDetailedRegionId
      : hoveredDetailedRegionId ?? selectedDetailedRegionId;
    if (targetId === null || hasRegionSelection || hoveredDetailedRegionId === null) {
      setNativeSceneDetailedRegionId(targetId);
      return;
    }
    const timer = window.setTimeout(() => {
      setNativeSceneDetailedRegionId(targetId);
    }, 140);
    return () => window.clearTimeout(timer);
  }, [hasRegionSelection, hoveredDetailedRegionId, selectedDetailedRegionId, viewerSource]);
  const sliceAnnotationsEnabled =
    viewerSource === "allen" || (viewerSource === "subject" && subjectAnnotationsAvailable);
  const sliceIndexes = sliceIndexesBySource[viewerSource];
  const setSliceIndexes = useCallback((
    next:
      | Record<SlicePlane, number>
      | ((current: Record<SlicePlane, number>) => Record<SlicePlane, number>),
  ) => {
    setSliceIndexesBySource((current) => ({
      ...current,
      [viewerSource]: typeof next === "function" ? next(current[viewerSource]) : next,
    }));
  }, [viewerSource]);
  const activeSliceCount = viewerSource === "subject" && importedManifest
    ? importedManifest.slice_counts[activePlane]
    : sliceCount(activePlane, sliceResolution);
  const sliceIndex = sliceIndexes[activePlane];
  const activeSliceSpacingMm = viewerSource === "subject" && importedManifest
    ? importedManifest.planes[activePlane].spacing_mm
    : resolutionMm(sliceResolution);
  const activeConnectivityInspection =
    connectivityPinnedInspection ?? connectivityHoverInspection;
  const connectivityAvailableForSource = viewerSource === "allen"
    ? connectivityState.hasViewerAssets
    : connectivityState.hasNativeViewerAssets;
  const inspectedConnectivityRegion = activeConnectivityInspection?.regionId
    ? REGION_BY_ID.get(activeConnectivityInspection.regionId) ?? null
    : null;
  const visibleRegionCount = REGIONS.filter((region) => visibility[region.id]).length;
  useEffect(() => {
    let cancelled = false;
    fetch("/atlas/detailed-annotations.json")
      .then((response) => {
        if (!response.ok) throw new Error("Annotations Allen détaillées indisponibles");
        return response.json() as Promise<DetailedAnnotationManifest>;
      })
      .then((manifest) => {
        if (!cancelled) setDetailedAnnotations(manifest);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    setHoveredDetailedRegionId(null);
    const detailedSelectionAvailable = viewerSource === "allen" || subjectAnnotationsAvailable;
    if (!detailedSelectionAvailable) {
      setSelectedDetailedRegionId(null);
    }
  }, [activePlane, sliceIndex, sliceResolution, subjectAnnotationsAvailable, viewerSource]);

  useEffect(() => {
    const closeImageMenu = (event: PointerEvent) => {
      for (const menu of [imageMenuRef.current, sessionMenuRef.current]) {
        if (menu?.open && event.target instanceof Node && !menu.contains(event.target)) {
          menu.removeAttribute("open");
        }
      }
    };
    const closeImageMenuWithKeyboard = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        for (const menu of [imageMenuRef.current, sessionMenuRef.current]) {
          if (!menu?.open) continue;
          menu.removeAttribute("open");
          menu.querySelector("summary")?.focus();
        }
      }
    };
    document.addEventListener("pointerdown", closeImageMenu);
    document.addEventListener("keydown", closeImageMenuWithKeyboard);
    return () => {
      document.removeEventListener("pointerdown", closeImageMenu);
      document.removeEventListener("keydown", closeImageMenuWithKeyboard);
    };
  }, []);

  const selectRegion = useCallback((regionId: number | null) => {
    setSelectedDetailedRegionId(null);
    setHoveredDetailedRegionId(null);
    setHoveredRegionId(null);
    setMenuHoveredRegionId(null);
    if (regionId !== null) {
      setVisibility((current) => ({ ...current, [regionId]: true }));
      setLastInspectedRegionId(regionId);
    }
    setSelectedRegionId((current) => (current === regionId ? null : regionId));
  }, []);

  const hoverRegionFromViewer = useCallback((regionId: number | null) => {
    if (hasRegionSelection) return;
    if (regionId !== null) {
      setLastInspectedRegionId(regionId);
    }
    setHoveredRegionId(regionId);
  }, [hasRegionSelection]);

  const hoverDetailedRegion = useCallback((regionId: number | null) => {
    if (hasRegionSelection) return;
    setHoveredDetailedRegionId(regionId);
  }, [hasRegionSelection]);

  const selectDetailedRegion = useCallback((regionId: number | null) => {
    const next = selectedDetailedRegionId === regionId ? null : regionId;
    const structure = next === null ? null : detailedStructureById.get(next) ?? null;
    const majorRegionId = structure ? majorRegionIdFor(structure) : null;
    setSelectedDetailedRegionId(next);
    setSelectedRegionId(null);
    setHoveredRegionId(null);
    setHoveredDetailedRegionId(null);
    setMenuHoveredRegionId(null);
    setIsolatedRegionId(null);
    if (majorRegionId !== null) {
      setVisibility((visibilityState) => ({ ...visibilityState, [majorRegionId]: true }));
      setLastInspectedRegionId(majorRegionId);
    }
  }, [detailedStructureById, selectedDetailedRegionId]);

  const hoverMajorRegionFromNativeScene = useCallback((regionId: number | null) => {
    const structure = regionId === null ? null : detailedStructureById.get(regionId) ?? null;
    setHoveredDetailedRegionId(null);
    hoverRegionFromViewer(structure ? majorRegionIdFor(structure) : null);
  }, [detailedStructureById, hoverRegionFromViewer]);

  const selectMajorRegionFromNativeScene = useCallback((regionId: number | null) => {
    const structure = regionId === null ? null : detailedStructureById.get(regionId) ?? null;
    selectRegion(structure ? majorRegionIdFor(structure) : null);
  }, [detailedStructureById, selectRegion]);

  const selectDetailedRegionFromTree = useCallback((structure: DetailedAnnotationStructure) => {
    if (selectedDetailedRegionId === structure.id) {
      setSelectedDetailedRegionId(null);
      setSelectedRegionId(null);
      setHoveredDetailedRegionId(null);
      setHoveredRegionId(null);
      setMenuHoveredRegionId(null);
      setIsolatedRegionId(null);
      return;
    }
    const majorRegionId = majorRegionIdFor(structure);
    setSelectedDetailedRegionId(structure.id);
    setHoveredDetailedRegionId(null);
    setHoveredRegionId(null);
    setMenuHoveredRegionId(null);
    setIsolatedRegionId(null);
    setSelectedRegionId(null);
    if (majorRegionId !== null) {
      setVisibility((current) => ({ ...current, [majorRegionId]: true }));
      setLastInspectedRegionId(majorRegionId);
    }
  }, [selectedDetailedRegionId]);

  const hoverDetailedRegionFromTree = useCallback((structure: DetailedAnnotationStructure | null) => {
    if (structure === null) {
      setHoveredDetailedRegionId(null);
      setMenuHoveredRegionId(null);
      return;
    }
    if (hasRegionSelection) {
      return;
    }
    setHoveredDetailedRegionId(structure.id);
    setMenuHoveredRegionId(majorRegionIdFor(structure));
  }, [hasRegionSelection]);

  const inspectConnectivity = useCallback((inspection: ConnectivityInspection | null) => {
    if (connectivityPinnedInspection !== null) {
      return;
    }
    setConnectivityHoverInspection((current) => {
      if (current === inspection) return current;
      if (current === null || inspection === null) return inspection;
      const unchanged =
        current.plane === inspection.plane &&
        current.index === inspection.index &&
        current.regionId === inspection.regionId &&
        Math.round(current.projection * 100) === Math.round(inspection.projection * 100) &&
        Math.round(current.injection * 100) === Math.round(inspection.injection * 100);
      return unchanged ? current : inspection;
    });
  }, [connectivityPinnedInspection]);

  const pinConnectivityInspection = useCallback((inspection: ConnectivityInspection | null) => {
    setConnectivityPinnedInspection(inspection);
    setConnectivityHoverInspection(null);
  }, []);

  const clearConnectivityInspection = useCallback(() => {
    setConnectivityPinnedInspection(null);
  }, []);

  const changeActivePlane = useCallback((plane: SlicePlane) => {
    if (sliceWheelFrame.current !== null) cancelAnimationFrame(sliceWheelFrame.current);
    if (sliceSliderFrame.current !== null) cancelAnimationFrame(sliceSliderFrame.current);
    sliceWheelDelta.current = 0;
    pendingWheelSteps.current = 0;
    pendingSliderIndex.current = null;
    sliceWheelFrame.current = null;
    sliceSliderFrame.current = null;
    setHoveredRegionId(null);
    setActivePlane(plane);
  }, []);

  useEffect(() => {
    if (!connectivityVisible) {
      setConnectivityHoverInspection(null);
      setConnectivityPinnedInspection(null);
      return;
    }
    setHoveredRegionId(null);
    setMenuHoveredRegionId(null);
  }, [connectivityVisible]);

  useEffect(() => {
    setConnectivityHoverInspection(null);
    setConnectivityPinnedInspection(null);
  }, [activePlane, sliceIndex, viewerSource]);

  const restoreWholeBrainDisplay = useCallback(() => {
    setWholeBrainVisible(true);
    setRegionVisibilityMode(false);
    setVisibility(Object.fromEntries(REGIONS.map((region) => [region.id, true])));
    setDisplayedDetailedRegionIds(new Set());
    setIsolationSnapshot(null);
  }, []);

  const toggleDisplayedDetailedRegion = useCallback((structure: DetailedAnnotationStructure) => {
    if (!regionVisibilityMode) {
      setRegionVisibilityMode(true);
      setWholeBrainVisible(false);
      setVisibility(Object.fromEntries(
        REGIONS.map((region) => [region.id, region.id === structure.id]),
      ));
      setDisplayedDetailedRegionIds(
        MAJOR_REGION_IDS.has(structure.id) ? new Set() : new Set([structure.id]),
      );
      return;
    }
    if (MAJOR_REGION_IDS.has(structure.id)) {
      const willBeVisible = !visibility[structure.id];
      const hasAnotherMajorRegion = REGIONS.some(
        (region) => region.id !== structure.id && visibility[region.id],
      );
      if (!willBeVisible && !hasAnotherMajorRegion && displayedDetailedRegionIds.size === 0) {
        restoreWholeBrainDisplay();
        return;
      }
      setVisibility((current) => ({ ...current, [structure.id]: willBeVisible }));
      return;
    }
    if (
      displayedDetailedRegionIds.has(structure.id) &&
      displayedDetailedRegionIds.size === 1 &&
      !REGIONS.some((region) => visibility[region.id])
    ) {
      restoreWholeBrainDisplay();
      return;
    }
    setDisplayedDetailedRegionIds((current) => {
      const next = new Set(current);
      if (next.has(structure.id)) next.delete(structure.id);
      else next.add(structure.id);
      return next;
    });
  }, [displayedDetailedRegionIds, regionVisibilityMode, restoreWholeBrainDisplay, visibility]);

  const toggleWholeBrain = () => {
    if (!wholeBrainVisible) {
      restoreWholeBrainDisplay();
      return;
    }
    setWholeBrainVisible(false);
    setRegionVisibilityMode(true);
  };

  const isolateSelectedRegion = () => {
    if (isolationSnapshot) {
      setWholeBrainVisible(isolationSnapshot.wholeBrainVisible);
      setVisibility(isolationSnapshot.visibility);
      setDisplayedDetailedRegionIds(isolationSnapshot.displayedDetailedRegionIds);
      setRegionVisibilityMode(isolationSnapshot.regionVisibilityMode);
      setIsolationSnapshot(null);
      return;
    }
    const target = selectedDetailedRegion ?? selectedRegion;
    if (!target) {
      return;
    }
    setIsolationSnapshot({
      displayedDetailedRegionIds: new Set(displayedDetailedRegionIds),
      regionVisibilityMode,
      visibility: { ...visibility },
      wholeBrainVisible,
    });
    setWholeBrainVisible(false);
    setRegionVisibilityMode(true);
    setIsolatedRegionId(null);
    setVisibility(Object.fromEntries(
      REGIONS.map((region) => [region.id, region.id === target.id]),
    ));
    setDisplayedDetailedRegionIds(
      MAJOR_REGION_IDS.has(target.id) ? new Set() : new Set([target.id]),
    );
  };

  const hideSelectedRegion = () => {
    const target = selectedDetailedRegion ?? selectedRegion;
    if (!target) {
      return;
    }
    if (MAJOR_REGION_IDS.has(target.id)) {
      setVisibility((current) => ({ ...current, [target.id]: false }));
    }
    setDisplayedDetailedRegionIds((current) => {
      const next = new Set(current);
      next.delete(target.id);
      return next;
    });
    setHoveredRegionId(null);
    setMenuHoveredRegionId(null);
    setSelectedRegionId(null);
    setHoveredDetailedRegionId(null);
    setSelectedDetailedRegionId(null);
    setIsolatedRegionId(null);
  };

  const clearSelectedRegion = () => {
    setHoveredRegionId(null);
    setMenuHoveredRegionId(null);
    setSelectedRegionId(null);
    setHoveredDetailedRegionId(null);
    setSelectedDetailedRegionId(null);
    setIsolatedRegionId(null);
  };

  const resetRegionDisplay = () => {
    setWholeBrainVisible(true);
    setVisibility(Object.fromEntries(REGIONS.map((region) => [region.id, true])));
    setHoveredRegionId(null);
    setMenuHoveredRegionId(null);
    setLastInspectedRegionId(null);
    setSelectedRegionId(null);
    setIsolatedRegionId(null);
    setHoveredDetailedRegionId(null);
    setSelectedDetailedRegionId(null);
    setDisplayedDetailedRegionIds(new Set());
    setRegionVisibilityMode(false);
    setIsolationSnapshot(null);
  };

  const resetWorkspaceDisplay = () => {
    const centeredAllenIndexes = Object.fromEntries(
      SLICE_PLANE_ORDER.map((plane) => [plane, Math.floor(sliceCount(plane, 25) / 2)]),
    ) as Record<SlicePlane, number>;
    setViewerSource("allen");
    setActivePlane("coronal");
    setSliceResolution(25);
    setSliceIndexesBySource((current) => ({
      ...current,
      allen: centeredAllenIndexes,
      subject: registrationState.viewerManifest
        ? Object.fromEntries(
            SLICE_PLANE_ORDER.map((plane) => [
              plane,
              Math.floor(registrationState.viewerManifest!.slice_counts[plane] / 2),
            ]),
          ) as Record<SlicePlane, number>
        : current.subject,
    }));
    setSlice3DMode("none");
    setClipDirection("positive");
    setBrainOpacity(0.35);
    setConnectivityVisible(false);
    setProjectionVisible(true);
    setInjectionVisible(true);
    setConnectivityOpacity(0.85);
    setConnectivityThreshold(0.05);
    setConnectivityHoverInspection(null);
    setConnectivityPinnedInspection(null);
    setShowImportedMask(true);
    setShowImportedAnnotations(true);
    setShowAllenRegionColors(true);
    setRegionSearch("");
    setSidebarCollapsed(false);
    setRegistrationOpen(false);
    setAllenRegistrationOpen(false);
    setConnectivityOpen(false);
    setExperimentExplorerEnabled(false);
    setSelectedExperiment(null);
    setHoveredExperiment(null);
    setExperimentFilterRegion(false);
    sliceWheelDelta.current = 0;
    resetRegionDisplay();
    setSceneResetKey((current) => current + 1);
  };

  const exploreExperiments = () => {
    setViewerSource("allen");
    setSlice3DMode("none");
    setConnectivityVisible(false);
    setSelectedExperiment(null);
    setHoveredExperiment(null);
    setConnectivityPinnedInspection(null);
    setConnectivityHoverInspection(null);
    setTooltipRegionId(null);
    setExperimentExplorerEnabled(true);
    setExperimentFilterRegion(hasRegionSelection);
    setConnectivityOpen(false);
  };

  const openImageTask = (task: ImageTask) => {
    setRegistrationOpen(task === "image");
    setAllenRegistrationOpen(task === "atlas");
    setModalitiesOpen(task === "modalities");
    setConnectivityOpen(task === "connectivity");
  };

  const imageWorkBusy = registrationPending || registrationState.status === "uploading"
    || registrationState.status === "running" || allenRegistrationState.status === "running"
    || modalityState.status === "uploading" || connectivityState.nativeStatus === "running";
  const imageWorkflow = (active: ImageTask) => <ImageWorkflow
    active={active} hasImage={registrationState.hasViewerAssets} hasRegions={subjectAnnotationsAvailable}
    hasExperiment={connectivityState.hasViewerAssets}
    modalityCount={modalityState.modalities.length} nativeConnectivity={connectivityState.hasNativeViewerAssets}
    importStatus={registrationState.status} atlasStatus={allenRegistrationState.status}
    modalityStatus={modalityState.status} nativeStatus={connectivityState.nativeStatus}
    busy={imageWorkBusy || registrationFile !== null} onNavigate={openImageTask}
  />;

  const closeTaskDialogs = useCallback(() => {
    setRegistrationOpen(false);
    setAllenRegistrationOpen(false);
    setModalitiesOpen(false);
    setConnectivityOpen(false);
    setRegionExportOpen(false);
  }, []);
  useDialogFocus(registrationOpen ? "registration-title" : allenRegistrationOpen ? "allen-registration-title"
    : modalitiesOpen ? "modalities-title" : connectivityOpen ? "connectivity-title"
      : regionExportOpen ? "region-export-title" : null, closeTaskDialogs);

  const changeSliceResolution = useCallback((nextResolution: SliceResolution) => {
    if (viewerSource === "subject") {
      return;
    }
    if (nextResolution === sliceResolution) {
      return;
    }
    setHoveredRegionId(null);
    sliceWheelDelta.current = 0;
    setSliceIndexes((current) =>
      Object.fromEntries(
        SLICE_PLANE_ORDER.map((plane) => {
          const positionMm = current[plane] * resolutionMm(sliceResolution);
          const nextIndex = Math.min(
            sliceCount(plane, nextResolution) - 1,
            Math.max(0, Math.round(positionMm / resolutionMm(nextResolution))),
          );
          return [plane, nextIndex];
        }),
      ) as Record<SlicePlane, number>,
    );
    setSliceResolution(nextResolution);
  }, [setSliceIndexes, sliceResolution, viewerSource]);

  const handleSliceWheel = (event: WheelEvent<HTMLDivElement>) => {
    event.preventDefault();
    setHoveredRegionId(null);
    sliceWheelDelta.current += event.deltaY;

    const threshold = event.deltaMode === 1 ? 3 : 60;
    const availableSteps = Math.floor(Math.abs(sliceWheelDelta.current) / threshold);
    if (availableSteps === 0) {
      return;
    }

    const direction = sliceWheelDelta.current > 0 ? 1 : -1;
    const steps = Math.min(availableSteps, 4);
    sliceWheelDelta.current =
      availableSteps > steps
        ? 0
        : sliceWheelDelta.current - direction * steps * threshold;
    pendingWheelSteps.current += direction * steps;
    if (sliceWheelFrame.current === null) {
      sliceWheelFrame.current = requestAnimationFrame(() => {
        const offset = pendingWheelSteps.current;
        pendingWheelSteps.current = 0;
        sliceWheelFrame.current = null;
        setSliceIndexes((current) => ({
          ...current,
          [activePlane]: Math.min(
            activeSliceCount - 1,
            Math.max(0, current[activePlane] + offset),
          ),
        }));
      });
    }
  };

  const scheduleSliderIndex = useCallback((nextIndex: number) => {
    pendingSliderIndex.current = nextIndex;
    if (sliceSliderFrame.current !== null) return;
    sliceSliderFrame.current = requestAnimationFrame(() => {
      const index = pendingSliderIndex.current;
      pendingSliderIndex.current = null;
      sliceSliderFrame.current = null;
      if (index === null) return;
      setHoveredRegionId(null);
      setSliceIndexes((current) => ({ ...current, [activePlane]: index }));
    });
  }, [activePlane, setSliceIndexes]);

  useEffect(() => () => {
    if (sliceWheelFrame.current !== null) cancelAnimationFrame(sliceWheelFrame.current);
    if (sliceSliderFrame.current !== null) cancelAnimationFrame(sliceSliderFrame.current);
  }, []);

  useEffect(() => {
    const currentPosition = {
      index: sliceIndex,
      plane: activePlane,
      resolution: sliceResolution,
      source: viewerSource,
    };
    const previous = previousSlicePosition.current;
    const sameStack =
      previous?.plane === activePlane &&
      previous.resolution === sliceResolution &&
      previous.source === viewerSource;
    const direction = sameStack ? Math.sign(sliceIndex - previous.index) : 0;
    const offsets = direction === 0
      ? [-2, -1, 1, 2]
      : [direction, direction * 2, direction * 3, direction * 4, -direction];
    const nearbyIndexes = offsets
      .map((offset) => sliceIndex + offset)
      .filter((index) => index >= 0 && index < activeSliceCount);
    const assets: string[] = [];

    for (const index of nearbyIndexes) {
      if (viewerSource === "allen") {
        assets.push(sliceUrl(activePlane, index, sliceResolution));
        if (sliceAnnotationsEnabled) {
          assets.push(sliceMaskUrl(activePlane, index, sliceResolution));
        }
        if (detailedAnnotations) {
          assets.push(detailedAnnotationMaskUrl(activePlane, index, sliceResolution));
          assets.push(detailedAnnotationOutlineUrl(activePlane, index, sliceResolution));
        }
        if (connectivityVisible && connectivityState.viewerManifest) {
          if (projectionVisible) {
            assets.push(connectivityOverlayUrl(
              "projection",
              activePlane,
              index,
              sliceResolution,
              connectivityState.viewerManifest,
              connectivityState.finishedAt,
            ));
          }
          if (injectionVisible) {
            assets.push(connectivityOverlayUrl(
              "injection",
              activePlane,
              index,
              sliceResolution,
              connectivityState.viewerManifest,
              connectivityState.finishedAt,
            ));
          }
        }
      } else {
        assets.push(
          activeModality
            ? modalitySliceUrl(activeModality.id, activePlane, index, showBrainOnly)
            : showBrainOnly
              ? subjectSlice3DUrl(activePlane, index, registrationState.finishedAt)
              : subjectSliceUrl(activePlane, index, registrationState.finishedAt),
        );
        if (slice3DMode === "clip") {
          assets.push(subjectSlice3DUrl(activePlane, index, registrationState.finishedAt));
        }
        if (showImportedMask) {
          assets.push(subjectMaskOutlineUrl(activePlane, index, registrationState.finishedAt));
        }
        if (subjectAnnotationsAvailable) {
          assets.push(subjectAllenMaskUrl(activePlane, index, allenRegistrationState.finishedAt));
          assets.push(subjectAllenDetailedMaskUrl(
            activePlane,
            index,
            allenRegistrationState.finishedAt,
          ));
          if (showImportedAnnotations) {
            assets.push(subjectAllenDetailedOutlineUrl(
              activePlane,
              index,
              allenRegistrationState.finishedAt,
            ));
          }
        }
        if (connectivityVisible && connectivityState.hasNativeViewerAssets) {
          if (projectionVisible) {
            assets.push(nativeConnectivityOverlayUrl(
              "projection",
              activePlane,
              index,
              connectivityState.finishedAt,
              connectivityState.experimentId,
              connectivityState.nativeFinishedAt,
            ));
          }
          if (injectionVisible) {
            assets.push(nativeConnectivityOverlayUrl(
              "injection",
              activePlane,
              index,
              connectivityState.finishedAt,
              connectivityState.experimentId,
              connectivityState.nativeFinishedAt,
            ));
          }
        }
      }
    }

    preloadImages(assets);
    previousSlicePosition.current = currentPosition;
  }, [
    activePlane,
    activeModality,
    activeSliceCount,
    allenRegistrationState.finishedAt,
    connectivityState.finishedAt,
    connectivityState.nativeFinishedAt,
    connectivityState.hasNativeViewerAssets,
    connectivityState.viewerManifest,
    connectivityVisible,
    detailedAnnotations,
    injectionVisible,
    projectionVisible,
    registrationState.finishedAt,
    showImportedAnnotations,
    showBrainOnly,
    showImportedMask,
    slice3DMode,
    sliceAnnotationsEnabled,
    sliceIndex,
    sliceResolution,
    subjectAnnotationsAvailable,
    viewerSource,
  ]);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/import/status", { cache: "no-store" })
      .then((response) => {
        if (!response.ok) {
          throw new Error("État de l'import indisponible");
        }
        return readImportResponse(response);
      })
      .then((nextState) => {
        if (!cancelled) {
          setRegistrationState(nextState);
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  const refreshModalities = useCallback(async () => {
    const response = await fetch("/api/modalities/status", { cache: "no-store" });
    const nextState = await readModalityResponse(response);
    if (!response.ok) throw new Error(nextState.message);
    setModalityState(nextState);
  }, []);

  useEffect(() => {
    if (modalityState.status !== "uploading") return;
    const timer = window.setInterval(() => { void refreshModalities().catch(() => undefined); }, 2000);
    return () => window.clearInterval(timer);
  }, [modalityState.status, refreshModalities]);

  useEffect(() => {
    setModalitySession("");
    setModalityAligned(false);
    setSelectedSessionId("");
    setModalityTask("modality");
    if (!registrationState.hasViewerAssets) {
      setCompareSlices(false);
      setRegistrationQC(false);
      setModalityState(INITIAL_MODALITY_STATE);
      return;
    }
    void refreshModalities().catch(() => undefined);
  }, [refreshModalities, registrationState.finishedAt, registrationState.hasViewerAssets]);

  useEffect(() => {
    if (
      activeModalityId !== null
      && !modalityState.modalities.some((modality) => modality.id === activeModalityId)
    ) {
      setActiveModalityId(null);
    }
  }, [activeModalityId, modalityState.modalities]);

  useEffect(() => {
    if (!activeModality) return;
    setModalityMin(activeModality.percentiles[0]);
    setModalityMax(activeModality.percentiles[1]);
    setModalityPalette("gray");
    setModalityInverted(false);
  }, [activeModality?.id, activeModality?.percentiles[0], activeModality?.percentiles[1]]);

  useEffect(() => {
    if (!activeModality || activeModalitySliceKey === null) return;
    let cancelled = false;
    void loadModalitySlice(activeModality.id, activePlane, sliceIndexesBySource.subject[activePlane])
      .then((data) => {
        if (!cancelled) setLoadedModalitySlice({ key: activeModalitySliceKey, data });
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [activeModality, activeModalitySliceKey, activePlane, sliceIndexesBySource.subject]);

  useEffect(() => {
    if (viewerSource !== "subject" || modalityState.modalities.length === 0) return;
    const index = sliceIndexesBySource.subject[activePlane];
    for (const modality of modalityState.modalities) {
      void loadModalitySlice(modality.id, activePlane, index).catch(() => undefined);
    }
  }, [activePlane, modalityState.modalities, sliceIndexesBySource.subject, viewerSource]);

  useEffect(() => {
    if (viewerSource !== "subject" || !activeModality || measuredRegionId === null) {
      setRegionStatisticsPending(false);
      setRegionStatistics(null);
      setRegionStatisticsError(null);
      return;
    }
    const controller = new AbortController();
    setRegionStatisticsPending(true);
    setRegionStatistics(null);
    setRegionStatisticsError(null);
    void fetch(
      `/api/modalities/${encodeURIComponent(activeModality.id)}/statistics/${measuredRegionId}`,
      { signal: controller.signal },
    )
      .then(async (response) => {
        const payload = await response.json() as RegionStatistics & { message?: string };
        if (!response.ok) throw new Error(payload.message ?? "Calcul impossible");
        setRegionStatistics(payload);
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setRegionStatisticsError(
          error instanceof Error ? error.message : "Le calcul des statistiques a échoué",
        );
      })
      .finally(() => {
        if (!controller.signal.aborted) setRegionStatisticsPending(false);
      });
    return () => controller.abort();
  }, [activeModality, measuredRegionId, viewerSource]);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/allen-registration/status", { cache: "no-store" })
      .then(readAllenRegistrationResponse)
      .then((nextState) => {
        if (!cancelled) {
          setAllenRegistrationState(nextState);
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/connectivity/status", { cache: "no-store" })
      .then(readConnectivityResponse)
      .then((nextState) => {
        if (!cancelled) {
          setConnectivityState(nextState);
          if (nextState.experimentId) {
            setConnectivityExperimentId(String(nextState.experimentId));
          }
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const revision = registrationState.finishedAt;
    if (!registrationState.hasViewerAssets || !revision || activatedSubjectRevision.current === revision) {
      return;
    }
    activatedSubjectRevision.current = revision;
    setRegistrationFile(null);
    if (!registrationState.viewerManifest) {
      return;
    }
    setSliceIndexesBySource((current) => ({
      ...current,
      subject: Object.fromEntries(
        SLICE_PLANE_ORDER.map((plane) => [
          plane,
          Math.floor(registrationState.viewerManifest!.slice_counts[plane] / 2),
        ]),
      ) as Record<SlicePlane, number>,
    }));
    resetRegionDisplay();
    setSlice3DMode("none");
    setViewerSource("subject");
  }, [registrationState.finishedAt, registrationState.hasViewerAssets, registrationState.viewerManifest]);

  useEffect(() => {
    if (
      registrationState.status !== "uploading" &&
      registrationState.status !== "running"
    ) {
      return;
    }
    let cancelled = false;
    const refresh = async () => {
      try {
        const response = await fetch("/api/import/status", { cache: "no-store" });
        if (!response.ok) {
          throw new Error("État de l'import indisponible");
        }
        const nextState = await readImportResponse(response);
        if (!cancelled) {
          setRegistrationState(nextState);
        }
      } catch (error) {
        if (!cancelled) {
          setRegistrationState((current) => ({
            ...current,
            status: "failed",
            message: error instanceof Error ? error.message : "Connexion à l'import impossible",
          }));
        }
      }
    };
    void refresh();
    const timer = window.setInterval(refresh, 2000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [registrationState.status]);

  useEffect(() => {
    if (allenRegistrationState.status !== "running") {
      return;
    }
    let cancelled = false;
    const refresh = async () => {
      try {
        const response = await fetch("/api/allen-registration/status", { cache: "no-store" });
        const nextState = await readAllenRegistrationResponse(response);
        if (!cancelled) {
          setAllenRegistrationState(nextState);
        }
      } catch (error) {
        if (!cancelled) {
          setAllenRegistrationState((current) => ({
            ...current,
            status: "failed",
            message: error instanceof Error ? error.message : "Connexion au recalage impossible",
          }));
        }
      }
    };
    const timer = window.setInterval(refresh, 2000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [allenRegistrationState.status]);

  useEffect(() => {
    if (connectivityState.status !== "running" && connectivityState.nativeStatus !== "running") {
      return;
    }
    let cancelled = false;
    const refresh = async () => {
      try {
        const response = await fetch("/api/connectivity/status", { cache: "no-store" });
        const nextState = await readConnectivityResponse(response);
        if (!cancelled) {
          setConnectivityState(nextState);
          if (nextState.status === "completed" && nextState.hasViewerAssets) {
            setConnectivityVisible(true);
            if (nextState.nativeStatus === "completed" && nextState.hasNativeViewerAssets) {
              setViewerSource("subject");
              setConnectivityOpen(false);
            } else if (connectivityState.status === "running") {
              setViewerSource("allen");
              setConnectivityOpen(false);
            }
          }
        }
      } catch (error) {
        if (!cancelled) {
          setConnectivityState((current) => ({
            ...current,
            status: "failed",
            message: error instanceof Error ? error.message : "Connexion au module de connectivité impossible",
          }));
        }
      }
    };
    const timer = window.setInterval(refresh, 1500);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [connectivityState.nativeStatus, connectivityState.status]);

  const startRegistration = async () => {
    if (!registrationFile) {
      return;
    }
    setRegistrationPending(true);
    setAllenRegistrationState(INITIAL_ALLEN_REGISTRATION_STATE);
    setConnectivityState((current) => ({
      ...current,
      nativeStatus: "idle",
      nativeMessage: "Projetez la carte dans l'image importée",
      nativeLogTail: [],
      hasNativeViewerAssets: false,
      nativeViewerManifest: null,
    }));
    setConnectivityVisible(false);
    setHoveredRegionId(null);
    setMenuHoveredRegionId(null);
    setSelectedRegionId(null);
    setIsolatedRegionId(null);
    setRegistrationState((current) => ({
      ...current,
      status: "uploading",
      message: "Import de l'image",
      fileName: registrationFile.name,
    }));
    try {
      const response = await fetch("/api/import/start", {
        method: "POST",
        headers: { "X-File-Name": encodeURIComponent(registrationFile.name) },
        body: registrationFile,
      });
      const nextState = await readImportResponse(response);
      setRegistrationState(nextState);
      if (!response.ok) {
        throw new Error(nextState.message);
      }
    } catch (error) {
      setRegistrationState((current) => ({
        ...current,
        status: "failed",
        message: error instanceof Error ? error.message : "L'import n'a pas pu démarrer",
      }));
    } finally {
      setRegistrationPending(false);
    }
  };

  const startAllenRegistration = async () => {
    setAllenRegistrationState((current) => ({
      ...current,
      status: "running",
      message: "Démarrage du recalage Allen",
      logTail: [],
    }));
    try {
      const response = await fetch("/api/allen-registration/start", { method: "POST" });
      const nextState = await readAllenRegistrationResponse(response);
      setAllenRegistrationState(nextState);
      if (!response.ok) {
        throw new Error(nextState.message);
      }
    } catch (error) {
      setAllenRegistrationState((current) => ({
        ...current,
        status: "failed",
        message: error instanceof Error ? error.message : "Le recalage n'a pas pu démarrer",
      }));
    }
  };

  const importModality = async () => {
    const registered = modalityState.sessions?.some((entry) => entry.id === selectedSessionId) ?? false;
    if (!modalityFile || !modalityName.trim() || !modalityAlignmentConfirmed(modalitySession, modalityAligned, registered)) return;
    setModalityState((current) => ({
      ...current,
      status: "uploading",
      message: "Import et validation de la modalité",
    }));
    try {
      const response = await fetch("/api/modalities/import", {
        method: "POST",
        headers: {
          "X-File-Name": encodeURIComponent(modalityFile.name),
          "X-Modality-Name": encodeURIComponent(modalityName.trim()),
          "X-Modality-Alignment": modalitySession === "other" ? "session-rare-aligned" : "same-session-aligned",
          ...(modalitySession === "other" ? { "X-Session-Id": selectedSessionId } : {}),
        },
        body: modalityFile,
      });
      const nextState = await readModalityResponse(response);
      setModalityState(nextState);
      if (!response.ok) throw new Error(nextState.message);
      setModalityFile(null);
      setModalityName("");
      setModalitySession("");
      setModalityAligned(false);
      setActiveModalityId(null);
    } catch (error) {
      setModalityState((current) => ({
        ...current,
        status: "failed",
        message: error instanceof Error ? error.message : "L'import de la modalité a échoué",
      }));
    }
  };

  const registerSession = async (name: string, file: File): Promise<boolean> => {
    setModalityState((current) => ({ ...current, status: "uploading", message: "Import et recalage de la nouvelle session" }));
    setModalityAligned(false);
    try {
      const response = await fetch("/api/sessions/import", {
        method: "POST", headers: { "X-File-Name": encodeURIComponent(file.name), "X-Session-Name": encodeURIComponent(name) }, body: file,
      });
      const next = await readModalityResponse(response);
      setModalityState(next);
      if (!response.ok) throw new Error(next.message);
      const previous = new Set(modalityState.sessions?.map((entry) => entry.id) ?? []);
      const added = next.sessions?.find((entry) => !previous.has(entry.id));
      setSelectedSessionId(added?.id ?? "");
      setModalitySession("other");
      setModalityTask("modality");
      return true;
    } catch (error) {
      setModalityState((current) => ({ ...current, status: "failed", message: error instanceof Error ? error.message : "Recalage de session impossible" }));
      return false;
    }
  };

  const deleteModality = async (id: string) => {
    try {
      const response = await fetch(`/api/modalities/${encodeURIComponent(id)}`, { method: "DELETE" });
      const nextState = await readModalityResponse(response);
      setModalityState(nextState);
      if (!response.ok) throw new Error(nextState.message);
    } catch (error) {
      setModalityState((current) => ({
        ...current,
        status: "failed",
        message: error instanceof Error ? error.message : "La suppression a échoué",
      }));
    }
  };

  const openRegionExport = () => {
    setRegionExportIds(new Set(measuredRegionId === null ? [] : [measuredRegionId]));
    setRegionExportSearch("");
    setRegionExportError(null);
    setRegionExportOpen(true);
  };

  const exportRegionValues = async () => {
    const checkedRegionIds = [...(
      regionExportListRef.current?.querySelectorAll<HTMLInputElement>(
        'input[name="region-export-id"]:checked',
      ) ?? []
    )]
      .map((input) => Number(input.value))
      .filter((regionId) => Number.isSafeInteger(regionId) && regionId > 0);
    if (!activeModality || checkedRegionIds.length === 0) return;
    setRegionExportPending(true);
    setRegionExportError(null);
    try {
      const response = await fetch(
        `/api/modalities/${encodeURIComponent(activeModality.id)}/export-values`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ regionIds: checkedRegionIds }),
        },
      );
      if (!response.ok) {
        const payload = await response.json() as { message?: string };
        throw new Error(payload.message ?? "Export impossible");
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `gamebrain-${activeModality.name.replace(/[^a-zA-Z0-9_-]+/g, "-") || "modalite"}.csv`;
      link.click();
      URL.revokeObjectURL(url);
      setRegionExportOpen(false);
    } catch (error) {
      setRegionExportError(error instanceof Error ? error.message : "L'export a échoué");
    } finally {
      setRegionExportPending(false);
    }
  };

  const startConnectivity = async (
    requestedExperimentId?: number | string,
    requestedMetadata?: ConnectivitySearchResult,
  ) => {
    const rawExperimentId = requestedExperimentId ?? connectivityExperimentId;
    const experimentId = Number(
      typeof rawExperimentId === "string" ? rawExperimentId.trim() : rawExperimentId,
    );
    if (!Number.isSafeInteger(experimentId) || experimentId <= 0) {
      setConnectivityState((current) => ({
        ...current,
        status: "failed",
        message: "Saisissez un identifiant d'expérience Allen valide",
      }));
      return;
    }
    setConnectivityExperimentId(String(experimentId));
    setConnectivityState((current) => ({
      ...current,
      status: "running",
      message: `Chargement de l'expérience Allen ${experimentId}`,
      logTail: [],
      experimentId,
      metadata: requestedMetadata ?? null,
    }));
    try {
      const response = await fetch("/api/connectivity/start", {
        method: "POST",
        headers: { "X-Experiment-Id": String(experimentId) },
      });
      const nextState = await readConnectivityResponse(response);
      setConnectivityState({
        ...nextState,
        metadata: nextState.metadata ?? requestedMetadata ?? null,
      });
      if (!response.ok) {
        throw new Error(nextState.message);
      }
      if (nextState.status === "completed" && nextState.hasViewerAssets) {
        setExperimentExplorerEnabled(false);
        setHoveredExperiment(null);
        setConnectivityVisible(true);
        setViewerSource(viewerSource === "subject" && nextState.hasNativeViewerAssets ? "subject" : "allen");
        setConnectivityOpen(false);
      }
    } catch (error) {
      setConnectivityState((current) => ({
        ...current,
        status: "failed",
        message: error instanceof Error ? error.message : "L'expérience n'a pas pu être chargée",
      }));
    }
  };

  const searchConnectivityExperiments = async () => {
    const structure = connectivityRegionQuery.trim();
    if (!structure) {
      setConnectivitySearchStatus("failed");
      setConnectivitySearchMessage("Saisissez une région Allen");
      return;
    }
    setConnectivitySearchStatus("loading");
    setConnectivitySearchMessage("Recherche des expériences Allen");
    setConnectivitySearchResults([]);
    try {
      const response = await fetch(
        `/api/connectivity/search?structure=${encodeURIComponent(structure)}`,
        { cache: "no-store" },
      );
      const payload = await response.json() as ConnectivitySearchResponse;
      if (!response.ok) {
        throw new Error(payload.message);
      }
      setConnectivitySearchResults(payload.results);
      setConnectivitySearchStatus("completed");
      setConnectivitySearchMessage(payload.message);
      setConnectivityState((current) => current.status === "failed"
        && current.message === "Saisissez un identifiant d'expérience Allen valide"
        ? {
            ...current,
            status: current.hasViewerAssets ? "completed" : "idle",
            message: current.hasViewerAssets
              ? `Expérience Allen ${current.experimentId} prête`
              : "Sélectionnez une expérience Allen",
          }
        : current);
    } catch (error) {
      setConnectivitySearchStatus("failed");
      setConnectivitySearchMessage(
        error instanceof Error ? error.message : "La recherche Allen a échoué",
      );
    }
  };

  const cancelConnectivity = async () => {
    try {
      const response = await fetch("/api/connectivity/cancel", { method: "DELETE" });
      const nextState = await readConnectivityResponse(response);
      setConnectivityState(nextState);
    } catch (error) {
      setConnectivityState((current) => ({
        ...current,
        status: "failed",
        message: error instanceof Error ? error.message : "Impossible d'annuler le chargement",
      }));
    }
  };

  const startNativeConnectivity = async () => {
    setConnectivityState((current) => ({
      ...current,
      nativeStatus: "running",
      nativeMessage: "Projection de la connectivité vers l'image",
      nativeLogTail: [],
    }));
    try {
      const response = await fetch("/api/connectivity/native/start", { method: "POST" });
      const nextState = await readConnectivityResponse(response);
      setConnectivityState(nextState);
      if (!response.ok) throw new Error(nextState.nativeMessage);
    } catch (error) {
      setConnectivityState((current) => ({
        ...current,
        nativeStatus: "failed",
        nativeMessage: error instanceof Error ? error.message : "La projection native a échoué",
      }));
    }
  };

  const deleteImportedImage = async () => {
    try {
      const response = await fetch("/api/import/current", { method: "DELETE" });
      const nextState = await readImportResponse(response);
      if (!response.ok) {
        throw new Error(nextState.message);
      }
      setRegistrationState(nextState);
      setAllenRegistrationState(INITIAL_ALLEN_REGISTRATION_STATE);
      setModalityState(INITIAL_MODALITY_STATE);
      setModalityFile(null);
      setModalityName("");
      setActiveModalityId(null);
      setRegistrationFile(null);
      setViewerSource("allen");
      setSlice3DMode("none");
      setSliceIndexesBySource((current) => ({
        ...current,
        allen: Object.fromEntries(
          SLICE_PLANE_ORDER.map((plane) => [
            plane,
            Math.floor(sliceCount(plane, sliceResolution) / 2),
          ]),
        ) as Record<SlicePlane, number>,
      }));
      resetRegionDisplay();
    } catch (error) {
      setRegistrationState((current) => ({
        ...current,
        status: "failed",
        message: error instanceof Error ? error.message : "L'image n'a pas pu être supprimée",
      }));
    }
  };

  const resetEntireSession = async () => {
    const confirmed = window.confirm(
      t("Tout supprimer et revenir à l'état initial ?\n\nL'image importée, son recalage et toutes les données de connectivité calculées seront définitivement effacés."),
    );
    if (!confirmed) return;
    try {
      const response = await fetch("/api/session", { method: "DELETE" });
      const payload = await response.json() as { ok: boolean; message: string };
      if (!response.ok || !payload.ok) throw new Error(payload.message);
      clearConnectivitySliceCache();
      setRegistrationState(INITIAL_REGISTRATION_STATE);
      setAllenRegistrationState(INITIAL_ALLEN_REGISTRATION_STATE);
      setConnectivityState(INITIAL_CONNECTIVITY_STATE);
      setModalityState(INITIAL_MODALITY_STATE);
      setModalityFile(null);
      setModalityName("");
      setRegistrationFile(null);
      setConnectivityExperimentId("100140756");
      setConnectivitySearchStatus("idle");
      setConnectivitySearchMessage("Recherchez une région d'injection Allen");
      setConnectivitySearchResults([]);
      resetWorkspaceDisplay();
      const centeredAllenIndexes = Object.fromEntries(
        SLICE_PLANE_ORDER.map((plane) => [plane, Math.floor(sliceCount(plane, 25) / 2)]),
      ) as Record<SlicePlane, number>;
      setSliceIndexesBySource({
        allen: centeredAllenIndexes,
        subject: { ...centeredAllenIndexes },
      });
    } catch (error) {
      window.alert(t(error instanceof Error ? error.message : "La réinitialisation complète a échoué"));
    }
  };

  const connectivitySliceSource = (layer: "projection" | "injection") => {
    if (!connectivityVisible || (layer === "projection" ? !projectionVisible : !injectionVisible)) return undefined;
    if (viewerSource === "allen" && connectivityState.viewerManifest) {
      return connectivityOverlayUrl(layer, activePlane, sliceIndex, sliceResolution, connectivityState.viewerManifest, connectivityState.finishedAt);
    }
    if (viewerSource === "subject" && connectivityState.hasNativeViewerAssets) {
      return nativeConnectivityOverlayUrl(layer, activePlane, sliceIndex, connectivityState.finishedAt, connectivityState.experimentId, connectivityState.nativeFinishedAt);
    }
    return undefined;
  };
  const connectivitySliceProjectionSrc = connectivitySliceSource("projection");
  const connectivitySliceInjectionSrc = connectivitySliceSource("injection");

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="title-block">
          <p className="eyebrow">
            {viewerSource === "subject" ? t("Image NIfTI importée") : t(`Allen Mouse Brain Atlas / ${sliceResolution} um`)}
          </p>
          <h1>{t("Atlas anatomique")}</h1>
        </div>
        <div className="topbar-actions">
          <div className="language-selector" role="group" aria-label={t("Langue de l'interface")}>
            <button type="button" aria-pressed={language === "fr"} lang="fr" title="Français" onClick={() => setLanguage("fr")}>FR</button>
            <button type="button" aria-pressed={language === "en"} lang="en" title="English" onClick={() => setLanguage("en")}>EN</button>
          </div>
          {registrationState.hasViewerAssets && (
            <div className="source-selector" role="group" aria-label={t("Image affichée")}>
              <button
                aria-pressed={viewerSource === "allen"}
                className={viewerSource === "allen" ? "is-active" : undefined}
                onClick={() => setViewerSource("allen")}
                type="button"
              >{t("Allen")}</button>
              <button
                aria-pressed={viewerSource === "subject"}
                className={viewerSource === "subject" ? "is-active" : undefined}
                onClick={() => {
                  setSlice3DMode("none");
                  setViewerSource("subject");
                }}
                type="button"
              >{t("Image importée")}</button>
            </div>
          )}
          {!registrationState.hasViewerAssets ? (
            <button
              className="registration-button"
              type="button"
              onClick={() => setRegistrationOpen(true)}
            >
              {registrationState.status === "uploading" || registrationState.status === "running" ? t("Import en cours") : t("Importer une image")}
            </button>
          ) : (
            <details className="image-menu" ref={imageMenuRef}>
              <summary>
                <span>{t("Image")}</span>
                <span
                  className={`image-menu-status${subjectAnnotationsAvailable ? " is-ready" : ""}${allenRegistrationState.status === "running" ? " is-running" : ""}`}
                  aria-hidden="true"
                />
              </summary>
              <div className="image-menu-popover">
                <div className="image-menu-heading">
                  <strong>{registrationState.fileName ?? t("Image importée")}</strong>
                  <span>
                    {allenRegistrationState.status === "running"
                      ? t("Recalage Allen en cours")
                      : subjectAnnotationsAvailable
                        ? t("Régions Allen disponibles")
                        : t("Régions Allen non calculées")}
                  </span>
                </div>
                <button
                  aria-label={t("Gérer l'image et son import")}
                  type="button"
                  onClick={(event) => {
                    event.currentTarget.closest("details")?.removeAttribute("open");
                    setRegistrationOpen(true);
                  }}
                >{t("Image et import")}</button>
                <button
                  aria-label={allenRegistrationState.status === "running" ? t("Suivre le recalage Allen") : subjectAnnotationsAvailable
                    ? t("Gérer le recalage Allen de l'image importée")
                    : t("Recaler l'image importée avec Allen")}
                  type="button"
                  onClick={(event) => {
                    event.currentTarget.closest("details")?.removeAttribute("open");
                    setAllenRegistrationOpen(true);
                  }}
                >
                  {allenRegistrationState.status === "running" ? t("Suivre le recalage") : t("Recalage Allen")}
                </button>
                <button
                  aria-label={t("Gérer les modalités complémentaires")}
                  type="button"
                  onClick={(event) => {
                    event.currentTarget.closest("details")?.removeAttribute("open");
                    setModalitiesOpen(true);
                  }}
                >{t("Modalités")}{modalityState.modalities.length > 0
                    ? ` (${modalityState.modalities.length})`
                    : ""}
                </button>
                <button
                  aria-label={t("Supprimer l'image importée")}
                  className="is-danger"
                  type="button"
                  disabled={
                    registrationState.status === "uploading" ||
                    registrationState.status === "running" ||
                    allenRegistrationState.status === "running"
                  }
                  onClick={() => {
                    if (window.confirm(t("Supprimer l’image importée et toutes les données générées ?"))) {
                      void deleteImportedImage();
                    }
                  }}
                >{t("Supprimer l’image")}</button>
              </div>
            </details>
          )}
          {viewerSource === "subject" && activeModality && subjectAnnotationsAvailable && (
            <button
              className="global-reset-button"
              type="button"
              onClick={openRegionExport}
            >{t("Exporter les valeurs")}</button>
          )}
          <button
            className={`global-reset-button${connectivityVisible ? " is-active" : ""}`}
            type="button"
            onClick={() => setConnectivityOpen(true)}
          >{t("Connectivité")}</button>
          <details className="image-menu session-menu" ref={sessionMenuRef}>
            <summary>{t("Session")}</summary>
            <div className="image-menu-popover">
              <button type="button" onClick={(event) => {
                event.currentTarget.closest("details")?.removeAttribute("open");
                resetWorkspaceDisplay();
              }}><RotateCcw size={15} aria-hidden="true" /> {t("Rétablir l'affichage")}</button>
              <button className="is-danger" type="button" onClick={(event) => {
                event.currentTarget.closest("details")?.removeAttribute("open");
                void resetEntireSession();
              }}>{t("Supprimer les données de session")}</button>
            </div>
          </details>
        </div>
      </header>
      {registrationOpen && (
        <div className="registration-overlay" role="presentation">
          <section
            aria-labelledby="registration-title"
            aria-modal="true"
            className="registration-dialog"
            role="dialog"
          >
            <header className="registration-dialog-header">
              <div>
                <h2 id="registration-title">{registrationState.hasViewerAssets && !registrationFile ? t("Image de référence") : t("Importer une image")}</h2>
              </div>
              <button
                aria-label={t("Fermer")}
                className="dialog-close"
                type="button"
                onClick={() => setRegistrationOpen(false)}
              >{t("×")}</button>
            </header>
            <div className="registration-dialog-body">
              {imageWorkflow("image")}
              <div className="registration-dataset">
                <div>
                  <strong>
                    {registrationFile?.name ?? registrationState.fileName ?? t("Aucune image sélectionnée")}
                  </strong>
                  <span>{registrationFile ? t(`${(registrationFile.size / 1024 / 1024).toFixed(1)} Mo · NIfTI 3D`) : t("Image de référence · espace natif")}</span>
                </div>
              </div>

              <label className="registration-file-picker">
                <input
                  type="file"
                  aria-label={t("Image NIfTI à importer")}
                  accept=".nii,.nii.gz,application/gzip"
                  disabled={registrationState.status === "uploading" || registrationState.status === "running"}
                  onClick={(event) => {
                    event.currentTarget.value = "";
                  }}
                  onChange={(event) => {
                    const file = event.currentTarget.files?.[0] ?? null;
                    setRegistrationFile(file);
                    setRegistrationState((current) => ({
                      ...current,
                      status: file ? "idle" : current.status,
                      message: file ? "Image prête pour l'import" : current.message,
                    }));
                  }}
                />
                <span>{registrationFile ? t("Changer d'image") : t("Choisir une image")}</span>
                <small>{t(".nii ou .nii.gz")}</small>
              </label>
              {registrationFile && registrationState.hasViewerAssets && !imageWorkBusy && (
                <button type="button" className="workflow-text-action" onClick={() => {
                  setRegistrationFile(null);
                  setRegistrationState((current) => ({ ...current, status: "completed", message: "Image disponible" }));
                }}>{t("Conserver l'image actuelle")}</button>
              )}
              <WorkflowStatus
                status={registrationPending ? "running" : registrationState.status}
                title={registrationState.status === "failed" ? t("Import interrompu")
                  : registrationState.status === "uploading" ? t("Transfert de l'image")
                    : registrationPending || registrationState.status === "running" ? t("Préparation du cerveau et des coupes")
                      : registrationFile ? t("Image prête à importer")
                        : registrationState.hasViewerAssets ? t("Image disponible") : t("Choisir une image NIfTI")}
                message={registrationState.message} logs={registrationFile && registrationState.status === "idle" ? [] : registrationState.logTail}
              />
            </div>
            <footer className="registration-dialog-actions">
              {registrationState.hasViewerAssets && (
                <button
                  type="button"
                  onClick={() => {
                    setSlice3DMode("none");
                    setViewerSource("subject");
                    setRegistrationOpen(false);
                  }}
                >{t("Afficher l’image")}</button>
              )}
              <button type="button" onClick={() => setRegistrationOpen(false)}>
                {imageWorkBusy ? t("Continuer en arrière-plan") : t("Fermer")}
              </button>
              <button
                className="is-primary"
                type="button"
                disabled={
                  (!registrationFile && !registrationState.hasViewerAssets) ||
                  registrationPending ||
                  registrationState.status === "uploading" ||
                  registrationState.status === "running" ||
                  allenRegistrationState.status === "running"
                }
                onClick={() => {
                  if (registrationFile) void startRegistration();
                  else openImageTask("atlas");
                }}
              >
                {registrationState.status === "uploading"
                  ? t("Import en cours")
                  : registrationPending || registrationState.status === "running"
                  ? t("Préparation en cours")
                  : registrationFile ? registrationState.status === "failed" ? t("Réessayer l'import") : t("Importer l'image")
                    : registrationState.hasViewerAssets ? t("Ouvrir le recalage") : t("Importer l'image")}
              </button>
            </footer>
          </section>
        </div>
      )}
      {allenRegistrationOpen && (
        <div className="registration-overlay" role="presentation">
          <section
            aria-labelledby="allen-registration-title"
            aria-modal="true"
            className="registration-dialog"
            role="dialog"
          >
            <header className="registration-dialog-header">
              <div>
                <h2 id="allen-registration-title">{t("Recalage Allen")}</h2>
              </div>
              <button
                aria-label={t("Fermer")}
                className="dialog-close"
                type="button"
                onClick={() => setAllenRegistrationOpen(false)}
              >{t("×")}</button>
            </header>
            <div className="registration-dialog-body">
              {imageWorkflow("atlas")}
              <div className="registration-dataset">
                <div>
                  <strong>{registrationState.fileName ?? t("Image importée")}</strong>
                  <span>{t("Atlas Allen CCF 2017 · espace natif de l'image")}</span>
                </div>
              </div>
              <WorkflowStatus status={allenRegistrationState.status}
                title={allenRegistrationState.status === "running" ? t("Recalage et préparation des régions en cours")
                  : allenRegistrationState.status === "failed" ? t("Recalage interrompu")
                    : subjectAnnotationsAvailable ? t("Régions Allen disponibles")
                      : allenRegistrationState.status === "completed" ? t("Régions à préparer") : t("Recalage non lancé")}
                message={allenRegistrationState.message} logs={allenRegistrationState.logTail} />
            </div>
            <footer className="registration-dialog-actions">
              <button type="button" onClick={() => setAllenRegistrationOpen(false)}>
                {allenRegistrationState.status === "running" ? t("Continuer en arrière-plan") : t("Fermer")}
              </button>
              <button
                className={subjectAnnotationsAvailable ? undefined : "is-primary"}
                type="button"
                disabled={imageWorkBusy || !registrationState.hasViewerAssets}
                onClick={() => {
                  if (!subjectAnnotationsAvailable || window.confirm(t("Relancer le recalage et recalculer les régions Allen de cette image ?"))) {
                    void startAllenRegistration();
                  }
                }}
              >
                {subjectAnnotationsAvailable
                  ? t("Recalculer les régions")
                  : allenRegistrationState.status === "completed"
                    ? t("Préparer les régions")
                    : allenRegistrationState.status === "failed" ? t("Réessayer le recalage") : t("Lancer le recalage")}
              </button>
              {subjectAnnotationsAvailable && <button type="button" className="is-primary" onClick={() => {
                setViewerSource("subject");
                setShowImportedAnnotations(true);
                setAllenRegistrationOpen(false);
              }}>{t("Voir les régions")}</button>}
            </footer>
          </section>
        </div>
      )}
      {modalitiesOpen && (
        <div className="registration-overlay" role="presentation">
          <section
            aria-labelledby="modalities-title"
            aria-modal="true"
            className="registration-dialog modalities-dialog"
            role="dialog"
          >
            <header className="registration-dialog-header">
              <div>
                <h2 id="modalities-title">{t("Modalités et sessions")}</h2>
              </div>
              <button
                aria-label={t("Fermer")}
                className="dialog-close"
                type="button"
                onClick={() => setModalitiesOpen(false)}
              >{t("×")}</button>
            </header>
            <div className="registration-dialog-body modalities-body">
              {imageWorkflow("modalities")}
              <div className="workflow-reference"><span>{t("Image de référence")}</span><strong>{registrationState.fileName ?? t("Aucune image importée")}</strong></div>
              <div className="modality-task-tabs" role="tablist" aria-label={t("Import des données")}>
                <button type="button" role="tab" id="modality-task-tab" aria-controls="modality-task-panel"
                  aria-selected={modalityTask === "modality"} disabled={imageWorkBusy}
                  onClick={() => setModalityTask("modality")}>{t("Importer une modalité")}</button>
                <button type="button" role="tab" id="session-task-tab" aria-controls="session-task-panel"
                  aria-selected={modalityTask === "session"} disabled={imageWorkBusy}
                  onClick={() => setModalityTask("session")}>{t("Ajouter une session (RARE)")}</button>
              </div>
              {modalityTask === "session" ? <div role="tabpanel" id="session-task-panel" aria-labelledby="session-task-tab">
                <SessionImport disabled={imageWorkBusy} onRegister={registerSession} />
              </div> : <div role="tabpanel" id="modality-task-panel" aria-labelledby="modality-task-tab" className="modality-task-panel">
              <ModalityAlignment session={modalitySession} aligned={modalityAligned}
                disabled={imageWorkBusy}
                onSessionChange={(session) => { setModalitySession(session); setModalityAligned(false); }}
                onAlignedChange={setModalityAligned}
                sessions={modalityState.sessions ?? []} selectedSessionId={selectedSessionId}
                onSessionIdChange={(id) => { setSelectedSessionId(id); setModalityAligned(false); }}
                onAddSession={() => setModalityTask("session")}
                onViewSession={(session) => {
                  setActiveModalityId(session.previewModalityId); setViewerSource("subject");
                  setCompareSlices(true); setRegistrationQC(false); setModalitiesOpen(false);
                }} />
              {(modalitySession === "same" || (modalitySession === "other" && modalityState.sessions?.some((entry) => entry.id === selectedSessionId))) && <>
              <section className="modality-import-panel" aria-label={t("Modalité à importer")}>
                <label className="modality-name-field">
                  <span>{t("Nom de la modalité")}</span>
                  <input
                    type="text"
                    maxLength={80}
                    placeholder={t("Ex. T2 map, ADC, FA")}
                    value={modalityName}
                    disabled={modalityState.status === "uploading"}
                    onChange={(event) => setModalityName(event.currentTarget.value)}
                  />
                </label>
                <label className="registration-file-picker">
                  <input
                    type="file"
                    aria-label={t("Fichier de modalité NIfTI")}
                    accept=".nii,.nii.gz,application/gzip"
                    disabled={modalityState.status === "uploading"}
                    onClick={(event) => { event.currentTarget.value = ""; }}
                    onChange={(event) => {
                      const file = event.currentTarget.files?.[0] ?? null;
                      setModalityFile(file);
                      setModalityAligned(false);
                      if (file && !modalityName.trim()) {
                        setModalityName(file.name.replace(/\.nii(?:\.gz)?$/i, ""));
                      }
                    }}
                  />
                  <small>{t("Fichier NIfTI")}</small>
                  <span>{modalityFile ? t("Changer de fichier") : t("Choisir un fichier")}</span>
                </label>
                <button
                  type="button"
                  className="modality-import-button"
                  disabled={!registrationState.hasViewerAssets || !modalityFile || !modalityName.trim() || !modalityAlignmentConfirmed(modalitySession, modalityAligned, modalityState.sessions?.some((entry) => entry.id === selectedSessionId)) || imageWorkBusy}
                  onClick={() => void importModality()}
                >
                  {modalityState.status === "uploading" ? t("Validation en cours") : t("Importer")}
                </button>
              </section>
              {modalityFile && <p className="modality-selected-file">{modalityFile.name}</p>}
              </>}
              </div>}
              <WorkflowStatus status={modalityState.status}
                title={modalityState.status === "uploading" ? t("Traitement en cours")
                  : modalityState.status === "failed" ? t("Opération sur la modalité interrompue")
                    : modalityState.modalities.length > 0 ? t(`${modalityState.modalities.length} modalité${modalityState.modalities.length > 1 ? "s" : ""} disponible${modalityState.modalities.length > 1 ? "s" : ""}`)
                      : t("Aucune modalité complémentaire")}
                message={modalityState.message} />
              {modalityTask === "modality" && modalityState.modalities.length > 0 && <div className="modality-list">
                {modalityState.modalities.map((modality) => (
                  <article className="modality-row" key={modality.id}>
                    <div className="modality-row-heading">
                      <div>
                        <strong>{modality.name}</strong>
                        <span>{modality.sourceFile}</span>
                      </div>
                      <span className={`modality-geometry is-${modality.geometryStatus}`}
                        title={modality.geometryStatus === "registered" ? t("Transformation de la RARE de session appliquée vers la référence") : modality.geometryStatus === "compatible" ? t("Grille identique à l'image de référence") : t("Grille adaptée à l'image de référence, sans recalage anatomique supplémentaire")}>
                        {modality.geometryStatus === "registered" ? t("Recalée") : modality.geometryStatus === "compatible"
                          ? t("Grille compatible")
                          : t("Rééchantillonnée")}
                      </span>
                    </div>
                    <dl>
                      <div><dt>{t("Dimensions")}</dt><dd>{modality.shape.join(t(" × "))}</dd></div>
                      <div>
                        <dt>{t("Espacement")}</dt>
                        <dd>{modality.spacingMm.map((value) => value.toFixed(3)).join(t(" × "))} {t("mm")}</dd>
                      </div>
                      <div>
                        <dt>{t("Valeurs")}</dt>
                        <dd>{modality.valueRange.map((value) => value.toPrecision(4)).join(" – ")}</dd>
                      </div>
                    </dl>
                    <div className="modality-row-actions">
                      <button type="button" className="modality-show" onClick={() => {
                        setActiveModalityId(modality.id);
                        setViewerSource("subject");
                        setModalitiesOpen(false);
                      }}>{viewerSource === "subject" && activeModalityId === modality.id ? t("Affichée") : t("Afficher")}</button>
                    <button
                      type="button"
                      className="modality-delete"
                      onClick={() => {
                        if (window.confirm(t(`Supprimer la modalité « ${modality.name} » ?`))) {
                          void deleteModality(modality.id);
                        }
                      }}
                    >{t("Supprimer")}</button>
                    </div>
                  </article>
                ))}
              </div>}
            </div>
            <footer className="registration-dialog-actions">
              <button type="button" onClick={() => setModalitiesOpen(false)}>{t("Fermer")}</button>
            </footer>
          </section>
        </div>
      )}
      {regionExportOpen && (
        <div className="registration-overlay" role="presentation">
          <section
            aria-labelledby="region-export-title"
            aria-modal="true"
            className="registration-dialog region-export-dialog"
            role="dialog"
          >
            <header className="registration-dialog-header">
              <div>
                <p className="panel-kicker">{t("Données quantitatives")}</p>
                <h2 id="region-export-title">{t("Exporter les valeurs")}</h2>
              </div>
              <button
                aria-label={t("Fermer")}
                className="dialog-close"
                type="button"
                onClick={() => setRegionExportOpen(false)}
              >{t("×")}</button>
            </header>
            <div className="registration-dialog-body region-export-body">
              <div className="region-export-toolbar">
                <label>
                  <span className="visually-hidden">{t("Rechercher une région")}</span>
                  <input
                    type="search"
                    placeholder={t("Nom, acronyme ou identifiant")}
                    value={regionExportSearch}
                    onChange={(event) => setRegionExportSearch(event.currentTarget.value)}
                  />
                </label>
                <button
                  type="button"
                  onClick={() => setRegionExportIds(new Set(exportableRegions.map((region) => region.id)))}
                >{t("Tout sélectionner")}</button>
                <button type="button" onClick={() => setRegionExportIds(new Set())}>{t("Aucun")}</button>
              </div>
              <div className="region-export-count">
                <strong>{t(`${regionExportIds.size} ${regionExportIds.size === 1 ? "région sélectionnée" : "régions sélectionnées"}`)}</strong>
                <span>{t("Modalité :")} {activeModality?.name ?? t("indisponible")}</span>
              </div>
              <div className="region-export-list" ref={regionExportListRef}>
                {filteredExportRegions.map((structure) => (
                  <label key={structure.id}>
                    <input
                      type="checkbox"
                      name="region-export-id"
                      value={structure.id}
                      checked={regionExportIds.has(structure.id)}
                      onChange={() => setRegionExportIds((current) => {
                        const next = new Set(current);
                        if (next.has(structure.id)) next.delete(structure.id);
                        else next.add(structure.id);
                        return next;
                      })}
                    />
                    <span className="color-swatch" style={{ backgroundColor: structure.color }} />
                    <strong>{structure.acronym}</strong>
                    <span>{structure.name}</span>
                    <small>{structure.id}</small>
                  </label>
                ))}
                {filteredExportRegions.length === 0 && (
                  <p className="region-search-empty">{t("Aucune région trouvée")}</p>
                )}
              </div>
              {regionExportError && (
                <p className="registration-message is-error">{t(regionExportError)}</p>
              )}
            </div>
            <footer className="registration-dialog-actions">
              <button type="button" onClick={() => setRegionExportOpen(false)}>{t("Annuler")}</button>
              <button
                type="button"
                className="is-primary"
                disabled={regionExportIds.size === 0 || regionExportPending}
                onClick={() => void exportRegionValues()}
              >
                {regionExportPending ? t("Création du CSV") : t("Exporter le CSV")}
              </button>
            </footer>
          </section>
        </div>
      )}
      {connectivityOpen && (
        <div className="registration-overlay" role="presentation">
          <section
            aria-labelledby="connectivity-title"
            aria-modal="true"
            className="registration-dialog connectivity-dialog"
            role="dialog"
          >
            <header className="registration-dialog-header">
              <div>
                <p className="panel-kicker">{t("Allen Mouse Connectivity Atlas")}</p>
                <h2 id="connectivity-title">{t("Charger une expérience")}</h2>
              </div>
              <button
                aria-label={t("Fermer")}
                className="dialog-close"
                type="button"
                onClick={() => setConnectivityOpen(false)}
              >{t("×")}</button>
            </header>
            <div className="registration-dialog-body">
              {registrationState.hasViewerAssets && <>
                {imageWorkflow("connectivity")}
                <div className="workflow-reference"><span>{t("Image cible")}</span><strong>{registrationState.fileName}</strong></div>
                {!subjectAnnotationsAvailable && <div className="workflow-prerequisite">
                  <span>{t("Projection sur l'image : recalage Allen requis")}</span>
                  <button type="button" onClick={() => openImageTask("atlas")}>{t("Régions Allen")}</button>
                </div>}
              </>}
              <div className="registration-dataset">
                <div>
                  <strong>
                    {connectivityState.experimentId
                      ? t(`Expérience ${connectivityState.experimentId}`)
                      : t("Projection Allen")}
                  </strong>
                  <span>{t("Densité de projection et site d’injection · 50 µm")}</span>
                </div>
              </div>
              <div className="connectivity-load-modes" role="tablist" aria-label={t("Méthode de sélection")}>
                <button
                  type="button"
                  role="tab"
                  aria-selected={connectivityLoadMode === "region"}
                  className={connectivityLoadMode === "region" ? "is-active" : ""}
                  onClick={() => {
                    setConnectivityLoadMode("region");
                    setConnectivityState((current) => current.status === "failed"
                      && current.message === "Saisissez un identifiant d'expérience Allen valide"
                      ? {
                          ...current,
                          status: current.hasViewerAssets ? "completed" : "idle",
                          message: current.hasViewerAssets
                            ? `Expérience Allen ${current.experimentId} prête`
                            : "Recherchez ou sélectionnez une expérience Allen",
                        }
                      : current);
                  }}
                >{t("Par région")}</button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={connectivityLoadMode === "id"}
                  className={connectivityLoadMode === "id" ? "is-active" : ""}
                  onClick={() => setConnectivityLoadMode("id")}
                >{t("Par identifiant")}</button>
              </div>
              {connectivityLoadMode === "region" ? (
                <div className="connectivity-search-panel" role="tabpanel">
                  <form
                    className="connectivity-search-form"
                    onSubmit={(event) => {
                      event.preventDefault();
                      void searchConnectivityExperiments();
                    }}
                  >
                    <label htmlFor="connectivity-region-query">{t("Région d'injection")}</label>
                    <div>
                      <input
                        id="connectivity-region-query"
                        type="search"
                        value={connectivityRegionQuery}
                        disabled={connectivitySearchStatus === "loading" || connectivityState.status === "running"}
                        placeholder={t("Ex. VISp, Isocortex ou 315")}
                        onChange={(event) => setConnectivityRegionQuery(event.currentTarget.value)}
                      />
                      <button
                        type="submit"
                        disabled={connectivitySearchStatus === "loading" || connectivityState.status === "running"}
                      >
                        {connectivitySearchStatus === "loading" ? t("Recherche") : t("Rechercher")}
                      </button>
                    </div>
                  </form>
                  <p
                    className={`connectivity-search-message${connectivitySearchStatus === "failed" ? " is-error" : ""}`}
                    aria-live="polite"
                  >
                    {t(connectivitySearchMessage)}
                  </p>
                  {connectivitySearchResults.length > 0 && (
                    <div className="connectivity-search-results">
                      {connectivitySearchResults.map((experiment) => (
                        <article className="connectivity-experiment-row" key={experiment.id}>
                          <span
                            className="connectivity-experiment-swatch"
                            style={{ backgroundColor: experiment.primaryStructure.color ? `#${experiment.primaryStructure.color}` : undefined }}
                            aria-hidden="true"
                          />
                          <div className="connectivity-experiment-main">
                            <strong>
                              {experiment.primaryStructure.acronym || t("Région Allen")}
                              <span>#{experiment.id}</span>
                            </strong>
                            <span>{experiment.primaryStructure.name || t("Région principale non renseignée")}</span>
                            <small>
                              {experiment.transgenicLine || experiment.strain || t("Expérience standard")}
                              {experiment.sex ? ` · ${experiment.sex}` : ""}
                              {experiment.injectionVolumeMm3 !== null
                                ? t(` · ${experiment.injectionVolumeMm3.toFixed(3)} mm³`)
                                : ""}
                            </small>
                          </div>
                          <button
                            type="button"
                            disabled={connectivityState.status === "running"}
                            onClick={() => void startConnectivity(experiment.id, experiment)}
                          >{t("Charger")}</button>
                        </article>
                      ))}
                    </div>
                  )}
                </div>
              ) : (
                <label className="connectivity-form" role="tabpanel">
                  <span>{t("Identifiant de l’expérience Allen")}</span>
                  <input
                    type="text"
                    inputMode="numeric"
                    value={connectivityExperimentId}
                    disabled={connectivityState.status === "running"}
                    onChange={(event) => setConnectivityExperimentId(event.currentTarget.value)}
                  />
                  <small>{t("Exemple proposé par M2M : 100140756")}</small>
                </label>
              )}
              <WorkflowStatus status={connectivityState.status}
                title={connectivityState.status === "running" ? t("Préparation de l'expérience Allen")
                  : connectivityState.status === "failed" ? t("Chargement de l'expérience interrompu")
                    : connectivityState.hasViewerAssets ? t("Carte disponible dans l'atlas Allen") : t("Aucune expérience chargée")}
                message={connectivityState.message} logs={connectivityState.logTail} />
              {connectivityState.nativeStatus !== "idle" && <WorkflowStatus status={connectivityState.nativeStatus}
                title={connectivityState.nativeStatus === "running" ? t("Projection dans l'image personnelle en cours")
                  : connectivityState.nativeStatus === "failed" ? t("Projection dans l'image interrompue")
                    : t("Carte disponible dans l'image personnelle")}
                message={connectivityState.nativeMessage} logs={connectivityState.nativeLogTail} />}
            </div>
            <footer className="registration-dialog-actions">
              <button
                type="button"
                onClick={exploreExperiments}
              >{t("Explorer les injections en 3D")}</button>
              {connectivityState.status === "running" && (
                <button
                  className="is-danger"
                  type="button"
                  onClick={() => void cancelConnectivity()}
                >{t("Annuler le chargement")}</button>
              )}
              {connectivityState.hasViewerAssets && (
                <button
                  type="button"
                  onClick={() => {
                    setConnectivityVisible(true);
                    setViewerSource("allen");
                    setConnectivityOpen(false);
                  }}
                >{t("Voir dans Allen")}</button>
              )}
              {connectivityState.hasViewerAssets && subjectAnnotationsAvailable && (
                <button
                  className="is-primary"
                  type="button"
                  disabled={imageWorkBusy || connectivityState.status === "running"}
                  onClick={() => {
                    if (connectivityState.hasNativeViewerAssets) {
                      setExperimentExplorerEnabled(false);
                      setViewerSource("subject");
                      setConnectivityVisible(true);
                      setConnectivityOpen(false);
                    } else void startNativeConnectivity();
                  }}
                >
                  {connectivityState.nativeStatus === "running"
                    ? t("Projection en cours")
                    : connectivityState.hasNativeViewerAssets
                      ? t("Voir dans mon image")
                      : t("Projeter sur l'image")}
                </button>
              )}
              {connectivityState.hasNativeViewerAssets && subjectAnnotationsAvailable && <button type="button"
                disabled={imageWorkBusy || connectivityState.status === "running"}
                onClick={() => {
                  if (window.confirm(t("Recalculer la projection de cette expérience dans l'image personnelle ?"))) void startNativeConnectivity();
                }}>{t("Recalculer la projection")}</button>}
              <button type="button" onClick={() => setConnectivityOpen(false)}>
                {connectivityState.nativeStatus === "running" || connectivityState.status === "running" ? t("Continuer en arrière-plan") : t("Fermer")}
              </button>
              {connectivityLoadMode === "id" && (
                <button
                  className="is-primary"
                  type="button"
                  disabled={connectivityState.status === "running"}
                  onClick={() => void startConnectivity()}
                >
                  {connectivityState.status === "running" ? t("Chargement en cours") : t("Charger")}
                </button>
              )}
            </footer>
          </section>
        </div>
      )}
      <Workspace resetRevision={sceneResetKey}>
        <section
          className={`viewer${sidebarCollapsed ? " is-sidebar-collapsed" : ""}${activeRegion ? " is-hovering" : ""}`}
          aria-label={t("Vue 3D des regions anatomiques Allen")}
        >
          <aside className="viewer-sidebar" aria-label={t("Réglages de la vue 3D")}>
            <header className="viewer-sidebar-header">
              <span>{sidebarCollapsed ? "3D" : t("Vue 3D")}</span>
              <div className="viewer-sidebar-actions">
                {!sidebarCollapsed && <button type="button" className="sidebar-toggle"
                  aria-label={t("Recentrer la vue 3D")} title={t("Recentrer la vue 3D")}
                  onClick={() => setCameraResetRevision((current) => current + 1)}>
                  <Focus size={16} aria-hidden="true" />
                </button>}
              <button
                type="button"
                className="sidebar-toggle"
                aria-label={sidebarCollapsed ? t("Ouvrir le panneau 3D") : t("Réduire le panneau 3D")}
                title={sidebarCollapsed ? t("Ouvrir le panneau") : t("Réduire le panneau")}
                onClick={() => setSidebarCollapsed((current) => !current)}
              >
                {sidebarCollapsed ? <ChevronRight size={16} aria-hidden="true" /> : <ChevronLeft size={16} aria-hidden="true" />}
              </button>
              </div>
            </header>
            {!sidebarCollapsed && (
              <div className="viewer-sidebar-content">
                <section className="sidebar-section">
                  <p className="sidebar-section-title">{t("Affichage")}</p>
                  <div className="slice-3d-mode sidebar-mode" role="group" aria-label={t("Mode de coupe 3D")}>
                    {(["none", "plane", "clip"] as Slice3DMode[]).map((mode) => (
                      <button
                        type="button"
                        aria-pressed={slice3DMode === mode}
                        className={slice3DMode === mode ? "is-active" : undefined}
                        key={mode}
                        onClick={() => {
                          setHoveredRegionId(null);
                          setSlice3DMode(mode);
                        }}
                      >
                        {mode === "none" ? t("Cerveau entier") : mode === "plane" ? t("Plan de coupe") : t("Cerveau coupé")}
                      </button>
                    ))}
                  </div>
                  {slice3DMode === "clip" && (
                    <div className="clip-side-control sidebar-clip-control">
                      <span>{t("Côté conservé")}</span>
                      <div role="group" aria-label={t("Côté anatomique conservé")}>
                        {(["negative", "positive"] as ClipDirection[]).map((direction) => (
                          <button
                            type="button"
                            aria-pressed={clipDirection === direction}
                            className={clipDirection === direction ? "is-active" : undefined}
                            key={direction}
                            onClick={() => {
                              setHoveredRegionId(null);
                              setClipDirection(direction);
                            }}
                          >
                            {direction === "negative"
                              ? t(activeSlice.negativeSide)
                              : t(activeSlice.positiveSide)}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                  {(experimentExplorerActive || connectivityVisible || slice3DMode === "clip" || hasRegionSelection) && <div className="opacity-control">
                    <div className="tool-heading">
                      <label htmlFor="context-opacity">{t("Opacité du contexte")}</label>
                      <output htmlFor="context-opacity">{Math.round(brainOpacity * 100)}%</output>
                    </div>
                    <input
                      id="context-opacity"
                      type="range"
                      min="10"
                      max="100"
                      step="5"
                      value={Math.round(brainOpacity * 100)}
                      onChange={(event) => setBrainOpacity(Number(event.currentTarget.value) / 100)}
                    />
                  </div>}
                </section>
                {viewerSource === "subject" && !subjectAnnotationsAvailable && <section className="subject-next-action">
                  <strong>{t("Régions Allen")}</strong>
                  <span>{allenRegistrationState.status === "running" ? t("Recalage en cours")
                    : allenRegistrationState.status === "failed" ? t("Recalage interrompu") : t("Non calculées")}</span>
                  <button type="button" onClick={() => openImageTask("atlas")}>
                    {allenRegistrationState.status === "running" ? t("Suivre le recalage") : t("Gérer le recalage")}
                  </button>
                </section>}
                <section
                  className={`region-picker${viewerSource === "subject" && !subjectAnnotationsAvailable ? " is-hidden" : ""}`}
                  aria-label={t("Régions anatomiques")}
                >
                  <div className="region-picker-heading">
                    <span>{t("Régions")}</span>
                    <span>
                      {detailedAnnotations
                        ? t(`${detailedAnnotations.structure_count} annotations`)
                        : t(`${visibleRegionCount}/${REGIONS.length} visibles`)}
                    </span>
                  </div>
                  <label className="region-search">
                    <span className="visually-hidden">{t("Rechercher une région")}</span>
                    <input
                      type="search"
                      placeholder={t("Nom, acronyme ou identifiant")}
                      value={regionSearch}
                      onChange={(event) => setRegionSearch(event.currentTarget.value)}
                    />
                  </label>
                  <div className="brain-visibility-row">
                    <label>
                      <input
                        type="checkbox"
                        checked={wholeBrainVisible}
                        onChange={toggleWholeBrain}
                      />
                      <span className="color-swatch whole-brain-swatch" aria-hidden="true" />
                      <span>{t("Cerveau complet")}</span>
                    </label>
                    <button
                      type="button"
                      className="region-display-reset"
                      onClick={resetRegionDisplay}
                      title={t("Rétablir la visibilité des régions et quitter l'isolation")}
                    >
                      <RotateCcw size={14} aria-hidden="true" /> {t("Rétablir")}</button>
                  </div>
                  <div className="region-picker-list">
                    {detailedAnnotations ? (
                      <RegionTree
                        displayedIds={treeDisplayedRegionIds}
                        onHover={hoverDetailedRegionFromTree}
                        onSelect={selectDetailedRegionFromTree}
                        onToggleDisplayed={toggleDisplayedDetailedRegion}
                        search={regionSearch}
                        selectedId={selectedDetailedRegionId ?? selectedRegionId}
                        structures={detailedAnnotations.structures}
                      />
                    ) : (
                      <p className="region-search-empty">{t("Chargement des annotations")}</p>
                    )}
                  </div>
                </section>
                {sliceAnnotationsEnabled && detailRegion && (
                  <div className="region-info-slot">
                    <aside
                      className={`region-info${selectedDetailedRegionId === detailRegion.id || selectedRegionId === detailRegion.id ? " has-actions" : ""}`}
                      aria-live="polite"
                    >
              <div className="region-info-heading">
                <span
                  className="region-info-swatch"
                  style={{ backgroundColor: detailRegion.color }}
                  aria-hidden="true"
                />
                <div>
                  <p className="region-info-label">
                    {hasRegionSelection ? <LockKeyhole size={13} aria-hidden="true" /> : <MousePointer2 size={13} aria-hidden="true" />}
                    {selectedDetailedRegionId === detailRegion.id
                      ? t("Sélection verrouillée")
                      : selectedRegionId === detailRegion.id
                        ? t("Sélection verrouillée")
                        : t("Aperçu au survol")}
                  </p>
                  <h2>{detailRegion.name}</h2>
                </div>
              </div>
              <dl>
                <div>
                  <dt>{t("Acronyme")}</dt>
                  <dd>{detailRegion.acronym}</dd>
                </div>
                <div>
                  <dt>{t("Identifiant")}</dt>
                  <dd>{detailRegion.id}</dd>
                </div>
                <div>
                  <dt>{t("Couleur")}</dt>
                  <dd>{detailRegion.color.toUpperCase()}</dd>
                </div>
                <div>
                  <dt>{t("Parent")}</dt>
                  <dd>
                    {detailRegion.parentName
                      ? `${detailRegion.parentName} (${detailRegion.parentId})`
                      : t("Aucun")}
                  </dd>
                </div>
              </dl>
              {(selectedDetailedRegionId === detailRegion.id || selectedRegionId === detailRegion.id) && (
                <div className="region-actions">
                  <button type="button" onClick={isolateSelectedRegion}>
                    {isolationSnapshot ? t("Retour") : t("Isoler")}
                  </button>
                  <button type="button" onClick={hideSelectedRegion}>{t("Masquer")}</button>
                  <button type="button" onClick={clearSelectedRegion} title={t("Libérer la sélection de région")}><X size={14} aria-hidden="true" /> {t("Libérer")}</button>
                </div>
              )}
                    </aside>
                  </div>
                )}
              </div>
            )}
          </aside>
          <div className={`viewer-content${viewerSource === "subject" && activeModality && measuredRegionId !== null ? " has-measurements" : ""}`}>
            <div className="viewer-stage" onPointerLeave={() => {
              setTooltipRegionId(null);
              setHoveredExperiment(null);
            }}>
            {experimentExplorerActive && (
              <ExperimentExplorerPanel
                count={visibleExperiments.length}
                total={experimentCatalogue.length}
                loading={experimentCatalogueLoading}
                error={experimentCatalogueError}
                filtered={experimentFilterRegion}
                regionName={selectedDetailedRegion?.name ?? selectedRegion?.name ?? null}
                selected={selectedExperiment}
                busy={connectivityState.status === "running" || connectivityState.nativeStatus === "running"}
                onFilter={(filtered) => {
                  setExperimentFilterRegion(filtered);
                  if (!filtered) {
                    setSelectedExperiment(null);
                    setHoveredExperiment(null);
                    setConnectivityVisible(false);
                    setConnectivityPinnedInspection(null);
                    setConnectivityHoverInspection(null);
                  }
                }}
                onClose={() => {
                  setExperimentExplorerEnabled(false);
                  setHoveredExperiment(null);
                }}
                onRetry={() => setExperimentCatalogueRetry((value) => value + 1)}
                onLoad={() => {
                  if (!selectedExperiment) return;
                  setExperimentExplorerEnabled(false);
                  setHoveredExperiment(null);
                  setConnectivityOpen(true);
                  void startConnectivity(selectedExperiment.id, selectedExperiment);
                }}
              />
            )}
            {sceneReady ? (
            <Suspense
              fallback={
                <div className="scene-loading" role="status">{t("Chargement de la vue 3D")}</div>
              }
            >
              <AtlasScene
                cameraResetRevision={cameraResetRevision}
                key={sceneResetKey}
                experimentExplorerActive={experimentExplorerActive}
                experiments={visibleExperiments}
                hoveredExperimentId={hoveredExperiment?.id ?? null}
                selectedExperimentId={selectedExperiment?.id ?? null}
                onHoverExperiment={setHoveredExperiment}
                onSelectExperiment={setSelectedExperiment}
                activePlane={activePlane}
                annotationRevision={allenRegistrationState.finishedAt}
                baseOpacity={
                  slice3DMode === "clip" ||
                  selectedRegionId !== null ||
                  experimentExplorerActive ||
                  connectivityVisible
                    ? brainOpacity
                    : 1
                }
                clipDirection={clipDirection}
                connectivityInjectionCenter={
                  connectivityVisible && injectionVisible
                    ? viewerSource === "allen" && connectivityState.hasViewerAssets
                      ? connectivityState.viewerManifest?.injection_marker?.center_mm
                      : viewerSource === "subject" && connectivityState.hasNativeViewerAssets
                        ? connectivityState.nativeViewerManifest?.injection_marker?.center_mm
                        : undefined
                    : undefined
                }
                connectivityInjectionRadius={
                  (viewerSource === "subject"
                    ? connectivityState.nativeViewerManifest?.injection_marker?.radius_mm
                    : connectivityState.viewerManifest?.injection_marker?.radius_mm) ?? 0.2
                }
                connectivityInjectionUrl={
                  connectivityVisible && injectionVisible
                    ? viewerSource === "allen" && connectivityState.hasViewerAssets
                      ? connectivityVolumeUrl("injection", connectivityState.finishedAt, connectivityState.experimentId)
                      : viewerSource === "subject" && connectivityState.hasNativeViewerAssets
                        ? nativeConnectivityVolumeUrl("injection", connectivityState.finishedAt, connectivityState.experimentId, connectivityState.nativeFinishedAt)
                        : undefined
                    : undefined
                }
                connectivityOpacity={connectivityOpacity}
                connectivitySliceProjectionSrc={connectivitySliceProjectionSrc}
                connectivitySliceInjectionSrc={connectivitySliceInjectionSrc}
                connectivityProjectionUrl={
                  connectivityVisible && projectionVisible
                    ? viewerSource === "allen" && connectivityState.hasViewerAssets
                      ? connectivityVolumeUrl("projection", connectivityState.finishedAt, connectivityState.experimentId)
                      : viewerSource === "subject" && connectivityState.hasNativeViewerAssets
                        ? nativeConnectivityVolumeUrl("projection", connectivityState.finishedAt, connectivityState.experimentId, connectivityState.nativeFinishedAt)
                        : undefined
                    : undefined
                }
                connectivityThreshold={connectivityThreshold}
                connectivityVolumeCenter={
                  viewerSource === "subject" ? SUBJECT_VOLUME_CENTER_MM : ATLAS_VOLUME_CENTER_MM
                }
                connectivityVolumeSpacingMm={
                  viewerSource === "subject"
                    ? connectivityState.nativeViewerManifest?.volume_spacing_mm
                      ?? DEFAULT_SUBJECT_VOLUME_SPACING_MM
                    : (connectivityState.viewerManifest?.volume_resolution_um ?? 100) / 1000
                }
                connectivityVolumeShape={
                  viewerSource === "subject"
                    ? connectivityState.nativeViewerManifest?.volume_shape
                    : connectivityState.viewerManifest?.volume_shape
                }
                detailedRegion={
                  (
                    viewerSource === "allen"
                      ? activeDetailedRegion?.meshAvailable
                      : subjectAnnotationsAvailable &&
                        nativeSceneDetailedRegion !== null &&
                        allenRegistrationState.nativeRegionIds.includes(nativeSceneDetailedRegion.id)
                  ) ? (viewerSource === "allen" ? activeDetailedRegion : nativeSceneDetailedRegion) : null
                }
                persistentDetailedRegions={scenePersistentDetailedRegions}
                hoveredRegionId={sceneHoveredRegionId}
                importedManifest={viewerSource === "subject" ? importedManifest : null}
                isolatedRegionId={isolatedRegionId}
                onHoverRegion={hoverRegionFromViewer}
                onHoverDetailedRegion={hoverMajorRegionFromNativeScene}
                onInspectRegion={inspectSceneRegion}
                onSelectRegion={selectRegion}
                onSelectDetailedRegion={selectMajorRegionFromNativeScene}
                selectedRegionId={selectedRegionId}
                selectionLocked={hasRegionSelection}
                source={viewerSource}
                subjectRevision={registrationState.finishedAt}
                subjectRegionsAvailable={subjectAnnotationsAvailable}
                slice3DMode={slice3DMode}
                sliceIndex={sliceIndex}
                sliceResolution={sliceResolution}
                visibility={visibility}
                wholeBrainVisible={wholeBrainVisible}
              />
            </Suspense>
            ) : (
              <div className="scene-loading" role="status">{t("Chargement de la vue 3D")}</div>
            )}
            </div>
            {viewerSource === "subject" && activeModality && measuredRegionId !== null && (
              <section className="region-measurements-panel" aria-live="polite">
                <header>
                  <div>
                    <p>{t("Mesures régionales")}</p>
                    <h2>{regionStatistics?.region_name ?? detailRegion?.name ?? t("Région Allen")}</h2>
                  </div>
                  <span>{activeModality.name}</span>
                </header>
                {regionStatisticsPending && (
                  <div className="region-measurements-status">{t("Calcul en cours")}</div>
                )}
                {regionStatisticsError && (
                  <div className="region-measurements-status is-error">{t(regionStatisticsError)}</div>
                )}
                {regionStatistics && (
                  <>
                    <dl className="region-measurements-grid">
                      <div><dt>{t("Voxels mesurés")}</dt><dd>{regionStatistics.valid_voxels}</dd></div>
                      <div><dt>{t("Volume")}</dt><dd>{formatValue(regionStatistics.sampled_volume_mm3)} {t("mm³")}</dd></div>
                      <div><dt>{t("Moyenne")}</dt><dd>{regionStatistics.statistics ? formatValue(regionStatistics.statistics.mean) : "n/a"}</dd></div>
                      <div><dt>{t("Médiane")}</dt><dd>{regionStatistics.statistics ? formatValue(regionStatistics.statistics.median) : "n/a"}</dd></div>
                      <div><dt>{t("Écart-type")}</dt><dd>{regionStatistics.statistics ? formatValue(regionStatistics.statistics.std) : "n/a"}</dd></div>
                      <div><dt>{t("Minimum")}</dt><dd>{regionStatistics.statistics ? formatValue(regionStatistics.statistics.min) : "n/a"}</dd></div>
                      <div><dt>{t("Maximum")}</dt><dd>{regionStatistics.statistics ? formatValue(regionStatistics.statistics.max) : "n/a"}</dd></div>
                      <div><dt>{t("Percentile 5")}</dt><dd>{regionStatistics.statistics ? formatValue(regionStatistics.statistics.p05) : "n/a"}</dd></div>
                      <div><dt>{t("Percentile 95")}</dt><dd>{regionStatistics.statistics ? formatValue(regionStatistics.statistics.p95) : "n/a"}</dd></div>
                    </dl>
                    <p className="region-measurements-note">
                      {regionStatistics.excluded_voxels} {t("voxels nuls ou non finis exclus · sous-régions incluses")}</p>
                  </>
                )}
              </section>
            )}
          </div>
        </section>
        <section className="slice-view" aria-label={t(activeSlice.title)}>
          <header className="panel-header">
            <div>
              <p className="panel-kicker">
                {viewerSource === "subject"
                  ? t(`${compareSlices || registrationQC ? t("Image importée") : activeModality?.name ?? t("Image importée")} · espace natif · ${Math.round(activeSliceSpacingMm * 1000)} µm`)
                  : t("Reference et annotations")}
              </p>
              <h2>{t(activeSlice.title)}</h2>
            </div>
            {viewerSource === "subject" && modalityState.modalities.length > 0 && (
              <button type="button" className={`comparison-toggle${compareSlices ? " is-active" : ""}`}
                aria-pressed={compareSlices} onClick={() => { setCompareSlices((value) => !value); setRegistrationQC(false); }}>
                {t(compareSlices ? "Vue simple" : "Comparer")}
              </button>
            )}
            {viewerSource === "subject" && subjectAnnotationsAvailable && (
              <button type="button" className={`comparison-toggle${registrationQC ? " is-active" : ""}`}
                aria-pressed={registrationQC} onClick={() => { setRegistrationQC((value) => !value); setCompareSlices(false); }}>
                {t(registrationQC ? "Fermer la vérification" : "Vérifier le recalage")}
              </button>
            )}
            {viewerSource === "subject" && !compareSlices && !registrationQC && modalityState.modalities.length > 0 && (
              <label className="slice-volume-selector">
                <span>{t("Volume")}</span>
                <select
                  value={activeModalityId ?? "rare"}
                  onChange={(event) => {
                    const value = event.currentTarget.value;
                    setActiveModalityId(value === "rare" ? null : value);
                  }}
                >
                  <option value="rare">{t("RARE")}</option>
                  {modalityState.modalities.map((modality) => (
                    <option value={modality.id} key={modality.id}>{modality.name}</option>
                  ))}
                </select>
              </label>
            )}
            <div className="slice-position">
              <span className="slice-index">{t("Index")} {sliceIndex} / {activeSliceCount - 1}
              </span>
              <span className="slice-coordinate">
                {(sliceIndex * activeSliceSpacingMm).toFixed(2)} {t("mm")}</span>
            </div>
          </header>
          <SliceToolbar
            inspectionMode={viewerSource === "subject" && registrationQC && subjectAnnotationsAvailable}
            onExploreExperiments={exploreExperiments}
            onReturnToExperiment={() => {
              setExperimentExplorerEnabled(false);
              setHoveredExperiment(null);
              setConnectivityVisible(true);
            }}
            library={
              <ConnectivityLibrary
                experiments={downloadedConnectivity}
                activeId={connectivityState.experimentId}
                disabled={connectivityState.status === "running" || connectivityState.nativeStatus === "running"}
                error={connectivityLibraryError}
                onSelect={(id) => {
                  const metadata = downloadedConnectivity.find((entry) => entry.id === id)?.metadata
                    ?? experimentCatalogue.find((entry) => entry.id === id);
                  void startConnectivity(id, metadata ?? undefined);
                }}
              />
            }
            activePlane={activePlane}
            connectivityAvailable={connectivityAvailableForSource}
            connectivityControlsVisible={!experimentExplorerActive}
            connectivityOpacity={connectivityOpacity}
            connectivityState={connectivityState}
            connectivityThreshold={connectivityThreshold}
            connectivityVisible={connectivityVisible}
            injectionVisible={injectionVisible}
            modalityControlsVisible={viewerSource === "subject" && !compareSlices && !registrationQC && activeModality !== null}
            modalityInverted={modalityInverted}
            modalityMax={modalityMax}
            modalityMin={modalityMin}
            modalityPalette={modalityPalette}
            projectionVisible={projectionVisible}
            showAllenRegionColors={showAllenRegionColors}
            showBrainOnly={showBrainOnly}
            showImportedAnnotations={showImportedAnnotations}
            showImportedMask={showImportedMask}
            sliceResolution={sliceResolution}
            subjectAnnotationsAvailable={subjectAnnotationsAvailable}
            viewerSource={viewerSource}
            onConnectivityOpacityChange={setConnectivityOpacity}
            onConnectivityThresholdChange={setConnectivityThreshold}
            onConnectivityVisibleChange={setConnectivityVisible}
            onInjectionVisibleChange={setInjectionVisible}
            onModalityInvertedChange={setModalityInverted}
            onModalityMaxChange={setModalityMax}
            onModalityMinChange={setModalityMin}
            onModalityPaletteChange={setModalityPalette}
            onModalitySettingsReset={() => {
              if (activeModality) {
                setModalityMin(activeModality.percentiles[0]);
                setModalityMax(activeModality.percentiles[1]);
              }
              setModalityPalette("gray");
              setModalityInverted(false);
            }}
            onPlaneChange={changeActivePlane}
            onProjectionVisibleChange={setProjectionVisible}
            onResolutionChange={changeSliceResolution}
            onShowAllenRegionColorsChange={setShowAllenRegionColors}
            onShowBrainOnlyChange={setShowBrainOnly}
            onShowImportedAnnotationsChange={setShowImportedAnnotations}
            onShowImportedMaskChange={setShowImportedMask}
          />
          <SliceComparison
            qcEnabled={viewerSource === "subject" && registrationQC && subjectAnnotationsAvailable}
            qcRevision={allenRegistrationState.finishedAt}
            enabled={viewerSource === "subject" && compareSlices && modalityState.modalities.length > 0}
            modalities={modalityState.modalities}
            activeId={activeModalityId}
            revision={registrationState.finishedAt}
            className={`slice-image-wrap${activeRegion ? " is-hovering" : ""}`}
            onWheel={handleSliceWheel}
          >
            <InteractiveSlice
              annotationOutlineSrc={
                viewerSource === "allen" && showAllenRegionColors
                  ? detailedAnnotationOutlineUrl(activePlane, sliceIndex, sliceResolution)
                  : viewerSource === "subject" && subjectAnnotationsAvailable && showImportedAnnotations
                    ? subjectAllenDetailedOutlineUrl(activePlane, sliceIndex, allenRegistrationState.finishedAt)
                    : undefined
              }
              annotationsEnabled={sliceAnnotationsEnabled}
              annotationsVisible={viewerSource === "allen"
                ? showAllenRegionColors
                : subjectAnnotationsAvailable && showImportedAnnotations}
              connectivityInspectionEnabled={viewerSource === "allen" && connectivityVisible}
              connectivityProjectionSrc={connectivitySliceProjectionSrc}
              connectivityInjectionSrc={connectivitySliceInjectionSrc}
              connectivityOpacity={connectivityOpacity}
              connectivityThreshold={connectivityThreshold}
              detailedHighlight={activeDetailedRegion
                ? {
                    color: activeDetailedRegion.color,
                    maskValue: activeDetailedRegion.maskValue,
                  }
                : null}
              detailedMaskSrc={
                viewerSource === "allen" && detailedAnnotations
                  ? detailedAnnotationMaskUrl(activePlane, sliceIndex, sliceResolution)
                  : viewerSource === "subject" && subjectAnnotationsAvailable && detailedAnnotations
                    ? subjectAllenDetailedMaskUrl(activePlane, sliceIndex, allenRegistrationState.finishedAt)
                  : undefined
              }
              detailedMaskValueToRegionId={detailedMaskValueToRegionId}
              hoveredRegionId={
                viewerSource === "allen" && !showAllenRegionColors ? null : activeRegionId
              }
              imageSrc={
                viewerSource === "subject"
                  ? activeModality
                    ? modalitySliceUrl(activeModality.id, activePlane, sliceIndex, showBrainOnly)
                    : showBrainOnly
                      ? subjectSlice3DUrl(activePlane, sliceIndex, registrationState.finishedAt)
                      : subjectSliceUrl(activePlane, sliceIndex, registrationState.finishedAt)
                  : undefined
              }
              imageResolutionMicrometers={viewerSource === "subject"
                ? Math.round(activeSliceSpacingMm * 1000)
                : undefined}
              modalityBrainOnly={showBrainOnly}
              modalityInverted={modalityInverted}
              modalityPalette={modalityPalette}
              modalityVisible={activeModalitySlice !== null}
              modalitySliceData={activeModalitySlice}
              modalityWindow={modalityWindow}
              index={sliceIndex}
              maskOutlineSrc={
                viewerSource === "subject" && showImportedMask
                  ? subjectMaskOutlineUrl(activePlane, sliceIndex, registrationState.finishedAt)
                  : undefined
              }
              maskSrc={
                viewerSource === "subject" && subjectAnnotationsAvailable
                  ? subjectAllenMaskUrl(activePlane, sliceIndex, allenRegistrationState.finishedAt)
                  : undefined
              }
              onHoverRegion={hoverRegionFromViewer}
              onInspectRegion={setTooltipRegionId}
              onHoverDetailedRegion={hoverDetailedRegion}
              onConnectivityInspect={inspectConnectivity}
              onConnectivityPin={pinConnectivityInspection}
              onSelectRegion={selectRegion}
              onSelectDetailedRegion={selectDetailedRegion}
              plane={activePlane}
              regionColorsVisible={viewerSource !== "allen" || showAllenRegionColors}
              resolution={sliceResolution}
            />
          </SliceComparison>
          <div className="slice-controls">
            {viewerSource === "allen" && connectivityVisible && connectivityState.hasViewerAssets && (
              <ConnectivityReadout
                inspection={activeConnectivityInspection}
                pinned={connectivityPinnedInspection !== null}
                region={inspectedConnectivityRegion}
                onClear={clearConnectivityInspection}
              />
            )}
            <div className="slice-control-heading">
              <label htmlFor="slice-position">{t(`Position ${activeSlice.label.toLowerCase()}`)}</label>
              <output htmlFor="slice-position">{sliceIndex}</output>
            </div>
            <input
              id="slice-position"
              type="range"
              className="viewer-range"
              style={{ "--range-progress": `${activeSliceCount > 1 ? sliceIndex / (activeSliceCount - 1) * 100 : 0}%` } as CSSProperties}
              aria-valuetext={t(`Coupe ${sliceIndex} sur ${activeSliceCount - 1}`)}
              disabled={activeSliceCount <= 1}
              min="0"
              max={activeSliceCount - 1}
              step="1"
              value={sliceIndex}
              onInput={(event) => {
                const nextIndex = Number(event.currentTarget.value);
                scheduleSliderIndex(nextIndex);
              }}
            />
            <div className="slice-range-limits" aria-hidden="true"><span>0</span><span>{activeSliceCount - 1}</span></div>
          </div>
        </section>
      </Workspace>
      <RegionTooltip
        name={hoveredExperiment
          ? `Experiment #${hoveredExperiment.id} / ${hoveredExperiment.primaryStructure.name || hoveredExperiment.primaryStructure.acronym}`
          : tooltipRegion?.name ?? null}
        acronym={hoveredExperiment ? undefined : tooltipRegion?.acronym}
      />
    </main>
  );
}
