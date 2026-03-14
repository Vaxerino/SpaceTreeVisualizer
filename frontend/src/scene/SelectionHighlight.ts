import * as THREE from 'three';

/**
 * Renders a white wireframe box around the currently selected cell.
 * Reuses a single LineSegments object — just updates its matrix.
 */
export class SelectionHighlight {
  private readonly lines: THREE.LineSegments;
  private readonly matrix = new THREE.Matrix4();

  constructor(scene: THREE.Scene) {
    const geo = new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1));
    const mat = new THREE.LineBasicMaterial({ color: 0xffffff, depthTest: false });
    this.lines = new THREE.LineSegments(geo, mat);
    this.lines.visible = false;
    this.lines.renderOrder = 1;
    scene.add(this.lines);
  }

  /** Move the highlight to match the matrix of a given InstancedMesh instance. */
  showAtInstance(mesh: THREE.InstancedMesh, instanceId: number): void {
    mesh.getMatrixAt(instanceId, this.matrix);
    this.lines.matrix.copy(this.matrix);
    this.lines.matrixAutoUpdate = false;
    this.lines.visible = true;
  }

  hide(): void {
    this.lines.visible = false;
  }
}
