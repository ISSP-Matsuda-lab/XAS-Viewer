(function () {
  'use strict';
  const C = window.XASCore;
  const colors = ['#42d8e7', '#e5a84d', '#9d8cff', '#69d59b', '#ef789d'];
  const $ = id => document.getElementById(id);
  const state = { datasets: [], activeId: null, view: 'energy', overlays: true, analysisPoints: false, zoom: null, drag: null, datasetDragId: null, importQueue: [], pendingImport: null };
  const paramIds = ['pre-min','pre-max','norm-min','norm-max','norm-order','flatten','rbkg','bg-kweight','spline-min','spline-max','k-min','k-max','dk','plot-kweight','window','show-window'];
  const keyMap = { 'pre-min':'preMin','pre-max':'preMax','norm-min':'normMin','norm-max':'normMax','norm-order':'normOrder','flatten':'flatten','rbkg':'rbkg','bg-kweight':'bgKweight','spline-min':'splineMin','spline-max':'splineMax','k-min':'kMin','k-max':'kMax','dk':'dk','plot-kweight':'plotKweight','window':'window','show-window':'showWindow' };

  function uid() { return Math.random().toString(36).slice(2, 9); }
  function active() { return state.datasets.find(d => d.id === state.activeId); }
  function defaultMapping(parsed) {
    const names = parsed.columns.map(v => v.toLowerCase());
    const energy = Math.max(0, names.findIndex(v => /energy|energ|mono|e_ev/.test(v)));
    let mu = names.findIndex(v => /(^|_)mu|xmu|absorp/.test(v)); if (mu < 0) mu = parsed.columns.length > 1 ? 1 : 0;
    const i0 = names.findIndex(v => /^i0\b|^i_0\b|incident/.test(v));
    const i1 = names.findIndex(v => /^(i1|i_1|is)\b|transmitted|transmission/.test(v));
    return { energy, mode: i0 >= 0 && i1 >= 0 ? 'transmission' : 'direct', mu, numerator: i0 >= 0 ? i0 : 1, denominator: i1 >= 0 ? i1 : Math.min(2, parsed.columns.length - 1) };
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
    const d = { id: uid(), name, parsed, mapping, color: colors[state.datasets.length % colors.length], params: adaptiveParams(parsed, mapping), visible: true, analysis: null, error: null };
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
    $('dataset-list').innerHTML = state.datasets.map(d => `<div class="dataset-item ${d.id === state.activeId ? 'active' : ''}" role="option" aria-selected="${d.id === state.activeId}" data-id="${d.id}" draggable="true"><span class="dataset-handle" aria-hidden="true" title="ドラッグして並べ替え">⠿</span><span class="dataset-color" style="background:${d.color}"></span><div class="dataset-copy"><strong>${escapeHtml(d.name)}</strong><small>${d.parsed.rows.length.toLocaleString()} points · ${d.error ? 'CHECK RANGE' : 'READY'}</small></div><div class="dataset-actions"><button data-action="toggle" title="表示切替">${d.visible ? '◉' : '○'}</button><button data-action="remove" title="削除">×</button></div></div>`).join('');
    $('dataset-list').querySelectorAll('.dataset-item').forEach(el => {
      el.addEventListener('click', e => {
        const action = e.target.dataset.action, d = state.datasets.find(x => x.id === el.dataset.id);
        if (action === 'remove') { state.datasets = state.datasets.filter(x => x.id !== d.id); if (state.activeId === d.id) state.activeId = state.datasets[0]?.id || null; }
        else if (action === 'toggle') d.visible = !d.visible;
        else state.activeId = d.id;
        renderDatasets(); syncControls(); updateAll();
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
  }
  function readControl(id) { const el = $(id); return el.type === 'checkbox' ? el.checked : el.tagName === 'SELECT' && id === 'window' ? el.value : +el.value; }

  function updateAll() {
    const d = active(), has = !!d;
    $('empty-state').hidden = has; $('chart').hidden = !has; $('project-title').textContent = d ? d.name : 'Untitled analysis';
    $('analysis-points-button').disabled = !has || state.view !== 'energy';
    $('plot-hint').textContent = state.analysisPoints && state.view === 'energy' ? '解析点を横にドラッグして範囲変更 · 余白ドラッグで移動' : 'ホイールで拡大 · ドラッグで移動';
    if (has) {
      $('metric-e0').textContent = d.analysis ? d.analysis.e0.toFixed(2) : 'ERR';
      $('metric-step').textContent = d.analysis ? d.analysis.edgeStep.toFixed(4) : 'ERR';
      $('metric-k').textContent = d.analysis ? `0–${d.analysis.k.at(-1).toFixed(1)}` : '—';
      $('metric-points').textContent = d.energy.length.toLocaleString();
      setMessage(d.error || `解析完了 · ${state.datasets.filter(x => x.visible).length}系列を表示`, !!d.error);
      requestAnimationFrame(drawChart);
    } else {
      ['metric-e0','metric-step','metric-k','metric-points'].forEach(id => $(id).textContent = '—'); setMessage('データを待っています'); $('chart-legend').innerHTML = '';
    }
  }
  function setMessage(message, error) { $('analysis-message').textContent = message; document.querySelector('.state-dot').style.background = error ? '#ef789d' : ''; }

  function seriesFor(d) {
    const a = d.analysis;
    if (!a) return state.view === 'energy' && d.energy?.length ? [{ name:d.name, x:d.energy, y:d.mu, color:d.color, width:1.8 }] : [];
    if (state.view === 'energy') {
      const s = [{ name:d.name, x:a.energy, y:a.mu, color:d.color, width:1.8 }];
      if (state.overlays && d.id === state.activeId) s.push({name:'pre-edge',x:a.energy,y:a.pre,color:'#69d59b',dash:'5 4',width:1},{name:'post-edge',x:a.energy,y:a.post,color:'#e5a84d',dash:'5 4',width:1},{name:'μ₀(E)',x:a.energy,y:a.background,color:'#ef789d',dash:'3 3',width:1});
      return s;
    }
    if (state.view === 'normalized') return [{ name:d.name, x:a.energy, y:a.normalized, color:d.color, width:1.7 }, ...(state.overlays && d.id === state.activeId ? [{name:'reference 1.0',x:[a.e0,a.energy.at(-1)],y:[1,1],color:'#52666d',dash:'4 4',width:1}] : [])];
    if (state.view === 'k') {
      const weighted = a.chi.map((v,i) => v * a.k[i] ** a.params.plotKweight);
      const s = [{ name:`${d.name} · k${a.params.plotKweight}χ(k)`,x:a.k,y:weighted,color:d.color,width:1.6 }];
      if (a.params.showWindow && d.id === state.activeId) { const max = Math.max(...weighted.map(Math.abs)) || 1; s.push({name:'window',x:a.k,y:a.window.map(v=>v*max),color:'#e5a84d',dash:'4 3',width:1}); }
      return s;
    }
    return [{ name:d.name, x:a.r, y:a.ftMag, color:d.color, width:1.8 }];
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
      marker('preMin', 'PRE MIN', e0 + d.params.preMin, '#69d59b'),
      marker('preMax', 'PRE MAX', e0 + d.params.preMax, '#69d59b'),
      marker('e0', 'E₀', e0, '#42d8e7'),
      marker('normMin', 'POST MIN', e0 + d.params.normMin, '#e5a84d'),
      marker('normMax', 'POST MAX', e0 + d.params.normMax, '#e5a84d')
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

  function drawChart() {
    const svg = $('chart'), rect = svg.getBoundingClientRect(); if (!rect.width || !rect.height || !active()) return;
    const series = state.datasets.filter(d => d.visible).flatMap(seriesFor); if (!series.length) { svg.innerHTML=''; $('chart-legend').innerHTML=''; return; }
    const W = rect.width, H = rect.height, m = { l:62, r:24, t:35, b:50 }, pw=W-m.l-m.r, ph=H-m.t-m.b;
    let allX=series.flatMap(s=>s.x), allY=series.flatMap(s=>s.y.filter(Number.isFinite)); let xmin=Math.min(...allX), xmax=Math.max(...allX), ymin=Math.min(...allY), ymax=Math.max(...allY);
    const py=(ymax-ymin||1)*.09; ymin-=py; ymax+=py; if(state.zoom){xmin=state.zoom.xmin;xmax=state.zoom.xmax;ymin=state.zoom.ymin;ymax=state.zoom.ymax;}
    const X=x=>m.l+(x-xmin)/(xmax-xmin)*pw, Y=y=>m.t+ph-(y-ymin)/(ymax-ymin)*ph;
    const ticks=(lo,hi,n)=>{const raw=(hi-lo)/n,pow=10**Math.floor(Math.log10(raw)),mags=[1,2,5,10],step=mags.find(v=>v*pow>=raw)*pow,start=Math.ceil(lo/step)*step,out=[];for(let v=start;v<=hi+step*.01;v+=step)out.push(v);return out;};
    const xt=ticks(xmin,xmax,7),yt=ticks(ymin,ymax,6), fmt=v=>Math.abs(v)>=100?Math.round(v).toString():Math.abs(v)>=10?v.toFixed(1):v.toFixed(2);
    let html=`<defs><clipPath id="plotclip"><rect x="${m.l}" y="${m.t}" width="${pw}" height="${ph}"/></clipPath></defs><rect x="${m.l}" y="${m.t}" width="${pw}" height="${ph}" fill="#09131788"/>`;
    xt.forEach(v=>html+=`<line x1="${X(v)}" y1="${m.t}" x2="${X(v)}" y2="${m.t+ph}" stroke="#1b2b31"/><text x="${X(v)}" y="${H-25}" fill="#63777e" font-size="9" text-anchor="middle" font-family="DM Mono">${fmt(v)}</text>`);
    yt.forEach(v=>html+=`<line x1="${m.l}" y1="${Y(v)}" x2="${m.l+pw}" y2="${Y(v)}" stroke="#1b2b31"/><text x="${m.l-10}" y="${Y(v)+3}" fill="#63777e" font-size="9" text-anchor="end" font-family="DM Mono">${fmt(v)}</text>`);
    const [xl,yl]=labels(); html+=`<text x="${m.l+pw/2}" y="${H-7}" fill="#83969c" font-size="9" text-anchor="middle" font-family="DM Mono">${xl}</text><text transform="translate(13 ${m.t+ph/2}) rotate(-90)" fill="#83969c" font-size="9" text-anchor="middle" font-family="DM Mono">${yl}</text>`;
    series.forEach(s=>{let path='';const stride=Math.max(1,Math.floor(s.x.length/(W*1.5)));for(let i=0;i<s.x.length;i+=stride){if(!Number.isFinite(s.y[i]))continue;path+=`${path?'L':'M'}${X(s.x[i]).toFixed(1)},${Y(s.y[i]).toFixed(1)}`;}html+=`<path d="${path}" fill="none" stroke="${s.color}" stroke-width="${s.width}" stroke-dasharray="${s.dash||''}" vector-effect="non-scaling-stroke" clip-path="url(#plotclip)"/>`;});
    if(state.view==='energy'&&state.overlays&&active()?.analysis){const x=X(active().analysis.e0);html+=`<line x1="${x}" y1="${m.t}" x2="${x}" y2="${m.t+ph}" stroke="#42d8e7" stroke-dasharray="3 4" opacity=".8"/><text x="${x+5}" y="${m.t+13}" fill="#42d8e7" font-size="8" font-family="DM Mono">E₀ ${active().analysis.e0.toFixed(1)} eV</text>`;}
    html+=`<rect data-hit="1" x="${m.l}" y="${m.t}" width="${pw}" height="${ph}" fill="transparent" style="cursor:crosshair"/>`;
    analysisMarkers(active()).forEach((marker, index) => {
      const x = X(marker.x), y = Y(marker.y); if (x < m.l || x > m.l + pw || y < m.t || y > m.t + ph) return;
      const anchor = index < 2 ? 'end' : index > 2 ? 'start' : 'middle', tx = x + (index < 2 ? -8 : index > 2 ? 8 : 0);
      html += `<g data-marker="${marker.key}" style="cursor:ew-resize"><line x1="${x}" y1="${y}" x2="${x}" y2="${m.t+ph}" stroke="${marker.color}" stroke-dasharray="2 4" opacity=".45" pointer-events="none"/><circle cx="${x}" cy="${y}" r="10" fill="transparent"/><circle cx="${x}" cy="${y}" r="5" fill="#091317" stroke="${marker.color}" stroke-width="2" pointer-events="none"/><text x="${tx}" y="${y-10}" fill="${marker.color}" font-size="7" text-anchor="${anchor}" font-family="DM Mono" pointer-events="none">${marker.label}</text></g>`;
    });
    svg.innerHTML=html; svg.setAttribute('viewBox',`0 0 ${W} ${H}`); svg._scale={xmin,xmax,ymin,ymax,m,pw,ph,X,Y,series};
    const unique=[]; series.forEach(s=>{if(!unique.some(u=>u.name===s.name))unique.push(s)}); $('chart-legend').innerHTML=unique.slice(0,5).map(s=>`<span class="legend-item"><i class="legend-swatch" style="background:${s.color}"></i>${escapeHtml(s.name)}</span>`).join('');
  }

  function chartPoint(e) { const svg=$('chart'),r=svg.getBoundingClientRect(),s=svg._scale;if(!s)return null;const px=e.clientX-r.left,py=e.clientY-r.top;return {px,py,x:s.xmin+(px-s.m.l)/s.pw*(s.xmax-s.xmin),y:s.ymax-(py-s.m.t)/s.ph*(s.ymax-s.ymin),s}; }
  function exportData() {
    const d=active(); if(!d?.analysis)return; const a=d.analysis; let rows,header;
    if(state.view==='energy'||state.view==='normalized'){header='energy_eV,mu,normalized,pre_edge,post_edge,background';rows=a.energy.map((e,i)=>[e,a.mu[i],a.normalized[i],a.pre[i],a.post[i],a.background[i]]);}
    else if(state.view==='k'){header='k_A^-1,chi,k_weighted_chi,window';rows=a.k.map((k,i)=>[k,a.chi[i],a.chi[i]*k**a.params.plotKweight,a.window[i]]);}
    else{header='R_A,ft_magnitude,ft_real,ft_imag';rows=a.r.map((r,i)=>[r,a.ftMag[i],a.ftRe[i],a.ftIm[i]]);}
    const blob=new Blob([header+'\n'+rows.map(r=>r.map(v=>Number(v).toPrecision(10)).join(',')).join('\n')],{type:'text/csv'}),url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download=d.name.replace(/\.[^.]+$/,'')+`_${state.view}.csv`;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
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
  document.querySelectorAll('.section-toggle').forEach(b=>b.onclick=()=>b.parentElement.classList.toggle('open'));
  document.querySelectorAll('.plot-tab').forEach(b=>b.onclick=()=>{document.querySelectorAll('.plot-tab').forEach(x=>x.classList.remove('active'));b.classList.add('active');state.view=b.dataset.view;state.zoom=null;updateAll()});
  $('analysis-points-button').onclick=()=>{state.analysisPoints=!state.analysisPoints;$('analysis-points-button').classList.toggle('active',state.analysisPoints);updateAll()};
  $('overlay-button').onclick=()=>{state.overlays=!state.overlays;$('overlay-button').classList.toggle('active',state.overlays);drawChart()}; $('reset-zoom').onclick=()=>{state.zoom=null;drawChart()}; $('export-button').onclick=exportData;
  $('guide-button').onclick=()=>$('guide-dialog').showModal(); $('guide-close').onclick=()=>$('guide-dialog').close();
  $('chart').addEventListener('pointermove',e=>{const p=chartPoint(e);if(!p)return;$('cursor-x').textContent=`${labels()[0].split(' ')[0]} ${p.x.toFixed(state.view==='energy'?1:2)}`;$('cursor-y').textContent=p.y.toPrecision(4);if(state.drag?.type==='marker'){moveAnalysisMarker(state.drag.key,p.x);return;}if(state.drag?.type==='pan'){const dx=p.px-state.drag.px,dy=p.py-state.drag.py,s=p.s;state.zoom={xmin:state.drag.zoom.xmin-dx/s.pw*(state.drag.zoom.xmax-state.drag.zoom.xmin),xmax:state.drag.zoom.xmax-dx/s.pw*(state.drag.zoom.xmax-state.drag.zoom.xmin),ymin:state.drag.zoom.ymin+dy/s.ph*(state.drag.zoom.ymax-state.drag.zoom.ymin),ymax:state.drag.zoom.ymax+dy/s.ph*(state.drag.zoom.ymax-state.drag.zoom.ymin)};drawChart();}});
  $('chart').addEventListener('pointerdown',e=>{const p=chartPoint(e);if(!p)return;const marker=e.target.closest('[data-marker]');state.drag=marker?{type:'marker',key:marker.dataset.marker}:{type:'pan',px:p.px,py:p.py,zoom:{xmin:p.s.xmin,xmax:p.s.xmax,ymin:p.s.ymin,ymax:p.s.ymax}};$('chart').setPointerCapture(e.pointerId)}); window.addEventListener('pointerup',()=>state.drag=null);
  $('chart').addEventListener('wheel',e=>{e.preventDefault();const p=chartPoint(e);if(!p)return;const f=e.deltaY>0?1.16:.86;state.zoom={xmin:p.x+(p.s.xmin-p.x)*f,xmax:p.x+(p.s.xmax-p.x)*f,ymin:p.y+(p.s.ymin-p.y)*f,ymax:p.y+(p.s.ymax-p.y)*f};drawChart()},{passive:false});
  window.addEventListener('resize',drawChart); renderDatasets(); syncControls(); updateAll();
})();
