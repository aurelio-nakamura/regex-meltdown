/* regex-meltdown UI — built & maintained by Aurelio Nakamura (autonomous AI agent). */
(function () {
  'use strict';
  var E = window.RegexMeltdown;
  var $ = function (s) { return document.querySelector(s); };

  var MAX_STEPS = 8_000_000;       // per-run engine budget (keeps the browser safe)
  var CURVE_MAX_LEN = 40;          // pump length for the steps-vs-length curve
                                   // (kept modest: the recursive engine recurses per input char)

  // note: HTML-safe short strings; {links} are added below in renderStory.
  var PRESETS = [
    { name: 'Nested quantifier — (a+)+$', re: '(a+)+$', pump: 'a', tail: 'X', safe: '^a+$', ilen: 24 },
    {
      name: '💥 Cloudflare 2019 WAF outage — .*.*=.*',
      re: '.*.*=.*', pump: ' ', tail: '!', safe: null, ilen: 150,
      note: 'On 2 July 2019 a single Web Application Firewall rule containing this shape spiked CPU to 100% across Cloudflare\u2019s global network, knocking large parts of the web offline for ~27 minutes. The catastrophic core is the two adjacent <code>.*</code> before <code>=.*</code>. Note it is <b>polynomial, not exponential</b> \u2014 which is exactly why it looked harmless in review.',
      src: 'https://blog.cloudflare.com/details-of-the-cloudflare-outage-on-july-2-2019/', srcName: 'Cloudflare post-mortem'
    },
    {
      name: '💥 Stack Overflow 2016 outage — \\s+$',
      re: '\\s+$', pump: ' ', tail: '!', safe: null, ilen: 180,
      note: 'On 20 July 2016 a trailing-whitespace trim like this hung Stack Overflow for 34 minutes: one saved post contained ~20,000 consecutive whitespace characters. Quadratic backtracking \u2014 the work grows with the <b>square</b> of the whitespace-run length. There is no cute regex tweak; the real fix was to cap input length.',
      src: 'https://stackstatus.net/post/147710624694/outage-postmortem-july-20-2016', srcName: 'Stack Overflow post-mortem'
    },
    { name: 'Overlapping alternation — (x+x+)+y', re: '(x+x+)+y', pump: 'x', tail: 'z', safe: null, ilen: 24 },
    { name: 'Classic email validator', re: '^([a-z0-9]+)+@([a-z0-9]+)+\\.[a-z]+$', pump: 'a', tail: '!', safe: '^[a-z0-9]+@[a-z0-9]+\\.[a-z]+$', ilen: 24 },
    { name: 'HTML tag stripper — <([a-z]+)([^>]*)*>', re: '<([a-z]+)([^>]*)*>', pump: ' ', tail: '<', safe: null, prefix: '<a', ilen: 24 },
    { name: 'Trim whitespace (nested) — (\\s+)+$', re: '(\\s+)+$', pump: ' ', tail: '!', safe: '^\\s+$', ilen: 24 },
    { name: 'SAFE: word chars — ^\\w+$', re: '^\\w+$', pump: 'a', tail: '!', safe: null, ilen: 24 },
  ];

  function fmt(n) { return n.toLocaleString('en-US'); }
  function buildInput(p, len) {
    return (p.prefix || '') + repeat(p.pump, len) + (p.tail || '');
  }
  function repeat(c, n) { var s = ''; for (var i = 0; i < n; i++) s += c; return s; }

  // ---- steps-vs-length curve (the money shot) ----
  function computeCurve(re, pump, tail, prefix) {
    var pts = [];
    var parsed;
    try { parsed = E.parse(re).ast; } catch (e) { return { error: String(e) }; }
    for (var L = 1; L <= CURVE_MAX_LEN; L++) {
      var input = (prefix || '') + repeat(pump, L) + (tail || '');
      var r;
      try { r = E.run(parsed, input, { maxSteps: MAX_STEPS }); }
      catch (e) { break; } // engine recursion limit on very long inputs — stop sampling
      pts.push({ len: L, steps: r.steps, meltdown: r.meltdown });
      if (r.meltdown) break; // no point pumping further; it already exploded
    }
    return { pts: pts };
  }

  // ---- classify growth from the curve: exponential vs polynomial vs linear ----
  function classify(pts) {
    var meltPt = null;
    for (var i = 0; i < pts.length; i++) { if (pts[i].meltdown) { meltPt = pts[i]; break; } }
    var meltdown = !!meltPt, meltLen = meltPt ? meltPt.len : null;

    var fine = pts.filter(function (p) { return p.steps > 0 && !p.meltdown; });
    var ratios = [];
    for (var k = 1; k < fine.length; k++) {
      if (fine[k].len === fine[k - 1].len + 1 && fine[k - 1].steps > 0) {
        ratios.push(fine[k].steps / fine[k - 1].steps);
      }
    }
    var expRatio = null;
    if (ratios.length >= 5) {
      var tailR = ratios.slice(-8);
      var s = 0; for (var j = 0; j < tailR.length; j++) s += Math.log(tailR[j]);
      expRatio = Math.exp(s / tailR.length); // geometric mean of per-char growth
    }
    // Exponential: growth roughly multiplies with each extra character,
    // or it hit the budget on a tiny (<=60 char) input.
    if ((meltdown && meltLen <= 60) || (expRatio != null && expRatio >= 1.5)) {
      return { cls: 'exp', meltdown: true, meltLen: meltLen };
    }
    // Otherwise fit a power law steps ~ c * len^p by least squares on log-log
    // (robust to the small-input startup transient that biases a 2-point fit).
    var reg = fine.filter(function (p) { return p.len >= 4 && p.steps > 0; });
    var exponent = null, Lhang = null;
    if (reg.length >= 3) {
      var n = reg.length, sx = 0, sy = 0;
      var xs = [], ys = [];
      for (var m = 0; m < n; m++) { xs.push(Math.log(reg[m].len)); ys.push(Math.log(reg[m].steps)); sx += xs[m]; sy += ys[m]; }
      var mx = sx / n, my = sy / n, num = 0, den = 0;
      for (var q = 0; q < n; q++) { num += (xs[q] - mx) * (ys[q] - my); den += (xs[q] - mx) * (xs[q] - mx); }
      if (den > 0) {
        exponent = num / den;
        var hi = reg[reg.length - 1];
        var c = hi.steps / Math.pow(hi.len, exponent);
        if (c > 0 && exponent > 0) Lhang = Math.round(Math.pow(MAX_STEPS / c, 1 / exponent));
      }
    }
    if (exponent != null && exponent >= 1.6) {
      return { cls: 'poly', meltdown: false, exponent: exponent, Lhang: Lhang };
    }
    return { cls: 'safe', meltdown: false, exponent: exponent };
  }

  // ---- single-run detail on the actual test string ----
  function runOne(re, input) {
    var parsed;
    try { parsed = E.parse(re).ast; } catch (e) { return { error: String(e) }; }
    try { return E.run(parsed, input, { maxSteps: MAX_STEPS, trace: true }); }
    catch (e) { return { error: 'input too long for the sandbox engine (try a shorter test string)' }; }
  }

  // ---- rendering ----
  function animateCounter(el, target, cls) {
    el.className = 'counter ' + cls;
    var dur = 900, t0 = null;
    var suffix = cls === 'exp' ? '+ steps  💥' : ' steps';
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
    if (!input || input.length === 0) { el.textContent = '(empty input)'; return; }
    if (!hot) { el.textContent = '(input too long to visualize)'; return; }
    var maxH = 1;
    for (var i = 0; i <= input.length; i++) if (hot[i] > maxH) maxH = hot[i];
    for (var j = 0; j < input.length; j++) {
      var span = document.createElement('span');
      var h = hot[j] || 0;
      var t = h / maxH; // 0..1
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
      var sres = sr.error ? null : sr;
      html += '<div><div class="hint">a safe rewrite</div><code>' + escapeHtml(safe) + '</code>' +
        '<div class="big" style="color:var(--safe)">' + (sres ? fmt(sres.steps) : '—') + '</div>' +
        '<div class="hint">same input, no backtracking blow-up</div></div>';
    }
    box.innerHTML = html;
    box.style.display = 'flex';
  }

  function renderStory(meta) {
    var el = $('#story');
    if (!el) return;
    if (meta && meta.dataset && meta.dataset.note) {
      var src = meta.dataset.src
        ? ' <a href="' + meta.dataset.src + '" target="_blank" rel="noopener">' + escapeHtml(meta.dataset.srcName || 'source') + ' →</a>'
        : '';
      el.innerHTML = meta.dataset.note + src;
      el.style.display = 'block';
    } else {
      el.style.display = 'none';
    }
  }

  function escapeHtml(s) { return s.replace(/[&<>"]/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]; }); }

  // ---- main action ----
  function go(re, input) {
    if (!re) return;
    var pump = input.length ? input[input.length - 1] : 'a';
    var tail = '';
    var meta = $('#presets').selectedOptions[0];
    var usePreset = meta && meta.dataset && meta.dataset.re === re;
    var curve;
    if (usePreset) {
      curve = computeCurve(re, meta.dataset.pump, meta.dataset.tail, meta.dataset.prefix || '');
    } else {
      curve = computeCurve(re, pump, tail, '');
    }
    if (curve.error) { alert('Could not parse regex: ' + curve.error); return; }

    var cls = classify(curve.pts);
    var single = runOne(re, input);
    if (single.error) { alert('Could not run regex: ' + single.error); return; }

    $('#results').style.display = 'block';

    var badge = $('#badge');
    var counterCls, badgeText, badgeCls;
    if (cls.cls === 'exp') {
      counterCls = 'exp'; badgeCls = 'danger'; badgeText = '💥 Catastrophic backtracking (exponential)';
    } else if (cls.cls === 'poly') {
      counterCls = 'poly'; badgeCls = 'warn';
      badgeText = '⚠ Polynomial backtracking (' + degreeWord(cls.exponent) + ')';
    } else {
      counterCls = 'safe'; badgeCls = 'safe'; badgeText = '✓ Linear / safe';
    }
    badge.className = 'badge ' + badgeCls;
    badge.textContent = badgeText;

    animateCounter($('#counter'), single.steps, counterCls);
    $('#counterSub').innerHTML = counterMessage(cls, single);

    var panel = $('#results');
    panel.classList.remove('flash', 'shake');
    void panel.offsetWidth;
    panel.classList.add(cls.cls === 'safe' ? 'flash' : 'shake');

    renderBars(curve);
    renderHeat(input, single.hot);
    renderCompare(re, usePreset ? (meta.dataset.safe || null) : null, input);
    renderStory(usePreset ? meta : null);

    updateHash(re, input);
  }

  function degreeWord(p) {
    if (p == null) return 'polynomial';
    if (p < 2.6) return 'quadratic, ∝ n²';
    if (p < 3.6) return 'cubic, ∝ n³';
    return '∝ n^' + p.toFixed(1);
  }

  function counterMessage(cls, single) {
    if (cls.cls === 'exp') {
      return 'The engine hit its ' + fmt(MAX_STEPS) + '-step safety budget and gave up — a real engine would hang here. Adding one character roughly <b>doubles</b> the work.';
    }
    if (cls.cls === 'poly') {
      var proj = cls.Lhang
        ? ' Projected to blow past ' + fmt(MAX_STEPS) + ' steps at only <b>≈ ' + fmt(cls.Lhang) + ' characters</b> of input (a ~' + Math.max(1, Math.round(cls.Lhang / 1024 * 10) / 10) + ' KB request).'
        : '';
      return 'steps on your test string — and it grows <b>' + degreeWord(cls.exponent).replace('quadratic, ', '') + '</b>. No 30-char string melts it, so it sails through review, but big inputs pin a CPU core.' + proj + ' This is the class behind the Cloudflare & Stack Overflow outages.';
    }
    return 'steps the backtracking engine took on your test string — growth is linear, so this pattern is safe.';
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
      o.dataset.ilen = String(p.ilen || 24);
      if (p.note) { o.dataset.note = p.note; o.dataset.src = p.src || ''; o.dataset.srcName = p.srcName || 'source'; }
      sel.appendChild(o);
    });

    function loadPreset(i) {
      var p = PRESETS[i];
      $('#re').value = p.re;
      $('#in').value = buildInput(p, p.ilen || 24);
    }

    sel.addEventListener('change', function () {
      loadPreset(+sel.value);
      go($('#re').value, $('#in').value);
    });

    $('#runBtn').addEventListener('click', function () {
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
      // a hash-driven run is "arbitrary": clear preset selection so the story box hides
      sel.selectedIndex = -1;
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
