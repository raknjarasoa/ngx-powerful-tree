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
- Two-tier CSS theming: 13 `--ngx-tree-*` CSS variables, auto dark mode via `prefers-color-scheme`
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
3. As the cursor moves, `dragover` fires on the **viewport** (not on rows).
4. The viewport handler saves `clientY`, schedules one rAF tick, and updates
   auto-scroll if near edges.
5. Next frame: `evaluateDragPosition()` computes the index from
   `(scrollTop + clientY - viewportTop) / itemSize`, looks up the row in
   `flattenedStructure`, computes the position, and calls
   `store.setDragState(...)` — only if the value changed.
6. The store's `dragTargetId` / `dragPosition` signals change.
7. Each row's `isDragOverBefore/After/Inside` computed re-runs; the matching
   row toggles its `[class.ngx-tree-row--drag-over-before]` host binding.
8. On `drop`, the viewport handler re-evaluates one last time, calls
   `store.moveItem(...)`, emits `itemMoved`, and clears drag state.
9. `moveItem` mutates `itemsMap` / `parentsMap` / `rootIds`, bumps `version`,
   which triggers `flattenedStructure` to recompute, which updates the list.

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

4. **Drag/drop event + rAF + timer choreography.** Six private fields,
   nine private methods, three independent timing channels (drag-eval rAF,
   auto-scroll rAF loop, spring-load `setTimeout`). Mitigation: extract a
   `NgxTreeDragController` class and use thin `RafSlot` / `TimerSlot`
   utilities so each channel manages its own cleanup. See section 8.

5. **Template selector precedence**: `itemTemplate ?? (isFolder ? defaultTemplate : (fileTemplate ?? defaultTemplate))`.
   Mitigation: flatten to a `computed` template selector with a self-documenting name.

6. **`OTHER_USERS_ROOT_ID` magic constant** in `moveToRoot()`. Looks like a
   feature for one specific consumer bleeding into the generic library.
   Mitigation: either document prominently or extract behind an optional
   `[rootSentinelId]` input.

---

## 8. Proposed refactor for the drag pipeline

The drag/drop machinery is the densest part of the component. The
architecture is correct; the implementation can be a lot easier to read.

**Goal:** turn ~200 lines of `private` fields and `private` methods spread
across `NgxPowerfulTree` into a single self-contained controller class with
no manual resource bookkeeping.

### Step 1: Thin resource slots

Two tiny utility classes that own one rAF id or one timer id and auto-cancel
on destroy:

```ts
// drag/raf-slot.ts
export class RafSlot {
  private id: number | null = null;
  constructor(destroyRef: DestroyRef) {
    destroyRef.onDestroy(() => this.cancel());
  }
  schedule(cb: () => void) {
    if (this.id !== null) return; // coalesce
    this.id = requestAnimationFrame(() => {
      this.id = null;
      cb();
    });
  }
  scheduleLoop(cb: () => void) {
    this.cancel();
    const tick = () => {
      cb();
      this.id = requestAnimationFrame(tick);
    };
    this.id = requestAnimationFrame(tick);
  }
  cancel() {
    if (this.id !== null) {
      cancelAnimationFrame(this.id);
      this.id = null;
    }
  }
}

// drag/timer-slot.ts
export class TimerSlot {
  private id: ReturnType<typeof setTimeout> | null = null;
  constructor(destroyRef: DestroyRef) {
    destroyRef.onDestroy(() => this.cancel());
  }
  schedule(ms: number, cb: () => void) {
    this.cancel();
    this.id = setTimeout(() => {
      this.id = null;
      cb();
    }, ms);
  }
  cancel() {
    if (this.id !== null) {
      clearTimeout(this.id);
      this.id = null;
    }
  }
}
```

Every `if (this.id !== null) cancelAnimationFrame(this.id); this.id = null;`
pattern disappears. Cleanup on destroy is automatic.

### Step 2: A `NgxTreeDragController`

A plain class (no Angular decorator) that owns the whole pipeline:

```ts
// drag/ngx-tree-drag-controller.ts
export interface DragDeps {
  store: NgxTreeStore;
  ngZone: NgZone;
  destroyRef: DestroyRef;
  viewport: () => CdkVirtualScrollViewport | undefined;
  itemSize: () => number;
  readOnly: () => boolean;
  emitMoved: (e: { draggedId: string; targetId: string; position: DragPosition }) => void;
}

export class NgxTreeDragController {
  private static readonly SCROLL_BASE = 10;
  private static readonly SCROLL_MAX = 14;
  private static readonly SPRING_DELAY_MS = 800;
  private static readonly EDGE_PX = 40;

  private readonly evalSlot: RafSlot;
  private readonly scrollSlot: RafSlot;
  private readonly springSlot: TimerSlot;
  private lastClientY: number | null = null;
  private springTargetId: string | null = null;
  private itemSizeWarned = false;

  constructor(private deps: DragDeps) {
    this.evalSlot = new RafSlot(deps.destroyRef);
    this.scrollSlot = new RafSlot(deps.destroyRef);
    this.springSlot = new TimerSlot(deps.destroyRef);
  }

  attach() {
    const vpt = this.deps.viewport();
    if (!vpt) return;
    const el = vpt.elementRef.nativeElement;

    this.deps.ngZone.runOutsideAngular(() => {
      el.addEventListener('dragover', this.onDragOver);
      el.addEventListener('dragleave', this.onDragLeave);
      el.addEventListener('drop', this.onDrop);
      document.addEventListener('dragend', this.onDragEnd);

      this.deps.destroyRef.onDestroy(() => {
        el.removeEventListener('dragover', this.onDragOver);
        el.removeEventListener('dragleave', this.onDragLeave);
        el.removeEventListener('drop', this.onDrop);
        document.removeEventListener('dragend', this.onDragEnd);
      });
    });
  }

  // Arrow-property handlers — auto-bound, no `bind(this)` boilerplate.
  private onDragOver = (e: DragEvent) => {
    /* … */
  };
  private onDragLeave = (e: DragEvent) => {
    /* … */
  };
  private onDrop = (e: DragEvent) => {
    /* … */
  };
  private onDragEnd = () => {
    /* … */
  };

  private evaluate() {
    /* … */
  }
  private updateAutoScroll(viewportEl: HTMLElement, mouseY: number) {
    /* … */
  }
}
```

### Step 3: Wire it into the component

`NgxPowerfulTree.ngAfterViewInit` shrinks to:

```ts
private dragController = new NgxTreeDragController({
  store: this.store,
  ngZone: this.ngZone,
  destroyRef: this.destroyRef,
  viewport: () => this.viewport(),
  itemSize: () => this.itemSize(),
  readOnly: () => this.readOnly(),
  emitMoved: (e) => this.itemMoved.emit(e),
});

ngAfterViewInit() {
  if (!isPlatformBrowser(this.platformId)) return;
  this.dragController.attach();
}
```

### What this buys you

- The component drops ~200 lines of drag code and 6 private fields.
- The drag pipeline becomes a single file you can read top-to-bottom.
- Cleanup is automatic — the slots wire themselves to `destroyRef`.
- Each timing channel (eval / scroll / spring-load) has its own slot, so
  the "is this id still valid?" branching vanishes.
- The controller can be unit-tested with a fake `DragDeps` — no `TestBed`
  needed for math-only tests.
- Spring-load delay, scroll speed, edge threshold become named static
  constants instead of scattered numeric literals.

### What it does NOT change

- The architecture (centralized math-based hit-testing) stays the same.
- The store contract is untouched.
- The row directive is untouched.
- No new dependencies (no RxJS for this — signals + small classes are enough).

This is a refactor in scope, not a rewrite. It can ship as a non-breaking
patch immediately after the current hybrid fix lands.
