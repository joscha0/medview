import { describe, expect, it } from "vitest";

import { orbitCamera } from "./orbit-camera";

const options = {
  maxPolarAngle: Math.PI - Math.PI / 36,
  minPolarAngle: Math.PI / 36,
  rotateSpeed: 0.8,
  worldUp: [0, 0, 1] as [number, number, number],
};

describe("Orbit camera rotation", () => {
  it("orbits around the focal point while preserving distance", () => {
    const result = orbitCamera(
      {
        focalPoint: [2, 3, 4],
        position: [2, -7, 4],
        viewUp: [0, 0, 1],
      },
      [100, 0],
      500,
      options,
    );
    const distance = Math.hypot(
      result.position[0] - result.focalPoint[0],
      result.position[1] - result.focalPoint[1],
      result.position[2] - result.focalPoint[2],
    );

    expect(distance).toBeCloseTo(10);
    expect(result.focalPoint).toEqual([2, 3, 4]);
    expect(result.position[0]).not.toBeCloseTo(2);
  });

  it("keeps the configured up axis fixed so users cannot roll the model", () => {
    const result = orbitCamera(
      {
        focalPoint: [0, 0, 0],
        position: [0, -10, 0],
        viewUp: [0.2, 0.9, 0.1],
      },
      [60, -40],
      500,
      options,
    );

    expect(result.viewUp).toEqual([0, 0, 1]);
  });

  it("clamps pitch before the camera can flip over a pole", () => {
    const result = orbitCamera(
      {
        focalPoint: [0, 0, 0],
        position: [0, -10, 0],
        viewUp: [0, 0, 1],
      },
      [0, 10_000],
      500,
      options,
    );
    const offset = result.position.map(
      (coordinate, index) => coordinate - result.focalPoint[index],
    );
    const polarAngle = Math.acos(
      offset[2] / Math.hypot(offset[0], offset[1], offset[2]),
    );

    expect(polarAngle).toBeCloseTo(options.minPolarAngle);
  });
});
