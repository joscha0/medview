import { Canvas, useFrame, useThree } from "@react-three/fiber";
import {
  Component,
  Suspense,
  useEffect,
  useRef,
  type ReactNode,
} from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type { AnatomyLayerId } from "./constants";
import { AnatomyModel } from "./anatomy-model";
import type { AnatomyViewMode, DicomSlicePlane } from "./types";

type AnatomyCanvasProps = {
  selectedLayers: ReadonlySet<AnatomyLayerId>;
  selectedPart: string | null;
  slicePlane: DicomSlicePlane | null;
  viewMode?: AnatomyViewMode;
  onSelectPart: (part: string) => void;
  onClearSelection: () => void;
  onReady?: () => void;
  onError: () => void;
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

export function AnatomyCanvas({
  selectedLayers,
  selectedPart,
  slicePlane,
  viewMode = "model",
  onSelectPart,
  onClearSelection,
  onReady,
  onError,
}: AnatomyCanvasProps) {
  const isSliceView = viewMode === "slice";

  return (
    <ModelErrorBoundary onError={onError}>
      <Canvas
        className="h-full w-full"
        camera={
          isSliceView
            ? { fov: 28, near: 0.01, far: 20, position: [0, 0, 3] }
            : {
                fov: 32,
                near: 0.01,
                far: 20,
                position: [1.8, 0.15, 3.35],
              }
        }
        dpr={[1, 1.5]}
        gl={{ antialias: true, localClippingEnabled: isSliceView }}
        onPointerMissed={onClearSelection}
        onCreated={({ gl }) => {
          gl.localClippingEnabled = isSliceView;
          gl.outputColorSpace = THREE.SRGBColorSpace;
          gl.toneMapping = THREE.ACESFilmicToneMapping;
          gl.toneMappingExposure = isSliceView ? 0.8 : 0.7;
        }}
      >
        <color
          attach="background"
          args={[isSliceView ? "#050505" : "#000000"]}
        />
        <hemisphereLight
          args={isSliceView ? [0xffffff, 0x202020, 0.8] : [0xffffff, 0x202020, 0.55]}
        />
        <directionalLight
          intensity={isSliceView ? 1.2 : 1.05}
          position={isSliceView ? [2, 3, 4] : [3, 4, 5]}
        />
        {!isSliceView && (
          <>
            <directionalLight
              color={0x9cc8ff}
              intensity={0.3}
              position={[-4, 2, -3]}
            />
            <CameraControls />
          </>
        )}
        <Suspense fallback={null}>
          <AnatomyModel
            selectedLayers={selectedLayers}
            selectedPart={selectedPart}
            slicePlane={slicePlane}
            onSelectPart={onSelectPart}
            onReady={onReady}
            viewMode={viewMode}
          />
        </Suspense>
      </Canvas>
    </ModelErrorBoundary>
  );
}
