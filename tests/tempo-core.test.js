/* =============================================================================
 * Rhythm Trainer
 * Copyright (c) 2026 Proximity Software Factory LLC. All rights reserved.
 *
 * This file is part of Rhythm Trainer. Proprietary and confidential.
 * Unauthorized copying, modification, or distribution is strictly prohibited.
 * See LICENSE for details.
 * ============================================================================= */
// node --test web/tempo-training/tests
const test = require('node:test');
const assert = require('node:assert/strict');
const TT = require('../tempo-core.js');

const m44 = TT.meterByKey('4-4'), m68 = TT.meterByKey('6-8'), m38 = TT.meterByKey('3-8'), m78 = TT.meterByKey('7-8'), m22 = TT.meterByKey('2-2');

test('beat note and bar length per meter', () => {
  assert.equal(TT.beatUnits(m44), 48);
  assert.equal(TT.beatUnits(m68), 72);
  assert.equal(TT.beatUnits(m22), 96);
  assert.equal(TT.beatUnits(m78), 24);
  assert.equal(TT.barUnits(m44), 192);
  assert.equal(TT.barUnits(m68), 144);
  assert.equal(TT.defaultValueFor(m68), 'dottedQuarter');
});

test('tempo starts at 96 BPM, within 30 to 300', () => {
  assert.equal(TT.BPM_DEFAULT, 96);
  assert.equal(TT.clampBPM(10), 30);
  assert.equal(TT.clampBPM(400), 300);
});

test('80 ms rule: a 64th in 4/4 times up to 46 BPM', () => {
  assert.equal(TT.isTooFast(46, m44, 3), false);
  assert.equal(TT.isTooFast(47, m44, 3), true);
  assert.equal(TT.isTooFast(300, m44, 48), false);
});

test('every click: triplets in threes, leftover becomes one rest, 32-item cap', () => {
  const t44 = TT.everyClickBar(m44, 'tripletEighth');
  assert.equal(t44.length, 12);
  const t38 = TT.everyClickBar(m38, 'tripletEighth');
  assert.deepEqual(t38.map((e) => [e.units, e.rest]), [[16, false], [16, false], [16, false], [24, true]]);
  assert.equal(TT.everyClickFits(m44, 'thirtySecond'), true); // 32 clicks
  assert.equal(TT.everyClickFits(m44, 'sixtyFourth'), false); // 64 clicks
  assert.equal(TT.everyClickFits(m38, 'whole'), false);
});

test('build a bar: room left, four bars, rests only after the bar', () => {
  const half = { kind: 'note', id: 'half' }, dq = { kind: 'note', id: 'dottedQuarter' };
  let tiles = [dq];
  assert.deepEqual(TT.canAdd(tiles, [], m44, 120, { kind: 'note', id: 'dottedHalf' }, 'bar'), { ok: false, reason: 'Only 5/8 left in bar 1' });
  tiles = [half, half, half, half, half, half];
  assert.equal(TT.canAdd(tiles, [], m44, 120, half, 'bar').ok, true); // bar 4 has room
  tiles = tiles.concat([half, half]);
  assert.deepEqual(TT.canAdd(tiles, [], m44, 120, half, 'bar'), { ok: false, reason: 'The bars are full' });
  assert.equal(TT.canAdd([half], [], m44, 120, half, 'after').ok, false);
  assert.equal(TT.canAdd([half], [], m44, 120, { kind: 'rest', id: 'quarter' }, 'after').ok, true);
  assert.equal(TT.canAdd([], [], m44, 300, { kind: 'note', id: 'thirtySecond' }, 'bar').ok, false);
});

test('build a bar: 64 items, four bars of 16ths', () => {
  const s16 = { kind: 'note', id: 'sixteenth' };
  const tiles = Array(63).fill(s16);
  assert.equal(TT.canAdd(tiles, [], m44, 60, s16, 'bar').ok, true);
  assert.deepEqual(TT.canAdd(tiles.concat([s16]), [], m44, 60, s16, 'bar'), { ok: false, reason: 'The bars are full' });
  assert.deepEqual(TT.canAdd(tiles.concat([s16]), [], m44, 60, { kind: 'rest', id: 'quarter' }, 'after'), { ok: false, reason: 'The bars hold 64 items' });
});

test('build a bar: last bar padded with rests, after-rests join it', () => {
  const bars = TT.builderBars([{ kind: 'note', id: 'dottedQuarter' }], [{ kind: 'rest', id: 'eighth' }], m44);
  assert.equal(bars.length, 1);
  assert.deepEqual(bars[0].map((e) => [e.units, e.rest]), [[72, false], [96, true], [24, true], [24, true]]);
  const groups = TT.builderBars([{ kind: 'group', id: 'eighthTriplet' }], [], m44);
  assert.equal(groups[0].filter((e) => !e.rest).length, 3);
});

test('meter change trims from the end, presets fit one bar', () => {
  const q = { kind: 'note', id: 'quarter' };
  assert.equal(TT.trimToMeter([q, q, q, q], m38).length, 1); // a quarter leaves 1/8 in a 3/8 bar; the next quarter would cross the bar line
  assert.equal(TT.trimToMeter([q, q, q, q], m44).length, 4);
  assert.equal(TT.trimToMeter(Array(20).fill(q), m44).length, 16); // four bars of quarters
  assert.equal(TT.presetTiles(TT.PRESETS[0], m38).length, 1);
  assert.equal(TT.presetTiles(TT.PRESETS[0], m44).length, 6);
});

test('click buffers: 60 ms, normal peak 0.6, accent louder, ends at 0', () => {
  const { normal, accent } = TT.clickBuffers(48000);
  assert.equal(normal.length, 2880);
  assert.ok(Math.abs(TT.peak(normal) - 0.6) < 1e-6);
  const db = 20 * Math.log10(TT.rms(accent) / TT.rms(normal));
  assert.ok(db > 3 && db <= 4.01, 'accent ' + db.toFixed(2) + ' dB');
  assert.ok(Math.abs(normal[normal.length - 1]) < 1e-9);
});

test('YIN finds A4 and a cello C2, refuses silence', () => {
  const sr = 48000;
  const tone = (f) => Float32Array.from({ length: 4096 }, (_, i) => 0.3 * Math.sin((2 * Math.PI * f * i) / sr) + 0.1 * Math.sin((4 * Math.PI * f * i) / sr));
  const a = TT.yin(tone(440), sr);
  assert.ok(Math.abs(a.frequency - 440) < 0.5);
  assert.ok(a.confidence > 0.9);
  const c = TT.yin(tone(65.41), sr);
  assert.ok(Math.abs(c.frequency - 65.41) < 0.2);
  assert.equal(TT.yin(new Float32Array(4096), sr), null);
});

test('gate opens at -45 dBFS and holds to -50', () => {
  assert.equal(TT.gatePasses(-47, false, true), false);
  assert.equal(TT.gatePasses(-47, true, true), true);
  assert.equal(TT.gatePasses(-51, true, true), false);
  assert.equal(TT.gatePasses(-80, false, false), true);
});

test('note names: white keys by letter, black keys as the sharp-first pair', () => {
  assert.deepEqual(TT.spellMidi(69), { text: 'A', octave: 4 });
  assert.deepEqual(TT.spellMidi(61), { text: 'C♯/D♭', octave: 4 });
  assert.deepEqual(TT.spellMidi(36), { text: 'C', octave: 2 });
});

test('nearest note and cents', () => {
  const n = TT.nearest(440 * 2 ** (12 / 1200));
  assert.equal(n.midi, 69);
  assert.ok(Math.abs(n.cents - 12) < 1e-6);
});

test('onset detector fires once on a note attack after the warm-up', () => {
  const sr = 48000;
  const det = TT.createOnsetDetector(sr);
  const s = new Float32Array(sr); // 1 s
  for (let i = Math.round(0.5 * sr); i < sr; i++) s[i] = 0.3 * Math.sin((2 * Math.PI * 440 * i) / sr);
  for (let i = 0; i < s.length; i++) s[i] += 1e-4 * Math.sin(i * 12.9898) ; // a little noise floor
  const found = [];
  for (let k = 0; k < s.length; k += 1024) found.push(...TT.onsetProcess(det, s.subarray(k, k + 1024), k / sr));
  assert.equal(found.length, 1);
  assert.ok(Math.abs(found[0] - 0.5) < 0.01, 'onset at ' + found[0]);
});

test('played filter needs a pitched moment within -100 to +120 ms', () => {
  assert.equal(TT.isPlayed(1.0, [1.11]), true);
  assert.equal(TT.isPlayed(1.0, [0.89]), false);
  assert.equal(TT.isPlayed(1.0, [1.13]), false);
});

test('pairing keeps order and chooses least offset; bar grade counts extras', () => {
  const clicks = [0, 0.5, 1.0, 1.5].map((t) => ({ t, interval: 0.5, rest: false }));
  const bar = { start: 0, end: 2.0, clicks };
  const onsets = [0.01, 0.48, 1.02, 1.5];
  const g = TT.gradeBar(bar, onsets, 5);
  assert.equal(g.total, 4);
  assert.equal(g.hitCount, 4);
  assert.equal(g.isHit, true);
  assert.deepEqual(g.offsets.map((o) => Math.round(o)), [2, -4, 4, 0]);
  const g2 = TT.gradeBar(bar, onsets.concat([1.25]).sort((a, b) => a - b), 5);
  assert.equal(g2.extra, 1);
  assert.equal(g2.isHit, false);
  const late = TT.gradeBar(bar, [0.04, 0.5, 1.0, 1.5], 5);
  assert.equal(late.hitCount, 3);
  // rests are not expected
  const rb = { start: 0, end: 2, clicks: [{ t: 0, interval: 1, rest: true }, { t: 1, interval: 1, rest: false }] };
  assert.equal(TT.gradeBar(rb, [1.0], 5).total, 1);
  assert.equal(TT.gradeBar({ start: 0, end: 1, clicks: [{ t: 0, interval: 1, rest: true }] }, [], 5), null);
});

test('timing text: hits, mean after 4 marks, 80th percentile spread', () => {
  const bars = [{ offsets: [2, -4, 4, 0], hitCount: 4, total: 4 }];
  assert.deepEqual(TT.timingStats(bars).lines, ['4 of 4 clicks hit', 'on average 1 % late', 'most notes within ±4 %']);
  assert.deepEqual(TT.timingStats([{ offsets: [1], hitCount: 1, total: 4 }]).lines, ['1 of 4 clicks hit', 'Figures for timing appear after 4 played notes.']);
  assert.equal(TT.timingStats([{ offsets: [-1, 1, 0, 0], hitCount: 4, total: 4 }]).lines[1], 'on average on the beat');
});

test('streak counts bars in a row and keeps the best', () => {
  const s = TT.createStreak();
  [true, true, false, true].forEach((h) => TT.streakRecord(s, h));
  assert.deepEqual(s, { current: 1, best: 2 });
});

test('calibration: median gap, needs 12 pairs and a tight spread', () => {
  const clicks = Array.from({ length: 16 }, (_, i) => i * 0.5);
  const ok = TT.calibrate(clicks, clicks.map((c, i) => c + 0.042 + (i % 3) * 0.001));
  assert.equal(ok.ok, true);
  assert.equal(ok.latencyMs, 43);
  assert.equal(TT.calibrate(clicks, clicks.slice(0, 8).map((c) => c + 0.04)).ok, false);
  assert.equal(TT.calibrate(clicks, clicks.map((c, i) => c + 0.04 + (i % 2) * 0.02)).ok, false);
});

test('text helpers', () => {
  assert.equal(TT.formatElapsed(12.34), '12.3 s');
  assert.equal(TT.formatElapsed(75), '1:15');
  assert.equal(TT.centsText(-7.4), '−7 cents');
  assert.equal(TT.centsText(0.2), '0 cents');
  assert.equal(TT.fraction(72), '3/8');
});
