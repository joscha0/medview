import { describe, expect, it } from "vitest";

import { getDicomSlicePlane, sortDicomFiles } from "./series";
import type { DicomFileInfo } from "./types";

function slice(
  name: string,
  position: [number, number, number],
  instanceNumber: number,
): DicomFileInfo {
  return {
    file: { name } as File,
    columns: 100,
    rows: 50,
    imageOrientation: [1, 0, 0, 0, 1, 0],
    imagePosition: position,
    instanceNumber,
    pixelSpacing: [2, 3],
    seriesInstanceUid: "series",
  };
}

describe("DICOM series spatial helpers", () => {
  it("sorts slices by their position along the slice normal", () => {
    const files = [
      slice("third.dcm", [0, 0, 20], 3),
      slice("first.dcm", [0, 0, 0], 1),
      slice("second.dcm", [0, 0, 10], 2),
    ];

    expect(sortDicomFiles(files).map((file) => file.file.name)).toEqual([
      "first.dcm",
      "second.dcm",
      "third.dcm",
    ]);
  });

  it("builds the anatomy slice plane relative to the series center", () => {
    const files = [
      slice("first.dcm", [0, 0, 0], 1),
      slice("middle.dcm", [0, 0, 10], 2),
      slice("last.dcm", [0, 0, 20], 3),
    ];

    expect(getDicomSlicePlane(files, 1)).toMatchObject({
      heightMm: 100,
      offsetFromSeriesCenterMm: 0,
      widthMm: 300,
    });
  });
});
