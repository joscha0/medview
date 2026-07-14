import { useEffect, useMemo } from "react";
import * as THREE from "three";
import { getAnatomyPartName } from "./scene-utils";

type SelectionOutlineProps = {
  scene: THREE.Object3D;
  selectedPart: string | null;
  clippingPlanes: THREE.Plane[] | null;
};

export function SelectionOutline({
  scene,
  selectedPart,
  clippingPlanes,
}: SelectionOutlineProps) {
  const outlinedMeshes = useMemo(() => {
    if (!selectedPart) return [];

    scene.updateMatrixWorld(true);
    const parentWorldInverse = scene.parent
      ? scene.parent.matrixWorld.clone().invert()
      : new THREE.Matrix4();
    const matches: Array<{
      geometry: THREE.BufferGeometry;
      matrix: THREE.Matrix4;
    }> = [];

    scene.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      if (getAnatomyPartName(object) !== selectedPart) return;

      const position = new THREE.Vector3();
      const quaternion = new THREE.Quaternion();
      const scale = new THREE.Vector3();
      const localMatrix = parentWorldInverse
        .clone()
        .multiply(object.matrixWorld);
      localMatrix.decompose(position, quaternion, scale);
      scale.multiplyScalar(1.035);
      matches.push({
        geometry: object.geometry,
        matrix: new THREE.Matrix4().compose(position, quaternion, scale),
      });
    });

    return matches;
  }, [scene, selectedPart]);

  const material = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        color: "#ffff00",
        side: THREE.BackSide,
        depthWrite: false,
        clippingPlanes,
      }),
    [clippingPlanes],
  );

  useEffect(() => () => material.dispose(), [material]);

  return outlinedMeshes.map((mesh, index) => (
    <mesh
      key={`${selectedPart}-${index}`}
      geometry={mesh.geometry}
      material={material}
      matrix={mesh.matrix}
      matrixAutoUpdate={false}
      raycast={() => null}
      renderOrder={20}
    />
  ));
}

