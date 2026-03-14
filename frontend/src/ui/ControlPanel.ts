import { AppState } from '../store/AppState';
import type { ColorMode, FilterSpec } from '../types';

/**
 * Left panel: color mode selector, level range filter, local/remote toggles,
 * tree list. All changes update AppState and call the provided refresh callback.
 */
export class ControlPanel {
  private readonly el: HTMLElement;

  constructor(container: HTMLElement, private readonly onFilterChange: () => void) {
    this.el = document.createElement('div');
    this.el.className = 'control-panel';
    container.appendChild(this.el);
    this.render();
  }

  private render(): void {
    this.el.innerHTML = `
      <div class="panel-section">
        <label class="label">COLOR MODE</label>
        <select id="colorMode">
          <option value="level">Level (depth)</option>
          <option value="local">Local / Remote</option>
          <option value="enclave">Enclave</option>
          <option value="refinement">Will Refine</option>
          <option value="sim">Sim Field</option>
        </select>
        <div id="simFieldRow" class="range-row" style="display:none;margin-top:4px">
          <span class="mono">field</span>
          <input type="number" id="simFieldIndex" min="0" max="99" value="0" class="num-input">
        </div>
      </div>

      <div class="panel-section">
        <label class="label">LEVEL FILTER</label>
        <div class="range-row">
          <span class="mono">min</span>
          <input type="number" id="levelMin" min="0" max="12" value="0" class="num-input">
          <span class="mono">max</span>
          <input type="number" id="levelMax" min="0" max="12" value="12" class="num-input">
        </div>
      </div>

      <div class="panel-section">
        <label class="label">VISIBILITY</label>
        <label class="checkbox-row">
          <input type="checkbox" id="showLocal" checked> local cells
        </label>
        <label class="checkbox-row">
          <input type="checkbox" id="showRemote" checked> remote cells
        </label>
      </div>

      <div class="panel-section" id="treeListSection">
        <label class="label">TREES</label>
        <div id="treeList" class="mono small">—</div>
      </div>
    `;

    const simFieldRow = this.el.querySelector('#simFieldRow') as HTMLElement;
    const simFieldInput = this.el.querySelector('#simFieldIndex') as HTMLInputElement;

    this.el.querySelector('#colorMode')!.addEventListener('change', e => {
      const mode = (e.target as HTMLSelectElement).value as ColorMode;
      AppState.setState({ colorMode: mode });
      simFieldRow.style.display = mode === 'sim' ? '' : 'none';
      this.onFilterChange();
    });

    simFieldInput.addEventListener('change', () => {
      AppState.setState({ simFieldIndex: parseInt(simFieldInput.value, 10) });
      this.onFilterChange();
    });

    const levelMin = this.el.querySelector('#levelMin') as HTMLInputElement;
    const levelMax = this.el.querySelector('#levelMax') as HTMLInputElement;
    const applyLevels = () => {
      const f: FilterSpec = {
        ...AppState.filter,
        minLevel: parseInt(levelMin.value, 10),
        maxLevel: parseInt(levelMax.value, 10),
      };
      AppState.setState({ filter: f });
      this.onFilterChange();
    };
    levelMin.addEventListener('change', applyLevels);
    levelMax.addEventListener('change', applyLevels);

    this.el.querySelector('#showLocal')!.addEventListener('change', e => {
      AppState.setState({ filter: { ...AppState.filter, showLocal: (e.target as HTMLInputElement).checked } });
      this.onFilterChange();
    });
    this.el.querySelector('#showRemote')!.addEventListener('change', e => {
      AppState.setState({ filter: { ...AppState.filter, showRemote: (e.target as HTMLInputElement).checked } });
      this.onFilterChange();
    });
  }

  updateTreeList(trees: string[]): void {
    const el = this.el.querySelector('#treeList');
    if (el) el.textContent = trees.length > 0 ? trees.join('\n') : '—';
  }
}
