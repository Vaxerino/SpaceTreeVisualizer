import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

/**
 * Owns the Three.js renderer, scene, camera, and animation loop.
 * Other scene components (CellRenderer, SelectionHighlight) add objects to
 * the scene directly.
 */
export class SceneManager {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;
  readonly controls: OrbitControls;

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(window.devicePixelRatio);
    this.renderer.setClearColor(0x141414);

    this.scene = new THREE.Scene();

    const aspect = canvas.clientWidth / canvas.clientHeight;
    this.camera = new THREE.PerspectiveCamera(60, aspect, 0.0001, 1000);
    this.camera.position.set(1.5, 1.5, 2.5);
    this.camera.lookAt(0.5, 0.5, 0.5);

    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.target.set(0.5, 0.5, 0.5);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.1;

    // Ambient + directional lights for Lambertian shading
    this.scene.add(new THREE.AmbientLight(0xffffff, 0.6));
    const dir = new THREE.DirectionalLight(0xffffff, 0.8);
    dir.position.set(2, 3, 2);
    this.scene.add(dir);

    // Domain origin marker (tiny white axes)
    this.scene.add(new THREE.AxesHelper(0.05));

    window.addEventListener('resize', () => this.onResize(canvas));
    this.onResize(canvas);

    this.animate();
  }

  private onResize(canvas: HTMLCanvasElement): void {
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  private animate(): void {
    requestAnimationFrame(() => this.animate());
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }
}
