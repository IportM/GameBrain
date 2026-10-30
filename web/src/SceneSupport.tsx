import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { Edges, useTexture } from "@react-three/drei";
import {
  DoubleSide,
  Light,
  Matrix4,
  Mesh,
  PerspectiveCamera,
  Quaternion,
  SRGBColorSpace,
  Vector3,
} from "three";

import { slicePlaneTransform, sliceUrl, type SlicePlane, type SliceResolution } from "./atlas";
import type { ImportedManifest } from "./data";

const SELECTED_REGION_LAYER = 1;

function importedSlicePlaneTransform(
  plane: SlicePlane,
  index: number,
  manifest: ImportedManifest,
) {
  const definition = manifest.planes[plane];
  const count = manifest.slice_counts[plane];
  const offset = (index - (count - 1) / 2) * definition.spacing_mm;
  const position: [number, number, number] = plane === "coronal"
    ? [offset, 0, 0]
    : plane === "sagittal"
      ? [0, 0, offset]
      : [0, offset, 0];
  const horizontal = plane === "sagittal" ? new Vector3(-1, 0, 0) : new Vector3(0, 0, 1);
  const vertical = plane === "axial" ? new Vector3(-1, 0, 0) : new Vector3(0, -1, 0);
  const normal = plane === "coronal"
    ? new Vector3(1, 0, 0)
    : plane === "sagittal"
      ? new Vector3(0, 0, 1)
      : new Vector3(0, -1, 0);
  return {
    position,
    quaternion: new Quaternion().setFromRotationMatrix(
      new Matrix4().makeBasis(horizontal, vertical, normal),
    ),
    size: [definition.width_mm, definition.height_mm] as [number, number],
  };
}

export function ResponsiveCamera() {
  const { camera, size } = useThree();
  useEffect(() => {
    if (!(camera instanceof PerspectiveCamera)) return;
    const mobile = size.width < 640;
    camera.position.set(...(mobile ? [23, 20, 25] as const : [15, 13, 16] as const));
    camera.fov = mobile ? 45 : 38;
    camera.updateProjectionMatrix();
  }, [camera, size.width]);
  return null;
}

export function LayeredAtlasRenderer({ overlayVisible }: { overlayVisible: boolean }) {
  const { camera, gl, scene } = useThree();
  useLayoutEffect(() => {
    scene.traverse((object) => {
      if (object instanceof Light) object.layers.enable(SELECTED_REGION_LAYER);
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

type SliceDisplayProps = {
  importedManifest: ImportedManifest | null;
  index: number;
  plane: SlicePlane;
  resolution: SliceResolution;
};

export function AtlasSlicePlane({
  importedManifest,
  index,
  plane,
  resolution,
  visible,
}: SliceDisplayProps & { visible: boolean }) {
  const transform = useMemo(
    () => importedManifest
      ? importedSlicePlaneTransform(plane, index, importedManifest)
      : slicePlaneTransform(plane, index, resolution),
    [importedManifest, index, plane, resolution],
  );
  return (
    <mesh position={transform.position} quaternion={transform.quaternion} visible={visible} raycast={() => undefined}>
      <planeGeometry args={transform.size} />
      <meshBasicMaterial color="#74b8d1" opacity={0.16} transparent depthWrite={false} side={DoubleSide} />
      <Edges color="#b7dce8" />
    </mesh>
  );
}

export function AtlasSliceSection({
  imageUrl,
  importedManifest,
  index,
  overlayLayer = true,
  plane,
  resolution,
}: SliceDisplayProps & { imageUrl?: string; overlayLayer?: boolean }) {
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
    meshRef.current?.layers.set(overlayLayer ? SELECTED_REGION_LAYER : 0);
  }, [overlayLayer]);
  return (
    <mesh ref={meshRef} position={transform.position} quaternion={transform.quaternion} raycast={() => undefined} renderOrder={2}>
      <planeGeometry args={transform.size} />
      <shaderMaterial
        uniforms={uniforms}
        side={DoubleSide}
        vertexShader={`varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`}
        fragmentShader={`uniform sampler2D sliceTexture; varying vec2 vUv; void main() { vec4 sliceColor = texture2D(sliceTexture, vUv); if (sliceColor.a < 0.5) discard; gl_FragColor = vec4(sliceColor.rgb, 1.0); }`}
      />
    </mesh>
  );
}
