const test = require('node:test');
const assert = require('node:assert/strict');
const core = require('../src/xas-core.js');

test('parses commented column headers and numeric rows', () => {
  const parsed = core.parseText('# energy mu\n8970 0.1\n8971 0.2\n8972 0.3');
  assert.deepEqual(parsed.columns, ['energy', 'mu']);
  assert.equal(parsed.rows.length, 3);
});

test('preserves spaces and units in comma-separated column names', () => {
  const parsed = core.parseText('# Energy [eV], Time, I0 [A], Is [A], Is/I0\n180.0, 1, 4.4e-10, 9.3e-11, 0.21\n180.1, 2, 4.6e-10, 9.1e-11, 0.20\n180.2, 3, 4.7e-10, 9.2e-11, 0.19');
  assert.deepEqual(parsed.columns, ['Energy [eV]', 'Time', 'I0 [A]', 'Is [A]', 'Is/I0']);
  assert.equal(parsed.rows[0][2], 4.4e-10);
});

test('detects and analyzes a synthetic Cu K edge', () => {
  const sample = core.syntheticCu();
  const energy = sample.rows.map(r => r[0]);
  const mu = sample.rows.map(r => r[1]);
  const result = core.analyze(energy, mu, core.DEFAULTS);
  assert.ok(Math.abs(result.e0 - 8979) < 3);
  assert.ok(result.edgeStep > 0.5);
  assert.ok(result.k.length > 200);
  assert.equal(result.r.length, 301);
  assert.ok(result.ftMag.every(Number.isFinite));
});

test('transformation output arrays stay aligned', () => {
  const sample = core.syntheticCu();
  const result = core.analyze(sample.rows.map(r => r[0]), sample.rows.map(r => r[1]), { ...core.DEFAULTS, e0: 8979 });
  assert.equal(result.energy.length, result.normalized.length);
  assert.equal(result.energy.length, result.background.length);
  assert.equal(result.k.length, result.chi.length);
  assert.equal(result.k.length, result.window.length);
});
