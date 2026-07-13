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

const MODEL_URL = "/anatomy-optimized.glb?v=anatomy-palette-2";

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

function AnatomyModel({ onReady }: { onReady: () => void }) {
  const gltf = useLoader(GLTFLoader, MODEL_URL, (loader) => {
    loader.setMeshoptDecoder(MeshoptDecoder);
  });

  const fittedModel = useMemo(() => {
    const scene = gltf.scene.clone(true);
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

  useEffect(onReady, [onReady]);

  return (
    <primitive
      object={fittedModel.scene}
      position={fittedModel.position}
      scale={fittedModel.scale}
      dispose={null}
    />
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
  const [status, setStatus] = useState<"loading" | "ready" | "error">(
    "loading",
  );
  const handleReady = useCallback(() => setStatus("ready"), []);
  const handleError = useCallback(() => setStatus("error"), []);

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
            gl.toneMappingExposure = 0.8;
          }}
        >
          <color attach="background" args={["#000000"]} />
          <hemisphereLight args={[0xffffff, 0x202020, 0.9]} />
          <directionalLight intensity={1.4} position={[3, 4, 5]} />
          <directionalLight
            color={0x9cc8ff}
            intensity={0.55}
            position={[-4, 2, -3]}
          />
          <CameraControls />
          <Suspense fallback={null}>
            <AnatomyModel onReady={handleReady} />
          </Suspense>
        </Canvas>
      </ModelErrorBoundary>

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
