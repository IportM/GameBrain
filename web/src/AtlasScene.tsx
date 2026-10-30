import { memo, Suspense, useMemo } from "react";
import { Canvas, type ThreeEvent } from "@react-three/fiber";
import { Environment, OrbitControls, useGLTF } from "@react-three/drei";
import { Plane, SRGBColorSpace, Vector3 } from "three";

import ConnectivityVolume from "./ConnectivityVolume";
import {
  AtlasRegion as AtlasRegionMesh,
  SubjectBrain as SubjectBrainMesh,
  SubjectRegion as SubjectRegionMesh,
  WholeBrain as WholeBrainMesh,
} from "./BrainMeshes";
import {
  AtlasSlicePlane as AtlasSlicePlaneView,
  AtlasSliceSection as AtlasSliceSectionView,
  LayeredAtlasRenderer as LayeredAtlasRendererView,
  ResponsiveCamera as ResponsiveCameraView,
} from "./SceneSupport";
import type { ImportedManifest } from "./data";
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

export type ViewerSource = "allen" | "subject";

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
      <ResponsiveCameraView />
      <LayeredAtlasRendererView
        overlayVisible={selectedRegionId !== null || slice3DMode === "clip"}
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

export default memo(AtlasScene);

useGLTF.preload("/atlas/regions/997.glb");
