import { useEffect, useLayoutEffect, useMemo } from "react";
import { useGLTF } from "@react-three/drei";
import {
  DoubleSide,
  EqualDepth,
  LessEqualDepth,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Object3D,
  Plane,
} from "three";

import type { RegionDefinition } from "./atlas";
import { subjectAllenRegionUrl } from "./viewerUrls";

const RESTING_REGION_COLOR = "#858c88";
const DIMMED_BRAIN_OPACITY = 0.07;
const SELECTED_REGION_LAYER = 1;

type SharedMeshProps = {
  baseOpacity: number;
  clipEnabled: boolean;
  clippingPlane: Plane;
  depthContextEnabled: boolean;
  dimmed: boolean;
  visible: boolean;
};

export function AtlasRegion({
  baseOpacity,
  clipEnabled,
  clippingPlane,
  depthContextEnabled,
  dimmed,
  highlighted,
  isolated,
  region,
  visible,
}: SharedMeshProps & {
  highlighted: boolean;
  isolated: boolean;
  region: RegionDefinition;
}) {
  const { scene } = useGLTF(`/atlas/regions/${region.id}.glb`);
  const depthScene = useMemo(() => scene.clone(true), [scene]);

  useLayoutEffect(() => {
    scene.traverse((object: Object3D) => {
      if (object instanceof Mesh) {
        object.userData.regionId = region.id;
        object.geometry.computeVertexNormals();
        object.material = new MeshStandardMaterial({
          color: RESTING_REGION_COLOR,
          roughness: 0.66,
          metalness: 0,
          transparent: true,
          opacity: 1,
          depthWrite: false,
        });
        object.castShadow = true;
        object.receiveShadow = true;
      }
    });
  }, [region, scene]);

  useLayoutEffect(() => {
    depthScene.traverse((object: Object3D) => {
      if (!(object instanceof Mesh)) return;
      object.material = new MeshBasicMaterial({ colorWrite: false, depthWrite: true });
      object.raycast = () => undefined;
      object.renderOrder = -100;
    });
    return () => {
      depthScene.traverse((object: Object3D) => {
        if (object instanceof Mesh && object.material instanceof MeshBasicMaterial) {
          object.material.dispose();
        }
      });
    };
  }, [depthScene]);

  useEffect(() => {
    scene.traverse((object: Object3D) => {
      if (!(object instanceof Mesh) || !(object.material instanceof MeshStandardMaterial)) return;
      const material = object.material;
      material.color.set(isolated ? RESTING_REGION_COLOR : highlighted ? region.color : RESTING_REGION_COLOR);
      material.emissive.set(!isolated && highlighted ? region.color : "#000000");
      material.emissiveIntensity = !isolated && highlighted ? 0.24 : 0;
      material.opacity = isolated
        ? 1
        : highlighted
          ? 1
          : dimmed
            ? Math.min(DIMMED_BRAIN_OPACITY, baseOpacity * 0.25)
            : baseOpacity;
      const materialIsOpaque = material.opacity >= 0.999;
      const selectedOverlay = depthContextEnabled && highlighted;
      material.transparent = !selectedOverlay && (depthContextEnabled || !materialIsOpaque);
      material.depthWrite = selectedOverlay || (!depthContextEnabled && materialIsOpaque);
      material.depthTest = true;
      material.depthFunc = depthContextEnabled && !highlighted ? EqualDepth : LessEqualDepth;
      object.layers.set(selectedOverlay ? SELECTED_REGION_LAYER : 0);
      object.renderOrder = 0;
      material.needsUpdate = true;
    });
  }, [baseOpacity, depthContextEnabled, dimmed, highlighted, isolated, region, scene]);

  useEffect(() => {
    scene.traverse((object: Object3D) => {
      if (!(object instanceof Mesh) || !(object.material instanceof MeshStandardMaterial)) return;
      const regionIsClipped = clipEnabled && !highlighted;
      object.material.clippingPlanes = regionIsClipped ? [clippingPlane] : [];
      object.material.clipShadows = regionIsClipped;
      object.material.needsUpdate = true;
    });
  }, [clipEnabled, clippingPlane, highlighted, scene]);

  useEffect(() => {
    depthScene.traverse((object: Object3D) => {
      if (!(object instanceof Mesh) || !(object.material instanceof MeshBasicMaterial)) return;
      object.material.clippingPlanes = clipEnabled ? [clippingPlane] : [];
      object.material.needsUpdate = true;
    });
  }, [clipEnabled, clippingPlane, depthScene]);

  return (
    <>
      <primitive object={depthScene} visible={visible && depthContextEnabled && !highlighted} />
      <primitive object={scene} visible={visible} />
    </>
  );
}

export function WholeBrain({
  baseOpacity,
  clipEnabled,
  clippingPlane,
  depthContextEnabled,
  dimmed,
  visible,
}: SharedMeshProps) {
  const { scene } = useGLTF("/atlas/regions/997.glb");
  const depthScene = useMemo(() => scene.clone(true), [scene]);

  useLayoutEffect(() => {
    scene.traverse((object: Object3D) => {
      if (!(object instanceof Mesh)) return;
      object.geometry.computeVertexNormals();
      object.material = new MeshStandardMaterial({
        color: "#a2aaa5",
        roughness: 0.72,
        metalness: 0,
        transparent: true,
        opacity: 1,
        depthWrite: false,
      });
      object.raycast = () => undefined;
      object.receiveShadow = true;
      object.renderOrder = 0;
    });
  }, [scene]);

  useLayoutEffect(() => {
    depthScene.traverse((object: Object3D) => {
      if (!(object instanceof Mesh)) return;
      object.material = new MeshBasicMaterial({ colorWrite: false, depthWrite: true });
      object.raycast = () => undefined;
      object.renderOrder = -100;
    });
    return () => {
      depthScene.traverse((object: Object3D) => {
        if (object instanceof Mesh && object.material instanceof MeshBasicMaterial) {
          object.material.dispose();
        }
      });
    };
  }, [depthScene]);

  useEffect(() => {
    scene.traverse((object: Object3D) => {
      if (object instanceof Mesh && object.material instanceof MeshStandardMaterial) {
        object.material.opacity = dimmed
          ? Math.min(DIMMED_BRAIN_OPACITY, baseOpacity * 0.25)
          : baseOpacity;
        object.material.transparent = depthContextEnabled || object.material.opacity < 0.999;
        object.material.depthWrite = !depthContextEnabled && object.material.opacity >= 0.999;
        object.material.depthTest = true;
        object.material.depthFunc = depthContextEnabled ? EqualDepth : LessEqualDepth;
        object.material.needsUpdate = true;
      }
    });
  }, [baseOpacity, depthContextEnabled, dimmed, scene]);

  useEffect(() => {
    scene.traverse((object: Object3D) => {
      if (!(object instanceof Mesh) || !(object.material instanceof MeshStandardMaterial)) return;
      object.material.clippingPlanes = clipEnabled ? [clippingPlane] : [];
      object.material.clipShadows = clipEnabled;
      object.material.needsUpdate = true;
    });
  }, [clipEnabled, clippingPlane, scene]);

  useEffect(() => {
    depthScene.traverse((object: Object3D) => {
      if (!(object instanceof Mesh) || !(object.material instanceof MeshBasicMaterial)) return;
      object.material.clippingPlanes = clipEnabled ? [clippingPlane] : [];
      object.material.needsUpdate = true;
    });
  }, [clipEnabled, clippingPlane, depthScene]);

  return (
    <>
      <primitive object={depthScene} visible={visible && depthContextEnabled} />
      <primitive object={scene} visible={visible} />
    </>
  );
}

export function SubjectBrain({
  baseOpacity,
  clipEnabled,
  clippingPlane,
  dimmed,
  revision,
  visible,
}: Omit<SharedMeshProps, "depthContextEnabled"> & { revision: string | null }) {
  const { scene: sourceScene } = useGLTF(
    `/api/import/viewer/subject.glb?v=${encodeURIComponent(revision ?? "current")}`,
  );
  const scene = useMemo(() => sourceScene.clone(true), [sourceScene]);

  useLayoutEffect(() => {
    scene.traverse((object: Object3D) => {
      if (!(object instanceof Mesh)) return;
      object.geometry.computeVertexNormals();
      object.material = new MeshStandardMaterial({
        color: "#cbd8d2",
        roughness: 0.7,
        metalness: 0,
        side: DoubleSide,
      });
      object.raycast = () => undefined;
      object.castShadow = true;
      object.receiveShadow = true;
    });
  }, [scene]);

  useEffect(() => {
    scene.traverse((object: Object3D) => {
      if (!(object instanceof Mesh) || !(object.material instanceof MeshStandardMaterial)) return;
      object.material.opacity = dimmed
        ? Math.min(DIMMED_BRAIN_OPACITY, baseOpacity * 0.25)
        : baseOpacity;
      object.material.transparent = object.material.opacity < 0.999;
      object.material.depthWrite = object.material.opacity >= 0.999;
      object.material.clippingPlanes = clipEnabled ? [clippingPlane] : [];
      object.material.clipShadows = clipEnabled;
      object.material.needsUpdate = true;
    });
  }, [baseOpacity, clipEnabled, clippingPlane, dimmed, scene]);

  return <primitive object={scene} visible={visible} />;
}

export function SubjectRegion({
  overlay,
  region,
  revision,
  visible,
}: {
  overlay: boolean;
  region: RegionDefinition;
  revision: string | null;
  visible: boolean;
}) {
  const { scene: sourceScene } = useGLTF(subjectAllenRegionUrl(region.id, revision));
  const scene = useMemo(() => sourceScene.clone(true), [sourceScene]);

  useLayoutEffect(() => {
    scene.traverse((object: Object3D) => {
      if (!(object instanceof Mesh)) return;
      object.userData.regionId = region.id;
      object.geometry.computeVertexNormals();
      object.material = new MeshStandardMaterial({
        color: region.color,
        emissive: region.color,
        emissiveIntensity: 0.2,
        roughness: 0.62,
        metalness: 0,
        side: DoubleSide,
      });
      object.castShadow = true;
      object.receiveShadow = true;
    });
  }, [region, scene]);

  useEffect(() => {
    scene.traverse((object: Object3D) => {
      if (!(object instanceof Mesh) || !(object.material instanceof MeshStandardMaterial)) return;
      object.layers.set(overlay ? SELECTED_REGION_LAYER : 0);
      object.material.clippingPlanes = [];
      object.material.needsUpdate = true;
    });
  }, [overlay, scene]);

  return <primitive object={scene} visible={visible} />;
}
