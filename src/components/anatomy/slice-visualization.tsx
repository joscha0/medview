import { useThree } from "@react-three/fiber";
import { useEffect, useMemo } from "react";
import * as THREE from "three";
import type { SliceTransform } from "./types";

export function SliceCamera({ transform }: { transform: SliceTransform }) {
  const { camera } = useThree();

  useEffect(() => {
    const viewingDirection = transform.normal.clone().negate();
    camera.position.copy(
      transform.position.clone().addScaledVector(viewingDirection, 3),
    );
    camera.up.copy(
      Math.abs(viewingDirection.y) > 0.9
        ? transform.vertical
        : new THREE.Vector3(0, 1, 0),
    );
    camera.lookAt(transform.position);
    camera.updateProjectionMatrix();
  }, [camera, transform]);

  return null;
}

export function SlicePlaneIndicator({
  transform,
}: {
  transform: SliceTransform;
}) {
  const geometries = useMemo(() => {
    const surface = new THREE.PlaneGeometry(transform.width, transform.height);
    return {
      surface,
      outline: new THREE.EdgesGeometry(surface),
    };
  }, [transform.height, transform.width]);

  useEffect(
    () => () => {
      geometries.outline.dispose();
      geometries.surface.dispose();
    },
    [geometries],
  );

  return (
    <group position={transform.position} quaternion={transform.quaternion}>
      <mesh geometry={geometries.surface} renderOrder={10}>
        <meshBasicMaterial
          color="#ef4444"
          opacity={0.24}
          transparent
          side={THREE.DoubleSide}
          depthTest={false}
          depthWrite={false}
        />
      </mesh>
      <lineSegments geometry={geometries.outline} renderOrder={11}>
        <lineBasicMaterial
          color="#f87171"
          opacity={0.9}
          transparent
          depthTest={false}
          depthWrite={false}
        />
      </lineSegments>
    </group>
  );
}

