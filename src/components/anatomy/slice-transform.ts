import * as THREE from "three";
import type { DicomSlicePlane, SliceTransform } from "./types";

const DEFAULT_PATIENT_HEIGHT_MM = 1800;
const ATLAS_VERTICAL_PLANE_SCALE = 1.2;

function patientDirectionToModel(direction: readonly number[]) {
  return new THREE.Vector3(direction[0], direction[2], -direction[1]);
}

export function getSliceTransform(
  plane: DicomSlicePlane,
  modelHeight: number,
): SliceTransform {
  const horizontal = patientDirectionToModel(
    plane.imageOrientation.slice(0, 3),
  ).normalize();
  const vertical = patientDirectionToModel(
    plane.imageOrientation.slice(3, 6),
  ).normalize();
  const normal = new THREE.Vector3()
    .crossVectors(horizontal, vertical)
    .normalize();
  const basis = new THREE.Matrix4().makeBasis(horizontal, vertical, normal);
  const modelUnitsPerMillimeter =
    modelHeight / (plane.patientHeightMm ?? DEFAULT_PATIENT_HEIGHT_MM);

  const position = normal
    .clone()
    .multiplyScalar(
      plane.offsetFromSeriesCenterMm * modelUnitsPerMillimeter,
    );
  position.y += plane.anatomicalCenterHeightFraction * modelHeight;

  return {
    position,
    quaternion: new THREE.Quaternion().setFromRotationMatrix(basis),
    horizontal,
    vertical,
    normal,
    width: plane.widthMm * modelUnitsPerMillimeter,
    height:
      plane.heightMm *
      modelUnitsPerMillimeter *
      THREE.MathUtils.lerp(
        1,
        ATLAS_VERTICAL_PLANE_SCALE,
        Math.abs(vertical.y),
      ),
  };
}

export function getSliceClippingPlanes(
  transform: SliceTransform,
  modelHeight: number,
) {
  const centerDistance = transform.normal.dot(transform.position);
  const halfThickness = modelHeight * 0.006;

  return [
    new THREE.Plane(
      transform.normal.clone(),
      -(centerDistance - halfThickness),
    ),
    new THREE.Plane(
      transform.normal.clone().negate(),
      centerDistance + halfThickness,
    ),
  ];
}

