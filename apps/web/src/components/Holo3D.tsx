import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import type { DashboardSpec, WidgetData } from '@ada/contracts';
import { formatMetricValue } from '@ada/domain/format';
import { pointLabelSafe } from './labels.ts';

/**
 * Modo de apresentação HOLO (opcional, carregado sob demanda). Sem câmera e sem gestos:
 * mouse/teclado giram a cena. Reaproveita os mesmos dados autorizados do dashboard.
 */
export default function Holo3D({ spec, data, onClose }: { spec: DashboardSpec; data: WidgetData[]; onClose: () => void }) {
  const host = useRef<HTMLDivElement>(null);
  const w = spec.widgets.find((x) => data.find((d) => d.widgetId === x.id && d.status === 'ok' && d.points.length));
  const d = w ? data.find((x) => x.widgetId === w.id)! : null;

  useEffect(() => {
    const el = host.current;
    if (!el || !w || !d) return;
    const main = d.series.find((s) => !s.isComparison)!;
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(45, el.clientWidth / el.clientHeight, 0.1, 100);
    camera.position.set(0, 4, 12);
    camera.lookAt(0, 1.5, 0);
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(el.clientWidth, el.clientHeight);
    el.appendChild(renderer.domElement);
    scene.add(new THREE.AmbientLight(0xffffff, 0.7));
    const light = new THREE.DirectionalLight(0xffffff, 1.2);
    light.position.set(4, 8, 6);
    scene.add(light);
    const group = new THREE.Group();
    scene.add(group);
    const pts = d.points.slice(0, 24);
    const max = Math.max(1, ...pts.map((p) => p.values[main.key] ?? 0));
    const color = getComputedStyle(document.documentElement).getPropertyValue('--series-1').trim() || '#3987e5';
    pts.forEach((p, i) => {
      const h = Math.max(0.05, ((p.values[main.key] ?? 0) / max) * 5);
      const bar = new THREE.Mesh(new THREE.BoxGeometry(0.6, h, 0.6), new THREE.MeshStandardMaterial({ color, roughness: 0.35, metalness: 0.2, transparent: true, opacity: 0.92 }));
      bar.position.set((i - (pts.length - 1) / 2) * 0.9, h / 2, 0);
      group.add(bar);
    });
    const grid = new THREE.GridHelper(Math.max(10, pts.length), Math.max(10, pts.length), 0x555555, 0x2c2c2a);
    scene.add(grid);
    let rot = 0;
    let dragging = false;
    let lastX = 0;
    const down = (e: PointerEvent) => ((dragging = true), (lastX = e.clientX));
    const move = (e: PointerEvent) => {
      if (!dragging) return;
      rot += (e.clientX - lastX) * 0.01;
      lastX = e.clientX;
    };
    const up = () => (dragging = false);
    const key = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft') rot -= 0.15;
      if (e.key === 'ArrowRight') rot += 0.15;
      if (e.key === 'Escape') onClose();
    };
    renderer.domElement.addEventListener('pointerdown', down);
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('keydown', key);
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let raf = 0;
    const frame = (t: number) => {
      group.rotation.y = rot + (reduce ? 0 : Math.sin(t * 0.0003) * 0.15);
      renderer.render(scene, camera);
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    const ro = new ResizeObserver(() => {
      camera.aspect = el.clientWidth / el.clientHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(el.clientWidth, el.clientHeight);
    });
    ro.observe(el);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('keydown', key);
      renderer.dispose();
      el.removeChild(renderer.domElement);
    };
  }, [w, d, onClose]);

  if (!w || !d) return <div className="note-box">Nada para apresentar em 3D: nenhum widget com dados disponíveis.</div>;
  const main = d.series.find((s) => !s.isComparison)!;
  return (
    <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
      <div className="row" style={{ padding: 12 }}>
        <strong className="grow">Modo HOLO — {w.title}</strong>
        <span className="muted small">Arraste ou use ← → · Esc fecha</span>
        <button className="btn sm" onClick={onClose}>Fechar 3D</button>
      </div>
      <div ref={host} style={{ height: 420 }} tabIndex={0} aria-label={`Visualização 3D de ${w.title}. Dados também disponíveis na tabela abaixo.`} />
      <table className="data" style={{ margin: 12, width: 'calc(100% - 24px)' }}>
        <tbody>
          {d.points.slice(0, 24).map((p) => (
            <tr key={p.label}>
              <td>{pointLabelSafe(p.label, w)}</td>
              <td className="num">{formatMetricValue(p.values[main.key] ?? null, main.unit)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
