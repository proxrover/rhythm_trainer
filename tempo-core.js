/* =============================================================================
 * Rhythm Trainer
 * Copyright (c) 2026 Proximity Software Factory LLC. All rights reserved.
 *
 * This file is part of Rhythm Trainer. Proprietary and confidential.
 * Unauthorized copying, modification, or distribution is strictly prohibited.
 * See LICENSE for details.
 * ============================================================================= */
// Rhythm Trainer — pure rules: note values, bar building, click sound, pitch, onsets and grading.
// No DOM, no audio graph, no storage: every function here takes values and returns values, so node's test runner loads it as is.
// Loaded by index.html as a classic script (works from file://) and by tests via require().
(function (root) {
  'use strict';

  // ---------- Units and note values (192 units per whole note) ----------
  const UNITS_PER_WHOLE = 192;
  const MAX_ITEMS = 32;
  const MAX_BARS = 4;
  const MAX_BUILDER_ITEMS = 64; // four bars of 16ths; Every click keeps MAX_ITEMS per bar
  const MAX_AFTER_RESTS = 4;
  const MIN_TIMED_INTERVAL = 0.08; // s, the 80 ms rule
  const BPM_MIN = 30, BPM_MAX = 300, BPM_DEFAULT = 96;

  // id, title, units, group size (triplet eighth clicks in threes)
  const NOTE_VALUES = [
    { id: 'whole', title: 'Whole', units: 192, group: 1 },
    { id: 'half', title: 'Half', units: 96, group: 1 },
    { id: 'dottedHalf', title: 'Dotted half', units: 144, group: 1 },
    { id: 'quarter', title: 'Quarter', units: 48, group: 1 },
    { id: 'dottedQuarter', title: 'Dotted quarter', units: 72, group: 1 },
    { id: 'eighth', title: 'Eighth', units: 24, group: 1 },
    { id: 'dottedEighth', title: 'Dotted 8th', units: 36, group: 1 },
    { id: 'sixteenth', title: '16th', units: 12, group: 1 },
    { id: 'dottedSixteenth', title: 'Dotted 16th', units: 18, group: 1 },
    { id: 'thirtySecond', title: '32nd', units: 6, group: 1 },
    { id: 'sixtyFourth', title: '64th', units: 3, group: 1 },
    { id: 'tripletEighth', title: 'Triplet 8th', units: 16, group: 3 },
  ];
  const valueById = (id) => NOTE_VALUES.find((v) => v.id === id);

  // Time signatures (TheoryKit Meter.all): top, bottom, beat groups in the meter's own unit.
  const METERS = [
    { top: 2, bottom: 4, beats: [1, 1] },
    { top: 3, bottom: 4, beats: [1, 1, 1] },
    { top: 4, bottom: 4, beats: [1, 1, 1, 1] },
    { top: 2, bottom: 2, beats: [1, 1] },
    { top: 3, bottom: 8, beats: [1, 1, 1] },
    { top: 6, bottom: 8, beats: [3, 3] },
    { top: 9, bottom: 8, beats: [3, 3, 3] },
    { top: 12, bottom: 8, beats: [3, 3, 3, 3] },
    { top: 5, bottom: 4, beats: [3, 2] },
    { top: 7, bottom: 8, beats: [2, 2, 3] },
  ];
  const meterKey = (m) => m.top + '-' + m.bottom;
  const meterByKey = (k) => METERS.find((m) => meterKey(m) === k);
  const barUnits = (m) => (m.top * UNITS_PER_WHOLE) / m.bottom;
  const isUniform = (m) => m.beats.every((b) => b === m.beats[0]);
  // The note the BPM counts (ClickNote.beatNote): group size over bottom in a uniform meter, 1/bottom otherwise.
  function beatUnits(m) {
    return isUniform(m) ? (m.beats[0] * UNITS_PER_WHOLE) / m.bottom : UNITS_PER_WHOLE / m.bottom;
  }
  const secondsPerUnit = (bpm, m) => 60 / bpm / beatUnits(m);
  const clickInterval = (bpm, m, units) => units * secondsPerUnit(bpm, m);
  const isTooFast = (bpm, m, units) => clickInterval(bpm, m, units) < MIN_TIMED_INTERVAL;
  const clampBPM = (b) => Math.max(BPM_MIN, Math.min(BPM_MAX, Math.round(b)));

  function gcd(a, b) { while (b) { [a, b] = [b, a % b]; } return a; }
  // "3/8", "1/4": a length as a part of a whole note (not a time signature).
  function fraction(units) {
    const g = gcd(units, UNITS_PER_WHOLE);
    return units / g + '/' + UNITS_PER_WHOLE / g;
  }

  // ---------- Every click (ClickNote.fits, PlayedBar.everyClick) ----------
  function everyClickBar(m, valueId) {
    const v = valueById(valueId);
    const bu = barUnits(m);
    const clicks = Math.floor(bu / (v.units * v.group)) * v.group;
    const entries = [];
    for (let i = 0; i < clicks; i++) entries.push({ units: v.units, rest: false, value: v.id });
    const left = bu - clicks * v.units;
    if (left > 0) entries.push({ units: left, rest: true, value: null });
    return entries;
  }
  function everyClickFits(m, valueId) {
    const v = valueById(valueId);
    if (v.units > barUnits(m)) return false;
    const n = everyClickBar(m, valueId).length;
    return n >= 1 && n <= MAX_ITEMS && everyClickBar(m, valueId).some((e) => !e.rest);
  }
  function defaultValueFor(m) {
    const bu = beatUnits(m);
    const v = NOTE_VALUES.find((x) => x.units === bu && x.group === 1);
    return v ? v.id : 'quarter';
  }

  // ---------- Build a bar ----------
  const GROUPS = [
    { id: 'beamedEighths', title: 'Two beamed eighths', parts: [24, 24] },
    { id: 'beamedSixteenths', title: 'Four beamed 16ths', parts: [12, 12, 12, 12] },
    { id: 'eighthTriplet', title: 'Eighth-note triplet', parts: [16, 16, 16] },
  ];
  const SINGLE_TILES = NOTE_VALUES.filter((v) => v.group === 1);
  const REMAINDER_RESTS = [192, 96, 72, 48, 24, 12, 6, 3];

  // A tile: { kind: 'note'|'rest'|'group', id }. Its parts in units.
  function tileParts(tile) {
    if (tile.kind === 'group') return GROUPS.find((g) => g.id === tile.id).parts;
    return [valueById(tile.id).units];
  }
  const tileUnits = (tile) => tileParts(tile).reduce((a, b) => a + b, 0);

  // Split the flat tile list into bars that each fill to the bar line.
  function splitBars(tiles, m) {
    const bu = barUnits(m);
    const bars = [[]];
    let used = 0;
    for (const t of tiles) {
      if (used === bu) { bars.push([]); used = 0; }
      bars[bars.length - 1].push(t);
      used += tileUnits(t);
    }
    return { bars, lastUsed: used };
  }
  function remainderRests(units) {
    const out = [];
    let left = units;
    for (const r of REMAINDER_RESTS) while (left >= r) { out.push(r); left -= r; }
    return out;
  }
  function builderItemCount(tiles, after, m) {
    let n = 0;
    for (const t of tiles) n += tileParts(t).length;
    const { lastUsed } = splitBars(tiles, m);
    if (tiles.length && lastUsed < barUnits(m)) n += remainderRests(barUnits(m) - lastUsed).length;
    return n + after.length;
  }
  // Whether a tile can be added; returns { ok, reason }.
  function canAdd(tiles, after, m, bpm, tile, target) {
    if (target === 'after') {
      if (tile.kind !== 'rest') return { ok: false, reason: 'Only rests go after the bar' };
      if (after.length >= MAX_AFTER_RESTS) return { ok: false, reason: 'After the bar holds ' + MAX_AFTER_RESTS + ' rests' };
      if (builderItemCount(tiles, after.concat([tile]), m) > MAX_BUILDER_ITEMS) return { ok: false, reason: 'The bars hold ' + MAX_BUILDER_ITEMS + ' items' };
      return { ok: true };
    }
    const bu = barUnits(m);
    const { bars, lastUsed } = splitBars(tiles, m);
    const full = tiles.length > 0 && lastUsed === bu;
    if (full && bars.length >= MAX_BARS) return { ok: false, reason: 'The bars are full' };
    const room = full ? bu : bu - lastUsed;
    const barNo = full ? bars.length + 1 : Math.max(1, bars.length);
    const u = tileUnits(tile);
    if (u > room) return { ok: false, reason: 'Only ' + fraction(room) + ' left in bar ' + barNo };
    if (tile.kind !== 'rest' && tileParts(tile).some((p) => isTooFast(bpm, m, p))) {
      return { ok: false, reason: 'Too fast to time at ' + bpm + ' BPM' };
    }
    if (builderItemCount(tiles.concat([tile]), after, m) > MAX_BUILDER_ITEMS) return { ok: false, reason: 'The bars hold ' + MAX_BUILDER_ITEMS + ' items' };
    return { ok: true };
  }
  // A meter change trims from the end, groups whole.
  function trimToMeter(tiles, m) {
    const kept = tiles.slice();
    const bu = barUnits(m);
    const fits = (ts) => {
      let used = 0, bars = 1;
      for (const t of ts) {
        const u = tileUnits(t);
        if (used === bu) { bars++; used = 0; }
        if (u > bu - used) return false;
        used += u;
      }
      return bars <= MAX_BARS;
    };
    while (kept.length && !fits(kept)) kept.pop();
    return kept;
  }
  // The bars as entries ready for the scheduler: each bar a list of { units, rest }; after-rests join the last bar.
  function builderBars(tiles, after, m) {
    const bu = barUnits(m);
    const { bars, lastUsed } = splitBars(tiles, m);
    if (!tiles.length) return [];
    const out = bars.map((b) => {
      const es = [];
      for (const t of b) for (const p of tileParts(t)) es.push({ units: p, rest: t.kind === 'rest', tile: t });
      return es;
    });
    const last = out[out.length - 1];
    if (lastUsed < bu) for (const r of remainderRests(bu - lastUsed)) last.push({ units: r, rest: true, auto: true });
    for (const t of after) last.push({ units: tileUnits(t), rest: true, after: true, tile: t });
    return out;
  }
  const PRESETS = [
    { title: '3/8 + five 1/8', tiles: ['dottedQuarter', 'eighth', 'eighth', 'eighth', 'eighth', 'eighth'].map((id) => ({ kind: 'note', id })) },
    { title: '3/8 1/8 1/2', tiles: ['dottedQuarter', 'eighth', 'half'].map((id) => ({ kind: 'note', id })) },
    { title: '3/8 3/8 1/4', tiles: ['dottedQuarter', 'dottedQuarter', 'quarter'].map((id) => ({ kind: 'note', id })) },
    { title: '1/4 rest + three 1/4', tiles: [{ kind: 'rest', id: 'quarter' }].concat(['quarter', 'quarter', 'quarter'].map((id) => ({ kind: 'note', id }))) },
  ];
  // A preset is one bar in the current meter.
  function presetTiles(preset, m) {
    const bu = barUnits(m);
    const out = [];
    let used = 0;
    for (const t of preset.tiles) { const u = tileUnits(t); if (used + u > bu) break; out.push(t); used += u; }
    return out;
  }

  // ---------- Click synthesis ----------
  function splitmix(seed) {
    let s = BigInt.asUintN(64, BigInt(seed));
    return function () {
      s = BigInt.asUintN(64, s + 0x9E3779B97F4A7C15n);
      let z = s;
      z = BigInt.asUintN(64, (z ^ (z >> 30n)) * 0xBF58476D1CE4E5B9n);
      z = BigInt.asUintN(64, (z ^ (z >> 27n)) * 0x94D049BB133111EBn);
      z = z ^ (z >> 31n);
      return Number(z >> 11n) / 2 ** 53 * 2 - 1;
    };
  }
  function rawClick(sr, accent) {
    const n = Math.round(0.06 * sr);
    const burst = Math.max(2, Math.round(0.0015 * sr));
    const rnd = splitmix(0x5EEDC11C);
    const x = new Float64Array(n);
    for (let i = 0; i < burst; i++) x[i] = rnd() * 0.5 * (1 - Math.cos((2 * Math.PI * i) / (burst - 1)));
    const shift = accent ? 1.25 : 1;
    const decay = accent ? 0.014 : 0.012;
    const out = new Float64Array(n);
    for (const [f, gain] of [[900, 1.0], [2400, 0.6]]) {
      const r = Math.exp(-1 / (decay * sr));
      const w = (2 * Math.PI * f * shift) / sr;
      const a1 = -2 * r * Math.cos(w), a2 = r * r, b0 = (1 - r * r) * gain;
      let y1 = 0, y2 = 0;
      for (let i = 0; i < n; i++) {
        const xin = x[i] - (i >= 2 ? x[i - 2] : 0);
        const y = b0 * xin - a1 * y1 - a2 * y2;
        y2 = y1; y1 = y; out[i] += y;
      }
    }
    const fade = Math.round(0.025 * sr);
    for (let i = 0; i < fade; i++) {
      const t = fade > 1 ? i / (fade - 1) : 1;
      out[n - fade + i] *= 0.5 * (1 + Math.cos(Math.PI * t));
    }
    return out;
  }
  const peak = (a) => a.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
  const rms = (a) => Math.sqrt(a.reduce((s, v) => s + v * v, 0) / a.length);
  function clickBuffers(sr) {
    const normal = rawClick(sr, false);
    const ns = 0.6 / peak(normal);
    for (let i = 0; i < normal.length; i++) normal[i] *= ns;
    const accent = rawClick(sr, true);
    let g = (rms(normal) * 10 ** (4 / 20)) / rms(accent);
    g = Math.min(g, 0.95 / peak(accent));
    for (let i = 0; i < accent.length; i++) accent[i] *= g;
    return { normal: Float32Array.from(normal), accent: Float32Array.from(accent) };
  }

  // ---------- YIN pitch detector ----------
  function yin(buf, sr) {
    const tauMin = Math.max(2, Math.floor(sr / 2000));
    const tauMax = Math.ceil(sr / 50);
    if (buf.length < 2 * tauMax) return null;
    let s = 0;
    for (let i = 0; i < buf.length; i++) s += buf[i] * buf[i];
    const level = Math.sqrt(s / buf.length);
    if (level < 1e-4) return null;
    const W = buf.length - tauMax;
    const d = new Float64Array(tauMax + 1);
    for (let tau = 1; tau <= tauMax; tau++) {
      let sum = 0;
      for (let i = 0; i < W; i++) { const df = buf[i] - buf[i + tau]; sum += df * df; }
      d[tau] = sum;
    }
    const dn = new Float64Array(tauMax + 1);
    dn[0] = 1;
    let run = 0;
    for (let tau = 1; tau <= tauMax; tau++) { run += d[tau]; dn[tau] = run > 0 ? (d[tau] * tau) / run : 1; }
    let tau = -1;
    for (let t = tauMin; t < tauMax; t++) {
      if (dn[t] < 0.1) { while (t + 1 < tauMax && dn[t + 1] < dn[t]) t++; tau = t; break; }
    }
    if (tau < 0) {
      let best = tauMin;
      for (let t = tauMin; t < tauMax; t++) if (dn[t] < dn[best]) best = t;
      tau = best;
    }
    if (tau >= tauMax - 1) return null;
    let offset = 0;
    const a = dn[tau - 1], b = dn[tau], c = dn[tau + 1];
    const den = a - 2 * b + c;
    if (den !== 0) offset = Math.max(-1, Math.min(1, (0.5 * (a - c)) / den));
    const confidence = Math.max(0, Math.min(1, 1 - dn[tau]));
    if (confidence < 0.1) return null;
    return { frequency: sr / (tau + offset), confidence, dbfs: 20 * Math.log10(level) };
  }

  // ---------- Pitch, cents, tolerance ----------
  const midiFloat = (f, refA = 440) => 69 + 12 * Math.log2(f / refA);
  function nearest(f, refA = 440) {
    const mf = midiFloat(f, refA);
    const midi = Math.round(mf);
    return { midi, pc: ((midi % 12) + 12) % 12, cents: (mf - midi) * 100 };
  }
  const PITCH_TOLERANCES = [10, 15, 20];
  const HIT_TOLERANCES = [5, 10, 15];

  // Background gate (TunerViewModel): open at -45 dBFS, hold down to -50 dBFS once a note shows.
  const GATE_OPEN_DBFS = -45, GATE_RELEASE_DBFS = -50;
  function gatePasses(dbfs, showing, gateOn) {
    if (!gateOn) return true;
    return dbfs >= (showing ? GATE_RELEASE_DBFS : GATE_OPEN_DBFS);
  }

  // ---------- Note names ----------
  // White keys by letter, black keys as the sharp-first pair ("C♯/D♭").
  const SHARP_NAMES = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];
  const FLAT_NAMES = ['C', 'D♭', 'D', 'E♭', 'E', 'F', 'G♭', 'G', 'A♭', 'A', 'B♭', 'B'];
  function spellMidi(midi) {
    const pc = ((midi % 12) + 12) % 12;
    const text = SHARP_NAMES[pc] === FLAT_NAMES[pc] ? SHARP_NAMES[pc] : SHARP_NAMES[pc] + '/' + FLAT_NAMES[pc];
    return { text, octave: Math.floor(midi / 12) - 1 };
  }

  // ---------- Onset detector: the power half of StreamingOnsetDetector ----------
  function createOnsetDetector(sr) {
    const win = Math.round(0.02 * sr);
    const hop = Math.max(1, Math.round(sr / 1000));
    const rc = 1 / (2 * Math.PI * 50), dt = 1 / sr, alpha = rc / (rc + dt);
    return {
      sr, win, hop, alpha,
      ring: new Float64Array(win), ringPos: 0, sum: 0, prevX: 0, prevY: 0,
      count: 0, hist: [], armed: true, lastFire: -1, startT: null,
    };
  }
  // samples: Float32Array; t0: time of samples[0] in seconds. Returns onset times found in this chunk.
  function onsetProcess(det, samples, t0) {
    if (det.startT === null) det.startT = t0;
    const found = [];
    for (let i = 0; i < samples.length; i++) {
      const x = samples[i];
      const y = det.alpha * (det.prevY + x - det.prevX);
      det.prevX = x; det.prevY = y;
      const sq = y * y;
      det.sum += sq - det.ring[det.ringPos];
      det.ring[det.ringPos] = sq;
      det.ringPos = (det.ringPos + 1) % det.win;
      det.count++;
      if (det.count % det.hop !== 0) continue;
      const t = t0 + i / det.sr;
      const P = Math.max(0, det.sum / det.win);
      det.hist.push({ t, P });
      if (det.hist.length > 120) det.hist.shift();
      const h = det.hist, L = h.length;
      if (t - det.startT < 0.3 || L < 61) continue;
      let ref = Infinity;
      for (let k = L - 61; k <= L - 6; k++) ref = Math.min(ref, h[k].P);
      ref = Math.max(ref, 1e-12);
      if (!det.armed) {
        if (t - det.lastFire >= 0.06 && P < 2.5 * ref) det.armed = true;
        continue;
      }
      if (P >= 5 * ref && P >= 1e-7) {
        let k = L - 1;
        while (k > 0 && L - 1 - k < 40 && h[k - 1].P < h[k].P && h[k - 1].P > 1.5 * ref) k--;
        found.push(h[k].t);
        det.armed = false;
        det.lastFire = t;
      }
    }
    return found;
  }

  // ---------- Hit grading ----------
  const RANGE_PERCENT = 25;
  // A played onset needs a pitched moment within [onset - 100 ms, onset + 120 ms].
  function isPlayed(onset, pitchedTimes) {
    return pitchedTimes.some((p) => p >= onset - 0.1 && p <= onset + 0.12);
  }
  // clicks: [{ t, interval }] sounding, in order; onsets: sorted times. Order-preserving pairing, most pairs, then least total |offset %|.
  function pairInOrder(clicks, onsets) {
    const n = clicks.length, m = onsets.length;
    const off = (i, j) => ((onsets[j] - clicks[i].t) / clicks[i].interval) * 100;
    // dp[i][j] = [pairs, -cost] best for first i clicks, first j onsets
    const dp = Array.from({ length: n + 1 }, () => Array.from({ length: m + 1 }, () => [0, 0]));
    const better = (a, b) => a[0] > b[0] || (a[0] === b[0] && a[1] > b[1] + 1e-12);
    for (let i = 1; i <= n; i++) {
      for (let j = 1; j <= m; j++) {
        let best = better(dp[i - 1][j], dp[i][j - 1]) ? dp[i - 1][j] : dp[i][j - 1];
        const o = off(i - 1, j - 1);
        if (Math.abs(o) <= RANGE_PERCENT) {
          const cand = [dp[i - 1][j - 1][0] + 1, dp[i - 1][j - 1][1] - Math.abs(o)];
          if (better(cand, best)) best = cand;
        }
        dp[i][j] = best;
      }
    }
    const pairs = [];
    let i = n, j = m;
    while (i > 0 && j > 0) {
      const o = off(i - 1, j - 1);
      const d = dp[i - 1][j - 1];
      if (Math.abs(o) <= RANGE_PERCENT && dp[i][j][0] === d[0] + 1 && Math.abs(dp[i][j][1] - (d[1] - Math.abs(o))) < 1e-9) {
        pairs.unshift({ click: i - 1, onset: j - 1, offset: o }); i--; j--;
      } else if (dp[i][j][0] === dp[i - 1][j][0] && Math.abs(dp[i][j][1] - dp[i - 1][j][1]) < 1e-9) i--;
      else j--;
    }
    return pairs;
  }
  // bar: { start, end, clicks: [{ t, interval, rest }] }; onsets: played, corrected, sorted; used: Set of onset times already paired.
  function gradeBar(bar, onsets, tolerance, used) {
    const sounding = bar.clicks.filter((c) => !c.rest);
    if (!sounding.length) return null;
    const first = sounding[0], last = sounding[sounding.length - 1];
    const lo = first.t - (RANGE_PERCENT / 100) * first.interval;
    const hi = last.t + (RANGE_PERCENT / 100) * last.interval;
    const cand = onsets.filter((o) => o >= lo && o <= hi && !(used && used.has(o)));
    const pairs = pairInOrder(sounding, cand);
    const paired = new Set(pairs.map((p) => cand[p.onset]));
    const offsets = pairs.map((p) => p.offset);
    const hitCount = offsets.filter((o) => Math.abs(o) <= tolerance + 1e-9).length;
    const extra = onsets.filter((o) => o >= bar.start && o < bar.end && !paired.has(o) && !(used && used.has(o))).length;
    return {
      offsets, hitCount, total: sounding.length, extra, paired: [...paired],
      hitClicks: pairs.filter((p) => Math.abs(p.offset) <= tolerance + 1e-9).map((p) => sounding[p.click]),
      isHit: hitCount === sounding.length && extra === 0,
    };
  }
  function percentile(sorted, q) {
    if (!sorted.length) return 0;
    const pos = (sorted.length - 1) * q;
    const lo = Math.floor(pos), hi = Math.ceil(pos);
    return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
  }
  // Text lines for the timing box from the last 16 graded bars.
  function timingStats(bars) {
    const recent = bars.slice(-16);
    const offs = recent.flatMap((b) => b.offsets);
    const hit = recent.reduce((s, b) => s + b.hitCount, 0);
    const total = recent.reduce((s, b) => s + b.total, 0);
    const lines = [];
    if (recent.length) lines.push(hit + ' of ' + total + ' clicks hit');
    if (offs.length >= 4) {
      const mean = offs.reduce((a, b) => a + b, 0) / offs.length;
      const r = Math.round(mean);
      lines.push(r === 0 ? 'on average on the beat' : 'on average ' + Math.abs(r) + ' % ' + (r > 0 ? 'late' : 'early'));
      const spread = percentile(offs.map(Math.abs).sort((a, b) => a - b), 0.8);
      lines.push('most notes within ±' + Math.max(1, Math.ceil(spread)) + ' %');
    } else if (recent.length) {
      lines.push('Figures for timing appear after 4 played notes.');
    }
    return { lines, hit, total, marks: offs.length };
  }
  function createStreak() { return { current: 0, best: 0 }; }
  function streakRecord(s, isHit) { if (isHit) { s.current++; s.best = Math.max(s.best, s.current); } else s.current = 0; }

  // ---------- Latency calibration (loopback) ----------
  // clickTimes: scheduled times; detections: raw onset times. The browser's loop delay is not known beforehand, so each click takes
  // the first detection 0 to 500 ms after it; gaps more than 100 ms from their median are dropped.
  function calibrate(clickTimes, detections) {
    const gaps = [];
    for (const c of clickTimes) {
      const d = detections.find((x) => x >= c && x - c <= 0.5);
      if (d !== undefined) gaps.push((d - c) * 1000);
    }
    if (!gaps.length) return { ok: false, reason: 'No clicks heard', pairs: 0 };
    const s0 = gaps.slice().sort((a, b) => a - b);
    const med0 = percentile(s0, 0.5);
    const kept = gaps.filter((g) => Math.abs(g - med0) <= 100).sort((a, b) => a - b);
    const med = percentile(kept, 0.5);
    const iqr = percentile(kept, 0.75) - percentile(kept, 0.25);
    if (kept.length < 12) return { ok: false, reason: 'Heard ' + kept.length + ' of ' + clickTimes.length + ' clicks; 12 are needed', pairs: kept.length };
    if (iqr > 5) return { ok: false, reason: 'The clicks were heard ' + iqr.toFixed(1) + ' ms apart from each other; 5 ms at most', pairs: kept.length, latencyMs: med };
    return { ok: true, latencyMs: Math.round(med), pairs: kept.length, iqr };
  }

  function formatElapsed(s) {
    if (s < 60) return s.toFixed(1) + ' s';
    const m = Math.floor(s / 60), r = Math.floor(s % 60);
    return m + ':' + String(r).padStart(2, '0');
  }
  function centsText(c) {
    const r = Math.round(c);
    if (r === 0) return '0 cents';
    return (r > 0 ? '+' : '−') + Math.abs(r) + ' cents';
  }

  const api = {
    UNITS_PER_WHOLE, MAX_ITEMS, MAX_BUILDER_ITEMS, MAX_BARS, MAX_AFTER_RESTS, MIN_TIMED_INTERVAL, BPM_MIN, BPM_MAX, BPM_DEFAULT,
    NOTE_VALUES, METERS, GROUPS, SINGLE_TILES, PRESETS,
    PITCH_TOLERANCES, HIT_TOLERANCES, GATE_OPEN_DBFS, GATE_RELEASE_DBFS, RANGE_PERCENT,
    valueById, meterKey, meterByKey, barUnits, beatUnits, secondsPerUnit, clickInterval, isTooFast, clampBPM, fraction,
    everyClickBar, everyClickFits, defaultValueFor,
    tileParts, tileUnits, splitBars, remainderRests, builderItemCount, canAdd, trimToMeter, builderBars, presetTiles,
    rawClick, clickBuffers, peak, rms,
    yin, nearest, gatePasses, spellMidi,
    createOnsetDetector, onsetProcess,
    isPlayed, pairInOrder, gradeBar, percentile, timingStats, createStreak, streakRecord,
    calibrate, formatElapsed, centsText,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.TT = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
