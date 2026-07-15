import * as THREE from "three";
import { describe, expect, it } from "vitest";

import type { DicomSlicePlane } from "./types";
import { getSliceClippingPlanes, getSliceTransform } from "./slice-transform";

const axialPlane: DicomSlicePlane = {
  anatomicalCenterHeightFraction: 0.2,
  imageOrientation: [1, 0, 0, 0, 1, 0],
  offsetFromSeriesCenterMm: 10,
  patientHeightMm: 1800,
  widthMm: 400,
  heightMm: 300,
};

function expectVectorToBeCloseTo(
  vector: THREE.Vector3,
  expected: readonly [number, number, number],
) {
  vector.toArray().forEach((value, index) => {
    expect(value).toBeCloseTo(expected[index]);
  });
}

describe("DICOM slice placement in the anatomy model", () => {
  it("converts an axial slice's orientation, size, and offset to model coordinates", () => {
    const transform = getSliceTransform(axialPlane, 1.8);

    expectVectorToBeCloseTo(transform.horizontal, [1, 0, 0]);
    expectVectorToBeCloseTo(transform.vertical, [0, 0, -1]);
    expectVectorToBeCloseTo(transform.normal, [0, 1, 0]);
    expectVectorToBeCloseTo(transform.position, [0, 0.37, 0]);
    expect(transform.width).toBeCloseTo(0.4);
    expect(transform.height).toBeCloseTo(0.3);

    const rotatedNormal = new THREE.Vector3(0, 0, 1).applyQuaternion(
      transform.quaternion,
    );
    expect(rotatedNormal.distanceTo(transform.normal)).toBeLessThan(1e-10);
  });

  it("uses the default patient height and applies the atlas correction to a coronal slice", () => {
    const transform = getSliceTransform(
      {
        ...axialPlane,
        anatomicalCenterHeightFraction: 0,
        imageOrientation: [1, 0, 0, 0, 0, -1],
        offsetFromSeriesCenterMm: 0,
        patientHeightMm: undefined,
      },
      1.8,
    );

    expectVectorToBeCloseTo(transform.vertical, [0, -1, 0]);
    expect(transform.width).toBeCloseTo(0.4);
    expect(transform.height).toBeCloseTo(0.36);
  });
});

describe("Anatomy clipping around a DICOM slice", () => {
  it("places two opposing clipping planes at equal distances from the slice", () => {
    const transform = getSliceTransform(
      { ...axialPlane, anatomicalCenterHeightFraction: 0 },
      1.8,
    );
    const [front, back] = getSliceClippingPlanes(transform, 1.8);
    const center = transform.position;
    const halfThickness = 1.8 * 0.006;

    expect(front.distanceToPoint(center)).toBeCloseTo(halfThickness);
    expect(back.distanceToPoint(center)).toBeCloseTo(halfThickness);
    expect(front.normal.dot(back.normal)).toBeCloseTo(-1);
  });
});
