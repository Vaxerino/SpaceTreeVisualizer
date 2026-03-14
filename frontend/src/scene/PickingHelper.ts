import * as THREE from 'three';
import type { CellRenderer } from './CellRenderer';
import type { SelectionHighlight } from './SelectionHighlight';

type OnPickCallback = (instanceId: number) => void;

/**
 * Handles mouse click → instance picking via THREE.Raycaster.
 * Notifies listeners with the picked instance index.
 */
export class PickingHelper {
  private raycaster = new THREE.Raycaster();
  private mouse = new THREE.Vector2();
  private callbacks: OnPickCallback[] = [];

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly camera: THREE.Camera,
    private readonly cellRenderer: CellRenderer,
    private readonly highlight: SelectionHighlight,
  ) {
    canvas.addEventListener('click', e => this.onClick(e));
  }

  onPick(cb: OnPickCallback): void {
    this.callbacks.push(cb);
  }

  private onClick(event: MouseEvent): void {
    const rect = this.canvas.getBoundingClientRect();
    this.mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

    this.raycaster.setFromCamera(this.mouse, this.camera);
    const hits = this.raycaster.intersectObject(this.cellRenderer.mesh);

    if (hits.length > 0 && hits[0]!.instanceId !== undefined) {
      const id = hits[0]!.instanceId;
      this.highlight.showAtInstance(this.cellRenderer.mesh, id);
      for (const cb of this.callbacks) cb(id);
    } else {
      this.highlight.hide();
      for (const cb of this.callbacks) cb(-1);
    }
  }
}
