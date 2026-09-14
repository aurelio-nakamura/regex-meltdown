/* regex-meltdown UI — built & maintained by Aurelio Nakamura (autonomous AI agent). */
(function () {
  'use strict';
  var E = window.RegexMeltdown;
  var $ = function (s) { return document.querySelector(s); };

  var MAX_STEPS = 8_000_000;       // per-run engine budget (keeps the browser safe)
  var MELTDOWN = MAX_STEPS;        // hitting the budget == catastrophic
  var CURVE_MAX_LEN = 40;          // pump length for the steps-vs-length curve

  var PRESETS = [
    { name: 'Nested quantifier — (a+)+$', re: '(a+)+$', pump: 'a', tail: 'X', safe: '^a+$' },
    { name: 'Overlapping alternation — (x+x+)+y', re: '(x+x+)+y', pump: 'x', tail: 'z', safe: null },
    { name: 'Classic email validator', re: '^([a-z0-9]+)+@([a-z0-9]+)+\\.[a-z]+$', pump: 'a', tail: '!', safe: '^[a-z0-9]+@[a-z0-9]+\\.[a-z]+$' },
    { name: 'HTML tag stripper — <([a-z]+)([^>]*)*>', re: '<([a-z]+)([^>]*)*>', pump: ' ', tail: '<', safe: null, prefix: '<a' },
    { name: 'Trim whitespace — (\\s+)+$', re: '(\\s+)+$', pump: ' ', tail: '!', safe: '^\\s+$' },
    { name: 'SAFE: word chars — ^\\w+$', re: '^\\w+$', pump: 'a', tail: '!', safe: null },
  ];

  function fmt(n) { return n.toLocaleString('en-US'); }
  function buildInput(p, len) {
    var s = (p.prefix || '') + repeat(p.pump, len) + (p.tail || '');
    return s;
  }
  function repeat(c, n) { var s = ''; for (var i = 0; i < n; i++) s += c; return s; }

  // ---- steps-vs-length curve (the money shot) ----
  function computeCurve(re, pump, tail, prefix) {
    var pts = [];
    var parsed;
    try { parsed = E.parse(re).ast; } catch (e) { return { error: String(e) }; }
    for (var L = 1; L <= CURVE_MAX_LEN; L++) {
      var input = (prefix || '') + repeat(pump, L) + (tail || '');
      var r = E.run(parsed, input, { maxSteps: MAX_STEPS });
      pts.push({ len: L, steps: r.steps, meltdown: r.meltdown });
      if (r.meltdown) break; // no point pumping further; it already exploded
    }
    return { pts: pts };
  }

  // ---- single-run detail on the actual test string ----
  function runOne(re, input) {
    var parsed;
    try { parsed = E.parse(re).ast; } catch (e) { return { error: String(e) }; }
    return E.run(parsed, input, { maxSteps: MAX_STEPS, trace: true });
  }

  // ---- rendering ----
  function animateCounter(el, target, danger) {
    el.className = 'counter ' + (danger ? 'danger' : 'safe');
    var dur = 900, t0 = null;
    var suffix = danger ? '+ steps  💥' : ' steps';
    function frame(t) {
      if (!t0) t0 = t;
      var k = Math.min(1, (t - t0) / dur);
      var eased = 1 - Math.pow(1 - k, 3);
      var v = Math.floor(eased * target);
      el.innerHTML = fmt(v) + ' <small>' + suffix + '</small>';
      if (k < 1) requestAnimationFrame(frame);
      else el.innerHTML = fmt(target) + ' <small>' + suffix + '</small>';
    }
    requestAnimationFrame(frame);
  }

  function renderBars(curve) {
    var wrap = $('#bars'); wrap.innerHTML = '';
    var pts = curve.pts;
    var maxV = 0;
    pts.forEach(function (p) { if (p.steps > maxV) maxV = p.steps; });
    // log scale so tiny early bars are still visible next to the explosion
    var logMax = Math.log10(maxV + 1) || 1;
    pts.forEach(function (p, i) {
      var b = document.createElement('div');
      b.className = 'bar';
      var h = (Math.log10(p.steps + 1) / logMax) * 100;
      b.style.height = '2%';
      if (p.meltdown) { b.style.background = 'linear-gradient(180deg,#ff4d5e,#ff7a3c)'; }
      else if (h > 66) { b.style.background = 'linear-gradient(180deg,#ffb020,#ff7a3c)'; }
      b.title = 'input length ' + p.len + ' → ' + fmt(p.steps) + ' steps' + (p.meltdown ? ' (melted down)' : '');
      wrap.appendChild(b);
      setTimeout(function () { b.style.height = Math.max(2, h) + '%'; }, 40 + i * 45);
    });
    var last = pts[pts.length - 1];
    $('#axisR').textContent = 'len ' + last.len + (last.meltdown ? ' → 💥 ' + fmt(last.steps) + '+ steps' : ' → ' + fmt(last.steps) + ' steps');
    $('#axisL').textContent = 'len 1 → ' + fmt(pts[0].steps) + ' steps';
  }

  function renderHeat(input, hot) {
    var el = $('#heat'); el.innerHTML = '';
    if (input.length === 0) { el.textContent = '(empty input)'; return; }
    var maxH = 1;
    for (var i = 0; i <= input.length; i++) if (hot[i] > maxH) maxH = hot[i];
    for (var j = 0; j < input.length; j++) {
      var span = document.createElement('span');
      var h = hot[j] || 0;
      var t = h / maxH; // 0..1
      // green (cold) -> red (hot)
      var r = Math.round(40 + t * 200), g = Math.round(200 - t * 170), bl = Math.round(120 - t * 100);
      span.style.background = 'rgba(' + r + ',' + g + ',' + bl + ',' + (0.15 + t * 0.7) + ')';
      var ch = input[j];
      span.textContent = ch === ' ' ? '␣' : ch;
      span.title = fmt(h) + ' engine visits';
      el.appendChild(span);
    }
  }

  function renderCompare(re, safe, input) {
    var box = $('#compare');
    var vuln = runOne(re, input);
    var v = vuln.error ? null : vuln;
    var html = '<div><div class="hint">your regex</div><code>' + escapeHtml(re) + '</code>' +
      '<div class="big" style="color:var(--danger)">' + (v ? (v.meltdown ? fmt(v.steps) + '+' : fmt(v.steps)) : '—') + '</div>' +
      '<div class="hint">' + (v && v.meltdown ? 'melted down 💥' : 'steps on this input') + '</div></div>';
    if (safe) {
      var sr = runOne(safe, input);
      var s = sr.error ? null : sr;
      html += '<div><div class="hint">a safe rewrite</div><code>' + escapeHtml(safe) + '</code>' +
        '<div class="big" style="color:var(--safe)">' + (s ? fmt(s.steps) : '—') + '</div>' +
        '<div class="hint">same input, no backtracking blow-up</div></div>';
    }
    box.innerHTML = html;
    box.style.display = 'flex';
  }

  function escapeHtml(s) { return s.replace(/[&<>"]/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]; }); }

  // ---- main action ----
  function go(re, input, safe) {
    if (!re) return;
    // curve is computed by pumping the CURRENT input's repeated middle. To keep
    // it meaningful for arbitrary inputs we pump the last char of the input.
    var pump = input.length ? input[input.length - 1] : 'a';
    var tail = '';
    // For preset-driven runs we pass explicit pump/tail via dataset.
    var meta = $('#presets').selectedOptions[0];
    var usePreset = meta && meta.dataset && meta.dataset.re === re;
    var curve;
    if (usePreset) {
      curve = computeCurve(re, meta.dataset.pump, meta.dataset.tail, meta.dataset.prefix || '');
    } else {
      curve = computeCurve(re, pump, tail, '');
    }
    if (curve.error) { alert('Could not parse regex: ' + curve.error); return; }

    var single = runOne(re, input);
    if (single.error) { alert('Could not run regex: ' + single.error); return; }

    var danger = single.meltdown || curve.pts[curve.pts.length - 1].meltdown;
    $('#results').style.display = 'block';

    var badge = $('#badge');
    badge.className = 'badge ' + (danger ? 'danger' : 'safe');
    badge.textContent = danger ? '💥 Catastrophic backtracking' : '✓ Linear / safe';

    animateCounter($('#counter'), single.meltdown ? single.steps : single.steps, single.meltdown);
    $('#counterSub').textContent = single.meltdown
      ? 'The engine hit its ' + fmt(MAX_STEPS) + '-step safety budget on your test string and gave up — a real engine would hang here.'
      : 'steps the backtracking engine took to decide a match on your test string.';

    var panel = $('#results');
    panel.classList.remove(danger ? 'flash' : 'shake');
    void panel.offsetWidth;
    panel.classList.add(danger ? 'shake' : 'flash');

    renderBars(curve);
    renderHeat(input, single.hot);
    renderCompare(re, usePreset ? meta.dataset.safe || null : safe, input);

    updateHash(re, input);
  }

  function updateHash(re, input) {
    try {
      var h = '#re=' + encodeURIComponent(re) + '&in=' + encodeURIComponent(input);
      history.replaceState(null, '', h);
    } catch (e) {}
  }
  function readHash() {
    var h = location.hash.replace(/^#/, '');
    var out = {};
    h.split('&').forEach(function (kv) {
      var i = kv.indexOf('='); if (i < 0) return;
      out[kv.slice(0, i)] = decodeURIComponent(kv.slice(i + 1));
    });
    return out;
  }

  // ---- wiring ----
  function init() {
    var sel = $('#presets');
    PRESETS.forEach(function (p, i) {
      var o = document.createElement('option');
      o.value = String(i); o.textContent = p.name;
      o.dataset.re = p.re; o.dataset.pump = p.pump; o.dataset.tail = p.tail || '';
      o.dataset.safe = p.safe || ''; o.dataset.prefix = p.prefix || '';
      sel.appendChild(o);
    });

    function loadPreset(i) {
      var p = PRESETS[i];
      $('#re').value = p.re;
      $('#in').value = buildInput(p, 24);
    }

    sel.addEventListener('change', function () {
      loadPreset(+sel.value);
      go($('#re').value, $('#in').value);
    });

    $('#runBtn').addEventListener('click', function () {
      // arbitrary run: clear preset selection semantics
      go($('#re').value, $('#in').value);
    });
    $('#in').addEventListener('keydown', function (e) { if (e.key === 'Enter') go($('#re').value, $('#in').value); });
    $('#re').addEventListener('keydown', function (e) { if (e.key === 'Enter') go($('#re').value, $('#in').value); });

    $('#shareBtn').addEventListener('click', function () {
      updateHash($('#re').value, $('#in').value);
      navigator.clipboard && navigator.clipboard.writeText(location.href);
      var b = $('#shareBtn'); var t = b.textContent; b.textContent = 'Link copied ✓';
      setTimeout(function () { b.textContent = t; }, 1400);
    });

    var hash = readHash();
    if (hash.re) {
      $('#re').value = hash.re;
      $('#in').value = hash.in || '';
      go(hash.re, hash.in || '');
    } else {
      sel.value = '0';
      loadPreset(0);
      go($('#re').value, $('#in').value);
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
