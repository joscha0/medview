import { useLoader, type ThreeEvent } from "@react-three/fiber";
import { useCallback, useEffect, useMemo } from "react";
import * as THREE from "three";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import {
  ANATOMY_LAYERS,
  DEFAULT_ANATOMY_LAYER,
  DEFAULT_ANATOMY_LAYER_CONFIG,
  getAnatomyLayerUrl,
  type AnatomyLayerId,
} from "./constants";
import {
  applyClippingPlanes,
  cloneAnatomyScene,
  getAnatomyPartName,
} from "./scene-utils";
import { SelectionOutline } from "./selection-outline";
import {
  getSliceClippingPlanes,
  getSliceTransform,
} from "./slice-transform";
import { SliceCamera, SlicePlaneIndicator } from "./slice-visualization";
import type { AnatomyViewMode, DicomSlicePlane } from "./types";

type AnatomyModelProps = {
  selectedLayers: ReadonlySet<AnatomyLayerId>;
  selectedPart: string | null;
  slicePlane: DicomSlicePlane | null;
  onSelectPart: (part: string) => void;
  onReady?: () => void;
  viewMode?: AnatomyViewMode;
};

function useAnatomyLayer(url: string) {
  return useLoader(GLTFLoader, url, (loader) => {
    loader.setMeshoptDecoder(MeshoptDecoder);
  });
}

function AnatomyLayer({
  url,
  clippingPlanes,
  selectedPart,
}: {
  url: string;
  clippingPlanes: THREE.Plane[] | null;
  selectedPart: string | null;
}) {
  const gltf = useAnatomyLayer(url);
  const scene = useMemo(() => cloneAnatomyScene(gltf.scene), [gltf.scene]);

  useEffect(() => {
    applyClippingPlanes(scene, clippingPlanes);
  }, [clippingPlanes, scene]);

  return (
    <>
      <primitive object={scene} dispose={null} />
      <SelectionOutline
        scene={scene}
        selectedPart={selectedPart}
        clippingPlanes={clippingPlanes}
      />
    </>
  );
}

export function AnatomyModel({
  selectedLayers,
  selectedPart,
  slicePlane,
  onSelectPart,
  onReady,
  viewMode = "model",
}: AnatomyModelProps) {
  const gltf = useAnatomyLayer(
    getAnatomyLayerUrl(DEFAULT_ANATOMY_LAYER_CONFIG.file),
  );
  const selectionKey = [...selectedLayers].sort().join(",");

  const fittedModel = useMemo(() => {
    const scene = cloneAnatomyScene(gltf.scene, true);
    const bounds = new THREE.Box3().setFromObject(scene);
    const center = bounds.getCenter(new THREE.Vector3());
    const sphere = bounds.getBoundingSphere(new THREE.Sphere());
    const scale = 1 / Math.max(sphere.radius, 0.1);

    return {
      scene,
      scale,
      modelHeight: bounds.getSize(new THREE.Vector3()).y * scale,
      position: center.multiplyScalar(-scale),
    };
  }, [gltf.scene]);

  const sliceTransform = useMemo(
    () =>
      slicePlane
        ? getSliceTransform(slicePlane, fittedModel.modelHeight)
        : null,
    [fittedModel.modelHeight, slicePlane],
  );
  const clippingPlanes = useMemo(() => {
    if (viewMode !== "slice" || !sliceTransform) return null;
    return getSliceClippingPlanes(sliceTransform, fittedModel.modelHeight);
  }, [fittedModel.modelHeight, sliceTransform, viewMode]);

  useEffect(() => {
    applyClippingPlanes(fittedModel.scene, clippingPlanes);
  }, [clippingPlanes, fittedModel.scene]);

  useEffect(() => onReady?.(), [onReady, selectionKey]);

  const handlePartClick = useCallback(
    (event: ThreeEvent<MouseEvent>) => {
      const part = getAnatomyPartName(event.object);
      if (!part) return;
      event.stopPropagation();
      onSelectPart(part);
    },
    [onSelectPart],
  );

  return (
    <>
      <group
        position={fittedModel.position}
        scale={fittedModel.scale}
        onClick={handlePartClick}
      >
        {ANATOMY_LAYERS.map((layer) => {
          if (!selectedLayers.has(layer.id)) return null;
          if (layer.id === DEFAULT_ANATOMY_LAYER) {
            return (
              <primitive
                key={layer.id}
                object={fittedModel.scene}
                dispose={null}
              />
            );
          }
          return (
            <AnatomyLayer
              key={layer.id}
              url={getAnatomyLayerUrl(layer.file)}
              clippingPlanes={clippingPlanes}
              selectedPart={selectedPart}
            />
          );
        })}
        {selectedLayers.has(DEFAULT_ANATOMY_LAYER) && (
          <SelectionOutline
            scene={fittedModel.scene}
            selectedPart={selectedPart}
            clippingPlanes={clippingPlanes}
          />
        )}
      </group>
      {viewMode === "model" && sliceTransform && (
        <SlicePlaneIndicator transform={sliceTransform} />
      )}
      {viewMode === "slice" && sliceTransform && (
        <SliceCamera transform={sliceTransform} />
      )}
    </>
  );
}

