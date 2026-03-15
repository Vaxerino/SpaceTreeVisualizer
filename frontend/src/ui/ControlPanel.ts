import { AppState } from '../store/AppState';
import type { ColorMode, ColormapName } from '../types';
import { COLORMAP_NAMES, COLORMAP_LABELS } from '../scene/ColormapRegistry';

/**
 * Left panel: color mode selector, colormap selector, level range filter,
 * local/remote toggles, tree list. All changes update AppState and call
 * the provided refresh callback.
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
    const colormapOptions = COLORMAP_NAMES
      .map(n => `<option value="${n}">${COLORMAP_LABELS[n]}</option>`)
      .join('');

    this.el.innerHTML = `
      <div class="panel-section">
        <label class="label">COLOR MODE</label>
        <select id="colorMode">
          <option value="level">Level (depth)</option>
          <option value="local">Local / Remote</option>
          <option value="enclave">Enclave</option>
          <option value="refinement">Will Refine</option>
          <option value="sim">Sim Field</option>
          <option value="treeId">SpaceTree ID</option>
        </select>

        <div id="colormapRow" style="margin-top:4px">
          <label class="label">COLORMAP</label>
          <select id="colormap">${colormapOptions}</select>
        </div>

        <div id="simFieldRow" class="range-row" style="display:none;margin-top:4px">
          <span class="mono">field</span>
          <input type="number" id="simFieldIndex" min="0" max="99" value="0" class="num-input">
        </div>
      </div>

      <div class="panel-section">
        <label class="label">LEVEL FILTER</label>
        <div class="level-slider-row">
          <input type="range" id="levelSlider" min="0" max="12" value="${AppState.filter.level}" style="flex:1">
          <span id="levelValue" class="mono" style="min-width:2ch;text-align:right">${AppState.filter.level}</span>
        </div>
        <label class="checkbox-row" style="margin-top:4px">
          <input type="checkbox" id="levelCumulative" ${AppState.filter.levelCumulative ? 'checked' : ''}> cumulative (0–N)
        </label>
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

    const colormapRow = this.el.querySelector('#colormapRow') as HTMLElement;
    const simFieldRow = this.el.querySelector('#simFieldRow') as HTMLElement;
    const simFieldInput = this.el.querySelector('#simFieldIndex') as HTMLInputElement;

    // Sync select and visibility to current AppState on initial render
    const colorModeEl = this.el.querySelector('#colorMode') as HTMLSelectElement;
    colorModeEl.value = AppState.colorMode;
    (this.el.querySelector('#colormap') as HTMLSelectElement).value = AppState.colormap;
    colormapRow.style.display = AppState.colorMode === 'treeId' ? 'none' : '';
    simFieldRow.style.display = AppState.colorMode === 'sim' ? '' : 'none';

    // Color mode
    this.el.querySelector('#colorMode')!.addEventListener('change', e => {
      const mode = (e.target as HTMLSelectElement).value as ColorMode;
      AppState.setState({ colorMode: mode });
      colormapRow.style.display = mode === 'treeId' ? 'none' : '';
      simFieldRow.style.display = mode === 'sim' ? '' : 'none';
      this.onFilterChange();
    });

    // Colormap
    this.el.querySelector('#colormap')!.addEventListener('change', e => {
      const name = (e.target as HTMLSelectElement).value as ColormapName;
      AppState.setState({ colormap: name });
      this.onFilterChange();
    });

    // Sim field index
    simFieldInput.addEventListener('change', () => {
      AppState.setState({ simFieldIndex: parseInt(simFieldInput.value, 10) });
      this.onFilterChange();
    });

    // Level slider
    const levelSlider = this.el.querySelector('#levelSlider') as HTMLInputElement;
    const levelValue = this.el.querySelector('#levelValue') as HTMLSpanElement;
    const applyLevel = () => {
      const level = parseInt(levelSlider.value, 10);
      levelValue.textContent = String(level);
      AppState.setState({ filter: { ...AppState.filter, level } });
      this.onFilterChange();
    };
    levelSlider.addEventListener('input', applyLevel);

    // Cumulative toggle
    const levelCumulative = this.el.querySelector('#levelCumulative') as HTMLInputElement;
    levelCumulative.addEventListener('change', () => {
      AppState.setState({ filter: { ...AppState.filter, levelCumulative: levelCumulative.checked } });
      this.onFilterChange();
    });

    // Visibility
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
