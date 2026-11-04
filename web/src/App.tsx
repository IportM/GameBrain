import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type WheelEvent,
} from "react";

import InteractiveSlice, { type ConnectivityInspection } from "./InteractiveSlice";
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

function formatMeasurement(value: number) {
  return value.toLocaleString("fr-FR", { maximumSignificantDigits: 6 });
}

export default function App() {
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
  const [registrationOpen, setRegistrationOpen] = useState(false);
  const [allenRegistrationOpen, setAllenRegistrationOpen] = useState(false);
  const [connectivityOpen, setConnectivityOpen] = useState(false);
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
  const [connectivitySettingsOpen, setConnectivitySettingsOpen] = useState(false);
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
  const [modalityState, setModalityState] = useState<ModalityState>(INITIAL_MODALITY_STATE);
  const [activeModalityId, setActiveModalityId] = useState<string | null>(null);
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

  const activeRegionId = connectivityVisible
    ? selectedRegionId
    : menuHoveredRegionId ?? hoveredRegionId ?? selectedRegionId;
  const sceneHoveredRegionId = connectivityVisible
    ? null
    : slice3DMode === "clip"
      ? menuHoveredRegionId ?? hoveredRegionId
      : activeRegionId;
  const activeRegion = activeRegionId === null ? null : REGION_BY_ID.get(activeRegionId) ?? null;
  const detailedStructureById = useMemo(
    () => new Map(detailedAnnotations?.structures.map((structure) => [structure.id, structure]) ?? []),
    [detailedAnnotations],
  );
  const detailedMaskValueToRegionId = useMemo(
    () => new Map(
      detailedAnnotations?.structures.map((structure) => [structure.maskValue, structure.id]) ?? [],
    ),
    [detailedAnnotations],
  );
  const activeDetailedRegionId = connectivityVisible
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
    const targetId = connectivityVisible
      ? selectedDetailedRegionId
      : hoveredDetailedRegionId ?? selectedDetailedRegionId;
    if (targetId === null || connectivityVisible || hoveredDetailedRegionId === null) {
      setNativeSceneDetailedRegionId(targetId);
      return;
    }
    const timer = window.setTimeout(() => {
      setNativeSceneDetailedRegionId(targetId);
    }, 140);
    return () => window.clearTimeout(timer);
  }, [connectivityVisible, hoveredDetailedRegionId, selectedDetailedRegionId, viewerSource]);
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
    const detailedSelectionAvailable = viewerSource === "allen"
      ? sliceResolution === 25
      : subjectAnnotationsAvailable;
    if (!detailedSelectionAvailable) {
      setSelectedDetailedRegionId(null);
    }
  }, [activePlane, sliceIndex, sliceResolution, subjectAnnotationsAvailable, viewerSource]);

  useEffect(() => {
    const closeImageMenu = (event: PointerEvent) => {
      const menu = imageMenuRef.current;
      if (menu?.open && event.target instanceof Node && !menu.contains(event.target)) {
        menu.removeAttribute("open");
      }
    };
    const closeImageMenuWithKeyboard = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        imageMenuRef.current?.removeAttribute("open");
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
    if (regionId !== null) {
      setVisibility((current) => ({ ...current, [regionId]: true }));
      setLastInspectedRegionId(regionId);
    }
    setSelectedRegionId((current) => (current === regionId ? null : regionId));
  }, []);

  const hoverRegionFromViewer = useCallback((regionId: number | null) => {
    if (!connectivityVisible && regionId !== null) {
      setLastInspectedRegionId(regionId);
    }
    setHoveredRegionId(connectivityVisible ? null : regionId);
  }, [connectivityVisible]);

  const hoverDetailedRegion = useCallback((regionId: number | null) => {
    setHoveredDetailedRegionId(connectivityVisible ? null : regionId);
  }, [connectivityVisible]);

  const selectDetailedRegion = useCallback((regionId: number | null) => {
    const next = selectedDetailedRegionId === regionId ? null : regionId;
    const structure = next === null ? null : detailedStructureById.get(next) ?? null;
    const majorRegionId = structure ? majorRegionIdFor(structure) : null;
    setSelectedDetailedRegionId(next);
    setSelectedRegionId(majorRegionId);
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
    setSelectedRegionId(majorRegionId);
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
    if (connectivityVisible) {
      return;
    }
    setHoveredDetailedRegionId(structure.id);
    setMenuHoveredRegionId(majorRegionIdFor(structure));
  }, [connectivityVisible]);

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

  const toggleConnectivitySettings = useCallback(() => {
    setConnectivitySettingsOpen((current) => !current);
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
    setConnectivitySettingsOpen(false);
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
    sliceWheelDelta.current = 0;
    resetRegionDisplay();
    setSceneResetKey((current) => current + 1);
  };

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
        if (sliceResolution === 25 && detailedAnnotations) {
          assets.push(detailedAnnotationMaskUrl(activePlane, index));
          assets.push(detailedAnnotationOutlineUrl(activePlane, index));
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
            ));
          }
          if (injectionVisible) {
            assets.push(nativeConnectivityOverlayUrl(
              "injection",
              activePlane,
              index,
              connectivityState.finishedAt,
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
    if (!registrationState.hasViewerAssets) {
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
  }, [activeModality]);

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
    if (!modalityFile || !modalityName.trim()) return;
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
        },
        body: modalityFile,
      });
      const nextState = await readModalityResponse(response);
      setModalityState(nextState);
      if (!response.ok) throw new Error(nextState.message);
      setModalityFile(null);
      setModalityName("");
      setActiveModalityId(null);
    } catch (error) {
      setModalityState((current) => ({
        ...current,
        status: "failed",
        message: error instanceof Error ? error.message : "L'import de la modalité a échoué",
      }));
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
    if (!activeModality || regionExportIds.size === 0) return;
    setRegionExportPending(true);
    setRegionExportError(null);
    try {
      const response = await fetch(
        `/api/modalities/${encodeURIComponent(activeModality.id)}/export-values`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ regionIds: [...regionExportIds] }),
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
    } catch (error) {
      setConnectivitySearchStatus("failed");
      setConnectivitySearchMessage(
        error instanceof Error ? error.message : "La recherche Allen a échoué",
      );
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
      "Tout supprimer et revenir à l'état initial ?\n\nL'image importée, son recalage et toutes les données de connectivité calculées seront définitivement effacés.",
    );
    if (!confirmed) return;
    try {
      const response = await fetch("/api/session", { method: "DELETE" });
      const payload = await response.json() as { ok: boolean; message: string };
      if (!response.ok || !payload.ok) throw new Error(payload.message);
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
      window.alert(error instanceof Error ? error.message : "La réinitialisation complète a échoué");
    }
  };

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="title-block">
          <p className="eyebrow">
            {viewerSource === "subject" ? "Image NIfTI importée" : `Allen Mouse Brain Atlas / ${sliceResolution} um`}
          </p>
          <h1>Atlas anatomique</h1>
        </div>
        <div className="topbar-actions">
          {registrationState.hasViewerAssets && (
            <div className="source-selector" role="group" aria-label="Image affichée">
              <button
                aria-pressed={viewerSource === "allen"}
                className={viewerSource === "allen" ? "is-active" : undefined}
                onClick={() => setViewerSource("allen")}
                type="button"
              >
                Allen
              </button>
              <button
                aria-pressed={viewerSource === "subject"}
                className={viewerSource === "subject" ? "is-active" : undefined}
                onClick={() => {
                  setSlice3DMode("none");
                  setViewerSource("subject");
                }}
                type="button"
              >
                Image importée
              </button>
            </div>
          )}
          {!registrationState.hasViewerAssets ? (
            <button
              className="registration-button"
              type="button"
              onClick={() => setRegistrationOpen(true)}
            >
              Importer une image
            </button>
          ) : (
            <details className="image-menu" ref={imageMenuRef}>
              <summary>
                <span>Image</span>
                <span
                  className={`image-menu-status${subjectAnnotationsAvailable ? " is-ready" : ""}${allenRegistrationState.status === "running" ? " is-running" : ""}`}
                  aria-hidden="true"
                />
              </summary>
              <div className="image-menu-popover">
                <div className="image-menu-heading">
                  <strong>{registrationState.fileName ?? "Image importée"}</strong>
                  <span>
                    {allenRegistrationState.status === "running"
                      ? "Recalage Allen en cours"
                      : subjectAnnotationsAvailable
                        ? "Régions Allen disponibles"
                        : "Régions Allen non calculées"}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={(event) => {
                    event.currentTarget.closest("details")?.removeAttribute("open");
                    setRegistrationOpen(true);
                  }}
                >
                  Changer d’image
                </button>
                <button
                  type="button"
                  disabled={allenRegistrationState.status === "running"}
                  onClick={(event) => {
                    event.currentTarget.closest("details")?.removeAttribute("open");
                    setAllenRegistrationOpen(true);
                  }}
                >
                  {subjectAnnotationsAvailable ? "Gérer le recalage Allen" : "Recaler avec Allen"}
                </button>
                <button
                  type="button"
                  onClick={(event) => {
                    event.currentTarget.closest("details")?.removeAttribute("open");
                    setModalitiesOpen(true);
                  }}
                >
                  Modalités{modalityState.modalities.length > 0
                    ? ` (${modalityState.modalities.length})`
                    : ""}
                </button>
                <button
                  className="is-danger"
                  type="button"
                  disabled={
                    registrationState.status === "uploading" ||
                    registrationState.status === "running" ||
                    allenRegistrationState.status === "running"
                  }
                  onClick={() => {
                    if (window.confirm("Supprimer l’image importée et toutes les données générées ?")) {
                      void deleteImportedImage();
                    }
                  }}
                >
                  Supprimer l’image
                </button>
              </div>
            </details>
          )}
          {viewerSource === "subject" && activeModality && subjectAnnotationsAvailable && (
            <button
              className="global-reset-button"
              type="button"
              onClick={openRegionExport}
            >
              Exporter les valeurs
            </button>
          )}
          <button
            className={`global-reset-button${connectivityVisible ? " is-active" : ""}`}
            type="button"
            onClick={() => setConnectivityOpen(true)}
          >
            Connectivité
          </button>
          <button
            className="global-reset-button is-danger"
            type="button"
            title="Supprimer les imports et les calculs, puis revenir à l'état initial"
            onClick={() => void resetEntireSession()}
          >
            Revenir à zéro
          </button>
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
                <p className="panel-kicker">Volume personnel</p>
                <h2 id="registration-title">Importer une image</h2>
              </div>
              <button
                aria-label="Fermer"
                className="dialog-close"
                type="button"
                onClick={() => setRegistrationOpen(false)}
              >
                ×
              </button>
            </header>
            <div className="registration-dialog-body">
              <div className="registration-dataset">
                <div>
                  <strong>
                    {registrationFile?.name ?? registrationState.fileName ?? "Aucune image sélectionnée"}
                  </strong>
                  <span>Volume NIfTI 3D affiché dans son espace natif</span>
                </div>
                <span className={`registration-status is-${registrationState.status}`}>
                  {registrationState.status === "idle"
                    ? "Prêt"
                    : registrationState.status === "uploading"
                      ? "Import"
                    : registrationState.status === "running"
                      ? "En cours"
                      : registrationState.status === "completed"
                        ? "Terminé"
                        : "Échec"}
                </span>
              </div>

              <label className="registration-file-picker">
                <input
                  type="file"
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
                      fileName: file?.name ?? current.fileName,
                      hasViewerAssets: file ? false : current.hasViewerAssets,
                      viewerManifest: file ? null : current.viewerManifest,
                    }));
                  }}
                />
                <span>{registrationFile ? "Changer d'image" : "Choisir une image"}</span>
                <small>.nii ou .nii.gz</small>
              </label>

              {(registrationState.status === "uploading" || registrationState.status === "running") && (
                <div className="registration-progress" aria-label="Import en cours">
                  <span />
                </div>
              )}

              <p
                className={`registration-message${registrationState.status === "failed" ? " is-error" : ""}`}
                aria-live="polite"
              >
                {registrationState.message}
              </p>
              {registrationState.status === "failed" && (registrationState.logTail?.length ?? 0) > 0 && (
                <pre className="registration-error-details">
                  {registrationState.logTail?.slice(-5).join("\n")}
                </pre>
              )}

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
                >
                  Afficher l’image
                </button>
              )}
              <button type="button" onClick={() => setRegistrationOpen(false)}>
                Fermer
              </button>
              <button
                className="is-primary"
                type="button"
                disabled={
                  !registrationFile ||
                  registrationPending ||
                  registrationState.status === "uploading" ||
                  registrationState.status === "running" ||
                  allenRegistrationState.status === "running"
                }
                onClick={() => void startRegistration()}
              >
                {registrationState.status === "uploading"
                  ? "Import en cours"
                  : registrationPending || registrationState.status === "running"
                  ? "Préparation en cours"
                  : registrationState.hasViewerAssets
                    ? "Réimporter"
                    : "Importer"}
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
                <p className="panel-kicker">Annotations anatomiques</p>
                <h2 id="allen-registration-title">Recaler Allen</h2>
              </div>
              <button
                aria-label="Fermer"
                className="dialog-close"
                type="button"
                onClick={() => setAllenRegistrationOpen(false)}
              >
                ×
              </button>
            </header>
            <div className="registration-dialog-body">
              <div className="registration-dataset">
                <div>
                  <strong>{registrationState.fileName ?? "Image importée"}</strong>
                  <span>Recalage SyN complet · cerveau extrait vers Allen CCF 2017</span>
                </div>
                <span className={`registration-status is-${allenRegistrationState.status}`}>
                  {allenRegistrationState.status === "idle"
                    ? "Prêt"
                    : allenRegistrationState.status === "running"
                      ? "En cours"
                      : allenRegistrationState.status === "completed"
                        ? "Terminé"
                        : "Échec"}
                </span>
              </div>
              {allenRegistrationState.status === "running" && (
                <div className="registration-progress" aria-label="Recalage en cours">
                  <span />
                </div>
              )}
              <p
                className={`registration-message${allenRegistrationState.status === "failed" ? " is-error" : ""}`}
                aria-live="polite"
              >
                {allenRegistrationState.message}
              </p>
              {allenRegistrationState.logTail.length > 0 && (
                <pre className="registration-log-details">
                  {allenRegistrationState.logTail.slice(-8).join("\n")}
                </pre>
              )}
            </div>
            <footer className="registration-dialog-actions">
              <button type="button" onClick={() => setAllenRegistrationOpen(false)}>
                Fermer
              </button>
              <button
                className="is-primary"
                type="button"
                disabled={allenRegistrationState.status === "running"}
                onClick={() => void startAllenRegistration()}
              >
                {subjectAnnotationsAvailable
                  ? "Relancer le recalage"
                  : allenRegistrationState.status === "completed"
                    ? "Préparer les régions"
                    : "Lancer le recalage"}
              </button>
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
                <p className="panel-kicker">Données complémentaires</p>
                <h2 id="modalities-title">Modalités</h2>
              </div>
              <button
                aria-label="Fermer"
                className="dialog-close"
                type="button"
                onClick={() => setModalitiesOpen(false)}
              >
                ×
              </button>
            </header>
            <div className="registration-dialog-body modalities-body">
              <section className="modality-import-panel">
                <label className="modality-name-field">
                  <span>Nom de la modalité</span>
                  <input
                    type="text"
                    maxLength={80}
                    placeholder="Ex. T2 map, ADC, FA"
                    value={modalityName}
                    disabled={modalityState.status === "uploading"}
                    onChange={(event) => setModalityName(event.currentTarget.value)}
                  />
                </label>
                <label className="registration-file-picker">
                  <input
                    type="file"
                    accept=".nii,.nii.gz,application/gzip"
                    disabled={modalityState.status === "uploading"}
                    onClick={(event) => { event.currentTarget.value = ""; }}
                    onChange={(event) => {
                      const file = event.currentTarget.files?.[0] ?? null;
                      setModalityFile(file);
                      if (file && !modalityName.trim()) {
                        setModalityName(file.name.replace(/\.nii(?:\.gz)?$/i, ""));
                      }
                    }}
                  />
                  <span>{modalityFile ? "Changer de fichier" : "Choisir un fichier"}</span>
                  <small>{modalityFile?.name ?? ".nii ou .nii.gz"}</small>
                </label>
                <button
                  type="button"
                  className="modality-import-button"
                  disabled={!modalityFile || !modalityName.trim() || modalityState.status === "uploading"}
                  onClick={() => void importModality()}
                >
                  {modalityState.status === "uploading" ? "Validation en cours" : "Importer"}
                </button>
              </section>
              {modalityState.status === "uploading" && (
                <div className="registration-progress" aria-label="Import en cours"><span /></div>
              )}
              <p
                className={`registration-message${modalityState.status === "failed" ? " is-error" : ""}`}
                aria-live="polite"
              >
                {modalityState.message}
              </p>
              <div className="modality-list">
                {modalityState.modalities.map((modality) => (
                  <article className="modality-row" key={modality.id}>
                    <div className="modality-row-heading">
                      <div>
                        <strong>{modality.name}</strong>
                        <span>{modality.sourceFile}</span>
                      </div>
                      <span className={`modality-geometry is-${modality.geometryStatus}`}>
                        {modality.geometryStatus === "compatible"
                          ? "Grille compatible"
                          : "Rééchantillonnée"}
                      </span>
                    </div>
                    <dl>
                      <div><dt>Dimensions</dt><dd>{modality.shape.join(" × ")}</dd></div>
                      <div>
                        <dt>Espacement</dt>
                        <dd>{modality.spacingMm.map((value) => value.toFixed(3)).join(" × ")} mm</dd>
                      </div>
                      <div>
                        <dt>Valeurs</dt>
                        <dd>{modality.valueRange.map((value) => value.toPrecision(4)).join(" – ")}</dd>
                      </div>
                    </dl>
                    <button
                      type="button"
                      className="modality-delete"
                      onClick={() => {
                        if (window.confirm(`Supprimer la modalité « ${modality.name} » ?`)) {
                          void deleteModality(modality.id);
                        }
                      }}
                    >
                      Supprimer
                    </button>
                  </article>
                ))}
                {modalityState.modalities.length === 0 && (
                  <p className="modality-empty">Aucune modalité importée</p>
                )}
              </div>
            </div>
            <footer className="registration-dialog-actions">
              <button type="button" onClick={() => setModalitiesOpen(false)}>Fermer</button>
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
                <p className="panel-kicker">Données quantitatives</p>
                <h2 id="region-export-title">Exporter les valeurs</h2>
              </div>
              <button
                aria-label="Fermer"
                className="dialog-close"
                type="button"
                onClick={() => setRegionExportOpen(false)}
              >
                ×
              </button>
            </header>
            <div className="registration-dialog-body region-export-body">
              <div className="region-export-toolbar">
                <label>
                  <span className="visually-hidden">Rechercher une région</span>
                  <input
                    type="search"
                    placeholder="Nom, acronyme ou identifiant"
                    value={regionExportSearch}
                    onChange={(event) => setRegionExportSearch(event.currentTarget.value)}
                  />
                </label>
                <button
                  type="button"
                  onClick={() => setRegionExportIds(new Set(exportableRegions.map((region) => region.id)))}
                >
                  Tout sélectionner
                </button>
                <button type="button" onClick={() => setRegionExportIds(new Set())}>
                  Aucun
                </button>
              </div>
              <div className="region-export-count">
                <strong>{regionExportIds.size}</strong> région{regionExportIds.size > 1 ? "s" : ""} sélectionnée{regionExportIds.size > 1 ? "s" : ""}
                <span>Modalité : {activeModality?.name ?? "indisponible"}</span>
              </div>
              <div className="region-export-list">
                {filteredExportRegions.map((structure) => (
                  <label key={structure.id}>
                    <input
                      type="checkbox"
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
                  <p className="region-search-empty">Aucune région trouvée</p>
                )}
              </div>
              {regionExportError && (
                <p className="registration-message is-error">{regionExportError}</p>
              )}
            </div>
            <footer className="registration-dialog-actions">
              <button type="button" onClick={() => setRegionExportOpen(false)}>Annuler</button>
              <button
                type="button"
                className="is-primary"
                disabled={regionExportIds.size === 0 || regionExportPending}
                onClick={() => void exportRegionValues()}
              >
                {regionExportPending ? "Création du CSV" : "Exporter le CSV"}
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
                <p className="panel-kicker">Allen Mouse Connectivity Atlas</p>
                <h2 id="connectivity-title">Charger une expérience</h2>
              </div>
              <button
                aria-label="Fermer"
                className="dialog-close"
                type="button"
                onClick={() => setConnectivityOpen(false)}
              >
                ×
              </button>
            </header>
            <div className="registration-dialog-body">
              <div className="registration-dataset">
                <div>
                  <strong>
                    {connectivityState.experimentId
                      ? `Expérience ${connectivityState.experimentId}`
                      : "Projection Allen"}
                  </strong>
                  <span>Densité de projection et site d’injection · 50 µm</span>
                </div>
                <span className={`registration-status is-${connectivityState.status}`}>
                  {connectivityState.status === "idle"
                    ? "Prêt"
                    : connectivityState.status === "running"
                      ? "Chargement"
                      : connectivityState.status === "completed"
                        ? "Terminé"
                        : "Échec"}
                </span>
              </div>
              <div className="connectivity-load-modes" role="tablist" aria-label="Méthode de sélection">
                <button
                  type="button"
                  role="tab"
                  aria-selected={connectivityLoadMode === "region"}
                  className={connectivityLoadMode === "region" ? "is-active" : ""}
                  onClick={() => setConnectivityLoadMode("region")}
                >
                  Par région
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={connectivityLoadMode === "id"}
                  className={connectivityLoadMode === "id" ? "is-active" : ""}
                  onClick={() => setConnectivityLoadMode("id")}
                >
                  Par identifiant
                </button>
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
                    <label htmlFor="connectivity-region-query">Région d'injection</label>
                    <div>
                      <input
                        id="connectivity-region-query"
                        type="search"
                        value={connectivityRegionQuery}
                        disabled={connectivitySearchStatus === "loading" || connectivityState.status === "running"}
                        placeholder="Ex. VISp, Isocortex ou 315"
                        onChange={(event) => setConnectivityRegionQuery(event.currentTarget.value)}
                      />
                      <button
                        type="submit"
                        disabled={connectivitySearchStatus === "loading" || connectivityState.status === "running"}
                      >
                        {connectivitySearchStatus === "loading" ? "Recherche" : "Rechercher"}
                      </button>
                    </div>
                  </form>
                  <p
                    className={`connectivity-search-message${connectivitySearchStatus === "failed" ? " is-error" : ""}`}
                    aria-live="polite"
                  >
                    {connectivitySearchMessage}
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
                              {experiment.primaryStructure.acronym || "Région Allen"}
                              <span>#{experiment.id}</span>
                            </strong>
                            <span>{experiment.primaryStructure.name || "Région principale non renseignée"}</span>
                            <small>
                              {experiment.transgenicLine || experiment.strain || "Expérience standard"}
                              {experiment.sex ? ` · ${experiment.sex}` : ""}
                              {experiment.injectionVolumeMm3 !== null
                                ? ` · ${experiment.injectionVolumeMm3.toFixed(3)} mm³`
                                : ""}
                            </small>
                          </div>
                          <button
                            type="button"
                            disabled={connectivityState.status === "running"}
                            onClick={() => void startConnectivity(experiment.id, experiment)}
                          >
                            Charger
                          </button>
                        </article>
                      ))}
                    </div>
                  )}
                </div>
              ) : (
                <label className="connectivity-form" role="tabpanel">
                  <span>Identifiant de l’expérience Allen</span>
                  <input
                    type="text"
                    inputMode="numeric"
                    value={connectivityExperimentId}
                    disabled={connectivityState.status === "running"}
                    onChange={(event) => setConnectivityExperimentId(event.currentTarget.value)}
                  />
                  <small>Exemple proposé par M2M : 100140756</small>
                </label>
              )}
              {(connectivityState.status === "running" || connectivityState.nativeStatus === "running") && (
                <div
                  className="registration-progress"
                  aria-label={connectivityState.nativeStatus === "running"
                    ? "Projection de la connectivité vers l'image"
                    : "Chargement de la connectivité"}
                >
                  <span />
                </div>
              )}
              <p
                className={`registration-message${connectivityState.status === "failed" ? " is-error" : ""}`}
                aria-live="polite"
              >
                {connectivityState.message}
              </p>
              {connectivityState.logTail.length > 0 && (
                <pre className="registration-log-details">
                  {connectivityState.logTail.slice(-8).join("\n")}
                </pre>
              )}
              {connectivityState.nativeStatus !== "idle" && (
                <p
                  className={`registration-message${connectivityState.nativeStatus === "failed" ? " is-error" : ""}`}
                  aria-live="polite"
                >
                  {connectivityState.nativeMessage}
                </p>
              )}
              {connectivityState.nativeLogTail.length > 0 && (
                <pre className="registration-log-details">
                  {connectivityState.nativeLogTail.slice(-8).join("\n")}
                </pre>
              )}
            </div>
            <footer className="registration-dialog-actions">
              {connectivityState.hasViewerAssets && (
                <button
                  type="button"
                  onClick={() => {
                    setConnectivityVisible(true);
                    setViewerSource("allen");
                    setConnectivityOpen(false);
                  }}
                >
                  Afficher la carte
                </button>
              )}
              {connectivityState.hasViewerAssets && subjectAnnotationsAvailable && (
                <button
                  className="is-primary"
                  type="button"
                  disabled={connectivityState.nativeStatus === "running"}
                  onClick={() => void startNativeConnectivity()}
                >
                  {connectivityState.nativeStatus === "running"
                    ? "Projection en cours"
                    : connectivityState.hasNativeViewerAssets
                      ? "Reprojeter sur l'image"
                      : "Projeter sur l'image"}
                </button>
              )}
              <button type="button" onClick={() => setConnectivityOpen(false)}>
                Fermer
              </button>
              {connectivityLoadMode === "id" && (
                <button
                  className="is-primary"
                  type="button"
                  disabled={connectivityState.status === "running"}
                  onClick={() => void startConnectivity()}
                >
                  {connectivityState.status === "running" ? "Chargement en cours" : "Charger"}
                </button>
              )}
            </footer>
          </section>
        </div>
      )}
      <div className="workspace">
        <section
          className={`viewer${sidebarCollapsed ? " is-sidebar-collapsed" : ""}${activeRegion ? " is-hovering" : ""}`}
          aria-label="Vue 3D des regions anatomiques Allen"
        >
          <aside className="viewer-sidebar" aria-label="Réglages de la vue 3D">
            <header className="viewer-sidebar-header">
              <span>{sidebarCollapsed ? "3D" : "Vue 3D"}</span>
              <button
                type="button"
                className="sidebar-toggle"
                aria-label={sidebarCollapsed ? "Ouvrir le panneau 3D" : "Réduire le panneau 3D"}
                title={sidebarCollapsed ? "Ouvrir le panneau" : "Réduire le panneau"}
                onClick={() => setSidebarCollapsed((current) => !current)}
              >
                {sidebarCollapsed ? ">" : "<"}
              </button>
            </header>
            {!sidebarCollapsed && (
              <div className="viewer-sidebar-content">
                <section className="sidebar-section">
                  <p className="sidebar-section-title">Affichage</p>
                  <div className="slice-3d-mode sidebar-mode" role="group" aria-label="Mode de coupe 3D">
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
                        {mode === "none" ? "Entier" : mode === "plane" ? "Plan" : "Coupe"}
                      </button>
                    ))}
                  </div>
                  {slice3DMode === "clip" && (
                    <div className="clip-side-control sidebar-clip-control">
                      <span>Côté conservé</span>
                      <div role="group" aria-label="Côté anatomique conservé">
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
                              ? activeSlice.negativeSide
                              : activeSlice.positiveSide}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                  <div className="opacity-control">
                    <div className="tool-heading">
                      <label htmlFor="context-opacity">Opacité du contexte</label>
                      <output htmlFor="context-opacity">{Math.round(brainOpacity * 100)}%</output>
                    </div>
                    <input
                      id="context-opacity"
                      type="range"
                      min="10"
                      max="100"
                      step="5"
                      value={Math.round(brainOpacity * 100)}
                      disabled={slice3DMode !== "clip" && selectedRegionId === null}
                      onChange={(event) => setBrainOpacity(Number(event.currentTarget.value) / 100)}
                    />
                  </div>
                </section>
                <section
                  className={`region-picker${viewerSource === "subject" && !subjectAnnotationsAvailable ? " is-hidden" : ""}`}
                  aria-label="Régions anatomiques"
                >
                  <div className="region-picker-heading">
                    <span>Régions</span>
                    <span>
                      {detailedAnnotations
                        ? `${detailedAnnotations.structure_count} annotations`
                        : `${visibleRegionCount}/${REGIONS.length} visibles`}
                    </span>
                  </div>
                  <label className="region-search">
                    <span className="visually-hidden">Rechercher une région</span>
                    <input
                      type="search"
                      placeholder="Nom, acronyme ou identifiant"
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
                      <span>Cerveau complet</span>
                    </label>
                    <button
                      type="button"
                      className="region-display-reset"
                      onClick={resetRegionDisplay}
                      title="Rétablir toutes les régions"
                    >
                      Réinitialiser
                    </button>
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
                      <p className="region-search-empty">Chargement des annotations</p>
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
                    {selectedDetailedRegionId === detailRegion.id
                      ? "Annotation sélectionnée"
                      : selectedRegionId === detailRegion.id
                        ? "Région sélectionnée"
                        : activeDetailedRegion
                          ? "Annotation Allen"
                          : "Région Allen"}
                  </p>
                  <h2>{detailRegion.name}</h2>
                </div>
              </div>
              <dl>
                <div>
                  <dt>Acronyme</dt>
                  <dd>{detailRegion.acronym}</dd>
                </div>
                <div>
                  <dt>Identifiant</dt>
                  <dd>{detailRegion.id}</dd>
                </div>
                <div>
                  <dt>Couleur</dt>
                  <dd>{detailRegion.color.toUpperCase()}</dd>
                </div>
                <div>
                  <dt>Parent</dt>
                  <dd>
                    {detailRegion.parentName
                      ? `${detailRegion.parentName} (${detailRegion.parentId})`
                      : "Aucun"}
                  </dd>
                </div>
              </dl>
              {(selectedDetailedRegionId === detailRegion.id || selectedRegionId === detailRegion.id) && (
                <div className="region-actions">
                  <button type="button" onClick={isolateSelectedRegion}>
                    {isolationSnapshot ? "Retour" : "Isoler"}
                  </button>
                  <button type="button" onClick={hideSelectedRegion}>Masquer</button>
                  <button type="button" onClick={clearSelectedRegion}>Effacer</button>
                </div>
              )}
                    </aside>
                  </div>
                )}
              </div>
            )}
          </aside>
          <div className={`viewer-content${viewerSource === "subject" && activeModality && measuredRegionId !== null ? " has-measurements" : ""}`}>
            <div className="viewer-stage">
            <Suspense
              fallback={
                <div className="scene-loading" role="status">
                  Chargement de la vue 3D
                </div>
              }
            >
              <AtlasScene
                key={sceneResetKey}
                activePlane={activePlane}
                annotationRevision={allenRegistrationState.finishedAt}
                baseOpacity={
                  slice3DMode === "clip" ||
                  selectedRegionId !== null ||
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
                      ? connectivityVolumeUrl("injection", connectivityState.finishedAt)
                      : viewerSource === "subject" && connectivityState.hasNativeViewerAssets
                        ? nativeConnectivityVolumeUrl("injection", connectivityState.finishedAt)
                        : undefined
                    : undefined
                }
                connectivityOpacity={connectivityOpacity}
                connectivityProjectionUrl={
                  connectivityVisible && projectionVisible
                    ? viewerSource === "allen" && connectivityState.hasViewerAssets
                      ? connectivityVolumeUrl("projection", connectivityState.finishedAt)
                      : viewerSource === "subject" && connectivityState.hasNativeViewerAssets
                        ? nativeConnectivityVolumeUrl("projection", connectivityState.finishedAt)
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
                onSelectRegion={selectRegion}
                onSelectDetailedRegion={selectMajorRegionFromNativeScene}
                selectedRegionId={selectedRegionId}
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
            </div>
            {viewerSource === "subject" && activeModality && measuredRegionId !== null && (
              <section className="region-measurements-panel" aria-live="polite">
                <header>
                  <div>
                    <p>Mesures régionales</p>
                    <h2>{regionStatistics?.region_name ?? detailRegion?.name ?? "Région Allen"}</h2>
                  </div>
                  <span>{activeModality.name}</span>
                </header>
                {regionStatisticsPending && (
                  <div className="region-measurements-status">Calcul en cours</div>
                )}
                {regionStatisticsError && (
                  <div className="region-measurements-status is-error">{regionStatisticsError}</div>
                )}
                {regionStatistics && (
                  <>
                    <dl className="region-measurements-grid">
                      <div><dt>Voxels mesurés</dt><dd>{regionStatistics.valid_voxels}</dd></div>
                      <div><dt>Volume</dt><dd>{formatMeasurement(regionStatistics.sampled_volume_mm3)} mm³</dd></div>
                      <div><dt>Moyenne</dt><dd>{regionStatistics.statistics ? formatMeasurement(regionStatistics.statistics.mean) : "n/a"}</dd></div>
                      <div><dt>Médiane</dt><dd>{regionStatistics.statistics ? formatMeasurement(regionStatistics.statistics.median) : "n/a"}</dd></div>
                      <div><dt>Écart-type</dt><dd>{regionStatistics.statistics ? formatMeasurement(regionStatistics.statistics.std) : "n/a"}</dd></div>
                      <div><dt>Minimum</dt><dd>{regionStatistics.statistics ? formatMeasurement(regionStatistics.statistics.min) : "n/a"}</dd></div>
                      <div><dt>Maximum</dt><dd>{regionStatistics.statistics ? formatMeasurement(regionStatistics.statistics.max) : "n/a"}</dd></div>
                      <div><dt>Percentile 5</dt><dd>{regionStatistics.statistics ? formatMeasurement(regionStatistics.statistics.p05) : "n/a"}</dd></div>
                      <div><dt>Percentile 95</dt><dd>{regionStatistics.statistics ? formatMeasurement(regionStatistics.statistics.p95) : "n/a"}</dd></div>
                    </dl>
                    <p className="region-measurements-note">
                      {regionStatistics.excluded_voxels} voxels nuls ou non finis exclus · sous-régions incluses
                    </p>
                  </>
                )}
              </section>
            )}
          </div>
        </section>
        <section className="slice-view" aria-label={activeSlice.title}>
          <header className="panel-header">
            <div>
              <p className="panel-kicker">
                {viewerSource === "subject"
                  ? `${activeModality?.name ?? "Image importée"} · espace natif · ${Math.round(activeSliceSpacingMm * 1000)} µm`
                  : "Reference et annotations"}
              </p>
              <h2>{activeSlice.title}</h2>
            </div>
            {viewerSource === "subject" && modalityState.modalities.length > 0 && (
              <label className="slice-volume-selector">
                <span>Volume</span>
                <select
                  value={activeModalityId ?? "rare"}
                  onChange={(event) => {
                    const value = event.currentTarget.value;
                    setActiveModalityId(value === "rare" ? null : value);
                  }}
                >
                  <option value="rare">RARE</option>
                  {modalityState.modalities.map((modality) => (
                    <option value={modality.id} key={modality.id}>{modality.name}</option>
                  ))}
                </select>
              </label>
            )}
            <div className="slice-position">
              <span className="slice-index">
                Index {sliceIndex} / {activeSliceCount - 1}
              </span>
              <span className="slice-coordinate">
                {(sliceIndex * activeSliceSpacingMm).toFixed(2)} mm
              </span>
            </div>
          </header>
          <SliceToolbar
            activePlane={activePlane}
            connectivityAvailable={connectivityAvailableForSource}
            connectivityOpacity={connectivityOpacity}
            connectivitySettingsOpen={connectivitySettingsOpen}
            connectivityState={connectivityState}
            connectivityThreshold={connectivityThreshold}
            connectivityVisible={connectivityVisible}
            injectionVisible={injectionVisible}
            modalityControlsVisible={activeModality !== null}
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
            onConnectivitySettingsToggle={toggleConnectivitySettings}
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
          <div
            className={`slice-image-wrap${activeRegion ? " is-hovering" : ""}`}
            onWheel={handleSliceWheel}
          >
            <InteractiveSlice
              annotationOutlineSrc={
                viewerSource === "allen" && sliceResolution === 25 && showAllenRegionColors
                  ? detailedAnnotationOutlineUrl(activePlane, sliceIndex)
                  : viewerSource === "subject" && subjectAnnotationsAvailable && showImportedAnnotations
                    ? subjectAllenDetailedOutlineUrl(activePlane, sliceIndex, allenRegistrationState.finishedAt)
                    : undefined
              }
              annotationsEnabled={sliceAnnotationsEnabled}
              connectivityInspectionEnabled={viewerSource === "allen" && connectivityVisible}
              connectivityProjectionSrc={
                connectivityVisible && projectionVisible
                  ? viewerSource === "allen" && connectivityState.viewerManifest
                    ? connectivityOverlayUrl(
                      "projection",
                      activePlane,
                      sliceIndex,
                      sliceResolution,
                      connectivityState.viewerManifest,
                      connectivityState.finishedAt,
                    )
                    : viewerSource === "subject" && connectivityState.hasNativeViewerAssets
                      ? nativeConnectivityOverlayUrl("projection", activePlane, sliceIndex, connectivityState.finishedAt)
                      : undefined
                  : undefined
              }
              connectivityInjectionSrc={
                connectivityVisible && injectionVisible
                  ? viewerSource === "allen" && connectivityState.viewerManifest
                    ? connectivityOverlayUrl(
                      "injection",
                      activePlane,
                      sliceIndex,
                      sliceResolution,
                      connectivityState.viewerManifest,
                      connectivityState.finishedAt,
                    )
                    : viewerSource === "subject" && connectivityState.hasNativeViewerAssets
                      ? nativeConnectivityOverlayUrl("injection", activePlane, sliceIndex, connectivityState.finishedAt)
                      : undefined
                  : undefined
              }
              connectivityOpacity={connectivityOpacity}
              connectivityThreshold={connectivityThreshold}
              detailedHighlight={activeDetailedRegion
                ? {
                    color: activeDetailedRegion.color,
                    maskValue: activeDetailedRegion.maskValue,
                  }
                : null}
              detailedMaskSrc={
                viewerSource === "allen" && sliceResolution === 25 && detailedAnnotations
                  ? detailedAnnotationMaskUrl(activePlane, sliceIndex)
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
              onHoverDetailedRegion={hoverDetailedRegion}
              onConnectivityInspect={inspectConnectivity}
              onConnectivityPin={pinConnectivityInspection}
              onSelectRegion={selectRegion}
              onSelectDetailedRegion={selectDetailedRegion}
              plane={activePlane}
              regionColorsVisible={viewerSource !== "allen" || showAllenRegionColors}
              resolution={sliceResolution}
            />
          </div>
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
              <label htmlFor="slice-position">Position {activeSlice.label.toLowerCase()}</label>
              <output htmlFor="slice-position">{sliceIndex}</output>
            </div>
            <input
              id="slice-position"
              type="range"
              min="0"
              max={activeSliceCount - 1}
              step="1"
              value={sliceIndex}
              onInput={(event) => {
                const nextIndex = Number(event.currentTarget.value);
                scheduleSliderIndex(nextIndex);
              }}
            />
          </div>
        </section>
      </div>
    </main>
  );
}
