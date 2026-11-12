import {
  memo,
  Suspense,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  type ComponentRef,
  type MutableRefObject,
} from "react";
import { Canvas, type ThreeEvent, useThree } from "@react-three/fiber";
import { Environment, OrbitControls, useGLTF } from "@react-three/drei";
import { MOUSE, Plane, SRGBColorSpace, Vector3 } from "three";

import ConnectivityVolume from "./ConnectivityVolume";
import ExperimentMarkers from "./ExperimentMarkers";
import { clearConnectivityVolumeCache } from "./connectivityVolumeCache";
import {
  AtlasRegion as AtlasRegionMesh,
  DetailedAtlasRegion as DetailedAtlasRegionMesh,
  SubjectBrain as SubjectBrainMesh,
  SubjectDetailedRegion as SubjectDetailedRegionMesh,
  SubjectRegion as SubjectRegionMesh,
  WholeBrain as WholeBrainMesh,
} from "./BrainMeshes";
import {
  AtlasSlicePlane as AtlasSlicePlaneView,
  AtlasSliceSection as AtlasSliceSectionView,
  LayeredAtlasRenderer as LayeredAtlasRendererView,
  ResponsiveCamera as ResponsiveCameraView,
} from "./SceneSupport";
import type { ConnectivitySearchResult, ImportedManifest } from "./data";
import {
  REGION_BY_ID,
  REGIONS,
  SLICE_PLANES,
  resolutionMm,
  type ClipDirection,
  type Slice3DMode,
  type SlicePlane,
  type SliceResolution,
} from "./atlas";
import { subjectSlice3DUrl } from "./viewerUrls";
import type { DetailedAnnotationStructure } from "./detailedAnnotations";

export type ViewerSource = "allen" | "subject";

type SavedCameraView = {
  position: [number, number, number];
  target: [number, number, number];
};

type CameraViewStore = Record<ViewerSource, SavedCameraView | null>;

function IndependentOrbitControls({
  source,
  views,
  resetRevision,
}: {
  source: ViewerSource;
  views: MutableRefObject<CameraViewStore>;
  resetRevision: number;
}) {
  const controls = useRef<ComponentRef<typeof OrbitControls>>(null);
  const { camera } = useThree();
  const lastReset = useRef(resetRevision);

  useEffect(() => {
    if (lastReset.current !== resetRevision) {
      views.current[source] = null;
      lastReset.current = resetRevision;
    }
    const saved = views.current[source];
    const position = saved?.position ?? [15, 13, 16];
    const target = saved?.target ?? [0, 0, 0];
    camera.position.set(...position);
    controls.current?.target.set(...target);
    controls.current?.update();
  }, [camera, source, views, resetRevision]);

  return (
    <OrbitControls
      ref={controls}
      makeDefault
      enablePan
      minDistance={8}
      maxDistance={50}
      dampingFactor={0.08}
      mouseButtons={{
        LEFT: MOUSE.ROTATE,
        MIDDLE: MOUSE.PAN,
        RIGHT: MOUSE.PAN,
      }}
      onChange={() => {
        if (!controls.current) return;
        views.current[source] = {
          position: camera.position.toArray() as [number, number, number],
          target: controls.current.target.toArray() as [number, number, number],
        };
      }}
    />
  );
}

function AtlasScene({
  cameraResetRevision,
  activePlane,
  annotationRevision,
  baseOpacity,
  clipDirection,
  connectivityInjectionCenter,
  connectivityInjectionUrl,
  connectivityInjectionRadius,
  connectivityOpacity,
  connectivityVolumeCenter,
  connectivityProjectionUrl,
  connectivityThreshold,
  connectivityVolumeSpacingMm,
  connectivityVolumeShape,
  detailedRegion,
  experimentExplorerActive,
  experiments,
  hoveredExperimentId,
  selectedExperimentId,
  onHoverExperiment,
  onSelectExperiment,
  hoveredRegionId,
  importedManifest,
  isolatedRegionId,
  onHoverRegion,
  onHoverDetailedRegion,
  onInspectRegion,
  onSelectRegion,
  onSelectDetailedRegion,
  persistentDetailedRegions,
  selectedRegionId,
  selectionLocked,
  source,
  subjectRevision,
  subjectRegionsAvailable,
  slice3DMode,
  sliceIndex,
  sliceResolution,
  visibility,
  wholeBrainVisible,
}: {
  cameraResetRevision: number;
  activePlane: SlicePlane;
  annotationRevision: string | null;
  baseOpacity: number;
  clipDirection: ClipDirection;
  connectivityInjectionCenter?: [number, number, number];
  connectivityInjectionUrl?: string;
  connectivityInjectionRadius: number;
  connectivityOpacity: number;
  connectivityVolumeCenter?: [number, number, number];
  connectivityProjectionUrl?: string;
  connectivityThreshold: number;
  connectivityVolumeSpacingMm: number | [number, number, number];
  connectivityVolumeShape?: [number, number, number];
  detailedRegion: DetailedAnnotationStructure | null;
  experimentExplorerActive: boolean;
  experiments: ConnectivitySearchResult[];
  hoveredExperimentId: number | null;
  selectedExperimentId: number | null;
  onHoverExperiment: (experiment: ConnectivitySearchResult | null) => void;
  onSelectExperiment: (experiment: ConnectivitySearchResult) => void;
  hoveredRegionId: number | null;
  importedManifest: ImportedManifest | null;
  isolatedRegionId: number | null;
  onHoverRegion: (regionId: number | null) => void;
  onHoverDetailedRegion: (regionId: number | null) => void;
  onInspectRegion: (regionId: number | null) => void;
  onSelectRegion: (regionId: number | null) => void;
  onSelectDetailedRegion: (regionId: number | null) => void;
  persistentDetailedRegions: DetailedAnnotationStructure[];
  selectedRegionId: number | null;
  selectionLocked: boolean;
  source: ViewerSource;
  subjectRevision: string | null;
  subjectRegionsAvailable: boolean;
  slice3DMode: Slice3DMode;
  sliceIndex: number;
  sliceResolution: SliceResolution;
  visibility: Record<number, boolean>;
  wholeBrainVisible: boolean;
}) {
  const cameraViews = useRef<CameraViewStore>({ allen: null, subject: null });
  const subjectHoverTimer = useRef<number | null>(null);
  const subjectPickSequence = useRef(0);
  const pointerGesture = useRef({ x: 0, y: 0, button: -1, dragged: true });
  const pressedExperiment = useRef<ConnectivitySearchResult | null>(null);
  useEffect(() => () => clearConnectivityVolumeCache(), []);
  useLayoutEffect(() => {
    clearConnectivityVolumeCache("/api/connectivity/native-viewer/");
  }, [subjectRevision]);
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
  const detailedRegionIsMajor = detailedRegion !== null && REGION_BY_ID.has(detailedRegion.id);
  const contextActive =
    slice3DMode === "clip" || selectedRegionId !== null || detailedRegion !== null;
  const pointerInteractionLocked = slice3DMode === "clip" || selectionLocked;
  const depthContextActive =
    contextActive || experimentExplorerActive || connectivityProjectionUrl !== undefined || connectivityInjectionUrl !== undefined || connectivityInjectionCenter !== undefined;
  const sceneRegionId = detailedRegion && !detailedRegionIsMajor
    ? null
    : contextActive
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

  const subjectPickFromEvent = (event: ThreeEvent<PointerEvent | MouseEvent>) => {
    const intersection = event.intersections.find(
      (candidate) => candidate.object.userData.subjectBrain === true,
    );
    if (!intersection) return null;
    const point = intersection.point;
    const direction = event.ray.direction;
    return {
      point: [point.x, -point.y, point.z] as [number, number, number],
      direction: [direction.x, -direction.y, direction.z] as [number, number, number],
    };
  };

  const requestSubjectRegion = async (pick: NonNullable<ReturnType<typeof subjectPickFromEvent>>) => {
    const parameters = new URLSearchParams({
      x: String(pick.point[0]),
      y: String(pick.point[1]),
      z: String(pick.point[2]),
      dx: String(pick.direction[0]),
      dy: String(pick.direction[1]),
      dz: String(pick.direction[2]),
    });
    try {
      const response = await fetch(`/api/allen-registration/pick?${parameters}`);
      if (!response.ok) return null;
      const payload = await response.json() as { regionId?: number | null };
      return typeof payload.regionId === "number" ? payload.regionId : null;
    } catch {
      return null;
    }
  };

  useEffect(() => () => {
    if (subjectHoverTimer.current !== null) window.clearTimeout(subjectHoverTimer.current);
  }, []);

  const handlePointerMove = (event: ThreeEvent<PointerEvent>) => {
    if (experimentExplorerActive) return;
    if (event.buttons !== 0) {
      clearPointerHover();
      return;
    }
    event.stopPropagation();
    if (source === "subject" && subjectRegionsAvailable) {
      const pick = subjectPickFromEvent(event);
      if (!pick) return;
      if (subjectHoverTimer.current !== null) window.clearTimeout(subjectHoverTimer.current);
      const sequence = ++subjectPickSequence.current;
      subjectHoverTimer.current = window.setTimeout(() => {
        void requestSubjectRegion(pick).then((regionId) => {
          if (sequence !== subjectPickSequence.current) return;
          onInspectRegion(regionId);
          if (!pointerInteractionLocked) onHoverDetailedRegion(regionId);
        });
      }, 70);
      return;
    }
    const regionId = regionFromEvent(event);
    onInspectRegion(regionId);
    if (!pointerInteractionLocked) onHoverRegion(regionId);
  };

  const handleClick = (event: ThreeEvent<MouseEvent>) => {
    event.stopPropagation();
    if (experimentExplorerActive) return;
    if (pointerGesture.current.dragged || pointerGesture.current.button !== 0) return;
    if (source === "subject" && subjectRegionsAvailable) {
      const pick = subjectPickFromEvent(event);
      if (!pick) return;
      const sequence = ++subjectPickSequence.current;
      void requestSubjectRegion(pick).then((regionId) => {
        if (sequence !== subjectPickSequence.current) return;
        if (regionId === null) onSelectRegion(null);
        else onSelectDetailedRegion(regionId);
      });
      return;
    }
    onSelectRegion(regionFromEvent(event));
  };

  const clearPointerHover = () => {
    if (subjectHoverTimer.current !== null) window.clearTimeout(subjectHoverTimer.current);
    subjectHoverTimer.current = null;
    subjectPickSequence.current += 1;
    onHoverExperiment(null);
    onInspectRegion(null);
    onHoverDetailedRegion(null);
    onHoverRegion(null);
  };

  return (
    <Canvas
      camera={{ position: [15, 13, 16], fov: 38, near: 0.1, far: 100 }}
      dpr={connectivityProjectionUrl ? 1 : [1, 1.5]}
      frameloop="demand"
      gl={{ antialias: true, outputColorSpace: SRGBColorSpace }}
      onCreated={({ gl, raycaster }) => {
        gl.localClippingEnabled = true;
        raycaster.layers.enable(1);
      }}
      onContextMenu={(event) => event.preventDefault()}
      onPointerDownCapture={(event) => {
        pressedExperiment.current = null;
        if (!experimentExplorerActive) clearPointerHover();
        pointerGesture.current = {
          x: event.clientX,
          y: event.clientY,
          button: event.button,
          dragged: false,
        };
      }}
      onPointerMoveCapture={(event) => {
        const gesture = pointerGesture.current;
        if (Math.hypot(event.clientX - gesture.x, event.clientY - gesture.y) > 4) {
          gesture.dragged = true;
          if (event.buttons !== 0) onHoverExperiment(null);
        }
      }}
      onPointerUpCapture={(event) => {
        const gesture = pointerGesture.current;
        if (Math.hypot(event.clientX - gesture.x, event.clientY - gesture.y) > 4) {
          gesture.dragged = true;
        }
        const experiment = pressedExperiment.current;
        pressedExperiment.current = null;
        if (experimentExplorerActive && experiment && event.button === 0 &&
          gesture.button === 0 && !gesture.dragged) {
          onSelectExperiment(experiment);
        }
      }}
      onPointerCancelCapture={() => {
        pointerGesture.current.dragged = true;
        pressedExperiment.current = null;
      }}
      onPointerMissed={() => {
        if (experimentExplorerActive) return;
        if (pointerGesture.current.dragged || pointerGesture.current.button !== 0) return;
        onSelectDetailedRegion(null);
        onSelectRegion(null);
      }}
      shadows
    >
      <color attach="background" args={["#111513"]} />
      <ResponsiveCameraView />
      <LayeredAtlasRendererView
        overlayVisible={
          experimentExplorerActive ||
          selectedRegionId !== null ||
          detailedRegion !== null ||
          persistentDetailedRegions.length > 0 ||
          slice3DMode === "clip"
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
          {experimentExplorerActive && (
            <ExperimentMarkers
              experiments={experiments}
              hoveredId={hoveredExperimentId}
              selectedId={selectedExperimentId}
              onHover={onHoverExperiment}
              onPress={(experiment) => { pressedExperiment.current = experiment; }}
            />
          )}
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
          {connectivityInjectionUrl && connectivityVolumeShape && (
            <ConnectivityVolume
              center={connectivityVolumeCenter}
              clipEnabled={slice3DMode === "clip"}
              clippingPlane={clippingPlane}
              highColor="#fff0d8"
              lowColor="#ff3f2e"
              opacity={connectivityOpacity}
              renderOrder={11}
              spacingMm={connectivityVolumeSpacingMm}
              shape={connectivityVolumeShape}
              threshold={connectivityThreshold}
              url={connectivityInjectionUrl}
            />
          )}
          {!connectivityInjectionUrl && connectivityInjectionCenter && (
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
          <AtlasSlicePlaneView
            importedManifest={source === "subject" ? importedManifest : null}
            index={sliceIndex}
            plane={activePlane}
            resolution={sliceResolution}
            visible={slice3DMode === "plane"}
          />
          <Suspense fallback={null}>
            {slice3DMode === "clip" && (
              <AtlasSliceSectionView
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
            onPointerOut={clearPointerHover}
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
            {source === "allen" && detailedRegion && !detailedRegionIsMajor && (
              <Suspense fallback={null} key={detailedRegion.id}>
                <DetailedAtlasRegionMesh structure={detailedRegion} />
              </Suspense>
            )}
            {source === "allen" && persistentDetailedRegions
              .filter((structure) => structure.id !== detailedRegion?.id)
              .map((structure) => (
                <Suspense fallback={null} key={`persistent-${structure.id}`}>
                  <DetailedAtlasRegionMesh highlighted={false} structure={structure} />
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
            {source === "subject" && subjectRegionsAvailable && detailedRegion && (
              <Suspense fallback={null} key={detailedRegion.id}>
                <SubjectDetailedRegionMesh
                  revision={annotationRevision}
                  structure={detailedRegion}
                />
              </Suspense>
            )}
            {source === "subject" && subjectRegionsAvailable && persistentDetailedRegions
              .filter((structure) => structure.id !== detailedRegion?.id)
              .map((structure) => (
                <Suspense fallback={null} key={`persistent-${structure.id}`}>
                  <SubjectDetailedRegionMesh
                    highlighted={false}
                    revision={annotationRevision}
                    structure={structure}
                  />
                </Suspense>
              ))}
          </group>
        </group>
        <Environment preset="studio" environmentIntensity={0.35} />
      </Suspense>
      <IndependentOrbitControls source={source} views={cameraViews} resetRevision={cameraResetRevision} />
    </Canvas>
  );
}

export default memo(AtlasScene);

useGLTF.preload("/atlas/regions/997.glb");
