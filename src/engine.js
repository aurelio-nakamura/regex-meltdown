// regex-meltdown engine — a tiny, dependency-free regex parser + an INSTRUMENTED
// backtracking matcher that records every step the engine takes, so we can
// *visualize* catastrophic backtracking instead of just detecting it.
//
// This is deliberately a classic recursive/CPS backtracking matcher (like the
// ones in PCRE / JS's engine for the pathological cases) — it is exactly this
// design that "melts down" on ambiguous quantifiers, which is the whole point.
//
// Built and maintained by Aurelio Nakamura, an autonomous AI agent.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.RegexMeltdown = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ---------- Parser: regex source -> AST ----------
  // Supported: literals, ., escapes (\d\w\s\D\W\S and escaped metachars),
  // character classes [..], groups (..) (?:..), alternation |, quantifiers
  // * + ? {n} {n,} {n,m} (greedy + lazy with trailing ?), anchors ^ $.
  function parse(src) {
    let i = 0;
    const n = src.length;
    let idCounter = 0;
    const nid = () => idCounter++;

    function peek() { return src[i]; }
    function eof() { return i >= n; }

    function parseAlternation() {
      const branches = [parseConcat()];
      while (!eof() && peek() === '|') { i++; branches.push(parseConcat()); }
      if (branches.length === 1) return branches[0];
      return { type: 'alt', id: nid(), branches };
    }

    function parseConcat() {
      const items = [];
      while (!eof() && peek() !== '|' && peek() !== ')') {
        items.push(parseQuantified());
      }
      return { type: 'concat', id: nid(), items };
    }

    function parseQuantified() {
      let atom = parseAtom();
      while (!eof()) {
        const c = peek();
        let q = null;
        if (c === '*') { q = { min: 0, max: Infinity }; i++; }
        else if (c === '+') { q = { min: 1, max: Infinity }; i++; }
        else if (c === '?') { q = { min: 0, max: 1 }; i++; }
        else if (c === '{') {
          const save = i;
          const m = /^\{(\d+)(,(\d*)?)?\}/.exec(src.slice(i));
          if (m) {
            const min = parseInt(m[1], 10);
            let max;
            if (m[2] === undefined) max = min;
            else if (m[3] === '' || m[3] === undefined) max = Infinity;
            else max = parseInt(m[3], 10);
            q = { min, max };
            i += m[0].length;
          } else { i = save; break; }
        } else break;
        let lazy = false;
        if (!eof() && peek() === '?') { lazy = true; i++; }
        atom = { type: 'repeat', id: nid(), child: atom, min: q.min, max: q.max, lazy };
      }
      return atom;
    }

    function parseAtom() {
      const c = peek();
      if (c === '(') {
        i++;
        let capturing = true;
        if (src.slice(i, i + 2) === '?:') { i += 2; capturing = false; }
        else if (peek() === '?') {
          // treat (?=...) (?!...) etc. as non-capturing group best-effort
          // (lookarounds are approximated as their inner concat for visualization)
          const m = /^\?[:=!]|^\?<[=!]/.exec(src.slice(i));
          if (m) { i += m[0].length; capturing = false; }
        }
        const body = parseAlternation();
        if (peek() === ')') i++;
        return { type: 'group', id: nid(), child: body, capturing };
      }
      if (c === '[') return parseClass();
      if (c === '.') { i++; return { type: 'any', id: nid() }; }
      if (c === '^') { i++; return { type: 'anchorStart', id: nid() }; }
      if (c === '$') { i++; return { type: 'anchorEnd', id: nid() }; }
      if (c === '\\') return parseEscape();
      // literal
      i++;
      return { type: 'char', id: nid(), ch: c };
    }

    function classFromEscape(e) {
      switch (e) {
        case 'd': return { neg: false, ranges: [['0', '9']], singles: [] };
        case 'D': return { neg: true, ranges: [['0', '9']], singles: [] };
        case 'w': return { neg: false, ranges: [['a', 'z'], ['A', 'Z'], ['0', '9']], singles: ['_'] };
        case 'W': return { neg: true, ranges: [['a', 'z'], ['A', 'Z'], ['0', '9']], singles: ['_'] };
        case 's': return { neg: false, ranges: [], singles: [' ', '\t', '\n', '\r', '\f', '\v'] };
        case 'S': return { neg: true, ranges: [], singles: [' ', '\t', '\n', '\r', '\f', '\v'] };
        default: return null;
      }
    }

    function escChar(e) {
      switch (e) {
        case 'n': return '\n'; case 't': return '\t'; case 'r': return '\r';
        case 'f': return '\f'; case 'v': return '\v'; case '0': return '\0';
        default: return e;
      }
    }

    function parseEscape() {
      i++; // consume backslash
      const e = src[i]; i++;
      const cls = classFromEscape(e);
      if (cls) return { type: 'class', id: nid(), ...cls };
      return { type: 'char', id: nid(), ch: escChar(e) };
    }

    function parseClass() {
      i++; // [
      let neg = false;
      if (peek() === '^') { neg = true; i++; }
      const ranges = [];
      const singles = [];
      // allow ] as first char literally
      let first = true;
      while (!eof() && (peek() !== ']' || first)) {
        first = false;
        let ch;
        if (peek() === '\\') {
          i++;
          const e = src[i]; i++;
          const cls = classFromEscape(e);
          if (cls) {
            for (const r of cls.ranges) ranges.push(r);
            for (const s of cls.singles) singles.push(s);
            continue;
          }
          ch = escChar(e);
        } else { ch = peek(); i++; }
        if (peek() === '-' && src[i + 1] !== ']' && !eof()) {
          i++; // -
          let hi;
          if (peek() === '\\') { i++; hi = escChar(src[i]); i++; }
          else { hi = peek(); i++; }
          ranges.push([ch, hi]);
        } else {
          singles.push(ch);
        }
      }
      if (peek() === ']') i++;
      return { type: 'class', id: nid(), neg, ranges, singles };
    }

    const ast = parseAlternation();
    return { ast, size: idCounter };
  }

  function classMatch(node, ch) {
    if (ch === undefined) return false;
    let inside = false;
    for (const s of node.singles) if (s === ch) { inside = true; break; }
    if (!inside) {
      for (const [lo, hi] of node.ranges) {
        if (ch >= lo && ch <= hi) { inside = true; break; }
      }
    }
    return node.neg ? !inside : inside;
  }

  // ---------- Instrumented backtracking matcher ----------
  // Returns { matched, steps, meltdown, trace, hotIndex }
  // trace (optional, capped) is a list of {pos, id, kind}
  //   kind: 'try' (attempt a node at pos), 'consume' (matched a char), 'fail'
  // hotIndex[pos] = number of times the engine visited that string position
  function run(ast, input, opts) {
    opts = opts || {};
    const maxSteps = opts.maxSteps || 2_000_000;
    const collectTrace = !!opts.trace;
    const traceCap = opts.traceCap || 20000;
    const len = input.length;

    let steps = 0;
    let meltdown = false;
    const hot = new Array(len + 1).fill(0);
    const trace = [];
    const err = { over: false };

    function tick(pos, id, kind) {
      steps++;
      if (pos >= 0 && pos <= len) hot[pos]++;
      if (collectTrace && trace.length < traceCap) trace.push({ pos, id, kind });
      if (steps >= maxSteps) { meltdown = true; err.over = true; throw err; }
    }

    // CPS matcher: match(node, pos, k) -> boolean; k(pos) is the continuation.
    function match(node, pos, k) {
      switch (node.type) {
        case 'concat': {
          const items = node.items;
          function step(idx, p) {
            if (idx === items.length) return k(p);
            return match(items[idx], p, (p2) => step(idx + 1, p2));
          }
          return step(0, pos);
        }
        case 'group':
          return match(node.child, pos, k);
        case 'alt': {
          for (const b of node.branches) {
            if (match(b, pos, k)) return true;
          }
          return false;
        }
        case 'char': {
          tick(pos, node.id, 'try');
          if (pos < len && input[pos] === node.ch) {
            tick(pos, node.id, 'consume');
            return k(pos + 1);
          }
          return false;
        }
        case 'any': {
          tick(pos, node.id, 'try');
          if (pos < len && input[pos] !== '\n') { tick(pos, node.id, 'consume'); return k(pos + 1); }
          return false;
        }
        case 'class': {
          tick(pos, node.id, 'try');
          if (pos < len && classMatch(node, input[pos])) { tick(pos, node.id, 'consume'); return k(pos + 1); }
          return false;
        }
        case 'anchorStart':
          tick(pos, node.id, 'try');
          return pos === 0 ? k(pos) : false;
        case 'anchorEnd':
          tick(pos, node.id, 'try');
          return pos === len ? k(pos) : false;
        case 'repeat':
          return matchRepeat(node, pos, 0, k);
        default:
          return k(pos);
      }
    }

    // Greedy/lazy quantifier with backtracking — the meltdown engine room.
    function matchRepeat(node, pos, count, k) {
      const { child, min, max, lazy } = node;
      tick(pos, node.id, 'try');
      const canMore = count < max;
      const canStop = count >= min;

      if (lazy) {
        if (canStop && k(pos)) return true;
        if (canMore) {
          return match(child, pos, (p2) => {
            if (p2 === pos && count >= min) return false; // zero-width guard
            return matchRepeat(node, p2, count + 1, k);
          });
        }
        return false;
      } else {
        if (canMore) {
          const more = match(child, pos, (p2) => {
            if (p2 === pos && count >= min) return false; // zero-width guard
            return matchRepeat(node, p2, count + 1, k);
          });
          if (more) return true;
        }
        if (canStop) return k(pos);
        return false;
      }
    }

    // Unanchored search: try each start position (like RegExp without ^).
    let matched = false;
    const anchoredStart = isAnchoredStart(ast);
    try {
      for (let start = 0; start <= len; start++) {
        if (match(ast, start, (p) => true)) { matched = true; break; }
        if (anchoredStart) break; // ^ can only match at 0 (single attempt)
      }
    } catch (e) {
      if (e !== err) throw e;
    }

    let hotIndex = 0, hotMax = -1;
    for (let p = 0; p <= len; p++) if (hot[p] > hotMax) { hotMax = hot[p]; hotIndex = p; }

    return { matched, steps, meltdown, trace, hot, hotIndex };
  }

  function isAnchoredStart(ast) {
    // best-effort: leading ^ in a concat
    let node = ast;
    while (node) {
      if (node.type === 'anchorStart') return true;
      if (node.type === 'concat') { node = node.items[0]; continue; }
      if (node.type === 'group') { node = node.child; continue; }
      return false;
    }
    return false;
  }

  function analyze(src, input, opts) {
    const { ast } = parse(src);
    return run(ast, input, opts);
  }

  return { parse, run, analyze, classMatch };
});
