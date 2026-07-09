(function () {
  'use strict';
  const C = window.XASCore;
  const palette = { primary: '#65508E', accent: '#6EB72D', amber: '#c39b45', rose: '#c8667c', grid: '#30283e', muted: '#91899d' };
  const colors = [palette.accent, palette.primary, '#c39b45', '#4a9c9c', '#c8667c'];
  const $ = id => document.getElementById(id);
  const PRESET_STORAGE_KEY = 'xas-workbench-analysis-presets';
  const state = { datasets: [], activeId: null, view: 'energy', overlays: true, analysisPoints: false, zoom: null, drag: null, datasetDragId: null, importQueue: [], pendingImport: null, legendVisible: false, legendEntries: {}, editingLegendId: null };
  const layoutSelection = new Set(), layoutDirty = new Set();
  let layoutResetDefaults = false;
  const paramIds = ['pre-min','pre-max','norm-min','norm-max','norm-order','flatten','rbkg','bg-kweight','spline-min','spline-max','k-min','k-max','dk','plot-kweight','window','show-window'];
  const keyMap = { 'pre-min':'preMin','pre-max':'preMax','norm-min':'normMin','norm-max':'normMax','norm-order':'normOrder','flatten':'flatten','rbkg':'rbkg','bg-kweight':'bgKweight','spline-min':'splineMin','spline-max':'splineMax','k-min':'kMin','k-max':'kMax','dk':'dk','plot-kweight':'plotKweight','window':'window','show-window':'showWindow' };

  function uid() { return Math.random().toString(36).slice(2, 9); }
  function active() { return state.datasets.find(d => d.id === state.activeId); }
  function defaultPlotStyle() {
    return { renderMode: 'line', lineStyle: 'solid', lineWidth: 2, xOffset: 0, yOffset: 0, markerSize: 3.5, markerStrokeWidth: 1, markerFilled: true, markerShape: 'circle' };
  }
  function plotStyle(d) {
    const raw = d?.plotStyle || {}, defaults = defaultPlotStyle();
    return {
      renderMode: ['line', 'line-markers', 'markers'].includes(raw.renderMode) ? raw.renderMode : defaults.renderMode,
      lineStyle: raw.lineStyle === 'dashed' ? 'dashed' : 'solid',
      lineWidth: Number.isFinite(Number(raw.lineWidth)) ? Math.min(12, Math.max(.25, Number(raw.lineWidth))) : defaults.lineWidth,
      xOffset: Number.isFinite(Number(raw.xOffset)) ? Number(raw.xOffset) : defaults.xOffset,
      yOffset: Number.isFinite(Number(raw.yOffset)) ? Number(raw.yOffset) : defaults.yOffset,
      markerSize: Number.isFinite(Number(raw.markerSize)) ? Math.min(20, Math.max(1, Number(raw.markerSize))) : defaults.markerSize,
      markerStrokeWidth: Number.isFinite(Number(raw.markerStrokeWidth)) ? Math.min(10, Math.max(0, Number(raw.markerStrokeWidth))) : defaults.markerStrokeWidth,
      markerFilled: raw.markerFilled !== false,
      markerShape: ['circle', 'square', 'diamond', 'triangle', 'cross'].includes(raw.markerShape) ? raw.markerShape : defaults.markerShape
    };
  }
  function defaultMapping(parsed) {
    const names = parsed.columns.map(v => v.toLowerCase());
    const energy = Math.max(0, names.findIndex(v => /energy|energ|mono|e_ev/.test(v)));
    let mu = names.findIndex(v => /(^|_)mu|xmu|absorp/.test(v)); if (mu < 0) mu = parsed.columns.length > 1 ? 1 : 0;
    const i0 = names.findIndex(v => /^i0\b|^i_0\b|incident/.test(v));
    const i1 = names.findIndex(v => /^(i1|i_1|is)\b|transmitted|transmission/.test(v));
    const numerator = parsed.columns.length > 6 ? 6 : (i0 >= 0 ? i0 : 1);
    const denominator = parsed.columns.length > 5 ? 5 : (i1 >= 0 ? i1 : Math.min(2, parsed.columns.length - 1));
    return { energy, mode: parsed.columns.length > 6 || (i0 >= 0 && i1 >= 0) ? 'transmission' : 'direct', mu, numerator, denominator };
  }
  function materialize(dataset) {
    const m = dataset.mapping;
    dataset.energy = dataset.parsed.rows.map(r => r[m.energy]);
    dataset.mu = dataset.parsed.rows.map(r => m.mode === 'transmission' ? Math.log(r[m.numerator] / r[m.denominator]) : r[m.mu]);
    dataset.analysis = null; runAnalysis(dataset);
  }
  function adaptiveParams(parsed, mapping) {
    const energy = parsed.rows.map(r => r[mapping.energy]).filter(Number.isFinite).sort((a,b) => a-b);
    const span = energy.at(-1) - energy[0], params = { ...C.DEFAULTS };
    if (span > 0 && span < 300) {
      const mu = parsed.rows.map(r => mapping.mode === 'transmission' ? Math.log(r[mapping.numerator] / r[mapping.denominator]) : r[mapping.mu]);
      const detectedE0 = C.detectE0(parsed.rows.map(r => r[mapping.energy]), mu);
      const detectedIndex = energy.reduce((best, value, index) => Math.abs(value - detectedE0) < Math.abs(energy[best] - detectedE0) ? index : best, 0);
      const e0 = energy[Math.max(2, Math.min(energy.length - (params.normOrder + 2), detectedIndex))];
      const spacing = span / Math.max(1, energy.length - 1);
      params.e0 = e0; params.preMin = energy[0] - e0 - spacing * .01; params.preMax = -Math.max(spacing * .49, span * .01);
      params.normMin = Math.max(spacing * .49, span * .01); params.normMax = energy.at(-1) - e0 + spacing * .01;
      params.splineMin = 0; params.splineMax = Math.max(spacing, energy.at(-1) - e0);
      params.kMin = 0; params.kMax = Math.sqrt(Math.max(0, energy.at(-1) - e0) / 3.80998212);
    }
    return params;
  }
  function addDataset(name, parsed, mapping) {
    const d = { id: uid(), name, parsed, mapping, color: colors[state.datasets.length % colors.length], plotStyle: defaultPlotStyle(), params: adaptiveParams(parsed, mapping), visible: true, analysis: null, error: null };
    state.datasets.push(d); state.activeId = d.id; materialize(d); renderDatasets(); syncControls(); updateAll();
  }
  function runAnalysis(d) {
    try { d.analysis = C.analyze(d.energy, d.mu, d.params); d.params.e0 = d.analysis.e0; d.error = null; }
    catch (err) { d.analysis = null; d.error = err.message; }
  }
  function runActive() { const d = active(); if (!d) return; runAnalysis(d); updateAll(); }

  async function loadFiles(files) {
    for (const file of files) {
      try { state.importQueue.push({ name: file.name, parsed: C.parseText(await file.text()) }); }
      catch (err) { setMessage(`${file.name}: ${err.message}`, true); }
    }
    showNextImport();
  }
  function loadSample() { if (state.datasets.some(d => d.name === 'Cu foil · demo')) { state.activeId = state.datasets.find(d => d.name === 'Cu foil · demo').id; updateAll(); return; } const parsed=C.syntheticCu(); addDataset('Cu foil · demo', parsed, defaultMapping(parsed)); }

  function renderDatasets() {
    $('dataset-count').textContent = `${state.datasets.length} DATASET${state.datasets.length === 1 ? '' : 'S'}`;
    $('dataset-list').innerHTML = state.datasets.map(d => `<div class="dataset-item ${d.id === state.activeId ? 'active' : ''} ${d.visible ? '' : 'off'}" role="option" aria-selected="${d.id === state.activeId}" data-id="${d.id}" draggable="true" title="左クリックで選択 · 右クリックで表示/非表示"><span class="dataset-handle" aria-hidden="true" title="ドラッグして並べ替え">⠿</span><span class="dataset-color" style="background:${d.color}"></span><div class="dataset-copy"><strong>${escapeHtml(d.name)}</strong><small>${d.parsed.rows.length.toLocaleString()} points · ${d.visible ? 'VISIBLE' : 'HIDDEN'} · ${d.error ? 'CHECK RANGE' : 'READY'}</small></div><div class="dataset-actions"><button data-action="remove" title="削除">×</button></div></div>`).join('');
    $('dataset-list').querySelectorAll('.dataset-item').forEach(el => {
      el.addEventListener('click', e => {
        const action = e.target.dataset.action, d = state.datasets.find(x => x.id === el.dataset.id);
        if (action === 'remove') { state.datasets = state.datasets.filter(x => x.id !== d.id); if (state.activeId === d.id) state.activeId = state.datasets[0]?.id || null; }
        else state.activeId = d.id;
        renderDatasets(); syncControls(); updateAll();
      });
      el.addEventListener('contextmenu', e => {
        e.preventDefault();
        if (e.target.closest('button')) return;
        const d = state.datasets.find(x => x.id === el.dataset.id); if (!d) return;
        d.visible = !d.visible;
        renderDatasets(); syncControls(); updateAll();
        setMessage(`${d.name}: ${d.visible ? '表示' : '非表示'}にしました`);
      });
      el.addEventListener('dragstart', e => {
        state.datasetDragId = el.dataset.id; el.classList.add('dragging');
        e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', el.dataset.id);
      });
      el.addEventListener('dragover', e => {
        if (!state.datasetDragId || state.datasetDragId === el.dataset.id) return;
        e.preventDefault(); e.dataTransfer.dropEffect = 'move';
        const after = e.clientY > el.getBoundingClientRect().top + el.offsetHeight / 2;
        $('dataset-list').querySelectorAll('.dataset-item').forEach(item => item.classList.remove('drag-before', 'drag-after'));
        el.classList.add(after ? 'drag-after' : 'drag-before'); el.dataset.dropAfter = after ? '1' : '0';
      });
      el.addEventListener('drop', e => {
        e.preventDefault();
        const dragged = state.datasets.find(d => d.id === state.datasetDragId);
        if (!dragged || dragged.id === el.dataset.id) return;
        state.datasets = state.datasets.filter(d => d.id !== dragged.id);
        let targetIndex = state.datasets.findIndex(d => d.id === el.dataset.id);
        if (el.dataset.dropAfter === '1') targetIndex++;
        state.datasets.splice(targetIndex, 0, dragged); state.datasetDragId = null;
        renderDatasets(); drawChart();
      });
      el.addEventListener('dragend', () => { state.datasetDragId = null; renderDatasets(); });
    });
  }
  function escapeHtml(s) { return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

  function showNextImport() {
    if (state.pendingImport || !state.importQueue.length) return;
    const pending = state.pendingImport = state.importQueue.shift(), d = { parsed: pending.parsed, mapping: defaultMapping(pending.parsed) };
    pending.mapping = d.mapping;
    const options = d.parsed.columns.map((v, i) => `<option value="${i}">${i + 1}: ${escapeHtml(v)}</option>`).join('');
    ['energy-column','mu-column','numerator-column','denominator-column'].forEach(id => $(id).innerHTML = options);
    $('energy-column').value = d.mapping.energy; $('mu-column').value = d.mapping.mu; $('numerator-column').value = d.mapping.numerator; $('denominator-column').value = d.mapping.denominator; $('signal-mode').value = d.mapping.mode;
    $('import-file-name').textContent = pending.name; $('preview-size').textContent = `${d.parsed.rows.length.toLocaleString()} ROWS × ${d.parsed.columns.length} COLUMNS`;
    $('import-error').hidden = true; updateMappingMode(); renderPreview(); $('import-dialog').showModal();
  }
  function currentMapping() { return { energy:+$('energy-column').value, mode:$('signal-mode').value, mu:+$('mu-column').value, numerator:+$('numerator-column').value, denominator:+$('denominator-column').value }; }
  function updateMappingMode() { const trans = $('signal-mode').value === 'transmission'; $('mu-column-row').hidden = trans; $('transmission-rows').hidden = !trans; renderPreview(); }
  function renderPreview() {
    const pending=state.pendingImport; if(!pending)return; const p=pending.parsed,m=currentMapping(),trans=m.mode==='transmission';
    $('formula-numerator').textContent=p.columns[m.numerator]; $('formula-denominator').textContent=p.columns[m.denominator];
    const heads=p.columns.map((name,i)=>`<th class="${i===m.energy?'selected-energy':trans&&i===m.numerator?'selected-numerator':trans&&i===m.denominator?'selected-denominator':!trans&&i===m.mu?'selected-numerator':''}">${i+1}. ${escapeHtml(name)}</th>`).join('');
    const rows=p.rows.slice(0,20).map((row,ri)=>`<tr><td>${ri+1}</td>${row.map((v,i)=>`<td class="${i===m.energy?'selected-energy':trans&&i===m.numerator?'selected-numerator':trans&&i===m.denominator?'selected-denominator':!trans&&i===m.mu?'selected-numerator':''}">${Number(v).toPrecision(7)}</td>`).join('')}</tr>`).join('');
    $('preview-table').className='preview-table'; $('preview-table').innerHTML=`<thead><tr><th>#</th>${heads}</tr></thead><tbody>${rows}</tbody>`;
  }
  function applyMapping() {
    const pending=state.pendingImport; if(!pending)return; const mapping=currentMapping();
    if(mapping.mode==='transmission'&&mapping.numerator===mapping.denominator){$('import-error').textContent='分子と分母には異なる列を選択してください。';$('import-error').hidden=false;return;}
    const energy=pending.parsed.rows.map(r=>r[mapping.energy]), mu=pending.parsed.rows.map(r=>mapping.mode==='transmission'?Math.log(r[mapping.numerator]/r[mapping.denominator]):r[mapping.mu]);
    if(energy.some(v=>!Number.isFinite(v))||mu.some(v=>!Number.isFinite(v))){$('import-error').textContent='選択した列から有限の数値を計算できません。0以下の分子・分母が含まれていないか確認してください。';$('import-error').hidden=false;return;}
    $('import-dialog').close(); state.pendingImport=null; state.view='energy'; state.zoom=null; document.querySelectorAll('.plot-tab').forEach(b=>b.classList.toggle('active',b.dataset.view==='energy')); addDataset(pending.name,pending.parsed,mapping); showNextImport();
  }
  function skipImport(){if(!$('import-dialog').open)return;$('import-dialog').close();state.pendingImport=null;showNextImport();}

  function syncControls() {
    const d = active();
    paramIds.forEach(id => { const el = $(id), value = d ? d.params[keyMap[id]] : C.DEFAULTS[keyMap[id]]; if (el.type === 'checkbox') el.checked = !!value; else el.value = value; el.disabled = !d; });
    $('e0').value = d?.params.e0?.toFixed(2) || ''; $('e0').disabled = !d; $('detect-e0').disabled = !d;
    $('reset-params').disabled = !d; $('save-params').disabled = !d; $('load-params').disabled = !d; $('plot-layout-button').disabled = !state.datasets.length; $('legend-toggle-button').disabled = !state.datasets.length;
  }
  function readControl(id) { const el = $(id); return el.type === 'checkbox' ? el.checked : el.tagName === 'SELECT' && id === 'window' ? el.value : +el.value; }

  function updateAll() {
    const d = active(), has = !!d;
    $('empty-state').hidden = has; $('chart').hidden = !has; $('project-title').textContent = d ? d.name : 'Untitled analysis';
    $('analysis-points-button').disabled = !has || state.view !== 'energy';
    $('plot-hint').textContent = state.analysisPoints && state.view === 'energy' ? '解析点ドラッグで範囲変更 · グラフドラッグで拡大' : 'ドラッグ範囲で拡大 · ダブルクリックでリセット';
    if (has) {
      $('metric-e0').textContent = d.analysis ? d.analysis.e0.toFixed(2) : 'ERR';
      $('metric-step').textContent = d.analysis ? d.analysis.edgeStep.toFixed(4) : 'ERR';
      $('metric-k').textContent = d.analysis ? `0–${d.analysis.k.at(-1).toFixed(1)}` : '—';
      $('metric-points').textContent = d.energy.length.toLocaleString();
      setMessage(d.error || `解析完了 · ${state.datasets.filter(x => x.visible).length}系列を表示`, !!d.error);
      requestAnimationFrame(drawChart);
    } else {
      ['metric-e0','metric-step','metric-k','metric-points'].forEach(id => $(id).textContent = '—'); setMessage('データを待っています'); $('chart-legend').innerHTML = ''; $('chart-legend').hidden = true;
    }
  }
  function setMessage(message, error) { $('analysis-message').textContent = message; document.querySelector('.state-dot').style.background = error ? '#ef789d' : ''; }

  function styledSeries(d, options) {
    const style = plotStyle(d);
    return {
      datasetId: d.id,
      name: options.name,
      x: options.x.map(v => v + (options.offset === false ? 0 : style.xOffset)),
      y: options.y.map(v => v + (options.offset === false ? 0 : style.yOffset)),
      color: options.color || d.color,
      width: options.width || style.lineWidth,
      dash: options.dash || (style.lineStyle === 'dashed' ? '8 5' : ''),
      renderMode: options.renderMode || style.renderMode,
      markerSize: style.markerSize,
      markerStrokeWidth: style.markerStrokeWidth,
      markerFilled: style.markerFilled,
      markerShape: style.markerShape,
      datasetSeries: options.datasetSeries !== false
    };
  }
  function seriesFor(d) {
    const a = d.analysis;
    if (!a) return state.view === 'energy' && d.energy?.length ? [styledSeries(d, { name:d.name, x:d.energy, y:d.mu })] : [];
    if (state.view === 'energy') {
      const s = [styledSeries(d, { name:d.name, x:a.energy, y:a.mu })];
      if (state.overlays && d.id === state.activeId) s.push(styledSeries(d, {name:'pre-edge',x:a.energy,y:a.pre,color:palette.accent,dash:'5 4',width:1,renderMode:'line',datasetSeries:false}),styledSeries(d, {name:'post-edge',x:a.energy,y:a.post,color:palette.amber,dash:'5 4',width:1,renderMode:'line',datasetSeries:false}),styledSeries(d, {name:'μ₀(E)',x:a.energy,y:a.background,color:palette.rose,dash:'3 3',width:1,renderMode:'line',datasetSeries:false}));
      return s;
    }
    if (state.view === 'normalized') return [styledSeries(d, { name:d.name, x:a.energy, y:a.normalized }), ...(state.overlays && d.id === state.activeId ? [styledSeries(d, {name:'reference 1.0',x:[a.e0,a.energy.at(-1)],y:[1,1],color:'#52666d',dash:'4 4',width:1,renderMode:'line',datasetSeries:false})] : [])];
    if (state.view === 'k') {
      const weighted = a.chi.map((v,i) => v * a.k[i] ** a.params.plotKweight);
      const s = [styledSeries(d, { name:`${d.name} · k${a.params.plotKweight}χ(k)`,x:a.k,y:weighted })];
      if (a.params.showWindow && d.id === state.activeId) { const max = Math.max(...weighted.map(Math.abs)) || 1; s.push(styledSeries(d, {name:'window',x:a.k,y:a.window.map(v=>v*max),color:palette.amber,dash:'4 3',width:1,renderMode:'line',datasetSeries:false})); }
      return s;
    }
    return [styledSeries(d, { name:d.name, x:a.r, y:a.ftMag })];
  }
  function labels() { return { energy:['Energy (eV)','μ(E) (a.u.)'], normalized:['Energy (eV)','Normalized μ(E)'], k:['k (Å⁻¹)',`k${active()?.params.plotKweight || 0} χ(k) (Å⁻${active()?.params.plotKweight || 0})`], r:['R (Å)','|χ(R)| (a.u.)'] }[state.view]; }

  function interpolateAt(x, xs, ys) {
    if (x <= xs[0]) return ys[0]; if (x >= xs.at(-1)) return ys.at(-1);
    let lo = 0, hi = xs.length - 1;
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (xs[mid] <= x) lo = mid; else hi = mid; }
    return ys[lo] + (ys[hi] - ys[lo]) * (x - xs[lo]) / (xs[hi] - xs[lo]);
  }
  function analysisMarkers(d) {
    if (!state.analysisPoints || state.view !== 'energy' || !d?.analysis) return [];
    const a = d.analysis, e0 = a.e0, marker = (key, label, x, color) => ({ key, label, x, y: interpolateAt(x, a.energy, a.mu), color });
    return [
      marker('preMin', 'PRE MIN', e0 + d.params.preMin, palette.accent),
      marker('preMax', 'PRE MAX', e0 + d.params.preMax, palette.accent),
      marker('e0', 'E₀', e0, palette.primary),
      marker('normMin', 'POST MIN', e0 + d.params.normMin, palette.amber),
      marker('normMax', 'POST MAX', e0 + d.params.normMax, palette.amber)
    ];
  }
  function moveAnalysisMarker(key, x) {
    const d = active(); if (!d?.analysis) return;
    const a = d.analysis, values = a.energy, span = values.at(-1) - values[0];
    let lo = 0, hi = values.length - 1;
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (values[mid] <= x) lo = mid; else hi = mid; }
    x = Math.abs(values[lo] - x) <= Math.abs(values[hi] - x) ? values[lo] : values[hi];
    const spacing = Math.max(span / Math.max(1, values.length - 1), span / 10000, 1e-6);
    const clamp = (value, lo, hi) => Math.max(lo, Math.min(hi, value));
    const previous = d.params[key], previousAnalysis = d.analysis, previousError = d.error;
    if (key === 'e0') d.params.e0 = clamp(x, values[0] + spacing, values.at(-1) - spacing);
    else {
      const offset = x - a.e0;
      if (key === 'preMin') d.params.preMin = clamp(offset, values[0] - a.e0 - spacing, d.params.preMax - spacing);
      if (key === 'preMax') d.params.preMax = clamp(offset, d.params.preMin + spacing, -spacing);
      if (key === 'normMin') d.params.normMin = clamp(offset, spacing, d.params.normMax - spacing);
      if (key === 'normMax') d.params.normMax = clamp(offset, d.params.normMin + spacing, values.at(-1) - a.e0 + spacing);
    }
    runAnalysis(d);
    if (d.error) { d.params[key] = previous; d.analysis = previousAnalysis; d.error = previousError; }
    syncControls(); updateAll();
  }

  function markerSvg(shape, cx, cy, s) {
    const r = s.markerSize, fill = s.markerFilled ? s.color : 'none', stroke = s.color, sw = s.markerStrokeWidth;
    if (shape === 'square') return `<rect x="${(cx-r).toFixed(1)}" y="${(cy-r).toFixed(1)}" width="${(r*2).toFixed(1)}" height="${(r*2).toFixed(1)}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}" vector-effect="non-scaling-stroke"/>`;
    if (shape === 'diamond') return `<polygon points="${cx.toFixed(1)},${(cy-r).toFixed(1)} ${(cx+r).toFixed(1)},${cy.toFixed(1)} ${cx.toFixed(1)},${(cy+r).toFixed(1)} ${(cx-r).toFixed(1)},${cy.toFixed(1)}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}" vector-effect="non-scaling-stroke"/>`;
    if (shape === 'triangle') return `<polygon points="${cx.toFixed(1)},${(cy-r).toFixed(1)} ${(cx+r*.9).toFixed(1)},${(cy+r*.75).toFixed(1)} ${(cx-r*.9).toFixed(1)},${(cy+r*.75).toFixed(1)}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}" vector-effect="non-scaling-stroke"/>`;
    if (shape === 'cross') return `<path d="M${(cx-r).toFixed(1)},${cy.toFixed(1)}L${(cx+r).toFixed(1)},${cy.toFixed(1)}M${cx.toFixed(1)},${(cy-r).toFixed(1)}L${cx.toFixed(1)},${(cy+r).toFixed(1)}" fill="none" stroke="${stroke}" stroke-width="${Math.max(1, sw)}" vector-effect="non-scaling-stroke"/>`;
    return `<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="${r}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}" vector-effect="non-scaling-stroke"/>`;
  }

  function drawChart() {
    const svg = $('chart'), rect = svg.getBoundingClientRect(); if (!rect.width || !rect.height || !active()) return;
    const series = state.datasets.filter(d => d.visible).flatMap(seriesFor); if (!series.length) { svg.innerHTML=''; svg._scale=null; $('chart-legend').innerHTML=''; $('chart-legend').hidden=true; return; }
    const W = rect.width, H = rect.height, m = { l:72, r:24, t:35, b:58 }, pw=W-m.l-m.r, ph=H-m.t-m.b;
    let allX=series.flatMap(s=>s.x), allY=series.flatMap(s=>s.y.filter(Number.isFinite)); let xmin=Math.min(...allX), xmax=Math.max(...allX), ymin=Math.min(...allY), ymax=Math.max(...allY);
    const py=(ymax-ymin||1)*.09; ymin-=py; ymax+=py; if(state.zoom){xmin=state.zoom.xmin;xmax=state.zoom.xmax;ymin=state.zoom.ymin;ymax=state.zoom.ymax;}
    const X=x=>m.l+(x-xmin)/(xmax-xmin)*pw, Y=y=>m.t+ph-(y-ymin)/(ymax-ymin)*ph;
    const ticks=(lo,hi,n)=>{const raw=(hi-lo)/n,pow=10**Math.floor(Math.log10(raw)),mags=[1,2,5,10],step=mags.find(v=>v*pow>=raw)*pow,start=Math.ceil(lo/step)*step,out=[];for(let v=start;v<=hi+step*.01;v+=step)out.push(v);return out;};
    const xt=ticks(xmin,xmax,7),yt=ticks(ymin,ymax,6), fmt=v=>Math.abs(v)>=100?Math.round(v).toString():Math.abs(v)>=10?v.toFixed(1):v.toFixed(2);
    let html=`<defs><clipPath id="plotclip"><rect x="${m.l}" y="${m.t}" width="${pw}" height="${ph}"/></clipPath></defs><rect x="${m.l}" y="${m.t}" width="${pw}" height="${ph}" fill="#120f1988"/>`;
    xt.forEach(v=>html+=`<line x1="${X(v)}" y1="${m.t}" x2="${X(v)}" y2="${m.t+ph}" stroke="${palette.grid}"/><text x="${X(v)}" y="${H-31}" fill="${palette.muted}" font-size="12" text-anchor="middle" font-family="DM Mono">${fmt(v)}</text>`);
    yt.forEach(v=>html+=`<line x1="${m.l}" y1="${Y(v)}" x2="${m.l+pw}" y2="${Y(v)}" stroke="${palette.grid}"/><text x="${m.l-12}" y="${Y(v)+4}" fill="${palette.muted}" font-size="12" text-anchor="end" font-family="DM Mono">${fmt(v)}</text>`);
    const [xl,yl]=labels(); html+=`<text x="${m.l+pw/2}" y="${H-9}" fill="#83969c" font-size="11" text-anchor="middle" font-family="DM Mono">${xl}</text><text transform="translate(16 ${m.t+ph/2}) rotate(-90)" fill="#83969c" font-size="11" text-anchor="middle" font-family="DM Mono">${yl}</text>`;
    series.forEach(s=>{let path='',markers='';const stride=Math.max(1,Math.floor(s.x.length/(W*1.5)));for(let i=0;i<s.x.length;i+=stride){if(!Number.isFinite(s.y[i]))continue;const cx=X(s.x[i]),cy=Y(s.y[i]);path+=`${path?'L':'M'}${cx.toFixed(1)},${cy.toFixed(1)}`;if(s.renderMode!=='line')markers+=markerSvg(s.markerShape,cx,cy,s);}if(s.renderMode!=='markers')html+=`<path d="${path}" fill="none" stroke="${s.color}" stroke-width="${s.width}" stroke-dasharray="${s.dash||''}" vector-effect="non-scaling-stroke" clip-path="url(#plotclip)"/>`;if(markers)html+=`<g clip-path="url(#plotclip)">${markers}</g>`;});
    if(state.view==='energy'&&state.overlays&&active()?.analysis){const x=X(active().analysis.e0);html+=`<line x1="${x}" y1="${m.t}" x2="${x}" y2="${m.t+ph}" stroke="${palette.primary}" stroke-dasharray="3 4" opacity=".9"/><text x="${x+5}" y="${m.t+13}" fill="#b9aad1" font-size="8" font-family="DM Mono">E₀ ${active().analysis.e0.toFixed(1)} eV</text>`;}
    html+=`<rect data-hit="1" x="${m.l}" y="${m.t}" width="${pw}" height="${ph}" fill="transparent" style="cursor:crosshair"/>`;
    if (state.drag?.type === 'zoom' && state.drag.current) {
      const x = Math.min(state.drag.px, state.drag.current.px), y = Math.min(state.drag.py, state.drag.current.py), w = Math.abs(state.drag.current.px - state.drag.px), h = Math.abs(state.drag.current.py - state.drag.py);
      if (w > 2 && h > 2) html += `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${w.toFixed(1)}" height="${h.toFixed(1)}" fill="${palette.primary}" opacity=".16" stroke="${palette.accent}" stroke-width="1.5" stroke-dasharray="4 3" pointer-events="none"/>`;
    }
    analysisMarkers(active()).forEach((marker, index) => {
      const x = X(marker.x), y = Y(marker.y); if (x < m.l || x > m.l + pw || y < m.t || y > m.t + ph) return;
      const anchor = index < 2 ? 'end' : index > 2 ? 'start' : 'middle', tx = x + (index < 2 ? -8 : index > 2 ? 8 : 0);
      html += `<g data-marker="${marker.key}" style="cursor:ew-resize"><line x1="${x}" y1="${y}" x2="${x}" y2="${m.t+ph}" stroke="${marker.color}" stroke-dasharray="2 4" opacity=".45" pointer-events="none"/><circle cx="${x}" cy="${y}" r="10" fill="transparent"/><circle cx="${x}" cy="${y}" r="5" fill="#120f19" stroke="${marker.color}" stroke-width="2" pointer-events="none"/><text x="${tx}" y="${y-10}" fill="${marker.color}" font-size="7" text-anchor="${anchor}" font-family="DM Mono" pointer-events="none">${marker.label}</text></g>`;
    });
    svg.innerHTML=html; svg.setAttribute('viewBox',`0 0 ${W} ${H}`); svg._scale={xmin,xmax,ymin,ymax,m,pw,ph,X,Y,series};
    renderChartLegend(series);
  }

  function chartPoint(e) { const svg=$('chart'),r=svg.getBoundingClientRect(),s=svg._scale;if(!s)return null;const px=e.clientX-r.left,py=e.clientY-r.top;return {px,py,x:s.xmin+(px-s.m.l)/s.pw*(s.xmax-s.xmin),y:s.ymax-(py-s.m.t)/s.ph*(s.ymax-s.ymin),s}; }
  function clampPlotPoint(p) {
    const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v)), s = p.s;
    const px = clamp(p.px, s.m.l, s.m.l + s.pw), py = clamp(p.py, s.m.t, s.m.t + s.ph);
    return { ...p, px, py, x: s.xmin + (px - s.m.l) / s.pw * (s.xmax - s.xmin), y: s.ymax - (py - s.m.t) / s.ph * (s.ymax - s.ymin) };
  }
  function autoscaleChart() {
    state.zoom = null;
    state.drag = null;
    drawChart();
  }
  function finishChartDrag(e) {
    if (!state.drag) return;
    const drag = state.drag;
    if (drag.type === 'zoom') {
      let changed = false;
      const end = chartPoint(e);
      if (end) {
        const p = clampPlotPoint(end), dx = Math.abs(p.px - drag.px), dy = Math.abs(p.py - drag.py);
        if (dx > 8 && dy > 8) {
          state.zoom = { xmin: Math.min(drag.x, p.x), xmax: Math.max(drag.x, p.x), ymin: Math.min(drag.y, p.y), ymax: Math.max(drag.y, p.y) };
          changed = true;
        } else {
          changed = dx > 2 || dy > 2;
        }
      }
      state.drag = null;
      if (changed) drawChart();
      return;
    }
    state.drag = null;
  }
  function exportData() {
    const d=active(); if(!d?.analysis)return; const a=d.analysis; let rows,header;
    if(state.view==='energy'||state.view==='normalized'){header='energy_eV,mu,normalized,pre_edge,post_edge,background';rows=a.energy.map((e,i)=>[e,a.mu[i],a.normalized[i],a.pre[i],a.post[i],a.background[i]]);}
    else if(state.view==='k'){header='k_A^-1,chi,k_weighted_chi,window';rows=a.k.map((k,i)=>[k,a.chi[i],a.chi[i]*k**a.params.plotKweight,a.window[i]]);}
    else{header='R_A,ft_magnitude,ft_real,ft_imag';rows=a.r.map((r,i)=>[r,a.ftMag[i],a.ftRe[i],a.ftIm[i]]);}
    const blob=new Blob([header+'\n'+rows.map(r=>r.map(v=>Number(v).toPrecision(10)).join(',')).join('\n')],{type:'text/csv'}),url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download=d.name.replace(/\.[^.]+$/,'')+`_${state.view}.csv`;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  }

  function toggleSidePanel(name) {
    const shell = document.querySelector('.app-shell'), panel = document.querySelector(`.${name}-panel`), button = $(`${name === 'dataset' ? 'dataset' : 'controls'}-panel-toggle`);
    const collapsed = panel.classList.toggle('collapsed');
    shell.classList.toggle(`${name}-collapsed`, collapsed);
    button.setAttribute('aria-expanded', String(!collapsed));
    button.title = `${name === 'dataset' ? 'データセット' : '解析条件'}を${collapsed ? '展開' : '折り畳む'}`;
    button.querySelector(':scope > b').textContent = name === 'dataset' ? (collapsed ? '›' : '‹') : (collapsed ? '‹' : '›');
    requestAnimationFrame(drawChart);
  }

  function toggleMetrics() {
    const workspace = document.querySelector('.workspace'), button = $('metrics-toggle');
    const collapsed = workspace.classList.toggle('metrics-collapsed');
    button.setAttribute('aria-expanded', String(!collapsed));
    button.textContent = collapsed ? '指標を表示' : '指標を隠す';
    button.title = collapsed ? '下部の指標を表示' : '下部の指標を折り畳む';
    requestAnimationFrame(drawChart);
  }

  function legendEntry(d) {
    const raw = state.legendEntries[d.id] || {};
    const fontSize = Number(raw.fontSize);
    return { name: typeof raw.name === 'string' && raw.name.trim() ? raw.name.trim() : d.name, fontSize: Number.isFinite(fontSize) ? Math.min(32, Math.max(8, fontSize)) : 11 };
  }
  function renderChartLegend(series) {
    const legend = $('chart-legend'), ids = [...new Set(series.filter(s => s.datasetSeries).map(s => s.datasetId))];
    const datasets = ids.map(id => state.datasets.find(d => d.id === id)).filter(Boolean);
    legend.hidden = !state.legendVisible || !datasets.length;
    $('legend-toggle-button').classList.toggle('active', state.legendVisible);
    if (legend.hidden) { legend.innerHTML = ''; return; }
    legend.innerHTML = datasets.map(d => {
      const entry = legendEntry(d);
      return `<button class="legend-item" data-id="${d.id}" type="button" title="ダブルクリックで編集" style="font-size:${entry.fontSize}px"><i class="legend-swatch" style="background:${d.color}"></i><span>${escapeHtml(entry.name)}</span></button>`;
    }).join('');
  }
  function openLegendEditor(id) {
    const d = state.datasets.find(item => item.id === id); if (!d) return;
    const entry = legendEntry(d); state.editingLegendId = id;
    $('legend-item-name').value = entry.name; $('legend-item-font-size').value = String(entry.fontSize);
    $('legend-edit-dialog').showModal(); $('legend-item-name').focus(); $('legend-item-name').select();
  }
  function applyLegendEdit(event) {
    event.preventDefault();
    const d = state.datasets.find(item => item.id === state.editingLegendId), fontSize = $('legend-item-font-size').valueAsNumber;
    if (!d || !$('legend-item-name').value.trim() || !Number.isFinite(fontSize)) return;
    state.legendEntries[d.id] = { name: $('legend-item-name').value.trim(), fontSize: Math.min(32, Math.max(8, fontSize)) };
    $('legend-edit-dialog').close(); drawChart();
  }
  function toggleLegend() {
    state.legendVisible = !state.legendVisible;
    drawChart();
  }

  function readPresets() {
    try {
      const parsed = JSON.parse(localStorage.getItem(PRESET_STORAGE_KEY) || '[]');
      return Array.isArray(parsed) ? parsed.filter(p => p?.id && p?.params) : [];
    } catch {
      return [];
    }
  }
  function writePresets(presets) {
    localStorage.setItem(PRESET_STORAGE_KEY, JSON.stringify(presets.slice(0, 30)));
  }
  function presetName(d) {
    const timestamp = new Date().toLocaleString('ja-JP', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
    return `${d.name} · ${timestamp}`;
  }
  function saveCurrentParamsPreset() {
    const d = active(); if (!d) return;
    try {
      const presets = readPresets();
      presets.unshift({ id: uid(), name: presetName(d), params: { ...d.params }, createdAt: Date.now() });
      writePresets(presets);
      setMessage(`解析条件を保存しました · ${presets[0].name}`);
    } catch (err) {
      setMessage(`解析条件を保存できませんでした: ${err.message}`, true);
    }
  }
  function renderPresetList() {
    const presets = readPresets();
    $('preset-empty').hidden = presets.length > 0;
    $('preset-list').innerHTML = presets.map(p => `<div class="preset-item" data-id="${p.id}"><div><b>${escapeHtml(p.name)}</b><small>E₀ ${Number(p.params.e0).toFixed(2)} eV · k ${p.params.kMin}–${p.params.kMax}</small></div><button data-action="apply" type="button">適用</button><button data-action="delete" type="button">削除</button></div>`).join('');
  }
  function openPresetDialog() {
    if (!active()) return;
    renderPresetList();
    $('preset-dialog').showModal();
  }
  function applyPreset(id) {
    const d = active(), preset = readPresets().find(p => p.id === id); if (!d || !preset) return;
    d.params = { ...C.DEFAULTS, ...preset.params };
    runAnalysis(d);
    $('preset-dialog').close(); syncControls(); updateAll();
    setMessage(`${preset.name} を ${d.name} へ適用しました`, !!d.error);
  }
  function deletePreset(id) {
    writePresets(readPresets().filter(p => p.id !== id));
    renderPresetList();
  }

  function colorInputValue(color) { return /^#[0-9a-f]{6}$/i.test(color || '') ? color : colors[0]; }
  function updateColorPresetSelection() {
    const value = $('plot-color').value.toLowerCase();
    $('plot-color-presets').querySelectorAll('[data-color]').forEach(button => button.classList.toggle('active', button.dataset.color.toLowerCase() === value));
  }
  function fillPlotStyleForm(d) {
    const style = plotStyle(d);
    $('plot-render-mode').value = style.renderMode; $('plot-line-style').value = style.lineStyle; $('plot-line-width').value = String(style.lineWidth);
    $('plot-color').value = colorInputValue(d.color); $('plot-x-offset').value = String(style.xOffset); $('plot-y-offset').value = String(style.yOffset);
    $('plot-marker-size').value = String(style.markerSize); $('plot-marker-stroke-width').value = String(style.markerStrokeWidth);
    $('plot-marker-filled').checked = style.markerFilled; $('plot-marker-shape').value = style.markerShape; $('plot-hidden').checked = !d.visible;
    updateColorPresetSelection();
  }
  function refreshLayoutSelection(loadValues = true) {
    const valid = new Set(state.datasets.map(d => d.id));
    [...layoutSelection].forEach(id => { if (!valid.has(id)) layoutSelection.delete(id); });
    $('plot-series-list').querySelectorAll('.plot-series-row').forEach(row => row.classList.toggle('is-selected', layoutSelection.has(row.dataset.id)));
    $('plot-selection-count').textContent = `${layoutSelection.size} selected`;
    const hasSelection = layoutSelection.size > 0;
    $('plot-layout-controls').hidden = !hasSelection;
    $('plot-layout-form').querySelector('button[type="submit"]').disabled = !hasSelection;
    $('plot-style-reset').disabled = !hasSelection;
    if (loadValues && hasSelection) {
      const first = state.datasets.find(d => layoutSelection.has(d.id));
      fillPlotStyleForm(first); layoutDirty.clear(); layoutResetDefaults = false;
    }
  }
  function movePlotBefore(sourceId, targetId) {
    const from = state.datasets.findIndex(d => d.id === sourceId), target = state.datasets.findIndex(d => d.id === targetId);
    if (from < 0 || target < 0 || from === target) return;
    const [moved] = state.datasets.splice(from, 1);
    state.datasets.splice(state.datasets.findIndex(d => d.id === targetId), 0, moved);
  }
  function renderPlotSeriesList() {
    $('plot-series-list').innerHTML = '';
    state.datasets.forEach(d => {
      const row = document.createElement('div'), style = plotStyle(d);
      row.className = `plot-series-row${layoutSelection.has(d.id) ? ' is-selected' : ''}${d.visible ? '' : ' is-hidden'}`;
      row.draggable = true; row.dataset.id = d.id; row.style.setProperty('--series-color', d.color);
      const checkbox = document.createElement('input'); checkbox.type = 'checkbox'; checkbox.checked = layoutSelection.has(d.id); checkbox.setAttribute('aria-label', `Select ${d.name}`);
      const handle = document.createElement('span'); handle.className = 'plot-drag-handle'; handle.textContent = '⠿'; handle.setAttribute('aria-hidden', 'true');
      const name = document.createElement('span'); name.className = 'plot-series-name'; name.textContent = d.name; name.title = `${d.name} · ${d.visible ? 'visible' : 'hidden'} · ${style.renderMode}`;
      checkbox.onclick = event => event.stopPropagation();
      checkbox.onchange = () => { checkbox.checked ? layoutSelection.add(d.id) : layoutSelection.delete(d.id); refreshLayoutSelection(); };
      row.onclick = () => { layoutSelection.has(d.id) ? layoutSelection.delete(d.id) : layoutSelection.add(d.id); checkbox.checked = layoutSelection.has(d.id); refreshLayoutSelection(); };
      row.ondragstart = event => { event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/plain', d.id); row.classList.add('dragging'); };
      row.ondragover = event => { event.preventDefault(); event.dataTransfer.dropEffect = 'move'; row.classList.add('drag-over'); };
      row.ondragleave = () => row.classList.remove('drag-over');
      row.ondrop = event => { event.preventDefault(); row.classList.remove('drag-over'); movePlotBefore(event.dataTransfer.getData('text/plain'), d.id); renderDatasets(); renderPlotSeriesList(); updateAll(); };
      row.ondragend = () => $('plot-series-list').querySelectorAll('.plot-series-row').forEach(item => item.classList.remove('dragging', 'drag-over'));
      row.append(checkbox, handle, name); $('plot-series-list').append(row);
    });
  }
  function openPlotLayout() {
    const hasDatasets = state.datasets.length > 0;
    layoutSelection.clear();
    if (hasDatasets) layoutSelection.add(state.activeId || state.datasets[0].id);
    $('plot-layout-empty').hidden = hasDatasets; $('plot-layout-body').hidden = !hasDatasets;
    renderPlotSeriesList(); refreshLayoutSelection();
    $('plot-layout-dialog').showModal();
    $('plot-series-list').querySelector('input')?.focus();
  }
  function applyPlotLayout(event) {
    event.preventDefault();
    const form = $('plot-layout-form'); if (!form.reportValidity()) return;
    const targets = state.datasets.filter(d => layoutSelection.has(d.id));
    const values = {
      renderMode: $('plot-render-mode').value, lineStyle: $('plot-line-style').value, lineWidth: $('plot-line-width').valueAsNumber,
      xOffset: $('plot-x-offset').valueAsNumber, yOffset: $('plot-y-offset').valueAsNumber, markerSize: $('plot-marker-size').valueAsNumber,
      markerStrokeWidth: $('plot-marker-stroke-width').valueAsNumber, markerFilled: $('plot-marker-filled').checked, markerShape: $('plot-marker-shape').value
    };
    targets.forEach(d => {
      const style = layoutResetDefaults ? defaultPlotStyle() : plotStyle(d);
      Object.entries(values).forEach(([key, value]) => { if (layoutDirty.has(key)) style[key] = value; });
      d.plotStyle = style;
      if (layoutResetDefaults) { d.color = colors[state.datasets.indexOf(d) % colors.length]; d.visible = true; }
      if (layoutDirty.has('color')) d.color = $('plot-color').value;
      if (layoutDirty.has('hidden')) d.visible = !$('plot-hidden').checked;
    });
    state.zoom = null; $('plot-layout-dialog').close(); renderDatasets(); syncControls(); updateAll();
  }

  $('file-input').addEventListener('change',e=>{loadFiles(e.target.files);e.target.value=''}); $('drop-input').addEventListener('change',e=>{loadFiles(e.target.files);e.target.value=''});
  ['dragenter','dragover'].forEach(type=>$('dropzone').addEventListener(type,e=>{e.preventDefault();$('dropzone').classList.add('drag')})); ['dragleave','drop'].forEach(type=>$('dropzone').addEventListener(type,e=>{$('dropzone').classList.remove('drag');if(type==='drop'){e.preventDefault();loadFiles(e.dataTransfer.files)}}));
  $('sample-button').onclick=$('empty-sample').onclick=loadSample; $('signal-mode').onchange=updateMappingMode; $('mapping-apply').onclick=applyMapping; $('import-cancel').onclick=$('import-skip').onclick=skipImport;
  $('import-dialog').addEventListener('cancel',e=>{e.preventDefault();skipImport()});
  ['energy-column','mu-column','numerator-column','denominator-column'].forEach(id=>$(id).addEventListener('change',renderPreview));
  paramIds.forEach(id=>$(id).addEventListener('change',()=>{const d=active();if(!d)return;d.params[keyMap[id]]=readControl(id);runActive()}));
  $('e0').addEventListener('change',()=>{const d=active();if(!d)return;d.params.e0=+$('e0').value;runActive()});
  $('detect-e0').onclick=()=>{const d=active();if(!d)return;d.params.e0=C.detectE0(d.energy,d.mu);syncControls();runActive()};
  $('reset-params').onclick=()=>{const d=active();if(!d)return;d.params={...C.DEFAULTS,e0:C.detectE0(d.energy,d.mu)};syncControls();runActive()};
  $('dataset-panel-toggle').onclick=()=>toggleSidePanel('dataset'); $('controls-panel-toggle').onclick=()=>toggleSidePanel('controls'); $('metrics-toggle').onclick=toggleMetrics;
  $('plot-layout-button').onclick=openPlotLayout; $('plot-layout-close').onclick=()=>$('plot-layout-dialog').close();
  $('plot-layout-form').querySelector('[value="cancel"]').onclick=()=>$('plot-layout-dialog').close(); $('plot-layout-form').onsubmit=applyPlotLayout;
  $('plot-select-all').onclick=()=>{state.datasets.forEach(d=>layoutSelection.add(d.id));renderPlotSeriesList();refreshLayoutSelection()};
  $('plot-select-none').onclick=()=>{layoutSelection.clear();renderPlotSeriesList();refreshLayoutSelection()};
  $('plot-style-reset').onclick=()=>{const first=state.datasets.find(d=>layoutSelection.has(d.id));if(!first)return;fillPlotStyleForm({...first,color:colors[state.datasets.indexOf(first)%colors.length],plotStyle:defaultPlotStyle(),visible:true});layoutDirty.clear();layoutResetDefaults=true};
  new Map([[$('plot-render-mode'),'renderMode'],[$('plot-line-style'),'lineStyle'],[$('plot-line-width'),'lineWidth'],[$('plot-color'),'color'],[$('plot-x-offset'),'xOffset'],[$('plot-y-offset'),'yOffset'],[$('plot-marker-size'),'markerSize'],[$('plot-marker-stroke-width'),'markerStrokeWidth'],[$('plot-marker-filled'),'markerFilled'],[$('plot-marker-shape'),'markerShape'],[$('plot-hidden'),'hidden']]).forEach((key,input)=>input.addEventListener('input',()=>layoutDirty.add(key)));
  $('plot-color').addEventListener('input',updateColorPresetSelection); $('plot-color-presets').querySelectorAll('[data-color]').forEach(button=>{button.style.setProperty('--preset-color',button.dataset.color);button.onclick=()=>{$('plot-color').value=button.dataset.color;layoutDirty.add('color');updateColorPresetSelection()}});
  $('save-params').onclick=saveCurrentParamsPreset; $('load-params').onclick=openPresetDialog; $('preset-close').onclick=()=>$('preset-dialog').close();
  $('preset-list').addEventListener('click',e=>{const button=e.target.closest('button[data-action]'), item=e.target.closest('.preset-item'); if(!button||!item)return; if(button.dataset.action==='apply')applyPreset(item.dataset.id); else deletePreset(item.dataset.id);});
  $('preset-dialog').addEventListener('cancel',e=>{e.preventDefault();$('preset-dialog').close()});
  $('legend-toggle-button').onclick=toggleLegend; $('chart-legend').addEventListener('dblclick',e=>{const item=e.target.closest('.legend-item');if(item)openLegendEditor(item.dataset.id)});
  $('legend-edit-close').onclick=()=>$('legend-edit-dialog').close(); $('legend-edit-form').querySelector('[value="cancel"]').onclick=()=>$('legend-edit-dialog').close(); $('legend-edit-form').onsubmit=applyLegendEdit;
  $('legend-edit-dialog').addEventListener('cancel',e=>{e.preventDefault();$('legend-edit-dialog').close()});
  document.querySelectorAll('.section-toggle').forEach(b=>b.onclick=()=>{const open=b.parentElement.classList.toggle('open');b.setAttribute('aria-expanded',String(open))});
  document.querySelectorAll('.plot-tab').forEach(b=>b.onclick=()=>{document.querySelectorAll('.plot-tab').forEach(x=>x.classList.remove('active'));b.classList.add('active');state.view=b.dataset.view;state.zoom=null;updateAll()});
  $('analysis-points-button').onclick=()=>{state.analysisPoints=!state.analysisPoints;$('analysis-points-button').classList.toggle('active',state.analysisPoints);updateAll()};
  $('overlay-button').onclick=()=>{state.overlays=!state.overlays;$('overlay-button').classList.toggle('active',state.overlays);drawChart()}; $('reset-zoom').onclick=autoscaleChart; $('export-button').onclick=exportData;
  $('guide-button').onclick=()=>$('guide-dialog').showModal(); $('guide-close').onclick=()=>$('guide-dialog').close();
  $('chart').addEventListener('pointermove',e=>{const p=chartPoint(e);if(!p)return;$('cursor-x').textContent=`${labels()[0].split(' ')[0]} ${p.x.toFixed(state.view==='energy'?1:2)}`;$('cursor-y').textContent=p.y.toPrecision(4);if(state.drag?.type==='marker'){moveAnalysisMarker(state.drag.key,p.x);return;}if(state.drag?.type==='zoom'){state.drag.current=clampPlotPoint(p);drawChart();}});
  $('chart').addEventListener('pointerdown',e=>{if(e.detail>=2){e.preventDefault();autoscaleChart();return;}const p=chartPoint(e);if(!p)return;const marker=e.target.closest('[data-marker]');const start=clampPlotPoint(p);state.drag=marker?{type:'marker',key:marker.dataset.marker}:{type:'zoom',px:start.px,py:start.py,x:start.x,y:start.y,current:start};$('chart').setPointerCapture(e.pointerId)});
  $('chart').addEventListener('pointerup',e=>{if($('chart').hasPointerCapture(e.pointerId))$('chart').releasePointerCapture(e.pointerId);finishChartDrag(e)});
  $('chart').addEventListener('pointercancel',()=>{state.drag=null;drawChart()});
  $('chart').addEventListener('dblclick',e=>{e.preventDefault();autoscaleChart()});
  $('chart').addEventListener('wheel',e=>{e.preventDefault();const p=chartPoint(e);if(!p)return;const f=e.deltaY>0?1.16:.86;state.zoom={xmin:p.x+(p.s.xmin-p.x)*f,xmax:p.x+(p.s.xmax-p.x)*f,ymin:p.y+(p.s.ymin-p.y)*f,ymax:p.y+(p.s.ymax-p.y)*f};drawChart()},{passive:false});
  window.addEventListener('resize',drawChart); renderDatasets(); syncControls(); updateAll();
})();
