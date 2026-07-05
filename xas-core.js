(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.XASCore = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const DEFAULTS = Object.freeze({
    preMin: -150, preMax: -30, normMin: 80, normMax: 800, normOrder: 2,
    flatten: true, rbkg: 1.0, bgKweight: 2, splineMin: 0, splineMax: 1100,
    kMin: 3, kMax: 14, dk: 1, plotKweight: 2, window: 'hanning', showWindow: false
  });

  function splitDelimited(line, commaSeparated) {
    if (!commaSeparated) return line.trim().split(/[;\t\s]+/).filter(Boolean);
    const cells = []; let cell = '', quoted = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"' && line[i + 1] === '"' && quoted) { cell += '"'; i++; }
      else if (ch === '"') quoted = !quoted;
      else if (ch === ',' && !quoted) { cells.push(cell.trim()); cell = ''; }
      else cell += ch;
    }
    cells.push(cell.trim());
    return cells;
  }

  function parseText(text) {
    const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/);
    let header = null;
    const rows = [];
    const commaSeparated = lines.some(line => line.includes(','));
    for (const raw of lines) {
      const line = raw.trim();
      if (!line || /^[#!;%]/.test(line)) {
        const candidate = line.replace(/^[#!;%]+\s*/, '').trim();
        if (candidate && /[A-Za-z]/.test(candidate)) {
          const candidateHeader = splitDelimited(candidate, commaSeparated);
          if (candidateHeader.length > 1) header = candidateHeader;
        }
        continue;
      }
      const parts = splitDelimited(line, commaSeparated);
      const nums = parts.map(Number);
      if (nums.length >= 2 && nums.every(Number.isFinite)) rows.push(nums);
      else if (!header && /[A-Za-z]/.test(line) && parts.length > 1) header = parts;
    }
    if (rows.length < 3) throw new Error('数値データを3行以上読み取れませんでした。');
    const width = Math.min(...rows.map(r => r.length));
    const columns = Array.from({ length: width }, (_, i) => (header && header.length === width ? header[i].trim() : `Column ${i + 1}`));
    return { columns, rows: rows.map(r => r.slice(0, width)) };
  }

  function movingAverage(values, radius) {
    const out = new Array(values.length); const sums = [0];
    for (let i = 0; i < values.length; i++) sums.push(sums[i] + values[i]);
    for (let i = 0; i < values.length; i++) {
      const a = Math.max(0, i - radius), b = Math.min(values.length, i + radius + 1);
      out[i] = (sums[b] - sums[a]) / (b - a);
    }
    return out;
  }

  function detectE0(energy, mu) {
    const y = movingAverage(mu, Math.max(1, Math.round(mu.length / 500)));
    const span = energy[energy.length - 1] - energy[0];
    let best = 1, bestD = -Infinity;
    for (let i = 1; i < y.length - 1; i++) {
      if (energy[i] < energy[0] + span * 0.08 || energy[i] > energy[0] + span * 0.75) continue;
      const d = (y[i + 1] - y[i - 1]) / (energy[i + 1] - energy[i - 1]);
      if (d > bestD) { bestD = d; best = i; }
    }
    return energy[best];
  }

  function solve(A, b) {
    const n = b.length; A = A.map(r => r.slice()); b = b.slice();
    for (let i = 0; i < n; i++) {
      let p = i; for (let j = i + 1; j < n; j++) if (Math.abs(A[j][i]) > Math.abs(A[p][i])) p = j;
      [A[i], A[p]] = [A[p], A[i]]; [b[i], b[p]] = [b[p], b[i]];
      const q = A[i][i] || 1e-12;
      for (let j = i; j < n; j++) A[i][j] /= q; b[i] /= q;
      for (let k = 0; k < n; k++) if (k !== i) { const f = A[k][i]; for (let j = i; j < n; j++) A[k][j] -= f * A[i][j]; b[k] -= f * b[i]; }
    }
    return b;
  }

  function polyfit(x, y, order) {
    const n = order + 1, A = Array.from({ length: n }, () => Array(n).fill(0)), b = Array(n).fill(0);
    for (let k = 0; k < x.length; k++) {
      const powers = [1]; for (let p = 1; p <= order * 2; p++) powers[p] = powers[p - 1] * x[k];
      for (let i = 0; i < n; i++) { b[i] += y[k] * powers[i]; for (let j = 0; j < n; j++) A[i][j] += powers[i + j]; }
    }
    return solve(A, b);
  }

  function polyval(c, x) { let y = 0; for (let i = c.length - 1; i >= 0; i--) y = y * x + c[i]; return y; }
  function selectRange(x, y, lo, hi) { const xx = [], yy = []; for (let i = 0; i < x.length; i++) if (x[i] >= lo && x[i] <= hi) { xx.push(x[i]); yy.push(y[i]); } return [xx, yy]; }
  function interp(x, y, q) {
    if (q <= x[0]) return y[0]; if (q >= x[x.length - 1]) return y[y.length - 1];
    let lo = 0, hi = x.length - 1; while (hi - lo > 1) { const m = (lo + hi) >> 1; if (x[m] <= q) lo = m; else hi = m; }
    return y[lo] + (y[hi] - y[lo]) * (q - x[lo]) / (x[hi] - x[lo]);
  }

  function gaussianSmooth(values, sigma) {
    const radius = Math.max(2, Math.ceil(sigma * 3)), kernel = []; let total = 0;
    for (let j = -radius; j <= radius; j++) { const w = Math.exp(-0.5 * (j / sigma) ** 2); kernel.push(w); total += w; }
    return values.map((_, i) => { let s = 0, w = 0; for (let j = -radius; j <= radius; j++) { const p = Math.max(0, Math.min(values.length - 1, i + j)); s += values[p] * kernel[j + radius]; w += kernel[j + radius]; } return s / w; });
  }

  function makeWindow(k, p) {
    if (p.window === 'none') return k.map(v => v >= p.kMin && v <= p.kMax ? 1 : 0);
    return k.map(v => {
      if (v < p.kMin || v > p.kMax) return 0;
      const edge = Math.min(Math.max(p.dk, 0.0001), (p.kMax - p.kMin) / 2);
      let t = 1;
      if (v < p.kMin + edge) t = (v - p.kMin) / edge;
      else if (v > p.kMax - edge) t = (p.kMax - v) / edge;
      if (p.window === 'kaiser') return Math.sqrt(Math.max(0, 1 - (1 - t) ** 2));
      return 0.5 - 0.5 * Math.cos(Math.PI * t);
    });
  }

  function analyze(energyInput, muInput, params) {
    const p = Object.assign({}, DEFAULTS, params || {});
    const pairs = energyInput.map((e, i) => [e, muInput[i]]).filter(v => Number.isFinite(v[0]) && Number.isFinite(v[1])).sort((a, b) => a[0] - b[0]);
    const energy = pairs.map(v => v[0]), mu = pairs.map(v => v[1]);
    if (energy.length < 10) throw new Error('解析には10点以上のデータが必要です。');
    const e0 = Number.isFinite(+p.e0) ? +p.e0 : detectE0(energy, mu);
    const [preX, preY] = selectRange(energy, mu, e0 + p.preMin, e0 + p.preMax);
    const [postX0, postY] = selectRange(energy, mu, e0 + p.normMin, Math.min(energy.at(-1), e0 + p.normMax));
    if (preX.length < 2 || postX0.length < p.normOrder + 2) throw new Error('指定範囲にフィット用のデータ点が不足しています。');
    const preC = polyfit(preX.map(v => v - e0), preY, 1);
    const postC = polyfit(postX0.map(v => (v - e0) / 1000), postY, p.normOrder);
    const pre = energy.map(v => polyval(preC, v - e0));
    const post = energy.map(v => polyval(postC, (v - e0) / 1000));
    const pre0 = polyval(preC, 0), post0 = polyval(postC, 0), edgeStep = post0 - pre0;
    if (!Number.isFinite(edgeStep) || Math.abs(edgeStep) < 1e-10) throw new Error('Edge stepを計算できません。フィット範囲を確認してください。');
    const normalizedRaw = mu.map((v, i) => (v - pre[i]) / edgeStep);
    const normalized = normalizedRaw.map((v, i) => p.flatten && energy[i] > e0 ? v - ((post[i] - pre[i]) / edgeStep - 1) : v);

    const kRaw = [], nRaw = [];
    for (let i = 0; i < energy.length; i++) if (energy[i] >= e0 + Math.max(0, p.splineMin) && energy[i] <= e0 + p.splineMax) { kRaw.push(Math.sqrt((energy[i] - e0) / 3.80998212)); nRaw.push(normalizedRaw[i]); }
    const step = 0.05, k = [], nUniform = [];
    const kEnd = kRaw.at(-1) || 0;
    for (let q = 0; q <= kEnd; q += step) { k.push(q); nUniform.push(interp(kRaw, nRaw, q)); }
    const sigma = Math.max(3, (1.75 / Math.max(0.35, p.rbkg)) / step);
    const backgroundK = gaussianSmooth(nUniform, sigma);
    const chi = nUniform.map((v, i) => v - backgroundK[i]);
    const background = energy.map(v => v < e0 ? polyval(preC, v - e0) : pre[Math.max(0, energy.indexOf(v))] + edgeStep * interp(k, backgroundK, Math.sqrt(Math.max(0, v - e0) / 3.80998212)));
    const windowValues = makeWindow(k, p);
    const r = [], ftMag = [], ftRe = [], ftIm = [];
    for (let rv = 0; rv <= 6.0001; rv += 0.02) {
      let re = 0, im = 0;
      for (let i = 0; i < k.length; i++) { const a = chi[i] * k[i] ** p.plotKweight * windowValues[i] * step; re += a * Math.cos(2 * k[i] * rv); im += a * Math.sin(2 * k[i] * rv); }
      r.push(rv); ftRe.push(re); ftIm.push(im); ftMag.push(Math.hypot(re, im));
    }
    return { energy, mu, e0, edgeStep, pre, post, normalized, normalizedRaw, background, k, chi, backgroundK, window: windowValues, r, ftMag, ftRe, ftIm, params: p };
  }

  function syntheticCu() {
    const energy = [], mu = []; let seed = 137;
    const noise = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647 - 0.5; };
    for (let e = 8750; e <= 10150; e += e < 8920 ? 2 : e < 9020 ? 0.5 : 2) {
      const edge = 1 / (1 + Math.exp(-(e - 8979) / 1.8));
      const k = Math.sqrt(Math.max(0, e - 8979) / 3.80998212);
      const exafs = e > 8985 ? (0.13 * Math.sin(2 * k * 2.18 + 0.6) * Math.exp(-k / 9) + 0.045 * Math.sin(2 * k * 3.62 - 0.8) * Math.exp(-k / 11)) : 0;
      energy.push(e); mu.push(0.18 + (e - 8750) * 0.000035 + 0.92 * edge + exafs + noise() * (0.002 + k * 0.00025));
    }
    return { columns: ['energy_eV', 'mu'], rows: energy.map((e, i) => [e, mu[i]]) };
  }

  return { DEFAULTS, parseText, detectE0, analyze, syntheticCu, makeWindow };
});
