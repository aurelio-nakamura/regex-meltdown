const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const fs = require('node:fs');
const E = require('../src/engine.js');

function steps(re, input, max = 5_000_000) {
  const r = E.analyze(re, input, { maxSteps: max });
  return r;
}

test('literal + simple matches work', () => {
  assert.equal(steps('abc', 'abc').matched, true);
  assert.equal(steps('abc', 'abd').matched, false);
  assert.equal(steps('a+b', 'aaab').matched, true);
  assert.equal(steps('[0-9]+', '12345').matched, true);
  assert.equal(steps('a|b|c', 'c').matched, true);
  assert.equal(steps('^a+$', 'aaaa').matched, true);
  assert.equal(steps('^a+$', 'aaab').matched, false);
});

test('char classes and escapes', () => {
  assert.equal(steps('\\d+', '2024').matched, true);
  assert.equal(steps('\\w+', 'hello_1').matched, true);
  assert.equal(steps('[^>]+', 'abc').matched, true);
  assert.equal(steps('a\\.b', 'a.b').matched, true);
  assert.equal(steps('a\\.b', 'axb').matched, false, 'escaped dot must be literal');
});

test('quantifier bounds {n,m}', () => {
  assert.equal(steps('a{2,3}', 'aa').matched, true);
  assert.equal(steps('^a{2,3}$', 'aaaa').matched, false);
  assert.equal(steps('^a{3}$', 'aaa').matched, true);
});

test('nested quantifier melts down (exponential in input length)', () => {
  const s10 = steps('(a+)+$', 'a'.repeat(10) + 'X').steps;
  const s15 = steps('(a+)+$', 'a'.repeat(15) + 'X').steps;
  const s20 = steps('(a+)+$', 'a'.repeat(20) + 'X', 5_000_000);
  assert.ok(s15 > s10 * 8, 'steps must grow super-linearly (' + s10 + ' -> ' + s15 + ')');
  assert.equal(s20.meltdown, true, 'len=20 must hit the step budget');
});

test('safe rewrite stays cheap (no meltdown)', () => {
  const r = steps('^a+$', 'a'.repeat(60) + 'X', 5_000_000);
  assert.equal(r.meltdown, false);
  assert.ok(r.steps < 5000, 'anchored a+$ is linear: ' + r.steps);
});

test('overlapping alternation and email validator melt down', () => {
  assert.equal(steps('(x+x+)+y', 'x'.repeat(22) + 'z', 5_000_000).meltdown, true);
  assert.equal(steps('^([a-z0-9]+)+@', 'a'.repeat(24) + '!', 5_000_000).meltdown, true);
});

test('hot map identifies a re-scanned region', () => {
  const r = steps('(a+)+$', 'a'.repeat(12) + 'X', 2_000_000);
  assert.ok(r.hot.length === ('a'.repeat(12) + 'X').length + 1);
  const total = r.hot.reduce((a, b) => a + b, 0);
  assert.ok(total > 0);
});

test('step budget is respected (never runs away)', () => {
  const r = steps('(a+)+$', 'a'.repeat(40) + 'X', 100000);
  assert.ok(r.steps <= 100001, 'must stop at budget, got ' + r.steps);
  assert.equal(r.meltdown, true);
});

test('docs/engine.js is in sync with src/engine.js (build ran)', () => {
  const a = fs.readFileSync(path.join(__dirname, '..', 'src', 'engine.js'), 'utf8');
  const b = fs.readFileSync(path.join(__dirname, '..', 'docs', 'engine.js'), 'utf8');
  assert.equal(a, b, 'run `npm run build` to sync docs/engine.js');
});

test('app.js discloses AI authorship and links redosray (brand + honesty guards)', () => {
  const app = fs.readFileSync(path.join(__dirname, '..', 'docs', 'app.js'), 'utf8');
  const html = fs.readFileSync(path.join(__dirname, '..', 'docs', 'index.html'), 'utf8');
  assert.ok(/autonomous AI agent/i.test(html), 'index.html must disclose AI authorship');
  assert.ok(/redosray/.test(html), 'index.html should link the companion tool');
  assert.ok(/Aurelio Nakamura/.test(app));
});
