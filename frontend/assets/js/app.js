const API_BASE_URL = 'https://bindome.epfl.ch';
const state = {
    results: {},
    selected: new Set()
};
let molstarViewer = null;
const CHAIN_COLORS = {
    chainA: '#999999',
    chainB: '#4169e1',
    other: '#d0d0d0'
};
const routes = ['home', 'search', 'stats', 'faqs', 'downloads'];

function setActiveRoute(route) {
    const r = routes.includes(route) ? route : 'home';
    document.querySelectorAll('.page-section').forEach(s => s.classList.remove('active'));
    document.getElementById('page-' + r).classList.add('active');
    document.querySelectorAll('[data-route]').forEach(l => l.classList.toggle('active', l.getAttribute('data-route') === r))
}

function handleRouteChange() {
    setActiveRoute(window.location.hash.replace('#', '') || 'home')
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
        emdbProvider: 'rcsb'
    })
}

function parseUniProtInput() {
    const input = document.getElementById('uniprot-input').value;
    return [...new Set(input.split(/[\s,;]+/).map(id => id.trim().toUpperCase()).filter(Boolean))]
}
async function fetchUniprotSummary(id) {
    try {
        const response = await fetch(API_BASE_URL + '/uniprot/summary/' + encodeURIComponent(id) + '.json');
        if (!response.ok) {
            state.results[id] = {
                error: 'HTTP ' + response.status + ' - no models found'
            };
            return
        }
        const data = await response.json();
        const empty = data && typeof data === 'object' && !Array.isArray(data) && Object.keys(data).length === 0;
        if (!data || empty) {
            state.results[id] = {
                error: 'No models found, empty response'
            };
            return
        }
        state.results[id] = data
    } catch (error) {
        state.results[id] = {
            error: error instanceof SyntaxError ? 'Response could not be parsed. Check server or proxy configuration.' : 'Request failed: ' + error.message
        }
    }
}

function formatPercent(value) {
    return Number.isFinite(value) ? (value * 100).toFixed(1) + '%' : '-'
}

function escapeHtml(value) {
    return String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;')
}

function modelAttrValue(modelId) {
    return encodeURIComponent(String(modelId))
}

function getAllModels() {
    const models = [];
    Object.entries(state.results).forEach(([uniprotId, result]) => {
        if (!result || result.error || !Array.isArray(result.structures)) return;
        result.structures.forEach(structure => {
            if (structure && structure.summary && structure.summary.model_identifier && structure.summary.model_url) {
                models.push({
                    uniprotId,
                    modelId: structure.summary.model_identifier,
                    modelUrl: structure.summary.model_url,
                    modelFormat: structure.summary.model_format,
                    entities: structure.summary.entities || []
                })
            }
        })
    });
    return models
}

function toggleModel(modelId, checked) {
    checked ? state.selected.add(modelId) : state.selected.delete(modelId);
    const attr = modelAttrValue(modelId);
    document.querySelectorAll('tr[data-model-id="' + CSS.escape(attr) + '"]').forEach(row => row.classList.toggle('selected', state.selected.has(modelId)))
}

function resolveModelUrl(url) {
    if (/^https?:\/\//i.test(url)) return url;
    const path = url.startsWith('/') ? url : '/' + url;
    return API_BASE_URL + path
}

function modelFormatToMolstarFormat(modelFormat, url) {
    const upper = String(modelFormat || '').toUpperCase();
    if (upper === 'PDB') return 'pdb';
    if (upper === 'BCIF') return 'bcif';
    if (/\.bcif(?:\?|$)/i.test(url)) return 'bcif';
    if (/\.pdb(?:\?|$)/i.test(url)) return 'pdb';
    return 'mmcif'
}

function getPrimaryChainIds(model) {
    const chains = [];
    if (Array.isArray(model.entities)) {
        model.entities.forEach(entity => {
            if (Array.isArray(entity.chain_ids)) {
                entity.chain_ids.forEach(chainId => {
                    if (typeof chainId === 'string' && chainId.trim()) chains.push(chainId.trim())
                })
            }
        })
    }
    const unique = [...new Set(chains)];
    return {
        chainA: unique[0] || 'A',
        chainB: unique[1] || 'B'
    }
}

function addChainColorRules(representation, chainId, color) {
    if (!chainId) return;
    representation.color({
        color,
        selector: {
            label_asym_id: chainId
        }
    });
    representation.color({
        color,
        selector: {
            auth_asym_id: chainId
        }
    })
}

function addChainColoredStructureToMvs(builder, model) {
    const url = resolveModelUrl(model.modelUrl);
    const format = modelFormatToMolstarFormat(model.modelFormat, url);
    const {
        chainA,
        chainB
    } = getPrimaryChainIds(model);
    const structure = builder.download({
        url
    }).parse({
        format
    }).modelStructure({});
    const cartoon = structure.component({
        selector: 'polymer'
    }).representation({
        type: 'cartoon'
    });
    cartoon.color({
        color: CHAIN_COLORS.other
    });
    addChainColorRules(cartoon, chainA, CHAIN_COLORS.chainA);
    addChainColorRules(cartoon, chainB, CHAIN_COLORS.chainB)
}
async function clearMolstarViewer() {
    if (!molstarViewer) return;
    const builder = molstar.PluginExtensions.mvs.MVSData.createBuilder();
    await molstar.PluginExtensions.mvs.loadMVS(molstarViewer.plugin, builder.getState(), {
        sourceUrl: undefined,
        sanityChecks: true,
        replaceExisting: true
    })
}
async function loadSelectedModelsInMolstar(selectedModels) {
    const builder = molstar.PluginExtensions.mvs.MVSData.createBuilder();
    selectedModels.forEach(model => addChainColoredStructureToMvs(builder, model));
    await molstar.PluginExtensions.mvs.loadMVS(molstarViewer.plugin, builder.getState(), {
        sourceUrl: undefined,
        sanityChecks: true,
        replaceExisting: true
    })
}

function setViewerStatus(message) {
    document.getElementById('viewer-status').textContent = message
}
async function viewSelectedModels() {
    if (!molstarViewer) {
        setViewerStatus('Viewer is still initializing.');
        return
    }
    const selectedModels = getAllModels().filter(model => state.selected.has(model.modelId));
    if (!selectedModels.length) {
        await clearMolstarViewer();
        setViewerStatus('No models selected.');
        return
    }
    setViewerStatus('Loading ' + selectedModels.length + ' selected model(s)...');
    try {
        await loadSelectedModelsInMolstar(selectedModels);
        setViewerStatus('Loaded ' + selectedModels.length + ' selected model(s).')
    } catch (error) {
        setViewerStatus('Viewer error: ' + error.message)
    }
}

function renderModelTable(uniprotId, structures) {
    if (!Array.isArray(structures) || !structures.length) return '<div class="alert alert-warning mb-0">No models found.</div>';
    const rows = structures.map(structure => {
        const summary = structure && structure.summary ? structure.summary : {};
        const modelId = summary.model_identifier || '-';
        const esc = escapeHtml(modelId);
        const attr = modelAttrValue(modelId);
        const checked = state.selected.has(modelId) ? 'checked' : '';
        return `<tr class="model-row ${checked?'selected':''}" data-model-id="${attr}"><td class="text-center"><input type="checkbox" class="form-check-input model-checkbox" data-model-id="${attr}" ${checked} aria-label="Select model ${esc}" /></td><td><code>${esc}</code></td><td class="min-w-nowrap">${summary.uniprot_start??'-'}-${summary.uniprot_end??'-'}</td><td>${formatPercent(summary.coverage)}</td><td>${formatPercent(summary.sequence_identity)}</td></tr>`
    }).join('');
    return `<div class="table-responsive"><table class="table table-sm table-hover align-middle mb-0"><thead class="table-light"><tr><th scope="col" class="text-center">Sel</th><th scope="col">Model ID</th><th scope="col">UniProt range</th><th scope="col">Coverage</th><th scope="col">Seq. identity</th></tr></thead><tbody>${rows}</tbody></table></div>`
}

function renderAllResults() {
    const container = document.getElementById('results-container');
    container.innerHTML = '';
    Object.entries(state.results).forEach(([uniprotId, result]) => {
        const name = result?.uniprot_entry?.id || 'Unknown';
        const count = Array.isArray(result?.structures) ? result.structures.length : 0;
        const isError = !!result?.error;
        const uid = escapeHtml(uniprotId);
        const attr = modelAttrValue(uniprotId);
        const nameEsc = escapeHtml(name);
        const card = document.createElement('article');
        card.className = 'card bindome-card mb-3';
        card.innerHTML = `<div class="card-header d-flex justify-content-between align-items-center flex-wrap gap-2"><div><strong><code>${uid}</code></strong><span class="text-muted ms-2">${isError?'':nameEsc}</span></div><div class="d-flex align-items-center gap-2"><span class="badge text-bg-secondary">${count} model(s)</span><button type="button" class="btn btn-outline-primary btn-sm select-all" data-uniprot-id="${attr}">All</button><button type="button" class="btn btn-outline-secondary btn-sm select-none" data-uniprot-id="${attr}">None</button></div></div><div class="card-body p-0">${isError?`<div class="alert alert-warning m-3 mb-0">${escapeHtml(result.error)}</div>`:renderModelTable(uniprotId,result.structures)}</div>`;
        container.appendChild(card)
    });
    container.querySelectorAll('.model-checkbox').forEach(cb => cb.addEventListener('change', e => toggleModel(decodeURIComponent(e.target.getAttribute('data-model-id')), e.target.checked)));
    container.querySelectorAll('.select-all').forEach(btn => btn.addEventListener('click', () => {
        const result = state.results[decodeURIComponent(btn.getAttribute('data-uniprot-id'))];
        if (!result || !Array.isArray(result.structures)) return;
        result.structures.forEach(structure => {
            const id = structure?.summary?.model_identifier;
            if (id) state.selected.add(id)
        });
        renderAllResults()
    }));
    container.querySelectorAll('.select-none').forEach(btn => btn.addEventListener('click', () => {
        const result = state.results[decodeURIComponent(btn.getAttribute('data-uniprot-id'))];
        if (!result || !Array.isArray(result.structures)) return;
        result.structures.forEach(structure => {
            const id = structure?.summary?.model_identifier;
            if (id) state.selected.delete(id)
        });
        renderAllResults()
    }))
}
async function searchUniprots() {
    const ids = parseUniProtInput();
    const spinner = document.getElementById('search-spinner');
    if (!ids.length) {
        document.getElementById('results-container').innerHTML = '<div class="alert alert-info">Please enter one or more UniProt IDs.</div>';
        return
    }
    state.results = {};
    state.selected.clear();
    spinner.classList.remove('d-none');
    document.getElementById('search-btn').setAttribute('disabled', 'disabled');
    await Promise.allSettled(ids.map(id => fetchUniprotSummary(id)));
    renderAllResults();
    document.getElementById('download-card').classList.remove('d-none');
    document.getElementById('download-status').textContent = 'Search complete for ' + ids.length + ' UniProt ID(s).';
    spinner.classList.add('d-none');
    document.getElementById('search-btn').removeAttribute('disabled')
}
async function downloadModels(mode) {
    const status = document.getElementById('download-status');
    let models = getAllModels();
    if (mode === 'selected') models = models.filter(model => state.selected.has(model.modelId));
    const unique = new Map();
    models.forEach(model => {
        if (!unique.has(model.modelId)) unique.set(model.modelId, model)
    });
    models = Array.from(unique.values());
    if (!models.length) {
        status.textContent = mode === 'selected' ? 'No selected models to download.' : 'No models to download.';
        return
    }
    status.textContent = 'Fetching ' + models.length + ' file(s)...';
    const zip = new JSZip();
    for (let i = 0; i < models.length; i++) {
        const model = models[i];
        status.textContent = 'Downloading ' + (i + 1) + '/' + models.length + ': ' + model.modelId;
        try {
            const response = await fetch(resolveModelUrl(model.modelUrl));
            if (!response.ok) continue;
            const blob = await response.blob();
            const match = /\.([a-zA-Z0-9]+)(?:\?|$)/.exec(model.modelUrl);
            const formatMap = {
                MMCIF: '.cif',
                CIF: '.cif',
                PDB: '.pdb'
            };
            const extension = match ? '.' + match[1] : formatMap[String(model.modelFormat || '').toUpperCase()] || '.cif';
            zip.file(model.modelId + extension, blob)
        } catch (error) {}
    }
    status.textContent = 'Zipping ' + zip.file(/.*/).length + ' file(s)...';
    const zipBlob = await zip.generateAsync({
        type: 'blob'
    });
    const timestamp = new Date().toISOString().replace('T', '_').replace('Z', '').replace(/[.:]/g, '-');
    saveAs(zipBlob, 'bindome_models_' + mode + '_' + timestamp + '.zip');
    status.textContent = 'Download ready with ' + zip.file(/.*/).length + ' file(s).'
}
async function clearAll() {
    document.getElementById('uniprot-input').value = '';
    document.getElementById('results-container').innerHTML = '';
    document.getElementById('download-status').textContent = '';
    document.getElementById('download-card').classList.add('d-none');
    state.results = {};
    state.selected.clear();
    await clearMolstarViewer();
    setViewerStatus('Cleared.')
}
document.addEventListener('DOMContentLoaded', async () => {
    window.addEventListener('hashchange', handleRouteChange);
    handleRouteChange();
    try {
        await initViewer();
        setViewerStatus('Viewer ready.')
    } catch (error) {
        setViewerStatus('Viewer failed to initialize: ' + error.message)
    }
    document.getElementById('home-search-form').addEventListener('submit', event => {
        event.preventDefault();
        const value = document.getElementById('home-uniprot-input').value.trim();
        document.getElementById('uniprot-input').value = value;
        window.location.hash = 'search';
        searchUniprots()
    });
    document.getElementById('search-btn').addEventListener('click', searchUniprots);
    document.getElementById('clear-btn').addEventListener('click', clearAll);
    document.getElementById('view-selected-btn').addEventListener('click', viewSelectedModels);
    document.getElementById('clear-viewer-btn').addEventListener('click', async () => {
        await clearMolstarViewer();
        setViewerStatus('Viewer cleared.')
    });
    document.getElementById('download-all-btn').addEventListener('click', () => downloadModels('all'));
    document.getElementById('download-selected-btn').addEventListener('click', () => downloadModels('selected'))
});