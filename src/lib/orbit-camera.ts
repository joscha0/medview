import { Quaternion, Spherical, Vector3 as ThreeVector3 } from "three";

export type OrbitVector3 = [number, number, number];

export type OrbitCamera = {
  focalPoint: OrbitVector3;
  position: OrbitVector3;
  viewUp: OrbitVector3;
};

type OrbitCameraOptions = {
  maxPolarAngle: number;
  minPolarAngle: number;
  rotateSpeed: number;
  worldUp: OrbitVector3;
};

function toTuple(vector: ThreeVector3): OrbitVector3 {
  return [vector.x, vector.y, vector.z];
}

/**
 * Applies the same spherical-camera model used by Three.js OrbitControls.
 * Keeping worldUp fixed permits yaw and pitch while preventing camera roll.
 */
export function orbitCamera(
  camera: OrbitCamera,
  deltaCanvas: [number, number],
  viewportHeight: number,
  options: OrbitCameraOptions,
): OrbitCamera {
  if (viewportHeight <= 0) return camera;

  const target = new ThreeVector3(...camera.focalPoint);
  const position = new ThreeVector3(...camera.position);
  const worldUp = new ThreeVector3(...options.worldUp).normalize();
  if (worldUp.lengthSq() === 0) return camera;

  const offset = position.sub(target);
  if (offset.lengthSq() === 0) return camera;

  // OrbitControls transforms the camera's up axis to Y before converting the
  // offset to spherical coordinates, then transforms the result back.
  const yAxis = new ThreeVector3(0, 1, 0);
  const toYAxis = new Quaternion().setFromUnitVectors(worldUp, yAxis);
  const fromYAxis = toYAxis.clone().invert();
  const spherical = new Spherical().setFromVector3(
    offset.applyQuaternion(toYAxis),
  );
  const radiansPerPixel =
    (2 * Math.PI * options.rotateSpeed) / viewportHeight;

  spherical.theta -= deltaCanvas[0] * radiansPerPixel;
  spherical.phi -= deltaCanvas[1] * radiansPerPixel;
  spherical.phi = Math.max(
    options.minPolarAngle,
    Math.min(options.maxPolarAngle, spherical.phi),
  );
  spherical.makeSafe();

  offset.setFromSpherical(spherical).applyQuaternion(fromYAxis);

  return {
    focalPoint: [...camera.focalPoint],
    position: toTuple(target.add(offset)),
    viewUp: toTuple(worldUp),
  };
}
