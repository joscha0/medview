import * as THREE from "three";
import { HIDDEN_MUSCLE_COVERINGS } from "./constants";

export function cloneAnatomyScene(
  sourceScene: THREE.Object3D,
  hideMuscleCoverings = false,
) {
  const scene = sourceScene.clone(true);
  const materials = new Map<string, THREE.Material>();

  scene.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;

    const sourceMaterials = Array.isArray(object.material)
      ? object.material
      : [object.material];
    const clonedMaterials = sourceMaterials.map((source) => {
      const existing = materials.get(source.uuid);
      if (existing) return existing;

      const clone = source.clone() as THREE.Material;
      if (hideMuscleCoverings) {
        clone.visible = !HIDDEN_MUSCLE_COVERINGS.has(clone.name);
      }
      materials.set(source.uuid, clone);
      return clone;
    });

    object.material = Array.isArray(object.material)
      ? clonedMaterials
      : clonedMaterials[0];
    if (
      hideMuscleCoverings &&
      clonedMaterials.every((material) => !material.visible)
    ) {
      object.visible = false;
    }
  });

  return scene;
}

export function applyClippingPlanes(
  scene: THREE.Object3D,
  clippingPlanes: THREE.Plane[] | null,
) {
  const materials = new Set<THREE.Material>();

  scene.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    const objectMaterials = Array.isArray(object.material)
      ? object.material
      : [object.material];
    objectMaterials.forEach((material) => materials.add(material));
  });

  materials.forEach((material) => {
    material.clippingPlanes = clippingPlanes;
    material.side = clippingPlanes ? THREE.DoubleSide : THREE.FrontSide;
    material.needsUpdate = true;
  });
}

export function getAnatomyPartName(object: THREE.Object3D | null) {
  let current = object;

  while (current) {
    const name = current.name.trim();
    if (name && !/^(mesh|scene|auxscene)$/i.test(name)) return name;
    current = current.parent;
  }

  return null;
}

export function formatAnatomyPartName(name: string) {
  return name
    .replace(/\.[oe]\d*$/, "")
    .replace(/\.r$/, " · right")
    .replace(/\.l$/, " · left");
}

