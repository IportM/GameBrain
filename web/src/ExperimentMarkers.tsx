import { useLayoutEffect, useMemo, useRef } from "react";
import { useThree, type ThreeEvent } from "@react-three/fiber";
import { Color, DynamicDrawUsage, InstancedMesh, Matrix4, Object3D } from "three";
import { MESH_CENTER_MM } from "./atlas";
import type { ConnectivitySearchResult } from "./data";

export default function ExperimentMarkers({
  experiments, hoveredId, selectedId, onHover, onPress,
}: {
  experiments: ConnectivitySearchResult[];
  hoveredId: number | null;
  selectedId: number | null;
  onHover: (experiment: ConnectivitySearchResult | null) => void;
  onPress: (experiment: ConnectivitySearchResult) => void;
}) {
  const mesh = useRef<InstancedMesh>(null);
  const invalidate = useThree((state) => state.invalidate);
  const indexById = useMemo(() => new Map(experiments.map((experiment, index) => [experiment.id, index])), [experiments]);
  const previous = useRef<{ hoveredId: number | null; selectedId: number | null }>({ hoveredId: null, selectedId: null });
  const scratch = useMemo(() => ({ matrix: new Matrix4(), color: new Color() }), []);
  useLayoutEffect(() => {
    if (!mesh.current) return;
    const transform = new Object3D();
    const color = new Color();
    mesh.current.layers.set(1);
    experiments.forEach((experiment, index) => {
      const point = experiment.injectionCoordinatesUm!;
      transform.position.set(
        point[0] / 1000 - MESH_CENTER_MM[0],
        point[1] / 1000 - MESH_CENTER_MM[1],
        point[2] / 1000 - MESH_CENTER_MM[2],
      );
      transform.scale.setScalar(0.065);
      transform.updateMatrix();
      mesh.current!.setMatrixAt(index, transform.matrix);
      color.set(experiment.primaryStructure.color || "#72c8d1");
      mesh.current!.setColorAt(index, color);
    });
    mesh.current.instanceMatrix.setUsage(DynamicDrawUsage);
    mesh.current.instanceMatrix.clearUpdateRanges();
    mesh.current.instanceMatrix.addUpdateRange(0, experiments.length * 16);
    mesh.current.instanceMatrix.needsUpdate = true;
    if (mesh.current.instanceColor) {
      mesh.current.instanceColor.setUsage(DynamicDrawUsage);
      mesh.current.instanceColor.clearUpdateRanges();
      mesh.current.instanceColor.addUpdateRange(0, experiments.length * 3);
      mesh.current.instanceColor.needsUpdate = true;
    }
    mesh.current.computeBoundingSphere();
    // Keep raycasting bounds large enough for a subsequently enlarged marker.
    if (mesh.current.boundingSphere) mesh.current.boundingSphere.radius += 0.13 - 0.065;
    previous.current = { hoveredId: null, selectedId: null };
    invalidate();
  }, [experiments, invalidate]);

  useLayoutEffect(() => {
    const target = mesh.current;
    if (!target) return;
    const changedIds = new Set([previous.current.hoveredId, previous.current.selectedId, hoveredId, selectedId]);
    for (const id of changedIds) {
      const index = id === null ? undefined : indexById.get(id);
      if (index === undefined) continue;
      const selected = id === selectedId;
      const hovered = id === hoveredId;
      const radius = selected ? 0.13 : hovered ? 0.11 : 0.065;
      target.getMatrixAt(index, scratch.matrix);
      scratch.matrix.elements[0] = radius;
      scratch.matrix.elements[5] = radius;
      scratch.matrix.elements[10] = radius;
      target.setMatrixAt(index, scratch.matrix);
      scratch.color.set(selected ? "#ffffff" : hovered ? "#fff1c5" : experiments[index].primaryStructure.color || "#72c8d1");
      target.setColorAt(index, scratch.color);
      target.instanceMatrix.addUpdateRange(index * 16, 16);
      target.instanceColor?.addUpdateRange(index * 3, 3);
    }
    target.instanceMatrix.needsUpdate = true;
    if (target.instanceColor) target.instanceColor.needsUpdate = true;
    previous.current = { hoveredId, selectedId };
    invalidate();
  }, [experiments, indexById, hoveredId, selectedId, invalidate, scratch]);

  const atEvent = (event: ThreeEvent<PointerEvent | MouseEvent>) =>
    event.instanceId === undefined ? undefined : experiments[event.instanceId];

  if (experiments.length === 0) return null;
  return (
    <instancedMesh
      key={experiments.length}
      ref={mesh}
      args={[undefined, undefined, experiments.length]}
      renderOrder={100}
      frustumCulled={false}
      onPointerMove={(event) => {
        event.stopPropagation();
        onHover(event.buttons === 0 ? atEvent(event) ?? null : null);
      }}
      onPointerOut={() => onHover(null)}
      onPointerDown={(event) => {
        event.stopPropagation();
        const experiment = atEvent(event);
        if (event.button === 0 && experiment) onPress(experiment);
      }}
    >
      <sphereGeometry args={[1, 8, 6]} />
      <meshBasicMaterial depthTest={false} depthWrite={false} toneMapped={false} />
    </instancedMesh>
  );
}
