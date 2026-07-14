export const ANATOMY_LAYERS = [
  { id: "skeletal-system", name: "Skeletal", file: "skeletal-system.glb" },
  {
    id: "muscular-insertions",
    name: "Insertions",
    file: "muscular-insertions.glb",
  },
  { id: "joints", name: "Joints", file: "joints.glb" },
  {
    id: "muscular-system",
    name: "Muscular",
    file: "muscular-system.glb",
  },
  {
    id: "cardiovascular-system",
    name: "Cardiovascular",
    file: "cardiovascular-system.glb",
  },
  {
    id: "lymphoid-organs",
    name: "Lymphoid",
    file: "lymphoid-organs.glb",
  },
  {
    id: "nervous-system-sense-organs",
    name: "Nervous / senses",
    file: "nervous-system-sense-organs.glb",
  },
  {
    id: "visceral-systems",
    name: "Visceral",
    file: "visceral-systems.glb",
  },
] as const;

export type AnatomyLayerId = (typeof ANATOMY_LAYERS)[number]["id"];

export const DEFAULT_ANATOMY_LAYER: AnatomyLayerId = "muscular-system";
export const DEFAULT_ANATOMY_LAYER_CONFIG = ANATOMY_LAYERS.find(
  (layer) => layer.id === DEFAULT_ANATOMY_LAYER,
)!;

export const HIDDEN_MUSCLE_COVERINGS = new Set([
  "Articular capsule",
  "Bursa",
  "Cartilage",
  "Fascia",
  "Ligament",
]);

function getAnatomyAssetUrl(path: string) {
  return `${import.meta.env.BASE_URL}anatomy-layers/${path}`;
}

export function getAnatomyLayerUrl(file: string) {
  return `${getAnatomyAssetUrl(file)}?v=anatomy-layers-1`;
}

export function getAnatomyLayerPreviewUrl(layer: AnatomyLayerId) {
  return getAnatomyAssetUrl(`previews/${layer}.png`);
}
