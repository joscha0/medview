import * as THREE from "three";
import { describe, expect, it } from "vitest";

import {
  applyClippingPlanes,
  cloneAnatomyScene,
  formatAnatomyPartName,
  getAnatomyPartName,
} from "./scene-utils";

describe("Cloning the anatomy scene", () => {
  it("clones a shared material once so changes cannot affect the source scene", () => {
    const material = new THREE.MeshBasicMaterial();
    const source = new THREE.Group();
    source.add(
      new THREE.Mesh(new THREE.BoxGeometry(), material),
      new THREE.Mesh(new THREE.BoxGeometry(), material),
    );

    const clone = cloneAnatomyScene(source);
    const [first, second] = clone.children as THREE.Mesh[];

    expect(first.material).not.toBe(material);
    expect(first.material).toBe(second.material);

    (first.material as THREE.Material).visible = false;
    expect(material.visible).toBe(true);
  });

  it("hides muscle-covering meshes while keeping ordinary anatomy visible", () => {
    const source = new THREE.Group();
    const fascia = new THREE.MeshBasicMaterial({ name: "Fascia" });
    const muscle = new THREE.MeshBasicMaterial({ name: "Biceps brachii" });
    source.add(
      new THREE.Mesh(new THREE.BoxGeometry(), fascia),
      new THREE.Mesh(new THREE.BoxGeometry(), muscle),
    );

    const clone = cloneAnatomyScene(source, true);
    const [covering, anatomy] = clone.children as THREE.Mesh[];

    expect(covering.visible).toBe(false);
    expect((covering.material as THREE.Material).visible).toBe(false);
    expect(anatomy.visible).toBe(true);
    expect((anatomy.material as THREE.Material).visible).toBe(true);
  });
});

describe("Applying slice clipping to the anatomy scene", () => {
  it("enables double-sided clipping on every material and restores front sides when removed", () => {
    const first = new THREE.MeshBasicMaterial();
    const second = new THREE.MeshBasicMaterial();
    const scene = new THREE.Group();
    scene.add(
      new THREE.Mesh(new THREE.BoxGeometry(), first),
      new THREE.Mesh(new THREE.BoxGeometry(), [first, second]),
    );
    const planes = [new THREE.Plane(new THREE.Vector3(0, 1, 0), 0)];

    applyClippingPlanes(scene, planes);
    expect(first.clippingPlanes).toBe(planes);
    expect(second.clippingPlanes).toBe(planes);
    expect(first.side).toBe(THREE.DoubleSide);
    expect(second.side).toBe(THREE.DoubleSide);

    applyClippingPlanes(scene, null);
    expect(first.clippingPlanes).toBeNull();
    expect(second.clippingPlanes).toBeNull();
    expect(first.side).toBe(THREE.FrontSide);
    expect(second.side).toBe(THREE.FrontSide);
  });
});

describe("Finding the name of a selected anatomy part", () => {
  it("returns the nearest meaningful parent name when the selected mesh has a generic name", () => {
    const anatomy = new THREE.Group();
    anatomy.name = "Femur.r";
    const genericParent = new THREE.Group();
    genericParent.name = "Scene";
    const mesh = new THREE.Mesh();
    mesh.name = "Mesh";
    anatomy.add(genericParent);
    genericParent.add(mesh);

    expect(getAnatomyPartName(mesh)).toBe("Femur.r");
  });

  it("returns no name when nothing is selected", () => {
    expect(getAnatomyPartName(null)).toBeNull();
  });
});

describe("Formatting anatomy part names for display", () => {
  it.each([
    ["Femur.r", "Femur · right"],
    ["Kidney.l", "Kidney · left"],
    ["Muscle.o12", "Muscle"],
    ["Insertion.e3", "Insertion"],
  ])("formats model name %s as %s", (source, expected) => {
    expect(formatAnatomyPartName(source)).toBe(expected);
  });
});
