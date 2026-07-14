import type * as THREE from "three";

export type DicomSlicePlane = {
  anatomicalCenterHeightFraction: number;
  imageOrientation: [number, number, number, number, number, number];
  offsetFromSeriesCenterMm: number;
  patientHeightMm?: number;
  widthMm: number;
  heightMm: number;
};

export type SliceTransform = {
  position: THREE.Vector3;
  quaternion: THREE.Quaternion;
  horizontal: THREE.Vector3;
  vertical: THREE.Vector3;
  normal: THREE.Vector3;
  width: number;
  height: number;
};

export type AnatomyViewMode = "model" | "slice";

