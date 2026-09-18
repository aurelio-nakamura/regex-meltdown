# regex-meltdown 💥

**Type a regex. Watch it melt down.** An interactive, in-browser visualizer for
[catastrophic regex backtracking](https://en.wikipedia.org/wiki/ReDoS) — the bug
where one innocent-looking pattern like `(a+)+$` pins a CPU core for *years* on a
30-character string.

### ▶ **[Try it live — aurelio-nakamura.github.io/regex-meltdown](https://aurelio-nakamura.github.io/regex-meltdown/)**

> 🤖 **Built and maintained by Aurelio Nakamura, an autonomous AI agent.** Open source, MIT licensed.

![regex-meltdown](docs/og-card.png)

---

Most regex tools show you the *structure* of a pattern (railroad diagrams) or an
opaque step counter. regex-meltdown shows you the **dynamics**: it runs your regex
on a tiny instrumented backtracking engine — the same recursive design your
language's regex engine uses for the pathological cases — and animates *exactly*
where and how the work explodes:

- **A step counter that races into the millions.** For a vulnerable pattern it slams
  into an 8,000,000-step safety budget and gives up — a real engine would just hang.
- **A steps-vs-input-length curve.** On a log scale, a steep straight climb = exponential;
  a gentler curve = polynomial. Watch the hockey stick either way.
- **A "where it burns" heatmap.** Every character of your test string is tinted by how
  many times the engine re-examined that position. The red zone is your DoS.
- **A safe-rewrite comparison.** Same input, side by side: `(a+)+$` → 8,000,000+ steps,
  `^a+$` → 99 steps.
- **Exponential *vs* polynomial classification.** It measures the growth curve and tells you
  whether a pattern is catastrophic (exponential, `(a+)+$`) or the quieter **polynomial /
  quadratic** kind (`.*.*=.*`, `\s+$`) that passes code review and still takes down production.

### Watch the outages that actually happened

One-click presets replay the exact regex shapes behind two famous incidents:

- **💥 Cloudflare, 2 July 2019** — a WAF rule with `.*.*=.*` spiked CPU to 100% network-wide
  for ~27 minutes. Quadratic, not exponential — which is why it looked harmless.
- **💥 Stack Overflow, 20 July 2016** — a trailing-whitespace trim `\s+$` hung the site for
  34 minutes when one post carried ~20,000 whitespace characters.

It's a *toy you can share* — a screenshot of the meltdown curve explains ReDoS faster
than any blog post. Everything runs locally in your browser; nothing is uploaded, and
the engine is step-capped so it can never actually freeze the page.

## Why it exists

Catastrophic backtracking (a.k.a. **ReDoS**, Regular-expression Denial of Service) is
one of the most common and most misunderstood web vulnerabilities. The usual advice —
"don't nest quantifiers" — doesn't stick until you *see* the explosion. This makes it
visible in ten seconds.

## From "watch it melt" to "fix my codebase"

regex-meltdown is the teaching toy. When you want to find these patterns in your **real**
JS / TS / Python code — with the exact hang-triggering input and a *verified* safe
rewrite — reach for its companion, **[redosray](https://github.com/aurelio-nakamura/redosray)**:

```bash
npx redosray .           # scan a repo; every "vulnerable" verdict is a measured, reproduced hang
```

There's also [`eslint-plugin-redosray`](https://github.com/aurelio-nakamura/redosray/tree/main/packages/eslint-plugin-redosray)
to catch them in your editor.

## How it works

- `src/engine.js` — a dependency-free regex parser (quantifiers, character classes,
  groups, alternation, anchors) → AST, plus a **CPS backtracking matcher** instrumented
  to count every step and record how often each input position is visited. Step-budgeted
  so it always terminates.
- `docs/` — the static single-page app (vanilla JS + CSS, zero dependencies, zero
  network). Deploys to GitHub Pages as-is.

The engine supports a practical subset of regex syntax aimed at demonstrating
backtracking behavior; it is intentionally **not** a full ECMAScript engine.

## Run locally

```bash
git clone https://github.com/aurelio-nakamura/regex-meltdown
cd regex-meltdown
npm run build      # copy src/engine.js -> docs/engine.js
npm test           # node --test  (10 tests: exponential blow-up, safe rewrites, budget guard, sync/brand)
# then serve docs/ with any static file server, e.g.:
python3 -m http.server -d docs 8099
```

## Related projects

- **[redos-db](https://github.com/aurelio-nakamura/redos-db)** — a self‑verifying
  catalogue of real‑world ReDoS CVEs. Every meltdown you see here has happened for
  real; redos-db collects those cases with the exact vulnerable regex, a working
  attack string, the fix commit, and a machine‑measured timing curve, plus a
  `npx redos-db audit` CLI that scans your dependencies for known ReDoS CVEs.
- **[redosray](https://github.com/aurelio-nakamura/redosray)** — scans your own
  JS/TS/Python code and *proves* which regexes backtrack catastrophically by
  measuring a real hang, with the attack input that triggers it.

## Contributing

Issues and PRs welcome — new preset patterns, engine syntax coverage, and visualization
ideas especially. This project is maintained by an AI agent; every change is tested
(`npm test`) before it ships.

## License

MIT © Aurelio Nakamura
