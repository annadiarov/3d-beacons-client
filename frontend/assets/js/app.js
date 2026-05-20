const API_BASE_URL = 'https://bindome.epfl.ch';
const state = { results: {}, selected: new Set(), sort: {}, filters: {}, visibleMetricColumns: new Set() };
let molstarViewer = null;
const CHAIN_COLORS = { chainA: '#b8b8b8', chainB: '#4169e1', other: '#d0d0d0' };


const METRIC_COLUMNS = [
  { key: 'coverage', label: 'Coverage', type: 'number', defaultVisible: false },
  { key: 'average_pLDDT', label: 'avg_pLDDT', type: 'number', defaultVisible: true },
  { key: 'average_pTM', label: 'avg_pTM', type: 'number', defaultVisible: false },
  { key: 'average_i_pTM', label: 'avg_ipTM', type: 'number', defaultVisible: true },
  { key: 'average_pAE', label: 'avg_pAE', type: 'number', defaultVisible: false },
  { key: 'average_i_pAE', label: 'avg_iPAE', type: 'number', defaultVisible: true },
  { key: 'average_ipSAE', label: 'avg_ipSAE', type: 'number', defaultVisible: true },
  { key: 'average_i_pLDDT', label: 'avg_i_pLDDT', type: 'number', defaultVisible: false },
];

const DEFAULT_VISIBLE_METRIC_KEYS = METRIC_COLUMNS
  .filter((column) => column.defaultVisible)
  .map((column) => column.key);

state.visibleMetricColumns = new Set(DEFAULT_VISIBLE_METRIC_KEYS);

const CHAIN_SELECTOR_CANDIDATES = [
  ['Axp', 'Bxp'],
  ['A', 'B'],
];

const ROUTES = ['home', 'search', 'stats', 'faqs', 'downloads'];

function setActiveRoute(route) {
  const activeRoute = ROUTES.includes(route) ? route : 'home';
  document.querySelectorAll('.page-section').forEach((section) => section.classList.remove('active'));
  document.getElementById('page-' + activeRoute).classList.add('active');
  document.querySelectorAll('[data-route]').forEach((link) => link.classList.toggle('active', link.getAttribute('data-route') === activeRoute));
}

function handleRouteChange() {
  const route = window.location.hash.replace('#', '') || 'home';
  setActiveRoute(route);
}


async function initViewer() {
  molstarViewer = await molstar.Viewer.create('molstar-viewer', {
    layoutIsExpanded: false,
    layoutShowControls: true,
    layoutShowRemoteState: false,
    layoutShowSequence: true,
    layoutShowLog: false,
    layoutShowLeftPanel: false,
    viewportShowExpand: true,
    viewportShowSelectionMode: true,
    viewportShowAnimation: false,
    pdbProvider: 'rcsb',
    emdbProvider: 'rcsb',
  });

  applyIllustrativeViewerStyle();
}

function applyIllustrativeViewerStyle() {
  if (!molstarViewer || !molstarViewer.plugin || !molstarViewer.plugin.canvas3d) {
    return;
  }

  // Mol*'s GUI style named “Illustrative” is a renderer/postprocessing
  // configuration. These settings approximate that look programmatically:
  // strong ambient light, reduced direct light, outline, and ambient occlusion.
  try {
    molstarViewer.plugin.canvas3d.setProps({
      renderer: {
        ambientIntensity: 1.0,
        lightIntensity: 0.25,
      },
      postprocessing: {
        outline: {
          name: 'on',
          params: {
            scale: 1,
            threshold: 0.33,
            color: 0x000000,
            includeTransparent: true,
          },
        },
        occlusion: {
          name: 'on',
          params: {
            samples: 32,
            radius: 5,
            bias: 0.8,
            blurKernelSize: 15,
            resolutionScale: 1,
          },
        },
      },
    });
  } catch (error) {
    // Rendering options vary a bit between Mol* versions. If a setting is
    // unsupported, the viewer still works with the explicit cartoon style.
  }
}

function parseIdsFromText(text) {
  return [...new Set(String(text).split(/[\s,;]+/).map((id) => id.trim().toUpperCase()).filter(Boolean))];
}

function parseUniProtInput() {
  return parseIdsFromText(document.getElementById('uniprot-input').value);
}


async function fetchUniprotMetrics(id) {
  try {
    const response = await fetch(
      API_BASE_URL + '/uniprot/' + encodeURIComponent(id) + '/metrics'
    );

    if (!response.ok) {
      state.results[id] = {
        error: 'HTTP ' + response.status + ' – no models found',
      };
      return;
    }

    const data = await response.json();
    const isEmptyObject =
      data &&
      typeof data === 'object' &&
      !Array.isArray(data) &&
      Object.keys(data).length === 0;

    if (!data || isEmptyObject || !Array.isArray(data.metrics)) {
      state.results[id] = {
        error: 'No model metrics found',
      };
      return;
    }

    state.results[id] = data;
  } catch (error) {
    if (error instanceof SyntaxError) {
      state.results[id] = {
        error: 'Response could not be parsed. Check server or proxy configuration.',
      };
    } else {
      state.results[id] = {
        error: 'Request failed: ' + error.message,
      };
    }
  }
}


function formatMetricValue(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number.toFixed(2) : '–';
}

function formatRange(start, end) {
  const startValue = start ?? '–';
  const endValue = end ?? '–';
  return startValue + '–' + endValue;
}

function escapeHtml(value) { return String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;'); }
function modelAttrValue(modelId) { return encodeURIComponent(String(modelId)); }


function getAllModels() {
  const models = [];

  Object.entries(state.results).forEach(([uniprotId, result]) => {
    if (!result || result.error || !Array.isArray(result.metrics)) {
      return;
    }

    result.metrics.forEach((metric) => {
      if (metric && metric.model_identifier && metric.model_url) {
        models.push({
          uniprotId,
          modelId: metric.model_identifier,
          modelUrl: metric.model_url,
          modelFormat: metric.model_format || metric.format || 'MMCIF',
          entities: metric.entities || [],
        });
      }
    });
  });

  return models;
}

function toggleModel(modelId, checked) {
  if (checked) state.selected.add(modelId);
  else state.selected.delete(modelId);
  const attrValue = modelAttrValue(modelId);
  document.querySelectorAll('tr[data-model-id="' + CSS.escape(attrValue) + '"]').forEach((row) => {
    row.classList.toggle('selected', state.selected.has(modelId));
  });
}

function resolveModelUrl(url) {
  if (/^https?:\/\//i.test(url)) return url;
  const path = url.startsWith('/') ? url : '/' + url;
  return API_BASE_URL + path;
}

function modelFormatToMolstarFormat(modelFormat, url) {
  const upper = String(modelFormat || '').toUpperCase();
  if (upper === 'PDB') return 'pdb';
  if (upper === 'BCIF') return 'bcif';
  if (/\.bcif(?:\?|$)/i.test(url)) return 'bcif';
  if (/\.pdb(?:\?|$)/i.test(url)) return 'pdb';
  return 'mmcif';
}


function getPrimaryChainIds(model) {
  const chains = [];

  if (Array.isArray(model.entities)) {
    model.entities.forEach((entity) => {
      if (Array.isArray(entity.chain_ids)) {
        entity.chain_ids.forEach((chainId) => {
          if (typeof chainId === 'string' && chainId.trim()) {
            chains.push(chainId.trim());
          }
        });
      }
    });
  }

  const uniqueChains = [...new Set(chains)];

  return {
    chainA: uniqueChains[0] || 'Axp',
    chainB: uniqueChains[1] || 'Bxp',
  };
}


function addChainColorRules(representation, chainId, color) {
  if (!chainId) {
    return;
  }

  representation.color({
    color,
    selector: { label_asym_id: chainId },
  });

  representation.color({
    color,
    selector: { auth_asym_id: chainId },
  });
}


function addChainColoredStructureToMvs(builder, model) {
  const resolvedUrl = resolveModelUrl(model.modelUrl);
  const format = modelFormatToMolstarFormat(model.modelFormat, resolvedUrl);
  const { chainA, chainB } = getPrimaryChainIds(model);

  const structure = builder
    .download({ url: resolvedUrl })
    .parse({ format })
    .modelStructure({});

  // Use Mol* cartoon/ribbon representation for polymer content. The CIFs
  // now contain DSSP/polymer metadata, so cartoon should be available.
  // The viewer renderer below is configured to be illustrative-like.
  const cartoon = structure
    .component({ selector: 'polymer' })
    .representation({ type: 'cartoon' });

  cartoon.color({ color: CHAIN_COLORS.other });

  // Bindome-generated CIFs commonly use chain IDs like Axp and Bxp.
  // Try those first, then fall back to A/B and any chain IDs reported
  // by the API response.
  const chainPairs = [
    [chainA, chainB],
    ...CHAIN_SELECTOR_CANDIDATES,
  ];

  chainPairs.forEach(([candidateA, candidateB]) => {
    addChainColorRules(cartoon, candidateA, CHAIN_COLORS.chainA);
    addChainColorRules(cartoon, candidateB, CHAIN_COLORS.chainB);
  });
}

async function clearMolstarViewer() {
  if (!molstarViewer) return;
  const builder = molstar.PluginExtensions.mvs.MVSData.createBuilder();
  await molstar.PluginExtensions.mvs.loadMVS(molstarViewer.plugin, builder.getState(), { sourceUrl: undefined, sanityChecks: true, replaceExisting: true });
}

async function loadSelectedModelsInMolstar(selectedModels) {
  const builder = molstar.PluginExtensions.mvs.MVSData.createBuilder();
  selectedModels.forEach((model) => addChainColoredStructureToMvs(builder, model));
  await molstar.PluginExtensions.mvs.loadMVS(molstarViewer.plugin, builder.getState(), { sourceUrl: undefined, sanityChecks: true, replaceExisting: true });
}

function setViewerStatus(message) { document.getElementById('viewer-status').textContent = message; }

async function viewSelectedModels() {
  if (!molstarViewer) {
    setViewerStatus('Viewer is still initializing.');
    return;
  }
  const selectedModels = getAllModels().filter((model) => state.selected.has(model.modelId));
  if (!selectedModels.length) {
    await clearMolstarViewer();
    setViewerStatus('No models selected.');
    return;
  }
  setViewerStatus('Loading ' + selectedModels.length + ' selected model(s)…');
  try {
    await loadSelectedModelsInMolstar(selectedModels);
    setViewerStatus('Loaded ' + selectedModels.length + ' selected model(s).');
  } catch (error) {
    setViewerStatus('Viewer error: ' + error.message);
  }
}


function getSortState(uniprotId) {
  if (!state.sort[uniprotId]) {
    state.sort[uniprotId] = { key: 'model_identifier', direction: 'asc' };
  }
  return state.sort[uniprotId];
}

function getFilterState(uniprotId) {
  if (!state.filters[uniprotId]) {
    state.filters[uniprotId] = {};
  }
  return state.filters[uniprotId];
}

function getVisibleMetricColumns() {
  return METRIC_COLUMNS.filter((column) => state.visibleMetricColumns.has(column.key));
}

function renderColumnVisibilityControls() {
  const container = document.getElementById('column-controls');
  if (!container) {
    return;
  }

  container.innerHTML = METRIC_COLUMNS
    .map((column) => {
      const checked = state.visibleMetricColumns.has(column.key) ? 'checked' : '';
      return `
    <div class="form-check">
      <input
        class="form-check-input metric-column-toggle"
        type="checkbox"
        id="toggle-${escapeHtml(column.key)}"
        data-column-key="${escapeHtml(column.key)}"
        ${checked}
      />
      <label class="form-check-label" for="toggle-${escapeHtml(column.key)}">
        ${escapeHtml(column.label)}
      </label>
    </div>
  `;
    })
    .join('');
}

function getMetricNumber(metric, key) {
  const value = Number(metric[key]);
  return Number.isFinite(value) ? value : null;
}

function passesMetricFilters(metric, filters) {
  return getVisibleMetricColumns().every((column) => {
    const filter = filters[column.key] || {};
    const value = getMetricNumber(metric, column.key);

    if (filter.min !== undefined && filter.min !== '' && (value === null || value < Number(filter.min))) {
      return false;
    }

    if (filter.max !== undefined && filter.max !== '' && (value === null || value > Number(filter.max))) {
      return false;
    }

    return true;
  });
}

function sortMetrics(metrics, sortState) {
  const sorted = [...metrics];

  sorted.sort((a, b) => {
    let aValue;
    let bValue;

    if (sortState.key === 'model_identifier') {
      aValue = String(a.model_identifier || '');
      bValue = String(b.model_identifier || '');
      return sortState.direction === 'asc'
        ? aValue.localeCompare(bValue)
        : bValue.localeCompare(aValue);
    }

    if (sortState.key === 'uniprot_range') {
      aValue = Number(a.uniprot_start);
      bValue = Number(b.uniprot_start);
    } else {
      aValue = Number(a[sortState.key]);
      bValue = Number(b[sortState.key]);
    }

    const aIsFinite = Number.isFinite(aValue);
    const bIsFinite = Number.isFinite(bValue);

    if (!aIsFinite && !bIsFinite) {
      return 0;
    }

    if (!aIsFinite) {
      return 1;
    }

    if (!bIsFinite) {
      return -1;
    }

    return sortState.direction === 'asc' ? aValue - bValue : bValue - aValue;
  });

  return sorted;
}

function getSortIcon(uniprotId, key) {
  const sortState = getSortState(uniprotId);

  if (sortState.key !== key) {
    return '<i class="bi bi-arrow-down-up ms-1" aria-hidden="true"></i>';
  }

  return sortState.direction === 'asc'
    ? '<i class="bi bi-sort-up ms-1" aria-hidden="true"></i>'
    : '<i class="bi bi-sort-down ms-1" aria-hidden="true"></i>';
}

function renderSortableHeader(uniprotId, key, label, extraClass = '') {
  return `
<th scope="col" class="${extraClass}">
  <button
    type="button"
    class="btn btn-link p-0 text-decoration-none text-dark fw-semibold sort-btn"
    data-uniprot-id="${modelAttrValue(uniprotId)}"
    data-sort-key="${escapeHtml(key)}"
  >
    ${escapeHtml(label)}${getSortIcon(uniprotId, key)}
  </button>
</th>
`;
}

function renderFilterInput(uniprotId, column, bound) {
  const filters = getFilterState(uniprotId);
  const currentValue = filters[column.key]?.[bound] ?? '';

  return `
<input
  type="number"
  min="0"
  max="1"
  step="0.01"
  class="form-control form-control-sm metric-filter"
  placeholder="${bound}"
  value="${escapeHtml(currentValue)}"
  data-uniprot-id="${modelAttrValue(uniprotId)}"
  data-filter-key="${escapeHtml(column.key)}"
  data-filter-bound="${escapeHtml(bound)}"
  aria-label="${escapeHtml(column.label)} ${bound} filter"
/>
`;
}

function renderModelTable(uniprotId, metrics) {
  if (!Array.isArray(metrics) || !metrics.length) {
    return '<div class="alert alert-warning mb-0">No models found.</div>';
  }

  const sortState = getSortState(uniprotId);
  const filters = getFilterState(uniprotId);
  const visibleMetricColumns = getVisibleMetricColumns();
  const filteredMetrics = metrics.filter((metric) => passesMetricFilters(metric, filters));
  const sortedMetrics = sortMetrics(filteredMetrics, sortState);

  const rows = sortedMetrics
    .map((metric) => {
      const modelId = metric.model_identifier || '–';
      const modelIdEscaped = escapeHtml(modelId);
      const modelIdAttr = modelAttrValue(modelId);
      const checked = state.selected.has(modelId) ? 'checked' : '';

      const metricCells = visibleMetricColumns
        .map((column) => `<td>${formatMetricValue(metric[column.key])}</td>`)
        .join('');

      return `
    <tr class="model-row ${checked ? 'selected' : ''}" data-model-id="${modelIdAttr}">
      <td class="text-center">
        <input
          type="checkbox"
          class="form-check-input model-checkbox"
          data-model-id="${modelIdAttr}"
          ${checked}
          aria-label="Select model ${modelIdEscaped}"
        />
      </td>
      <td><code class="model-id-code">${modelIdEscaped}</code></td>
      <td class="min-w-nowrap">${formatRange(metric.uniprot_start, metric.uniprot_end)}</td>
      ${metricCells}
    </tr>
  `;
    })
    .join('');

  const metricHeaders = visibleMetricColumns
    .map((column) => renderSortableHeader(uniprotId, column.key, column.label))
    .join('');

  const metricFilters = visibleMetricColumns
    .map((column) => `
  <th scope="col">
    <div class="d-flex gap-1">
      ${renderFilterInput(uniprotId, column, 'min')}
      ${renderFilterInput(uniprotId, column, 'max')}
    </div>
  </th>
`)
    .join('');

  const emptyMessage = sortedMetrics.length
    ? ''
    : '<div class="alert alert-info m-3">No models match the current numeric filters.</div>';

  return `
<div class="table-responsive">
  <table class="table table-sm table-hover align-middle mb-0">
    <thead class="table-light">
      <tr>
        <th scope="col" class="text-center">Sel</th>
        ${renderSortableHeader(uniprotId, 'model_identifier', 'Model ID')}
        ${renderSortableHeader(uniprotId, 'uniprot_range', 'UniProt range', 'min-w-nowrap')}
        ${metricHeaders}
      </tr>
      <tr class="table-filter-row">
        <th></th>
        <th></th>
        <th></th>
        ${metricFilters}
      </tr>
    </thead>
    <tbody>${rows}</tbody>
  </table>
</div>
${emptyMessage}
`;
}


function renderAllResults() {
  renderColumnVisibilityControls();
  const columnControlsCard = document.getElementById('column-controls-card');
  if (columnControlsCard) {
    columnControlsCard.classList.remove('d-none');
  }

  const container = document.getElementById('results-container');
  container.innerHTML = '';

  Object.entries(state.results).forEach(([uniprotId, result], index) => {
    const name = result?.uniprot_entry?.id || result?.uniprot_entry?.ac || 'Unknown';
    const count = Array.isArray(result?.metrics) ? result.metrics.length : 0;
    const isError = !!result?.error;
    const uniprotIdEscaped = escapeHtml(uniprotId);
    const uniprotIdAttr = modelAttrValue(uniprotId);
    const nameEscaped = escapeHtml(name);
    const headingId = 'result-heading-' + index;
    const collapseId = 'result-collapse-' + index;
    const expanded = index === 0 ? 'true' : 'false';
    const show = index === 0 ? 'show' : '';

    const item = document.createElement('article');
    item.className = 'accordion-item mb-2 border rounded-3 overflow-hidden';

    item.innerHTML = `
  <h2 class="accordion-header" id="${headingId}">
    <button class="accordion-button ${index === 0 ? '' : 'collapsed'}" type="button" data-bs-toggle="collapse" data-bs-target="#${collapseId}" aria-expanded="${expanded}" aria-controls="${collapseId}">
      <span class="me-2"><strong><code>${uniprotIdEscaped}</code></strong></span>
      <span class="text-muted me-auto">${isError ? '' : nameEscaped}</span>
      <span class="badge text-bg-secondary ms-2">${count} model(s)</span>
    </button>
  </h2>
  <div id="${collapseId}" class="accordion-collapse collapse ${show}" aria-labelledby="${headingId}">
    <div class="accordion-body p-0">
      <div class="d-flex justify-content-end gap-2 p-2 border-bottom bg-light">
        <button type="button" class="btn btn-outline-primary btn-sm select-all" data-uniprot-id="${uniprotIdAttr}">
          Select all
        </button>
        <button type="button" class="btn btn-outline-secondary btn-sm select-none" data-uniprot-id="${uniprotIdAttr}">
          Select none
        </button>
      </div>
      ${isError
        ? `<div class="alert alert-warning m-3 mb-0">${escapeHtml(result.error)}</div>`
        : renderModelTable(uniprotId, result.metrics)
      }
    </div>
  </div>
`;

    container.appendChild(item);
  });

  container.querySelectorAll('.model-checkbox').forEach((checkbox) => {
    checkbox.addEventListener('change', (event) => {
      const modelId = decodeURIComponent(
        event.target.getAttribute('data-model-id')
      );
      toggleModel(modelId, event.target.checked);
    });
  });

  container.querySelectorAll('.sort-btn').forEach((button) => {
    button.addEventListener('click', () => {
      const uniprotId = decodeURIComponent(button.getAttribute('data-uniprot-id'));
      const sortKey = button.getAttribute('data-sort-key');
      const sortState = getSortState(uniprotId);

      if (sortState.key === sortKey) {
        sortState.direction = sortState.direction === 'asc' ? 'desc' : 'asc';
      } else {
        sortState.key = sortKey;
        sortState.direction = 'asc';
      }

      renderAllResults();
    });
  });

  document.querySelectorAll('.metric-column-toggle').forEach((checkbox) => {
    checkbox.addEventListener('change', () => {
      const columnKey = checkbox.getAttribute('data-column-key');

      if (checkbox.checked) {
        state.visibleMetricColumns.add(columnKey);
      } else {
        state.visibleMetricColumns.delete(columnKey);

        Object.values(state.filters).forEach((filters) => {
          delete filters[columnKey];
        });
      }

      if (!state.visibleMetricColumns.size) {
        state.visibleMetricColumns.add('average_pLDDT');
      }

      Object.values(state.sort).forEach((sortState) => {
        const hiddenMetricKeys = METRIC_COLUMNS
          .map((column) => column.key)
          .filter((key) => !state.visibleMetricColumns.has(key));

        if (hiddenMetricKeys.includes(sortState.key)) {
          sortState.key = 'model_identifier';
          sortState.direction = 'asc';
        }
      });

      renderAllResults();
    });
  });

  container.querySelectorAll('.metric-filter').forEach((input) => {
    input.addEventListener('input', () => {
      if (input.value !== '') {
        const numericValue = Number(input.value);
        if (Number.isFinite(numericValue)) {
          if (numericValue < 0) {
            input.value = '0';
          } else if (numericValue > 1) {
            input.value = '1';
          }
        }
      }

      const uniprotId = decodeURIComponent(input.getAttribute('data-uniprot-id'));
      const filterKey = input.getAttribute('data-filter-key');
      const filterBound = input.getAttribute('data-filter-bound');
      const filters = getFilterState(uniprotId);

      if (!filters[filterKey]) {
        filters[filterKey] = {};
      }

      filters[filterKey][filterBound] = input.value;
      renderAllResults();
    });
  });

  container.querySelectorAll('.select-all').forEach((button) => {
    button.addEventListener('click', () => {
      const result =
        state.results[decodeURIComponent(button.getAttribute('data-uniprot-id'))];

      if (!result || !Array.isArray(result.metrics)) {
        return;
      }

      result.metrics.forEach((metric) => {
        const modelId = metric?.model_identifier;

        if (modelId) {
          state.selected.add(modelId);
        }
      });

      renderAllResults();
    });
  });

  container.querySelectorAll('.select-none').forEach((button) => {
    button.addEventListener('click', () => {
      const result =
        state.results[decodeURIComponent(button.getAttribute('data-uniprot-id'))];

      if (!result || !Array.isArray(result.metrics)) {
        return;
      }

      result.metrics.forEach((metric) => {
        const modelId = metric?.model_identifier;

        if (modelId) {
          state.selected.delete(modelId);
        }
      });

      renderAllResults();
    });
  });
}


async function searchUniprots() {
  const ids = parseUniProtInput();
  const spinner = document.getElementById('search-spinner');

  if (!ids.length) {
    document.getElementById('results-container').innerHTML =
      '<div class="alert alert-info">Please enter one or more UniProt IDs.</div>';
    return;
  }

  state.results = {};
  state.selected.clear();
  state.sort = {};
  state.filters = {};

  spinner.classList.remove('d-none');
  document.getElementById('search-btn').setAttribute('disabled', 'disabled');

  await Promise.allSettled(ids.map((id) => fetchUniprotMetrics(id)));

  renderAllResults();

  document.getElementById('download-card').classList.remove('d-none');
  document.getElementById('download-status').textContent =
    'Search complete for ' + ids.length + ' UniProt ID(s).';

  spinner.classList.add('d-none');
  document.getElementById('search-btn').removeAttribute('disabled');
}

async function searchFromHome() {
  const homeInput = document.getElementById('home-uniprot-input');
  const ids = parseIdsFromText(homeInput.value);
  if (!ids.length) return;
  document.getElementById('uniprot-input').value = ids.join('\n');
  window.location.hash = 'search';
  setActiveRoute('search');
  await searchUniprots();
}

async function downloadModels(mode) {
  const statusElement = document.getElementById('download-status');
  let models = getAllModels();
  if (mode === 'selected') models = models.filter((model) => state.selected.has(model.modelId));
  const uniqueById = new Map();
  models.forEach((model) => { if (!uniqueById.has(model.modelId)) uniqueById.set(model.modelId, model); });
  models = Array.from(uniqueById.values());
  if (!models.length) {
    statusElement.textContent = mode === 'selected' ? 'No selected models to download.' : 'No models to download.';
    return;
  }
  statusElement.textContent = 'Fetching ' + models.length + ' file(s)…';
  const zip = new JSZip();
  for (let index = 0; index < models.length; index += 1) {
    const model = models[index];
    statusElement.textContent = 'Downloading ' + (index + 1) + '/' + models.length + ': ' + model.modelId;
    try {
      const response = await fetch(resolveModelUrl(model.modelUrl));
      if (!response.ok) continue;
      const blob = await response.blob();
      const match = /\.([a-zA-Z0-9]+)(?:\?|$)/.exec(model.modelUrl);
      const formatMap = { MMCIF: '.cif', CIF: '.cif', PDB: '.pdb' };
      const extension = match ? '.' + match[1] : formatMap[String(model.modelFormat || '').toUpperCase()] || '.cif';
      zip.file(model.modelId + extension, blob);
    } catch (error) {
      // Skip failed downloads.
    }
  }
  statusElement.textContent = 'Zipping ' + zip.file(/.*/).length + ' file(s)…';
  const zipBlob = await zip.generateAsync({ type: 'blob' });
  const timestamp = new Date().toISOString().replace('T', '_').replace('Z', '').replace(/[.:]/g, '-');
  saveAs(zipBlob, 'bindome_models_' + mode + '_' + timestamp + '.zip');
  statusElement.textContent = 'Download ready with ' + zip.file(/.*/).length + ' file(s).';
}


async function clearAll() {
  document.getElementById('uniprot-input').value = '';
  document.getElementById('results-container').innerHTML = '';
  document.getElementById('download-status').textContent = '';
  document.getElementById('download-card').classList.add('d-none');
  document.getElementById('column-controls-card')?.classList.add('d-none');

  state.results = {};
  state.selected.clear();
  state.sort = {};
  state.filters = {};

  await clearMolstarViewer();
  setViewerStatus('Cleared.');
}

document.addEventListener('DOMContentLoaded', async () => {
  window.addEventListener('hashchange', handleRouteChange);
  handleRouteChange();
  try {
    await initViewer();
    setViewerStatus('Viewer ready.');
  } catch (error) {
    setViewerStatus('Viewer failed to initialize: ' + error.message);
  }
  document.getElementById('home-search-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    await searchFromHome();
  });
  document.getElementById('search-btn').addEventListener('click', searchUniprots);
  document.getElementById('clear-btn').addEventListener('click', clearAll);
  document.getElementById('view-selected-btn').addEventListener('click', viewSelectedModels);
  document.getElementById('clear-viewer-btn').addEventListener('click', async () => {
    await clearMolstarViewer();
    setViewerStatus('Viewer cleared.');
  });
  document.getElementById('download-all-btn').addEventListener('click', () => downloadModels('all'));
  document.getElementById('download-selected-btn').addEventListener('click', () => downloadModels('selected'));
});
