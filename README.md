# @planthingsbetter/core

Pure domain logic shared across Plan Things Better products — the [Vertex
Flow](https://github.com/allanleonardjr/vertex-flow-obsidian) Obsidian plugin
and the Plan Things Better SaaS app.

Covers:

- Per-workspace taxonomy engine (Status, Priority, Task Type, Labels)
- LexoRank-based fractional-indexing for task ordering
- The filter/query grammar used by saved views and dashboards
- Sub-task hierarchy, blocks/blocked-by relations, and cycle detection
- Recurrence, activity history, and workspace templates
- The MCP servers' JSON payloads (tasks, projects, views, dashboards,
  counts, summaries, `run_view`), with each app supplying its own links
- Frontmatter-shaped (de)serialization helpers for the two products' storage
  layers to build on

This package has **no runtime dependencies** — it never imports the Obsidian
API, the DOM, or any UI library, so it's safe to use from a browser, a Node
server, or an Obsidian plugin sandbox alike.

> **Status:** this package currently duplicates logic that also lives in
> `vertex-flow-obsidian`'s `src/core/`, rather than replacing it. Until the
> plugin is cut over to depend on this package directly, a fix made in one
> place needs to be applied in both.

## Development

```bash
pnpm install
pnpm test        # vitest run
pnpm typecheck
pnpm lint
pnpm build       # emits dist/ (compiled JS + .d.ts)
```

`templates/*.md` are the source of truth for the built-in workspace
templates; `pnpm build:templates` (run automatically before `build`/`test`)
compiles them into `src/core/templates/generated.ts` and validates every
template against the real parser, failing the build on a bad anchor,
contradictory relation, or unknown taxonomy name rather than shipping it.

## Using this locally in another repo before publishing

```jsonc
// in the consuming repo's package.json
"@planthingsbetter/core": "file:../planthingsbetter-core"
```

Run `pnpm build` here in watch-adjacent fashion (re-run after each change)
and the consumer's `pnpm install` symlink picks it up — no publish needed for
local iteration. CI and real releases use a published semver range instead.

## Publishing

`prepublishOnly` runs lint, typecheck, tests, and the build, so `npm publish`
(or the `publish.yml` GitHub Action, triggered on a GitHub Release) fails
before anything broken reaches the registry.
