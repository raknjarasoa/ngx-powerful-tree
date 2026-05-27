# [2.3.0](https://github.com/raknjarasoa/ngx-powerful-tree/compare/v2.2.0...v2.3.0) (2026-05-27)

### Features

- improve tree layout performance and add benchmarking scripts for store optimization. ([69de56c](https://github.com/raknjarasoa/ngx-powerful-tree/commit/69de56c3e1bd2d602f08e09dae72fcc1216b4dff))

# [2.2.0](https://github.com/raknjarasoa/ngx-powerful-tree/compare/v2.1.0...v2.2.0) (2026-05-27)

### Features

- rewrite ngx-powerful-tree for extreme performance ([#7](https://github.com/raknjarasoa/ngx-powerful-tree/issues/7)) ([3c8ed9c](https://github.com/raknjarasoa/ngx-powerful-tree/commit/3c8ed9c30dda1bd42c3ac05ad68f6b1c0136a03c))

# [2.1.0](https://github.com/raknjarasoa/ngx-powerful-tree/compare/v2.0.0...v2.1.0) (2026-05-27)

### Features

- release opaque drag ghost Re-release; PR [#6](https://github.com/raknjarasoa/ngx-powerful-tree/issues/6) merged with a non-conventional commit message that semantic-release could not parse. ([8742b7b](https://github.com/raknjarasoa/ngx-powerful-tree/commit/8742b7b3f46b33d24677bd5517144319bb2ae17e))

# [2.0.0](https://github.com/raknjarasoa/ngx-powerful-tree/compare/v1.1.0...v2.0.0) (2026-05-26)

- feat(tree)!: accept nested NgxTreeNode[] via a single nodes input ([d447c0e](https://github.com/raknjarasoa/ngx-powerful-tree/commit/d447c0e2a230182f412d5d3c5e74061d2f902042))
- feat(tree)!: own state internally, expose reload(), enforce locks in store ([470cde4](https://github.com/raknjarasoa/ngx-powerful-tree/commit/470cde460233696c912b5b4c2ab8c1c61e4f68e4))

### chore

- **tree:** drop fileTemplate input alias, add directive tests, document contract ([2b57273](https://github.com/raknjarasoa/ngx-powerful-tree/commit/2b572731caf2526daebabdd63e3c1762a1162af5))

### Performance Improvements

- **tree:** debounce search, cache id->index, rAF-throttle dragover ([be13426](https://github.com/raknjarasoa/ngx-powerful-tree/commit/be1342671f0c3f7d64504c6dd457df0ed9235a3b)), closes [hi#frequency](https://github.com/hi/issues/frequency)

### BREAKING CHANGES

- consumers previously passing `[items]` and `[rootIds]`
  must pass a single `[nodes]` with embedded children. `reload(items, rootIds)`
  now reads `reload(nodes)`. `itemAdded.item` is renamed to `itemAdded.node`.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>

- **tree:** consumers previously passing `[fileTemplate]="ref"` as
  an input must instead project `<ng-template #fileTemplate>` as content.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>

- `items` and `rootIds` are no longer re-applied on
  subsequent emissions. Consumers that previously relied on signal
  re-sync must call `tree.reload(items, rootIds)` to swap data.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>

# [1.1.0](https://github.com/raknjarasoa/ngx-powerful-tree/compare/v1.0.0...v1.1.0) (2026-05-26)

### Features

- **tree:** refine drag-drop targets, isolate chevron expand clicks, restrict folder selection, and add typesafe template contexts ([9ced4c2](https://github.com/raknjarasoa/ngx-powerful-tree/commit/9ced4c208ffbde9740e558010b701811532c3f68))

# 1.0.0 (2026-05-26)

### Bug Fixes

- change hoverTimer type to any and set Ivy partial compilation mode for NPM publication ([d22b1f6](https://github.com/raknjarasoa/ngx-powerful-tree/commit/d22b1f6c6496042c5e90013fc7ba4806776ec8ed))

### Features

- add configurable tree permissions and name truncation, and refine overlay UI layout ([db36bac](https://github.com/raknjarasoa/ngx-powerful-tree/commit/db36bacbf07c97c53fd55a2229fc2ca6b1890e6f))
- disable multi-select, pre-select specific node, and update toggle button styles ([229fe0d](https://github.com/raknjarasoa/ngx-powerful-tree/commit/229fe0d3f03639fdc79300929bc13c3471504fd9))
- implement drag-and-drop auto-expansion, CSS nesting guidelines, and real-time FPS monitoring in the playground app ([cc92844](https://github.com/raknjarasoa/ngx-powerful-tree/commit/cc928442e1b7741728440d33da447a401a71db16))
- implement dynamic folder-only picker with deferrable view relocation overlay ([887e9a9](https://github.com/raknjarasoa/ngx-powerful-tree/commit/887e9a93d69e976adf0948740b61659d06637a89))
- implement locked folder functionality with recursive state propagation and restricted operations ([683dd2d](https://github.com/raknjarasoa/ngx-powerful-tree/commit/683dd2de902e2ba2cb9afb90ec38d8b45e2c76b3))
- initial release of ngx-powerful-tree with premium expansions and virtualization ([a90c45e](https://github.com/raknjarasoa/ngx-powerful-tree/commit/a90c45e167716bfa79c8005a688828a52f0a6fed))
- **picker:** implement readOnly mode and zero-boilerplate active store syncing for relocation picker ([cab45a8](https://github.com/raknjarasoa/ngx-powerful-tree/commit/cab45a8da96ab8125a63573a218a9e23db604a63))
- scaffold new Nx workspace with playground app and ngx-powerful-tree library ([3031708](https://github.com/raknjarasoa/ngx-powerful-tree/commit/3031708421a99a51dcc27c1e90d283e0b4000069))
- support custom icon overrides for tree nodes via FontAwesome integration ([decdb2e](https://github.com/raknjarasoa/ngx-powerful-tree/commit/decdb2eab8cbe8054c68ae52fb019a44988cb30f))
- update tree insertion logic to prioritize folders and add drop behavior with automatic deselection ([ef108a0](https://github.com/raknjarasoa/ngx-powerful-tree/commit/ef108a0d83b06c50154ff129c078b36deb882f2d))

### Performance Improvements

- optimize drag state updates and switch tree components to OnPush change detection ([8d99818](https://github.com/raknjarasoa/ngx-powerful-tree/commit/8d99818bd93e1bc260f4bbeb24e078a243fffee1))
- replace slow CSS style substring selectors with depth-0 class and static centering line overlays ([ed02218](https://github.com/raknjarasoa/ngx-powerful-tree/commit/ed0221854cf75979fb574867e2c0b9e9076d7ddd))
