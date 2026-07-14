import {
  Canvas,
  useFrame,
  useLoader,
  useThree,
  type ThreeEvent,
} from "@react-three/fiber";
import {
  Component,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { Button } from "@/components/ui/button";
import { Card, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

const ANATOMY_LAYERS = [
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

type AnatomyLayerId = (typeof ANATOMY_LAYERS)[number]["id"];

const DEFAULT_LAYER: AnatomyLayerId = "muscular-system";
const DEFAULT_LAYER_CONFIG = ANATOMY_LAYERS.find(
  (layer) => layer.id === DEFAULT_LAYER,
)!;
const layerUrl = (file: string) => `/anatomy-layers/${file}?v=anatomy-layers-1`;
const HIDDEN_MUSCLE_COVERINGS = new Set([
  "Articular capsule",
  "Bursa",
  "Cartilage",
  "Fascia",
  "Ligament",
]);
const DEFAULT_PATIENT_HEIGHT_MM = 1800;
const ATLAS_VERTICAL_PLANE_SCALE = 1.2;

export type DicomSlicePlane = {
  anatomicalCenterHeightFraction: number;
  imageOrientation: [number, number, number, number, number, number];
  offsetFromSeriesCenterMm: number;
  patientHeightMm?: number;
  widthMm: number;
  heightMm: number;
};

type ModelErrorBoundaryProps = {
  children: ReactNode;
  onError: () => void;
};

class ModelErrorBoundary extends Component<
  ModelErrorBoundaryProps,
  { hasError: boolean }
> {
  state = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch() {
    this.props.onError();
  }

  render() {
    return this.state.hasError ? null : this.props.children;
  }
}

function useAnatomyLayer(url: string) {
  return useLoader(GLTFLoader, url, (loader) => {
    loader.setMeshoptDecoder(MeshoptDecoder);
  });
}

function cloneSceneMaterials(
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
    if (hideMuscleCoverings && clonedMaterials.every((material) => !material.visible)) {
      object.visible = false;
    }
  });

  return scene;
}

function applyClippingPlanes(
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

function getAnatomyPartName(object: THREE.Object3D | null) {
  let current = object;
  while (current) {
    const name = current.name.trim();
    if (name && !/^(mesh|scene|auxscene)$/i.test(name)) return name;
    current = current.parent;
  }
  return null;
}

function displayAnatomyPartName(name: string) {
  return name
    .replace(/\.[oe]\d*$/, "")
    .replace(/\.r$/, " · right")
    .replace(/\.l$/, " · left");
}

function SelectionOutline({
  scene,
  selectedPart,
  clippingPlanes,
}: {
  scene: THREE.Object3D;
  selectedPart: string | null;
  clippingPlanes: THREE.Plane[] | null;
}) {
  const outlinedMeshes = useMemo(() => {
    if (!selectedPart) return [];
    scene.updateMatrixWorld(true);
    const parentWorldInverse = scene.parent
      ? scene.parent.matrixWorld.clone().invert()
      : new THREE.Matrix4();
    const matches: Array<{
      geometry: THREE.BufferGeometry;
      matrix: THREE.Matrix4;
    }> = [];

    scene.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      if (getAnatomyPartName(object) !== selectedPart) return;
      const position = new THREE.Vector3();
      const quaternion = new THREE.Quaternion();
      const scale = new THREE.Vector3();
      const localMatrix = parentWorldInverse.clone().multiply(object.matrixWorld);
      localMatrix.decompose(position, quaternion, scale);
      scale.multiplyScalar(1.035);
      matches.push({
        geometry: object.geometry,
        matrix: new THREE.Matrix4().compose(position, quaternion, scale),
      });
    });

    return matches;
  }, [scene, selectedPart]);

  const material = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        color: "#ffff00",
        side: THREE.BackSide,
        depthWrite: false,
        clippingPlanes,
      }),
    [clippingPlanes],
  );

  useEffect(() => () => material.dispose(), [material]);

  return outlinedMeshes.map((mesh, index) => (
    <mesh
      key={`${selectedPart}-${index}`}
      geometry={mesh.geometry}
      material={material}
      matrix={mesh.matrix}
      matrixAutoUpdate={false}
      raycast={() => null}
      renderOrder={20}
    />
  ));
}

function LayerModel({
  url,
  clippingPlanes,
  selectedPart,
}: {
  url: string;
  clippingPlanes: THREE.Plane[] | null;
  selectedPart: string | null;
}) {
  const gltf = useAnatomyLayer(url);
  const scene = useMemo(
    () => cloneSceneMaterials(gltf.scene),
    [gltf.scene],
  );

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

function AnatomyModel({
  selectedLayers,
  selectedPart,
  slicePlane,
  onSelectPart,
  onReady,
  viewMode = "model",
}: {
  selectedLayers: ReadonlySet<AnatomyLayerId>;
  selectedPart: string | null;
  slicePlane: DicomSlicePlane | null;
  onSelectPart: (part: string) => void;
  onReady?: () => void;
  viewMode?: "model" | "slice";
}) {
  const gltf = useAnatomyLayer(layerUrl(DEFAULT_LAYER_CONFIG.file));
  const selectionKey = [...selectedLayers].sort().join(",");

  const fittedModel = useMemo(() => {
    const scene = cloneSceneMaterials(gltf.scene, true);

    const bounds = new THREE.Box3().setFromObject(scene);
    const center = bounds.getCenter(new THREE.Vector3());
    const sphere = bounds.getBoundingSphere(new THREE.Sphere());
    const scale = 1 / Math.max(sphere.radius, 0.1);
    const modelHeight = bounds.getSize(new THREE.Vector3()).y * scale;

    return {
      scene,
      scale,
      modelHeight,
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
    const centerDistance = sliceTransform.normal.dot(sliceTransform.position);
    const halfThickness = fittedModel.modelHeight * 0.006;
    return [
      new THREE.Plane(
        sliceTransform.normal.clone(),
        -(centerDistance - halfThickness),
      ),
      new THREE.Plane(
        sliceTransform.normal.clone().negate(),
        centerDistance + halfThickness,
      ),
    ];
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
          if (layer.id === DEFAULT_LAYER) {
            return (
              <primitive
                key={layer.id}
                object={fittedModel.scene}
                dispose={null}
              />
            );
          }
          return (
            <LayerModel
              key={layer.id}
              url={layerUrl(layer.file)}
              clippingPlanes={clippingPlanes}
              selectedPart={selectedPart}
            />
          );
        })}
        {selectedLayers.has(DEFAULT_LAYER) && (
          <SelectionOutline
            scene={fittedModel.scene}
            selectedPart={selectedPart}
            clippingPlanes={clippingPlanes}
          />
        )}
      </group>
      {viewMode === "model" && sliceTransform && (
        <SlicePlaneIndicator
          transform={sliceTransform}
        />
      )}
      {viewMode === "slice" && sliceTransform && (
        <SliceCamera transform={sliceTransform} />
      )}
    </>
  );
}

function CameraControls() {
  const { camera, gl } = useThree();
  const controlsRef = useRef<OrbitControls | null>(null);

  useEffect(() => {
    const controls = new OrbitControls(camera, gl.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.enablePan = false;
    controls.minDistance = 1.25;
    controls.maxDistance = 7;
    controls.target.set(0, 0, 0);
    controls.update();
    controlsRef.current = controls;

    return () => {
      controlsRef.current = null;
      controls.dispose();
    };
  }, [camera, gl.domElement]);

  useFrame(() => controlsRef.current?.update());
  return null;
}

function patientDirectionToModel(direction: readonly number[]) {
  return new THREE.Vector3(direction[0], direction[2], -direction[1]);
}

type SliceTransform = {
  position: THREE.Vector3;
  quaternion: THREE.Quaternion;
  horizontal: THREE.Vector3;
  vertical: THREE.Vector3;
  normal: THREE.Vector3;
  width: number;
  height: number;
};

function getSliceTransform(
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

function SliceCamera({ transform }: { transform: SliceTransform }) {
  const { camera } = useThree();

  useEffect(() => {
    const viewingDirection = transform.normal.clone().negate();
    camera.position.copy(
      transform.position.clone().addScaledVector(viewingDirection, 3),
    );
    camera.up.copy(
      Math.abs(viewingDirection.y) > 0.9
        ? transform.vertical
        : new THREE.Vector3(0, 1, 0),
    );
    camera.lookAt(transform.position);
    camera.updateProjectionMatrix();
  }, [camera, transform]);

  return null;
}

function SlicePlaneIndicator({ transform }: { transform: SliceTransform }) {

  const geometries = useMemo(() => {
    const surface = new THREE.PlaneGeometry(transform.width, transform.height);
    return {
      surface,
      outline: new THREE.EdgesGeometry(surface),
    };
  }, [transform.height, transform.width]);

  useEffect(
    () => () => {
      geometries.outline.dispose();
      geometries.surface.dispose();
    },
    [geometries],
  );

  return (
    <group position={transform.position} quaternion={transform.quaternion}>
      <mesh geometry={geometries.surface} renderOrder={10}>
        <meshBasicMaterial
          color="#ef4444"
          opacity={0.24}
          transparent
          side={THREE.DoubleSide}
          depthTest={false}
          depthWrite={false}
        />
      </mesh>
      <lineSegments geometry={geometries.outline} renderOrder={11}>
        <lineBasicMaterial
          color="#f87171"
          opacity={0.9}
          transparent
          depthTest={false}
          depthWrite={false}
        />
      </lineSegments>
    </group>
  );
}

export function AnatomyViewer({
  slicePlane = null,
}: {
  slicePlane?: DicomSlicePlane | null;
}) {
  const [selectedLayers, setSelectedLayers] = useState<Set<AnatomyLayerId>>(
    () => new Set([DEFAULT_LAYER]),
  );
  const [status, setStatus] = useState<"loading" | "ready" | "error">(
    "loading",
  );
  const [selectedPart, setSelectedPart] = useState<string | null>(null);
  const handleReady = useCallback(() => setStatus("ready"), []);
  const handleError = useCallback(() => setStatus("error"), []);
  const toggleLayer = useCallback((id: AnatomyLayerId) => {
    setStatus("loading");
    setSelectedLayers((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  return (
    <div
      className="relative flex h-[32svh] min-h-40 max-h-80 shrink-0 overflow-hidden border-b bg-black [&_canvas]:touch-none"
      aria-label="Interactive 3D anatomy model and synchronized slice view."
    >
      <div className="relative min-w-0 flex-1">
        <ModelErrorBoundary onError={handleError}>
          <Canvas
            camera={{
              fov: 32,
              near: 0.01,
              far: 20,
              position: [1.8, 0.15, 3.35],
            }}
            dpr={[1, 1.5]}
            gl={{ antialias: true }}
            onPointerMissed={() => setSelectedPart(null)}
            onCreated={({ gl }) => {
              gl.outputColorSpace = THREE.SRGBColorSpace;
              gl.toneMapping = THREE.ACESFilmicToneMapping;
              gl.toneMappingExposure = 0.7;
            }}
          >
            <color attach="background" args={["#000000"]} />
            <hemisphereLight args={[0xffffff, 0x202020, 0.55]} />
            <directionalLight intensity={1.05} position={[3, 4, 5]} />
            <directionalLight
              color={0x9cc8ff}
              intensity={0.3}
              position={[-4, 2, -3]}
            />
            <CameraControls />
            <Suspense fallback={null}>
              <AnatomyModel
                selectedLayers={selectedLayers}
                selectedPart={selectedPart}
                slicePlane={slicePlane}
                onSelectPart={setSelectedPart}
                onReady={handleReady}
              />
            </Suspense>
          </Canvas>
        </ModelErrorBoundary>

        <div
          className="absolute bottom-2 left-2 top-2 z-10 grid w-60 auto-rows-max grid-cols-3 gap-1 overflow-y-auto rounded-md bg-black/60 p-1 backdrop-blur-sm"
          aria-label="Anatomy layers"
        >
          {ANATOMY_LAYERS.map((layer) => {
            const selected = selectedLayers.has(layer.id);
            return (
              <Card
                key={layer.id}
                className={cn(
                  "h-[76px] overflow-hidden rounded-md bg-black/30 shadow-none transition-colors",
                  selected ? "border-white/40 bg-white/10" : "border-white/10",
                )}
              >
                <Button
                  type="button"
                  variant="ghost"
                  aria-pressed={selected}
                  onClick={() => toggleLayer(layer.id)}
                  className={cn(
                    "h-full w-full flex-col gap-0 rounded-[5px] p-0.5 font-normal whitespace-normal",
                    selected
                      ? "text-white hover:bg-white/5"
                      : "text-white/55 hover:bg-white/5 hover:text-white/80",
                  )}
                >
                  <img
                    src={`/anatomy-layers/previews/${layer.id}.png`}
                    alt=""
                    draggable={false}
                    className="h-12 min-h-0 w-full select-none object-contain"
                  />
                  <CardTitle className="line-clamp-2 flex min-h-5 w-full items-center justify-center px-0.5 text-center text-[9px] font-normal leading-[1.05]">
                    {layer.name}
                  </CardTitle>
                </Button>
              </Card>
            );
          })}
        </div>

        {status === "loading" && (
          <div className="pointer-events-none absolute inset-0 grid place-items-center text-xs text-white/50">
            Loading anatomy…
          </div>
        )}
        {status === "error" && (
          <div className="pointer-events-none absolute inset-0 grid place-items-center text-xs text-white/50">
            Anatomy model unavailable
          </div>
        )}
        {status === "ready" && (
          <div className="pointer-events-none absolute bottom-2 right-3 text-[10px] text-white/35">
            Drag to rotate · Scroll to zoom
          </div>
        )}
      </div>

      <div
        className="relative w-1/3 min-w-0 border-l border-white/10 bg-black"
        aria-label="Sliced anatomy view"
      >
        {slicePlane ? (
          <ModelErrorBoundary onError={handleError}>
            <Canvas
              camera={{ fov: 28, near: 0.01, far: 20, position: [0, 0, 3] }}
              dpr={[1, 1.5]}
              gl={{ antialias: true, localClippingEnabled: true }}
              onPointerMissed={() => setSelectedPart(null)}
              onCreated={({ gl }) => {
                gl.localClippingEnabled = true;
                gl.outputColorSpace = THREE.SRGBColorSpace;
                gl.toneMapping = THREE.ACESFilmicToneMapping;
                gl.toneMappingExposure = 0.8;
              }}
            >
              <color attach="background" args={["#050505"]} />
              <hemisphereLight args={[0xffffff, 0x202020, 0.8]} />
              <directionalLight intensity={1.2} position={[2, 3, 4]} />
              <Suspense fallback={null}>
                <AnatomyModel
                  selectedLayers={selectedLayers}
                  selectedPart={selectedPart}
                  slicePlane={slicePlane}
                  onSelectPart={setSelectedPart}
                  viewMode="slice"
                />
              </Suspense>
            </Canvas>
          </ModelErrorBoundary>
        ) : (
          <div className="absolute inset-0 grid place-items-center px-4 text-center text-[10px] text-white/35">
            Load a DICOM series to view the anatomy slice
          </div>
        )}
        <div className="pointer-events-none absolute left-2 top-2 rounded bg-black/60 px-1.5 py-1 text-[9px] text-white/50">
          3D slice
        </div>
      </div>

      {selectedPart && (
        <div className="pointer-events-none absolute left-1/2 top-2 z-20 -translate-x-1/2 rounded-md border border-yellow-300/25 bg-black/75 px-2.5 py-1 text-[10px] text-yellow-100 shadow-sm backdrop-blur-sm">
          {displayAnatomyPartName(selectedPart)}
        </div>
      )}
    </div>
  );
}
