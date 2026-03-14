import type { CellRecord } from '../types';
import {
  CELL_FLAG_HAS_BEEN_REFINED, CELL_FLAG_WILL_BE_REFINED,
  CELL_FLAG_IS_LOCAL, CELL_FLAG_IS_PARENT_LOCAL,
  CELL_FLAG_WILL_BE_ENCLAVE, CELL_FLAG_HAS_BEEN_ENCLAVE,
  CELL_FLAG_INSIDE_DOMAIN,
} from '../types';

/**
 * Right panel: shows decoded fields of the selected CellRecord.
 * Monospace, dark card style — no decoration.
 */
export class DetailPanel {
  private readonly el: HTMLElement;

  constructor(container: HTMLElement) {
    this.el = document.createElement('div');
    this.el.className = 'detail-panel';
    container.appendChild(this.el);
    this.showEmpty();
  }

  showEmpty(): void {
    this.el.innerHTML = `<div class="panel-section"><span class="label">SELECTED CELL</span><div class="mono small muted">click a cell</div></div>`;
  }

  showCell(cell: CellRecord): void {
    const flag = (f: number) => (cell.flags & f) ? '✓' : '✗';
    const fmt = (v: number) => v.toFixed(6);

    const simRows = cell.simData
      ? cell.simData.slice(0, 8).map((v, i) =>
          `<tr><td class="mono small">field[${i}]</td><td class="mono small right">${v.toExponential(4)}</td></tr>`
        ).join('')
      : '';

    this.el.innerHTML = `
      <div class="panel-section">
        <span class="label">SELECTED CELL</span>

        <table class="detail-table">
          <tbody>
            <tr class="section-header"><td colspan="2" class="label small">CENTRE (float32×3)</td></tr>
            <tr><td class="mono small">x</td><td class="mono small right">${fmt(cell.cx)}</td></tr>
            <tr><td class="mono small">y</td><td class="mono small right">${fmt(cell.cy)}</td></tr>
            <tr><td class="mono small">z</td><td class="mono small right">${fmt(cell.cz)}</td></tr>

            <tr class="section-header"><td colspan="2" class="label small">SIZE H (float32×3)</td></tr>
            <tr><td class="mono small">hx</td><td class="mono small right">${fmt(cell.hx)}</td></tr>
            <tr><td class="mono small">hy</td><td class="mono small right">${fmt(cell.hy)}</td></tr>
            <tr><td class="mono small">hz</td><td class="mono small right">${fmt(cell.hz)}</td></tr>

            <tr class="section-header"><td colspan="2" class="label small">LEVEL (int16)</td></tr>
            <tr><td class="mono small">level</td><td class="mono small right">${cell.level}</td></tr>

            <tr class="section-header"><td colspan="2" class="label small">FLAGS (uint16)  <span class="muted">0x${cell.flags.toString(16).toUpperCase().padStart(4,'0')}</span></td></tr>
            <tr><td class="mono small">isLocal</td><td class="mono small right">${flag(CELL_FLAG_IS_LOCAL)}</td></tr>
            <tr><td class="mono small">isParentLocal</td><td class="mono small right">${flag(CELL_FLAG_IS_PARENT_LOCAL)}</td></tr>
            <tr><td class="mono small">hasBeenRefined</td><td class="mono small right">${flag(CELL_FLAG_HAS_BEEN_REFINED)}</td></tr>
            <tr><td class="mono small">willBeRefined</td><td class="mono small right">${flag(CELL_FLAG_WILL_BE_REFINED)}</td></tr>
            <tr><td class="mono small">insideDomain</td><td class="mono small right">${flag(CELL_FLAG_INSIDE_DOMAIN)}</td></tr>
            <tr><td class="mono small">willBeEnclave</td><td class="mono small right">${flag(CELL_FLAG_WILL_BE_ENCLAVE)}</td></tr>
            <tr><td class="mono small">hasBeenEnclave</td><td class="mono small right">${flag(CELL_FLAG_HAS_BEEN_ENCLAVE)}</td></tr>

            <tr class="section-header"><td colspan="2" class="label small">REL POS (int8×3)</td></tr>
            <tr><td class="mono small">x</td><td class="mono small right">${cell.relPosX}</td></tr>
            <tr><td class="mono small">y</td><td class="mono small right">${cell.relPosY}</td></tr>
            <tr><td class="mono small">z</td><td class="mono small right">${cell.relPosZ}</td></tr>

            <tr class="section-header"><td colspan="2" class="label small">SOURCE</td></tr>
            <tr><td class="mono small">rank</td><td class="mono small right">${cell.rank}</td></tr>
            <tr><td class="mono small">treeId</td><td class="mono small right">${cell.treeId}</td></tr>

            ${simRows ? `<tr class="section-header"><td colspan="2" class="label small">SIM DATA</td></tr>${simRows}` : ''}
          </tbody>
        </table>
      </div>
    `;
  }
}
