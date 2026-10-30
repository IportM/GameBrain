import {
  Suspense,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type WheelEvent,
} from "react";
import { Canvas, type ThreeEvent, useFrame, useThree } from "@react-three/fiber";
import { Edges, Environment, OrbitControls, useGLTF, useTexture } from "@react-three/drei";
import {
  DoubleSide,
  Light,
  Matrix4,
  Mesh,
  Plane,
  PerspectiveCamera,
  Quaternion,
  SRGBColorSpace,
  Vector3,
} from "three";

import InteractiveSlice, { type ConnectivityInspection } from "./InteractiveSlice";
import { ConnectivityReadout, SliceToolbar } from "./SliceToolbar";
import ConnectivityVolume from "./ConnectivityVolume";
import {
  AtlasRegion as AtlasRegionMesh,
  SubjectBrain as SubjectBrainMesh,
  SubjectRegion as SubjectRegionMesh,
  WholeBrain as WholeBrainMesh,
} from "./BrainMeshes";
import {
  INITIAL_ALLEN_REGISTRATION_STATE,
  INITIAL_CONNECTIVITY_STATE,
  INITIAL_REGISTRATION_STATE,
  readAllenRegistrationResponse,
  readConnectivityResponse,
  readImportResponse,
  type AllenRegistrationState,
  type ConnectivitySearchResponse,
  type ConnectivitySearchResult,
  type ConnectivityState,
  type ImportedManifest,
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
  slicePlaneTransform,
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
  subjectAllenMaskUrl,
  subjectAllenOutlineUrl,
  subjectMaskOutlineUrl,
  subjectSlice3DUrl,
  subjectSliceUrl,
} from "./viewerUrls";

const SELECTED_REGION_LAYER = 1;

type ViewerSource = "allen" | "subject";

function importedSlicePlaneTransform(
  plane: SlicePlane,
  index: number,
  manifest: ImportedManifest,
) {
  const definition = manifest.planes[plane];
  const count = manifest.slice_counts[plane];
  const offset = (index - (count - 1) / 2) * definition.spacing_mm;
  let position: [number, number, number];
  let horizontal: Vector3;
  let vertical: Vector3;
  let normal: Vector3;
  if (plane === "coronal") {
    position = [offset, 0, 0];
    horizontal = new Vector3(0, 0, 1);
    vertical = new Vector3(0, -1, 0);
    normal = new Vector3(1, 0, 0);
  } else if (plane === "sagittal") {
    position = [0, 0, offset];
    horizontal = new Vector3(-1, 0, 0);
    vertical = new Vector3(0, -1, 0);
    normal = new Vector3(0, 0, 1);
  } else {
    position = [0, offset, 0];
    horizontal = new Vector3(0, 0, 1);
    vertical = new Vector3(-1, 0, 0);
    normal = new Vector3(0, -1, 0);
  }
  return {
    position,
    quaternion: new Quaternion().setFromRotationMatrix(
      new Matrix4().makeBasis(horizontal, vertical, normal),
    ),
    size: [definition.width_mm, definition.height_mm] as [number, number],
  };
}

function ResponsiveCamera() {
  const { camera, size } = useThree();

  useEffect(() => {
    if (!(camera instanceof PerspectiveCamera)) {
      return;
    }

    const mobile = size.width < 640;
    if (mobile) {
      camera.position.set(23, 20, 25);
    } else {
      camera.position.set(15, 13, 16);
    }
    camera.fov = mobile ? 45 : 38;
    camera.updateProjectionMatrix();
  }, [camera, size.width]);

  return null;
}

function LayeredAtlasRenderer({ overlayVisible }: { overlayVisible: boolean }) {
  const { camera, gl, scene } = useThree();

  useLayoutEffect(() => {
    scene.traverse((object) => {
      if (object instanceof Light) {
        object.layers.enable(SELECTED_REGION_LAYER);
      }
    });
  }, [scene]);

  useFrame(() => {
    camera.layers.set(0);
    gl.autoClear = true;
    gl.render(scene, camera);

    if (overlayVisible) {
      const background = scene.background;
      gl.autoClear = false;
      gl.clearDepth();
      camera.layers.set(SELECTED_REGION_LAYER);
      scene.background = null;
      gl.render(scene, camera);
      scene.background = background;
    }

    camera.layers.enableAll();
    gl.autoClear = true;
  }, 1);

  return null;
}

function AtlasSlicePlane({
  importedManifest,
  index,
  plane,
  resolution,
  visible,
}: {
  importedManifest: ImportedManifest | null;
  index: number;
  plane: SlicePlane;
  resolution: SliceResolution;
  visible: boolean;
}) {
  const transform = useMemo(
    () => importedManifest
      ? importedSlicePlaneTransform(plane, index, importedManifest)
      : slicePlaneTransform(plane, index, resolution),
    [importedManifest, index, plane, resolution],
  );

  return (
    <mesh
      position={transform.position}
      quaternion={transform.quaternion}
      visible={visible}
      raycast={() => undefined}
    >
      <planeGeometry args={transform.size} />
      <meshBasicMaterial
        color="#74b8d1"
        opacity={0.16}
        transparent
        depthWrite={false}
        side={DoubleSide}
      />
      <Edges color="#b7dce8" />
    </mesh>
  );
}

function AtlasSliceSection({
  imageUrl,
  importedManifest,
  index,
  overlayLayer = true,
  plane,
  resolution,
}: {
  imageUrl?: string;
  importedManifest: ImportedManifest | null;
  index: number;
  overlayLayer?: boolean;
  plane: SlicePlane;
  resolution: SliceResolution;
}) {
  const meshRef = useRef<Mesh>(null);
  const texture = useTexture(imageUrl ?? sliceUrl(plane, index, resolution));
  const transform = useMemo(
    () => importedManifest
      ? importedSlicePlaneTransform(plane, index, importedManifest)
      : slicePlaneTransform(plane, index, resolution),
    [importedManifest, index, plane, resolution],
  );
  const uniforms = useMemo(() => ({ sliceTexture: { value: texture } }), [texture]);

  useEffect(() => {
    texture.colorSpace = SRGBColorSpace;
    texture.anisotropy = 4;
    texture.needsUpdate = true;
  }, [texture]);

  useLayoutEffect(() => {
    if (overlayLayer) {
      meshRef.current?.layers.set(SELECTED_REGION_LAYER);
    } else {
      meshRef.current?.layers.set(0);
    }
  }, [overlayLayer]);

  return (
    <mesh
      ref={meshRef}
      position={transform.position}
      quaternion={transform.quaternion}
      raycast={() => undefined}
      renderOrder={2}
    >
      <planeGeometry args={transform.size} />
      <shaderMaterial
        uniforms={uniforms}
        side={DoubleSide}
        vertexShader={`
          varying vec2 vUv;

          void main() {
            vUv = uv;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }
        `}
        fragmentShader={`
          uniform sampler2D sliceTexture;
          varying vec2 vUv;

          void main() {
            vec4 sliceColor = texture2D(sliceTexture, vUv);
            if (sliceColor.a < 0.5) {
              discard;
            }
            gl_FragColor = vec4(sliceColor.rgb, 1.0);
          }
        `}
      />
    </mesh>
  );
}

function AtlasScene({
  activePlane,
  annotationRevision,
  baseOpacity,
  clipDirection,
  connectivityInjectionCenter,
  connectivityInjectionRadius,
  connectivityOpacity,
  connectivityVolumeCenter,
  connectivityProjectionUrl,
  connectivityThreshold,
  connectivityVolumeSpacingMm,
  connectivityVolumeShape,
  hoveredRegionId,
  importedManifest,
  isolatedRegionId,
  onHoverRegion,
  onSelectRegion,
  selectedRegionId,
  source,
  subjectRevision,
  subjectRegionsAvailable,
  slice3DMode,
  sliceIndex,
  sliceIndexes,
  sliceResolution,
  visibility,
  wholeBrainVisible,
}: {
  activePlane: SlicePlane;
  annotationRevision: string | null;
  baseOpacity: number;
  clipDirection: ClipDirection;
  connectivityInjectionCenter?: [number, number, number];
  connectivityInjectionRadius: number;
  connectivityOpacity: number;
  connectivityVolumeCenter?: [number, number, number];
  connectivityProjectionUrl?: string;
  connectivityThreshold: number;
  connectivityVolumeSpacingMm: number | [number, number, number];
  connectivityVolumeShape?: [number, number, number];
  hoveredRegionId: number | null;
  importedManifest: ImportedManifest | null;
  isolatedRegionId: number | null;
  onHoverRegion: (regionId: number | null) => void;
  onSelectRegion: (regionId: number | null) => void;
  selectedRegionId: number | null;
  source: ViewerSource;
  subjectRevision: string | null;
  subjectRegionsAvailable: boolean;
  slice3DMode: Slice3DMode;
  sliceIndex: number;
  sliceIndexes: Record<SlicePlane, number>;
  sliceResolution: SliceResolution;
  visibility: Record<number, boolean>;
  wholeBrainVisible: boolean;
}) {
  const clippingPlane = useMemo(() => {
    const plane = new Plane();
    const offset = importedManifest
      ? (sliceIndex - (importedManifest.slice_counts[activePlane] - 1) / 2) *
        importedManifest.planes[activePlane].spacing_mm
      : sliceIndex * resolutionMm(sliceResolution) - SLICE_PLANES[activePlane].meshCenterMm;
    const normal =
      activePlane === "coronal"
        ? new Vector3(1, 0, 0)
        : activePlane === "sagittal"
          ? new Vector3(0, 0, 1)
          : new Vector3(0, 1, 0);
    const point =
      activePlane === "coronal"
        ? new Vector3(offset, 0, 0)
        : activePlane === "sagittal"
          ? new Vector3(0, 0, offset)
          : new Vector3(0, offset, 0);

    if (clipDirection === "negative") {
      normal.multiplyScalar(-1);
    }
    normal.y *= -1;
    point.y *= -1;
    return plane.setFromNormalAndCoplanarPoint(normal, point);
  }, [activePlane, clipDirection, importedManifest, sliceIndex, sliceResolution]);
  const contextActive = slice3DMode === "clip" || selectedRegionId !== null;
  const depthContextActive =
    contextActive || connectivityProjectionUrl !== undefined || connectivityInjectionCenter !== undefined;
  const sceneRegionId = contextActive
    ? selectedRegionId ?? hoveredRegionId
    : hoveredRegionId;

  const regionFromEvent = (event: {
    intersections: ThreeEvent<PointerEvent>["intersections"];
  }) => {
    const hitRegionIds = event.intersections
      .map((intersection) => intersection.object.userData.regionId as number | undefined)
      .filter((regionId): regionId is number => regionId !== undefined);
    const opaqueRegionId = hitRegionIds.find(
      (regionId) => REGION_BY_ID.get(regionId)?.opacity === undefined,
    );
    return opaqueRegionId ?? hitRegionIds[0] ?? null;
  };

  const handlePointerMove = (event: ThreeEvent<PointerEvent>) => {
    if (contextActive) {
      return;
    }
    event.stopPropagation();
    onHoverRegion(regionFromEvent(event));
  };

  const handleClick = (event: ThreeEvent<MouseEvent>) => {
    event.stopPropagation();
    onSelectRegion(regionFromEvent(event));
  };

  return (
    <Canvas
      camera={{ position: [15, 13, 16], fov: 38, near: 0.1, far: 100 }}
      dpr={connectivityProjectionUrl ? 1 : [1, 1.5]}
      frameloop="demand"
      gl={{ antialias: true, outputColorSpace: SRGBColorSpace }}
      onCreated={({ gl }) => {
        gl.localClippingEnabled = true;
      }}
      onPointerMissed={() => onSelectRegion(null)}
      shadows
    >
      <color attach="background" args={["#111513"]} />
      <ResponsiveCamera />
      <LayeredAtlasRenderer
        overlayVisible={
          selectedRegionId !== null || slice3DMode === "clip"
        }
      />
      <ambientLight intensity={0.18} />
      <hemisphereLight args={["#d8f0e2", "#18201c", 0.55]} />
      <directionalLight
        castShadow
        intensity={2.5}
        position={[8, 12, 10]}
        shadow-mapSize={[1024, 1024]}
      />
      <directionalLight color="#7ea6d8" intensity={0.9} position={[-8, -3, -6]} />
      <Suspense fallback={null}>
        <group scale={[1, -1, 1]}>
          {connectivityProjectionUrl && connectivityVolumeShape && (
            <ConnectivityVolume
              center={connectivityVolumeCenter}
              clipEnabled={slice3DMode === "clip"}
              clippingPlane={clippingPlane}
              highColor="#fffde8"
              lowColor="#159447"
              opacity={connectivityOpacity}
              spacingMm={connectivityVolumeSpacingMm}
              shape={connectivityVolumeShape}
              threshold={connectivityThreshold}
              url={connectivityProjectionUrl}
            />
          )}
          {connectivityInjectionCenter && (
            <mesh position={connectivityInjectionCenter} renderOrder={11}>
              <sphereGeometry args={[connectivityInjectionRadius, 24, 16]} />
              <meshStandardMaterial
                color="#ff4b35"
                emissive="#ff2f24"
                emissiveIntensity={0.65}
                clippingPlanes={slice3DMode === "clip" ? [clippingPlane] : []}
                opacity={connectivityOpacity}
                transparent={connectivityOpacity < 1}
                depthTest={false}
                depthWrite={false}
              />
            </mesh>
          )}
          <AtlasSlicePlane
            importedManifest={source === "subject" ? importedManifest : null}
            index={sliceIndex}
            plane={activePlane}
            resolution={sliceResolution}
            visible={slice3DMode === "plane"}
          />
          <Suspense fallback={null}>
            {slice3DMode === "clip" && (
              <AtlasSliceSection
                imageUrl={
                  source === "subject"
                    ? subjectSlice3DUrl(activePlane, sliceIndex, subjectRevision)
                    : undefined
                }
                index={sliceIndex}
                importedManifest={source === "subject" ? importedManifest : null}
                plane={activePlane}
                resolution={sliceResolution}
              />
            )}
          </Suspense>
          <group
            scale={0.001}
            onClick={handleClick}
            onPointerMove={handlePointerMove}
            onPointerOut={() => onHoverRegion(null)}
          >
            {source === "subject" ? (
              <SubjectBrainMesh
                baseOpacity={baseOpacity}
                clipEnabled={slice3DMode === "clip"}
                clippingPlane={clippingPlane}
                dimmed={!contextActive && sceneRegionId !== null}
                revision={subjectRevision}
                visible={wholeBrainVisible}
              />
            ) : (
              <WholeBrainMesh
                baseOpacity={baseOpacity}
                clipEnabled={slice3DMode === "clip"}
                clippingPlane={clippingPlane}
                depthContextEnabled={depthContextActive}
                dimmed={!contextActive && sceneRegionId !== null}
                visible={wholeBrainVisible}
              />
            )}
            {source === "allen" && REGIONS.map((region) => (
              <Suspense fallback={null} key={region.id}>
                <AtlasRegionMesh
                  baseOpacity={baseOpacity}
                  clipEnabled={slice3DMode === "clip"}
                  clippingPlane={clippingPlane}
                  depthContextEnabled={depthContextActive}
                  dimmed={
                    !contextActive &&
                    sceneRegionId !== null &&
                    sceneRegionId !== region.id
                  }
                  highlighted={sceneRegionId === region.id}
                  isolated={isolatedRegionId === region.id}
                  region={region}
                  visible={
                    visibility[region.id] &&
                    (!depthContextActive ||
                      !wholeBrainVisible ||
                      sceneRegionId === region.id)
                  }
                />
              </Suspense>
            ))}
            {source === "subject" && subjectRegionsAvailable && REGIONS.map((region) => {
              const highlighted = sceneRegionId === region.id;
              return highlighted && visibility[region.id] ? (
                <Suspense fallback={null} key={region.id}>
                  <SubjectRegionMesh
                    overlay={selectedRegionId === region.id}
                    region={region}
                    revision={annotationRevision}
                    visible
                  />
                </Suspense>
              ) : null;
            })}
          </group>
        </group>
        <Environment preset="studio" environmentIntensity={0.35} />
      </Suspense>
      <OrbitControls
        makeDefault
        enablePan={false}
        minDistance={8}
        maxDistance={50}
        dampingFactor={0.08}
      />
    </Canvas>
  );
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
  const [registrationState, setRegistrationState] = useState<RegistrationState>(
    INITIAL_REGISTRATION_STATE,
  );
  const [allenRegistrationState, setAllenRegistrationState] =
    useState<AllenRegistrationState>(INITIAL_ALLEN_REGISTRATION_STATE);
  const [connectivityState, setConnectivityState] =
    useState<ConnectivityState>(INITIAL_CONNECTIVITY_STATE);
  const [viewerSource, setViewerSource] = useState<ViewerSource>("allen");
  const [showAllenRegionColors, setShowAllenRegionColors] = useState(true);
  const [showImportedMask, setShowImportedMask] = useState(true);
  const [showImportedAnnotations, setShowImportedAnnotations] = useState(true);
  const activatedSubjectRevision = useRef<string | null>(null);
  const imageMenuRef = useRef<HTMLDetailsElement>(null);
  const sliceWheelDelta = useRef(0);
  const [visibility, setVisibility] = useState<Record<number, boolean>>(() =>
    Object.fromEntries(REGIONS.map((region) => [region.id, true])),
  );

  const toggleRegion = (regionId: number) => {
    setVisibility((current) => ({ ...current, [regionId]: !current[regionId] }));
    setHoveredRegionId((current) => (current === regionId ? null : current));
    setMenuHoveredRegionId((current) => (current === regionId ? null : current));
    setSelectedRegionId((current) => (current === regionId ? null : current));
    setIsolatedRegionId((current) => (current === regionId ? null : current));
  };

  const activeRegionId = connectivityVisible
    ? selectedRegionId
    : menuHoveredRegionId ?? hoveredRegionId ?? selectedRegionId;
  const sceneHoveredRegionId = connectivityVisible
    ? null
    : slice3DMode === "clip"
      ? menuHoveredRegionId ?? hoveredRegionId
      : activeRegionId;
  const activeRegion = activeRegionId === null ? null : REGION_BY_ID.get(activeRegionId) ?? null;
  const detailRegion = activeRegion ?? (
    lastInspectedRegionId === null ? null : REGION_BY_ID.get(lastInspectedRegionId) ?? null
  );
  const selectedRegion =
    selectedRegionId === null ? null : REGION_BY_ID.get(selectedRegionId) ?? null;
  const activeSlice = SLICE_PLANES[activePlane];
  const importedManifest = registrationState.viewerManifest;
  const subjectAnnotationsAvailable =
    allenRegistrationState.status === "completed" &&
    Boolean(allenRegistrationState.hasNativeAssets);
  const sliceAnnotationsEnabled =
    viewerSource === "allen" || (viewerSource === "subject" && subjectAnnotationsAvailable);
  const sliceIndexes = sliceIndexesBySource[viewerSource];
  const setSliceIndexes = (
    next:
      | Record<SlicePlane, number>
      | ((current: Record<SlicePlane, number>) => Record<SlicePlane, number>),
  ) => {
    setSliceIndexesBySource((current) => ({
      ...current,
      [viewerSource]: typeof next === "function" ? next(current[viewerSource]) : next,
    }));
  };
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
  const filteredRegions = useMemo(() => {
    const normalizedSearch = regionSearch.trim().toLocaleLowerCase("fr");
    if (!normalizedSearch) {
      return REGIONS;
    }
    return REGIONS.filter((region) =>
      `${region.name} ${region.acronym} ${region.id}`
        .toLocaleLowerCase("fr")
        .includes(normalizedSearch),
    );
  }, [regionSearch]);

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

  const selectRegion = (regionId: number | null) => {
    if (regionId !== null) {
      setVisibility((current) => ({ ...current, [regionId]: true }));
      setLastInspectedRegionId(regionId);
    }
    setSelectedRegionId((current) => (current === regionId ? null : regionId));
  };

  const selectRegionFromMenu = (regionId: number) => {
    setVisibility((current) => ({ ...current, [regionId]: true }));
    setHoveredRegionId(null);
    setMenuHoveredRegionId(null);
    setSelectedRegionId(regionId);
    setLastInspectedRegionId(regionId);
    setIsolatedRegionId(null);
  };

  const hoverRegionFromMenu = (regionId: number) => {
    if (connectivityVisible || selectedRegionId !== null) {
      return;
    }
    setLastInspectedRegionId(regionId);
    setMenuHoveredRegionId(regionId);
  };

  const hoverRegionFromViewer = (regionId: number | null) => {
    if (!connectivityVisible && regionId !== null) {
      setLastInspectedRegionId(regionId);
    }
    setHoveredRegionId(connectivityVisible ? null : regionId);
  };

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

  const isolateSelectedRegion = () => {
    if (!selectedRegion) {
      return;
    }
    setWholeBrainVisible(false);
    setIsolatedRegionId(selectedRegion.id);
    setVisibility(
      Object.fromEntries(REGIONS.map((region) => [region.id, region.id === selectedRegion.id])),
    );
  };

  const hideSelectedRegion = () => {
    if (!selectedRegion) {
      return;
    }
    setVisibility((current) => ({ ...current, [selectedRegion.id]: false }));
    setHoveredRegionId(null);
    setMenuHoveredRegionId(null);
    setSelectedRegionId(null);
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

  const changeSliceResolution = (nextResolution: SliceResolution) => {
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
  };

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
    setSliceIndexes((current) => ({
      ...current,
      [activePlane]: Math.min(
        activeSliceCount - 1,
        Math.max(0, current[activePlane] + direction * steps),
      ),
    }));
  };

  useEffect(() => {
    const adjacentIndexes = [sliceIndex - 1, sliceIndex + 1].filter(
      (index) => index >= 0 && index < activeSliceCount,
    );
    adjacentIndexes.forEach((index) => {
      const image = new Image();
      image.src = viewerSource === "subject"
        ? subjectSliceUrl(activePlane, index, registrationState.finishedAt)
        : sliceUrl(activePlane, index, sliceResolution);
    });
  }, [activePlane, activeSliceCount, registrationState.finishedAt, sliceIndex, sliceResolution, viewerSource]);

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
                    <span>{visibleRegionCount}/{REGIONS.length} visibles</span>
                  </div>
                  <label className="region-search">
                    <span className="visually-hidden">Rechercher une région</span>
                    <input
                      type="search"
                      placeholder="Rechercher une région"
                      value={regionSearch}
                      onChange={(event) => setRegionSearch(event.currentTarget.value)}
                    />
                  </label>
                  <label className="brain-visibility-row">
                    <input
                      type="checkbox"
                      checked={wholeBrainVisible}
                      onChange={() => setWholeBrainVisible((current) => !current)}
                    />
                    <span className="color-swatch whole-brain-swatch" aria-hidden="true" />
                    <span>Cerveau complet</span>
                  </label>
                  <div className="region-picker-list">
                    {filteredRegions.map((region) => (
                      <div
                        className={`region-picker-item${selectedRegionId === region.id ? " is-selected" : ""}`}
                        key={region.id}
                        onFocus={() => hoverRegionFromMenu(region.id)}
                        onBlur={() =>
                          setMenuHoveredRegionId((current) =>
                            current === region.id ? null : current,
                          )
                        }
                        onPointerEnter={() => hoverRegionFromMenu(region.id)}
                        onPointerLeave={() =>
                          setMenuHoveredRegionId((current) =>
                            current === region.id ? null : current,
                          )
                        }
                      >
                        <input
                          type="checkbox"
                          checked={visibility[region.id]}
                          aria-label={`Afficher ${region.name}`}
                          onChange={() => toggleRegion(region.id)}
                        />
                        <span
                          className="color-swatch"
                          style={{ backgroundColor: region.color }}
                          aria-hidden="true"
                        />
                        <button
                          type="button"
                          title={`Sélectionner ${region.name}`}
                          onClick={() => selectRegionFromMenu(region.id)}
                        >
                          <span>
                            <strong>{region.acronym}</strong>
                            <small>{region.name}</small>
                          </span>
                          <span className="region-number">{region.id}</span>
                        </button>
                      </div>
                    ))}
                    {filteredRegions.length === 0 && (
                      <p className="region-search-empty">Aucune région trouvée</p>
                    )}
                  </div>
                </section>
                {sliceAnnotationsEnabled && detailRegion && (
                  <div className="region-info-slot">
                    <aside
                      className={`region-info${viewerSource === "allen" && selectedRegionId === detailRegion.id ? " has-actions" : ""}`}
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
                    {selectedRegionId === detailRegion.id ? "Région sélectionnée" : "Région Allen"}
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
                    {detailRegion.parentName} ({detailRegion.parentId})
                  </dd>
                </div>
              </dl>
              {viewerSource === "allen" && selectedRegionId === detailRegion.id && (
                <div className="region-actions">
                  <button type="button" onClick={isolateSelectedRegion}>Afficher uniquement</button>
                  <button type="button" onClick={hideSelectedRegion}>Masquer</button>
                  <button type="button" onClick={() => selectRegion(null)}>Effacer</button>
                </div>
              )}
                    </aside>
                  </div>
                )}
              </div>
            )}
          </aside>
          <div className="viewer-stage">
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
                viewerSource === "subject" ? [0, 0, 0] : ATLAS_VOLUME_CENTER_MM
              }
              connectivityVolumeSpacingMm={
                viewerSource === "subject"
                  ? connectivityState.nativeViewerManifest?.volume_spacing_mm ?? [0.1, 0.1, 0.1]
                  : (connectivityState.viewerManifest?.volume_resolution_um ?? 100) / 1000
              }
              connectivityVolumeShape={
                viewerSource === "subject"
                  ? connectivityState.nativeViewerManifest?.volume_shape
                  : connectivityState.viewerManifest?.volume_shape
              }
              hoveredRegionId={sceneHoveredRegionId}
              importedManifest={viewerSource === "subject" ? importedManifest : null}
              isolatedRegionId={isolatedRegionId}
              onHoverRegion={hoverRegionFromViewer}
              onSelectRegion={selectRegion}
              selectedRegionId={selectedRegionId}
              source={viewerSource}
              subjectRevision={registrationState.finishedAt}
              subjectRegionsAvailable={subjectAnnotationsAvailable}
              slice3DMode={slice3DMode}
              sliceIndex={sliceIndex}
              sliceIndexes={sliceIndexes}
              sliceResolution={sliceResolution}
              visibility={visibility}
              wholeBrainVisible={wholeBrainVisible}
            />
          </div>
        </section>
        <section className="slice-view" aria-label={activeSlice.title}>
          <header className="panel-header">
            <div>
              <p className="panel-kicker">
                {viewerSource === "subject"
                  ? `Image importée · espace natif · ${Math.round(activeSliceSpacingMm * 1000)} µm`
                  : "Reference et annotations"}
              </p>
              <h2>{activeSlice.title}</h2>
            </div>
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
            projectionVisible={projectionVisible}
            showAllenRegionColors={showAllenRegionColors}
            showImportedAnnotations={showImportedAnnotations}
            showImportedMask={showImportedMask}
            sliceResolution={sliceResolution}
            subjectAnnotationsAvailable={subjectAnnotationsAvailable}
            viewerSource={viewerSource}
            onConnectivityOpacityChange={setConnectivityOpacity}
            onConnectivitySettingsToggle={() => setConnectivitySettingsOpen((current) => !current)}
            onConnectivityThresholdChange={setConnectivityThreshold}
            onConnectivityVisibleChange={setConnectivityVisible}
            onInjectionVisibleChange={setInjectionVisible}
            onPlaneChange={(plane) => {
              sliceWheelDelta.current = 0;
              setHoveredRegionId(null);
              setActivePlane(plane);
            }}
            onProjectionVisibleChange={setProjectionVisible}
            onResolutionChange={changeSliceResolution}
            onShowAllenRegionColorsChange={setShowAllenRegionColors}
            onShowImportedAnnotationsChange={setShowImportedAnnotations}
            onShowImportedMaskChange={setShowImportedMask}
          />
          <div
            className={`slice-image-wrap${activeRegion ? " is-hovering" : ""}`}
            onWheel={handleSliceWheel}
          >
            <InteractiveSlice
              annotationOutlineSrc={
                viewerSource === "subject" && subjectAnnotationsAvailable && showImportedAnnotations
                  ? subjectAllenOutlineUrl(activePlane, sliceIndex, allenRegistrationState.finishedAt)
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
              hoveredRegionId={
                viewerSource === "allen" && !showAllenRegionColors ? null : activeRegionId
              }
              imageSrc={
                viewerSource === "subject"
                  ? subjectSliceUrl(activePlane, sliceIndex, registrationState.finishedAt)
                  : undefined
              }
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
              onConnectivityInspect={setConnectivityHoverInspection}
              onConnectivityPin={(inspection) => {
                setConnectivityPinnedInspection(inspection);
                setConnectivityHoverInspection(null);
              }}
              onSelectRegion={selectRegion}
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
                onClear={() => setConnectivityPinnedInspection(null)}
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
                setHoveredRegionId(null);
                setSliceIndexes((current) => ({
                  ...current,
                  [activePlane]: nextIndex,
                }));
              }}
            />
          </div>
        </section>
      </div>
    </main>
  );
}

useGLTF.preload("/atlas/regions/997.glb");

