import { Canvas, useFrame, useLoader, useThree } from "@react-three/fiber";
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
const layerUrl = (file: string) =>
  `/anatomy-layers/${file}?v=anatomy-layers-1`;
const HIDDEN_MUSCLE_COVERINGS = new Set([
  "Articular capsule",
  "Bursa",
  "Cartilage",
  "Fascia",
  "Ligament",
]);

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

function LayerModel({ url }: { url: string }) {
  const gltf = useAnatomyLayer(url);
  const scene = useMemo(() => gltf.scene.clone(true), [gltf.scene]);

  return <primitive object={scene} dispose={null} />;
}

function AnatomyModel({
  selectedLayers,
  onReady,
}: {
  selectedLayers: ReadonlySet<AnatomyLayerId>;
  onReady: () => void;
}) {
  const gltf = useAnatomyLayer(layerUrl(DEFAULT_LAYER_CONFIG.file));
  const selectionKey = [...selectedLayers].sort().join(",");

  const fittedModel = useMemo(() => {
    const scene = gltf.scene.clone(true);
    const materials = new Map<string, THREE.Material>();

    scene.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;

      const sourceMaterials = Array.isArray(object.material)
        ? object.material
        : [object.material];
      const clonedMaterials = sourceMaterials.map((source) => {
        const material = materials.get(source.uuid);
        if (material) {
          return material;
        }

        const clone = source.clone() as THREE.Material;
        clone.visible = !HIDDEN_MUSCLE_COVERINGS.has(clone.name);
        materials.set(source.uuid, clone);
        return clone;
      });
      object.material = Array.isArray(object.material)
        ? clonedMaterials
        : clonedMaterials[0];
    });

    const bounds = new THREE.Box3().setFromObject(scene);
    const center = bounds.getCenter(new THREE.Vector3());
    const sphere = bounds.getBoundingSphere(new THREE.Sphere());
    const scale = 1 / Math.max(sphere.radius, 0.1);

    return {
      scene,
      scale,
      position: center.multiplyScalar(-scale),
    };
  }, [gltf.scene]);

  useEffect(onReady, [onReady, selectionKey]);

  return (
    <group
      position={fittedModel.position}
      scale={fittedModel.scale}
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
        return <LayerModel key={layer.id} url={layerUrl(layer.file)} />;
      })}
    </group>
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

export function AnatomyViewer() {
  const [selectedLayers, setSelectedLayers] = useState<
    Set<AnatomyLayerId>
  >(() => new Set([DEFAULT_LAYER]));
  const [status, setStatus] = useState<"loading" | "ready" | "error">(
    "loading",
  );
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
      className="relative h-[32svh] min-h-40 max-h-80 shrink-0 overflow-hidden border-b bg-black [&_canvas]:touch-none"
      aria-label="Interactive 3D anatomy model. Drag to rotate and scroll to zoom."
    >
      <ModelErrorBoundary onError={handleError}>
        <Canvas
          camera={{ fov: 32, near: 0.01, far: 20, position: [0.75, 0.08, 3.8] }}
          dpr={[1, 1.5]}
          gl={{ antialias: true }}
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
                selected
                  ? "border-white/40 bg-white/10"
                  : "border-white/10",
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
  );
}
