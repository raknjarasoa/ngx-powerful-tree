# ngx-powerful-tree — Architecture

A tour of the library's internals: how the layers fit together, where state lives,
what features exist, and the parts of the code that carry the most cognitive load.

---

## 1. Three layers, one-way data flow

```
┌──────────────────────────────────────────────────────────────────────┐
│                       NgxPowerfulTree (component)                    │
│   Public API (inputs / outputs / public methods)                     │
│   Hosts CdkVirtualScrollViewport                                     │
│   Keyboard navigation + centralized drag/drop math                   │
│   Translates user intent → store calls                               │
│   Translates store changes → output() emissions                      │
└─────────────────┬──────────────────────────────────┬─────────────────┘
                  │ method calls                     │ reads signals
                  ▼                                  ▲
┌──────────────────────────────────────────────────────────────────────┐
│                       NgxTreeStore (Injectable)                      │
│   Single source of truth for all tree state                          │
│   Owns the canonical hierarchy (itemsMap + parentsMap + rootIds)     │
│   Owns ephemeral state (expanded, selected, focused, editing,        │
│     searchQuery, drag state)                                         │
│   Exposes one master computed: flattenedStructure                    │
│   Provides mutation methods with permission/cycle checks             │
└─────────────────┬──────────────────────────────────┬─────────────────┘
                  │ reads signals                    ▲
                  ▼                                  │
┌──────────────────────────────────────────────────────────────────────┐
│                  NgxTreeRowDirective (per visible row)               │
│   Pure presentation — applied as a directive in the template         │
│   100% reactive: computed signals → host bindings                    │
│   Only event it owns: dragstart (lightweight ghost + dragged set)    │
└──────────────────────────────────────────────────────────────────────┘
```

**Invariants:**

- The component never mutates DOM directly.
- The directive never mutates store state.
- The store is the only mutable piece in the system.

---

## 2. Three shapes of the same data

The library uses three intentionally-different shapes for nodes. This is the
single largest source of mental overhead, but each shape exists for a reason.

| Shape                   | Where it lives                                                | Why it exists                                        |
| ----------------------- | ------------------------------------------------------------- | ---------------------------------------------------- |
| `NgxTreeNode`           | Public API (`[nodes]`, `reload()`, `itemAdded` payload)       | Ergonomic nested shape humans actually write         |
| `NgxTreeItem`           | Store: `itemsMap: Map<id, NgxTreeItem>`, `children: string[]` | O(1) lookup and mutation, no recursive copies        |
| `NgxTreeStructuralItem` | `flattenedStructure().list` array                             | Denormalized row record that `cdkVirtualFor` renders |

`ngx-tree.utils.ts` provides both conversions:

- `flattenNodes()` — `NgxTreeNode[] → { items, rootIds }` for store ingestion.
- `expandItems()` — store `{ items, rootIds } → NgxTreeNode[]` for feeding a
  secondary tree (e.g. a relocation picker).

---

## 3. State model

All state lives in `NgxTreeStore`. The store is `providedIn` the component, so
each `<ngx-powerful-tree>` instance gets its own isolated store.

### Canonical data

| Signal / Map | Type                      | What it holds                            |
| ------------ | ------------------------- | ---------------------------------------- |
| `itemsMap`   | `Map<id, NgxTreeItem>`    | Flat record of every node                |
| `parentsMap` | `Map<id, string \| null>` | Reverse lookup, root nodes map to `null` |
| `rootIds`    | `Signal<string[]>`        | Order of root-level nodes                |
| `version`    | `Signal<number>`          | Bumped on structural mutation            |

### Ephemeral state

| Signal            | Type                                     | What it holds                                       |
| ----------------- | ---------------------------------------- | --------------------------------------------------- |
| `expandedItems`   | `Signal<Set<string>>`                    | Which folders are open                              |
| `selectedItems`   | `Signal<Set<string>>`                    | Selected IDs (single or multi)                      |
| `focusedItemId`   | `Signal<string \| null>`                 | Keyboard focus                                      |
| `editingItemId`   | `Signal<string \| null>`                 | Row currently in rename mode                        |
| `searchQuery`     | `Signal<string>`                         | Active filter string                                |
| `selectableTypes` | `Signal<'files' \| 'folders' \| 'all'>`  | What `selectItem` accepts                           |
| `searchPredicate` | `Signal<NgxTreeSearchPredicate \| null>` | Custom search function                              |
| `draggedItemId`   | `Signal<string \| null>`                 | Source of an in-progress drag                       |
| `dragTargetId`    | `Signal<string \| null>`                 | Item under the cursor (centralized hit-test result) |
| `dragPosition`    | `Signal<DragPosition \| null>`           | `'before' \| 'after' \| 'inside'`                   |

### The master computed

```ts
flattenedStructure = computed(() => {
  // Reads rootIds, expandedItems, selectableTypes, searchQuery, searchPredicate
  // and the structural `version` signal.
  // Returns { list: NgxTreeStructuralItem[], indexById: Record<string, number> }.
});
```

This is the one place tree traversal happens. Every visible row, the keyboard
handler, and the drag hit-tester all consume it. It's a single computed because:

- Search visibility, ancestor auto-expansion, and folder-only filtering all
  share the same traversal — keeping them together avoids three passes.
- Returning both `list` and `indexById` lets keyboard navigation jump by ID
  without a second scan.

---

## 4. Public API

### Inputs

| Input              | Type                                | Default    | Purpose                                                  |
| ------------------ | ----------------------------------- | ---------- | -------------------------------------------------------- |
| `nodes` (req.)     | `NgxTreeNode[]`                     | —          | Seed dataset, **read once** (use `reload()` to swap)     |
| `searchQuery`      | `string`                            | `''`       | Debounced filter                                         |
| `multiSelect`      | `boolean`                           | `false`    | Whether selection accumulates                            |
| `itemSize`         | `number`                            | `40`       | CDK virtual scroll row height in pixels — must match CSS |
| `selectableTypes`  | `'files' \| 'folders' \| 'all'`     | `'files'`  | Constrains what `selectItem` accepts                     |
| `searchDebounceMs` | `number`                            | `120`      | Debounce window; `0` = immediate                         |
| `readOnly`         | `boolean`                           | `false`    | Disables all mutations                                   |
| `searchPredicate`  | `(item, query) => boolean \| null`  | `null`     | Override default `name.includes` match                   |
| `actions`          | `{ add?, rename?, delete?, move? }` | all `true` | Per-row action availability (bool or `(item) => bool`)   |

### Outputs

| Output             | Payload                             | Fires on                                     |
| ------------------ | ----------------------------------- | -------------------------------------------- |
| `itemMoved`        | `{ draggedId, targetId, position }` | Successful drop or programmatic `moveItem()` |
| `itemRenamed`      | `{ id, name }`                      | `saveRename()` succeeds                      |
| `itemAdded`        | `{ parentId, node }`                | `createFolder()` succeeds                    |
| `itemDeleted`      | `id`                                | `triggerDelete()` or `Delete` key            |
| `selectionChanged` | `string[]` (sorted IDs)             | Any selection change                         |
| `focusedChanged`   | `string \| null`                    | Any focus change                             |
| `moveRequested`    | `id`                                | User clicks the inline "move" action button  |

### Public methods

| Method                                    | Purpose                                          |
| ----------------------------------------- | ------------------------------------------------ |
| `reload(nodes)`                           | Swap dataset, clear all ephemeral state          |
| `moveItem(draggedId, targetId, position)` | Programmatic move + emit `itemMoved`             |
| `addRootFolder(name?)`                    | Add an empty root folder, then enter rename mode |

### Content projection

| Template ref    | Receives                     | Purpose                                                      |
| --------------- | ---------------------------- | ------------------------------------------------------------ |
| `#itemTemplate` | `{ $implicit: item, index }` | Overrides **every** row (files and folders)                  |
| `#fileTemplate` | `{ $implicit: item, index }` | Overrides **non-folder** rows only; folders keep the default |

The store is exposed as `tree.store`, so consumers can imperatively call
`getItem`, `getParentId`, `getRootIds`, `getAllItemsAsRecord`, `expandAll`,
`collapseAll`, `moveToRoot`, etc.

---

## 5. Feature checklist

### Display & layout

- Virtual scrolling via CDK (`cdk-virtual-scroll-viewport`)
- Fixed-height rows (locked to `itemSize` via CSS for virtual-scroll correctness)
- Configurable depth padding
- Two-tier CSS theming: `--ngx-tree-*` CSS variables and `.ngx-tree-*` class names.
- Empty state
- Optional text wrapping (`:host(.ngx-tree-wrap)`)
- Custom row templates (whole-row or file-only)
- Custom icons per node or default folder/file SVGs

### Selection

- Single-select or multi-select
- Three selectable modes: `files`, `folders`, `all`
- Selection survives drag-and-drop moves
- Clear via `Escape`

### Focus and keyboard navigation (WAI-ARIA tree pattern)

- `role="tree"` on viewport, `role="treeitem"` on rows
- `aria-expanded`, `aria-selected`, `aria-level` on each row
- Arrow keys, Space, Enter, F2, Delete, Escape, Home, End
- Single-letter typeahead with wrap-around
- Auto-scroll keeps focused item visible
- Roving `tabindex`

### Search

- Debounced input (default 120 ms; 0 disables debounce)
- Default predicate: case-insensitive substring match on `name`
- Custom predicate function (can search by `data` fields)
- Matching items get `matchesSearch: true`
- Ancestor paths of matches auto-expand
- Search clears on `reload()`

### Mutations

- Add folder (root or nested), auto-enters rename mode
- Inline rename with blur/Enter to save, Escape to cancel
- Recursive delete with full cascade cleanup of selections/expansions/focus/drag
- Drag-and-drop move (three positions: `before`, `after`, `inside`)
- Programmatic `moveItem()` (also emits `itemMoved`)
- `moveToRoot(id)` on the store
- Duplicate ID detection in `flattenNodes()` (throws)

### Locking (read-only subtrees)

- `locked: true` propagates to all descendants
- Locked items: not draggable, not renamable, not deletable, not a valid `inside` target
- Locked badge with padlock icon
- `actions` input can further gate add/rename/delete/move per-row via predicate

### Drag-and-drop

- HTML5 native drag (`draggable="true"`)
- Centralized math-based hit-testing — index = `floor((scrollTop + clientY) / itemSize)`
- Position split:
  - File: top half = `before`, bottom half = `after`
  - Folder: top 25% = `before`, middle 50% = `inside`, bottom 25% = `after` (only if collapsed)
- Auto-scroll when cursor enters top/bottom 40 px of viewport
- Spring-loaded folder expansion (800 ms hover-inside) with `scrollTop` anchoring
- Drop-at-end-of-list affordance
- Refuses self-targeting, cycles, locked targets
- Dev-mode warning if rendered row height ≠ `[itemSize]`
- Lightweight text drag ghost

### Performance and SSR

- `ChangeDetectionStrategy.OnPush`
- Drag math runs outside Angular zone, writes signals only on actual changes
- Store no-op short-circuits on `setExpanded` / `selectItem`
- O(1) item lookup/mutation (Map-based)
- One denormalized `flattenedStructure` feeds the virtual scroll
- All DOM listeners gated on `isPlatformBrowser`

---

## 6. Lifecycle walkthroughs

### Drag a file before another file

1. User mousedowns → `dragstart` fires on the row.
2. `NgxTreeRowDirective.handleDragStart()` builds a lightweight ghost, sets
   `dataTransfer`, and calls `store.setDragState(id, null, null)`.
3. As the cursor moves over a row, `dragover` fires on that row.
4. The row's handler reads `event.clientY - rect.top` against its own
   `getBoundingClientRect()`, computes `before` / `after` / `inside`, and
   calls `store.setDragState(...)` — only if the result changed.
5. The store's `dragTargetId` / `dragPosition` signals change.
6. Each row's `isDragOverBefore/After/Inside` computed re-runs; the matching
   row toggles its `[class.ngx-tree-row--drag-over-before]` host binding.
7. If the cursor enters the top/bottom 40 px of the viewport, the parent
   component's auto-scroll rAF loop kicks in. As rows scroll past the
   stationary cursor, the browser naturally fires `dragover` on whichever
   row is now under it — no central re-evaluation needed.
8. If the cursor lingers on a collapsed folder's "inside" zone for 800 ms,
   the row uses a timestamp diff (`Date.now() - hoverStartedAt`) to fire
   the spring-load expansion. No setTimeout, no timer id — cancellation
   is automatic when the cursor leaves and resets the timestamp.
9. On `drop`, the row reads the current store state, calls
   `store.moveItem(...)`, emits `itemMoved`, and clears drag state.
10. `moveItem` mutates `itemsMap` / `parentsMap` / `rootIds`, bumps `version`,
    which triggers `flattenedStructure` to recompute and the list to update.

### Search "foo"

1. Consumer updates the bound `searchQuery` input.
2. Effect (#2 in the component constructor) reads it, debounces, and calls
   `store.setSearchQuery(value)`.
3. `flattenedStructure` recomputes:
   - Phase 1: scan all items, collect matches and ancestor IDs.
   - Phase 2: traverse from `rootIds`, including matches and ancestors only,
     treating ancestors as auto-expanded for the search duration.
4. Virtual scroll renders the filtered list. Matches carry
   `matchesSearch: true` for the template to highlight.

### Delete a folder with five children

1. User clicks the delete button → `triggerDelete(id, event)`.
2. `store.deleteItem(id)`:
   - Refuses if `isLocked(id)` (walks parents checking `locked`).
   - Detaches from parent `children` or `rootIds`.
   - DFS-collects every descendant into `deletedIds`.
   - Removes all from `itemsMap` and `parentsMap`.
   - Cascades cleanup across `selectedItems`, `expandedItems`,
     `focusedItemId`, `editingItemId`, and the drag signals.
   - Bumps `version`.
3. `flattenedStructure` recomputes; virtual scroll updates.
4. Component emits `itemDeleted(id)`.

---

## 7. Cognitive hot-spots (by weight)

These are not bugs; they are the parts that take the longest to onboard new
contributors. Each has a suggested mitigation.

1. **Three data shapes** (`NgxTreeNode` / `NgxTreeItem` / `NgxTreeStructuralItem`).
   Necessary for ergonomics + perf. Mitigation: this document, plus a brief
   table comment at the top of `ngx-tree.types.ts`.

2. **Seven effects in the component constructor.** Each is small but together
   load-bearing (seed, search debounce, selection emit, focus emit, edit-input
   autofocus, selectableTypes sync, searchPredicate sync). Mitigation: extract
   into a single `private setupEffects()` method so the constructor reads like
   a table of contents.

3. **Dual purpose of `flattenedStructure`** (it both flattens AND filters/
   ancestor-expands for search). Mitigation: split into a `matchedSet` /
   `ancestorSet` computed plus a `flattenedStructure` that reads them. Each
   half becomes shorter and independently testable.

4. **Drag/drop coordination.** Was the biggest hot-spot. After moving
   handlers back to the row directive and replacing the `setTimeout`
   spring-load with a timestamp diff, the only remaining timing primitive
   is the auto-scroll rAF loop on the parent component (genuinely needed
   because the cursor stays still while the viewport scrolls). See section 8.

5. **Template selector precedence**: `itemTemplate ?? (isFolder ? defaultTemplate : (fileTemplate ?? defaultTemplate))`.
   Mitigation: flatten to a `computed` template selector with a self-documenting name.

6. **`OTHER_USERS_ROOT_ID` magic constant** in `moveToRoot()`. Looks like a
   feature for one specific consumer bleeding into the generic library.
   Mitigation: either document prominently or extract behind an optional
   `[rootSentinelId]` input.

---

## 8. How the drag pipeline got simplified

An earlier iteration of this library centralized all drag hit-testing on
the parent component using `(scrollTop + clientY) / itemSize` math. That
approach was correct but heavy: it required two rAF channels, one timer,
six private fields, and ~200 lines of orchestration spread across the
parent. Tracing what triggered what was painful.

After studying the [`alerubis/angular-draggable-mat-tree`](https://github.com/alerubis/angular-draggable-mat-tree)
example, the pipeline was rewritten around the following principles:

1. **Each row owns its own drag handlers.** `dragover` / `dragleave` /
   `drop` are bound on the row directive, not the viewport. The row reads
   its own `getBoundingClientRect()` (one element, not the whole list) and
   writes the result to centralized store signals.

2. **No rAF coalescing for dragover.** The per-event work is small (one
   rect read, a few arithmetic comparisons, a signal write only if the
   result changed). At native ~60 Hz, it's well within budget.

3. **Spring-loaded folder expansion uses a timestamp diff, not setTimeout.**
   The row records `Date.now()` on the first hover. Each subsequent
   `dragover` checks `now - hoverStartedAt > 800`. Cancellation is
   automatic — `dragleave` resets the timestamp.

4. **Auto-scroll is the only rAF loop that remains** — and it has to be
   there, because the cursor stays still while the viewport scrolls.
   As rows physically move under the stationary cursor, the browser fires
   `dragover` on whichever row is now under it. No central
   re-evaluation needed.

5. **CSS contract is what makes per-row handlers safe under virtual scroll.**
   The dragging row uses `outline` (not `border`), and every row has a
   fixed `height: var(--ngx-tree-row-min-height)`. Without these two,
   class changes during drag would cause layout shift and trigger the
   classic feedback loop. With them, rows stay exactly `itemSize` pixels
   tall, virtual scroll is happy, and per-row handlers behave.

### What the parent component still owns

Only auto-scroll. Four numbers, one rAF id, ~80 lines:

```ts
private readonly scrollSpeedBase = 10;
private readonly scrollSpeedMax = 14;
private animationFrameId: number | null = null;
private itemSizeWarned = false;

ngAfterViewInit() {
  // Bind dragover on the viewport ONLY for auto-scroll near edges.
  // dragleave / drop / dragend just stop the rAF loop.
}
```

### What the row directive owns

Per row, two private fields:

```ts
private dragGhostEl: HTMLElement | null = null;
private springLoadHoverStartedAt: number | null = null;
```

Plus four handlers (`dragstart`, `dragover`, `dragleave`, `drop`) and a
`dragend` bound dynamically on the source element during drag.

### Tradeoffs vs. the centralized math approach

| Concern                                     | Centralized math      | Per-row events (current)                         |
| ------------------------------------------- | --------------------- | ------------------------------------------------ |
| Hit-test cost during stationary auto-scroll | one math op           | one rect read + one comparison per row crossed   |
| Spring-load mechanism                       | setTimeout + timer id | timestamp diff                                   |
| Total timing primitives                     | 3 (2 rAF + 1 timer)   | 1 (auto-scroll rAF)                              |
| Code volume                                 | ~200 lines            | ~80 lines (row) + ~80 lines (parent auto-scroll) |
| DOM-independent hit-testing                 | yes                   | no — relies on row's rect                        |
| Drop-at-end-of-list affordance              | built into math       | not implemented (revertible)                     |

The DOM-independent property of math-based hit-testing sounded nice but
was never actually needed — a cursor can only hover over rendered rows by
definition. The simpler per-row approach is the better fit.
