import { useEffect, useRef, useState } from "react";
import { Box, Crosshair, RotateCcw, X } from "lucide-react";
import * as THREE from "three";
import type { MissionState, SpatialAsset } from "../../shared/types";
import type { SpatialPreview } from "../api";

interface SpatialViewerLayers {
  asset: boolean;
  drones: boolean;
  detections: boolean;
  zones: boolean;
  noFly: boolean;
}

export function SpatialViewer({
  state,
  asset,
  preview,
  mode,
  replaySeq,
  onResetCamera,
  onClose
}: {
  state: MissionState;
  asset: SpatialAsset;
  preview: SpatialPreview;
  mode: "live" | "replay";
  replaySeq: number;
  onResetCamera: () => void;
  onClose: () => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [layers, setLayers] = useState<SpatialViewerLayers>({
    asset: true,
    drones: true,
    detections: true,
    zones: true,
    noFly: true
  });

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: true });
    renderer.setClearColor(0x0d1117, 1);
    const scene = new THREE.Scene();
    scene.fog = new THREE.Fog(0x0d1117, 38, 98);

    const camera = new THREE.PerspectiveCamera(52, 1, 0.1, 220);
    camera.position.set(0, 34, 42);
    camera.lookAt(0, 0, 0);

    const ambient = new THREE.AmbientLight(0xffffff, 0.75);
    const directional = new THREE.DirectionalLight(0xffffff, 1.2);
    directional.position.set(18, 36, 22);
    scene.add(ambient, directional);

    const root = new THREE.Group();
    scene.add(root);
    addGround(root, state);
    if (layers.zones) addZones(root, state);
    if (layers.noFly) addNoFly(root, state);
    if (layers.asset) addAsset(root, preview, state);
    if (layers.detections) addDetections(root, state);
    if (layers.drones) addDrones(root, state);

    const resize = () => {
      const bounds = canvas.getBoundingClientRect();
      const width = Math.max(320, Math.floor(bounds.width));
      const height = Math.max(260, Math.floor(bounds.height));
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);

    let frame = 0;
    let raf = 0;
    const render = () => {
      frame += 1;
      root.rotation.y = Math.sin(frame / 380) * 0.07;
      renderer.render(scene, camera);
      raf = requestAnimationFrame(render);
    };
    render();

    return () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
      renderer.dispose();
      scene.traverse((object) => {
        const mesh = object as THREE.Mesh;
        mesh.geometry?.dispose?.();
        const material = mesh.material as THREE.Material | THREE.Material[] | undefined;
        if (Array.isArray(material)) material.forEach((item) => item.dispose());
        else material?.dispose?.();
      });
    };
  }, [asset.assetId, preview, state, layers]);

  const progress = preview.timeRange
    ? Math.min(100, Math.max(0, ((state.updatedAt - preview.timeRange.startMs) / (preview.timeRange.endMs - preview.timeRange.startMs)) * 100))
    : undefined;

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Spatial viewer">
      <section className="spatial-viewer-modal">
        <div className="panel-title compact spatial-viewer-title">
          <div className="spatial-viewer-heading">
            {asset.kind === "vps-pose" ? <Crosshair size={17} /> : <Box size={17} />}
            <div>
              <h2>Spatial Viewer</h2>
              <span>{asset.kind} / {mode === "replay" ? `replay #${replaySeq}` : "live"}</span>
            </div>
          </div>
          <div className="viewer-actions">
            <button onClick={onResetCamera} title="Reset camera">
              <RotateCcw size={15} />
            </button>
            <button onClick={onClose} title="Close spatial viewer">
              <X size={15} />
            </button>
          </div>
        </div>

        <div className="spatial-viewer-body">
          <canvas ref={canvasRef} className="spatial-canvas" data-asset={asset.assetId} />
          <aside className="spatial-viewer-rail">
            <strong>{formatKind(asset.kind)}</strong>
            <span>{asset.assetId}</span>
            <div className="spatial-viewer-stats">
              <span>points {preview.points.length}</span>
              <span>conf {Math.round(asset.confidence * 100)}%</span>
              <span>xfm {Math.round(asset.transformConfidence * 100)}%</span>
              <span>{preview.generated ? "generated preview" : "asset preview"}</span>
            </div>
            {typeof progress === "number" && (
              <div className="viewer-timeline">
                <span>timeline</span>
                <div><i style={{ width: `${progress}%` }} /></div>
              </div>
            )}
            <div className="viewer-layer-list">
              {Object.entries(layerLabels).map(([key, label]) => (
                <button
                  key={key}
                  data-active={layers[key as keyof SpatialViewerLayers]}
                  onClick={() => setLayers((current) => ({ ...current, [key]: !current[key as keyof SpatialViewerLayers] }))}
                  title={`${layers[key as keyof SpatialViewerLayers] ? "Hide" : "Show"} ${label}`}
                >
                  {label}
                </button>
              ))}
            </div>
          </aside>
        </div>
      </section>
    </div>
  );
}

function addGround(root: THREE.Group, state: MissionState) {
  const grid = new THREE.GridHelper(Math.max(state.map.width, state.map.height), 24, 0x314052, 0x1f2a35);
  grid.position.y = -0.02;
  root.add(grid);
}

function addAsset(root: THREE.Group, preview: SpatialPreview, state: MissionState) {
  const geometry = new THREE.BufferGeometry();
  const positions: number[] = [];
  const colors: number[] = [];
  preview.points.forEach((point) => {
    const mapped = mapPoint(point, state);
    positions.push(mapped.x, mapped.y, mapped.z);
    const color = new THREE.Color(point.color);
    colors.push(color.r * point.intensity, color.g * point.intensity, color.b * point.intensity);
  });
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  const material = new THREE.PointsMaterial({ size: preview.mode === "pose" ? 0.9 : 0.32, vertexColors: true, transparent: true, opacity: 0.92 });
  root.add(new THREE.Points(geometry, material));

  if (preview.bounds) addRectOutline(root, preview.bounds, state, 0x50d7b8, 1.2);
}

function addDrones(root: THREE.Group, state: MissionState) {
  state.drones.forEach((drone) => {
    const mapped = mapPoint(drone.position, state);
    const color = drone.status === "failed" || drone.status === "offline" ? 0xe65c5c : drone.status === "returning" ? 0xe2ad4d : 0x82cfff;
    const marker = new THREE.Mesh(new THREE.SphereGeometry(0.58, 16, 12), new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.16 }));
    marker.position.set(mapped.x, mapped.y + 0.7, mapped.z);
    root.add(marker);
  });
}

function addDetections(root: THREE.Group, state: MissionState) {
  state.detections.forEach((detection) => {
    const mapped = mapPoint(detection.position, state);
    const color = detection.severity === "P1" ? 0xe65c5c : 0xe2ad4d;
    const marker = new THREE.Mesh(new THREE.OctahedronGeometry(0.58), new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.22 }));
    marker.position.set(mapped.x, mapped.y + 0.9, mapped.z);
    root.add(marker);
  });
}

function addZones(root: THREE.Group, state: MissionState) {
  state.zones.forEach((zone) => addRectOutline(root, zone.bounds, state, zone.priority === "P1" ? 0xe65c5c : 0x82cfff, 0.8));
}

function addNoFly(root: THREE.Group, state: MissionState) {
  state.noFlyZones.forEach((zone) => addRectOutline(root, zone, state, 0xe65c5c, 1.5));
}

function addRectOutline(root: THREE.Group, rect: { x: number; y: number; width: number; height: number }, state: MissionState, color: number, y = 0.5) {
  const corners = [
    mapPoint({ x: rect.x, y: rect.y, z: y }, state),
    mapPoint({ x: rect.x + rect.width, y: rect.y, z: y }, state),
    mapPoint({ x: rect.x + rect.width, y: rect.y + rect.height, z: y }, state),
    mapPoint({ x: rect.x, y: rect.y + rect.height, z: y }, state)
  ];
  const points = [corners[0], corners[1], corners[1], corners[2], corners[2], corners[3], corners[3], corners[0]];
  const geometry = new THREE.BufferGeometry().setFromPoints(points.map((point) => new THREE.Vector3(point.x, point.y, point.z)));
  root.add(new THREE.LineSegments(geometry, new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.76 })));
}

function mapPoint(point: { x: number; y: number; z: number }, state: MissionState) {
  return {
    x: point.x - state.map.width / 2,
    y: point.z,
    z: point.y - state.map.height / 2
  };
}

function formatKind(kind: SpatialAsset["kind"]) {
  return kind
    .split("-")
    .map((part) => part.toUpperCase() === "VPS" ? "VPS" : part[0].toUpperCase() + part.slice(1))
    .join(" ");
}

const layerLabels: Record<keyof SpatialViewerLayers, string> = {
  asset: "Asset",
  drones: "Drones",
  detections: "Detections",
  zones: "Zones",
  noFly: "No-fly"
};
