# ngx-powerful-tree

A virtualized Angular tree component with native HTML5 drag-and-drop, fluid
search, locked subtrees, and folder/file picker modes. Built on
`@angular/cdk/scrolling`. Designed to stay smooth at
100k+ rows.

## Installation

```sh
npm i ngx-powerful-tree @angular/cdk
```

## Quick start

```ts
import { Component, signal, viewChild } from '@angular/core';
import { NgxPowerfulTree, NgxTreeNode } from 'ngx-powerful-tree';

@Component({
  imports: [NgxPowerfulTree],
  template: `
    <ngx-powerful-tree
      #tree
      [nodes]="nodes()"
      [searchQuery]="search()"
      (itemMoved)="onMoved($event)"
      (itemRenamed)="onRenamed($event)"
      (itemDeleted)="onDeleted($event)"
    />
  `,
})
export class MyTree {
  tree = viewChild.required<NgxPowerfulTree>('tree');

  nodes = signal<NgxTreeNode[]>([
    {
      id: 'src',
      name: 'src',
      isFolder: true,
      children: [{ id: 'app.ts', name: 'app.ts', isFolder: false }],
    },
  ]);
  search = signal<string>('');

  async refresh() {
    const data = await this.api.fetchTree();
    this.tree().reload(data);
  }
}
```

## State ownership: the contract

**The tree owns its state after the first input emission.** `nodes` is read
once on mount and then ignored — internal mutations (move/rename/add/delete
via the UI or store) survive parent re-emissions without being silently
overwritten.

To swap the dataset entirely (e.g. after loading from a server), call the
public `reload()` method. It accepts the same nested `NgxTreeNode[]` shape
as the `nodes` input and clears expand/select/focus/search/drag state so
the new dataset starts from a clean slate.

To keep an external mirror in sync, subscribe to the fine-grained outputs
(`itemMoved`, `itemRenamed`, `itemAdded`, `itemDeleted`,
`selectionChanged`, `focusedChanged`). The tree never emits a full-tree
snapshot — at 100k+ items that would dwarf the cost of the mutation itself.

## Inputs

| Input              | Type                            | Default   | Description                                                                            |
| ------------------ | ------------------------------- | --------- | -------------------------------------------------------------------------------------- |
| `nodes` (required) | `NgxTreeNode[]`                 | —         | Seed dataset. Read once on first emission; call `reload(nodes)` to swap it afterwards. |
| `searchQuery`      | `string`                        | `''`      | Substring filter. Debounced by `searchDebounceMs`.                                     |
| `searchDebounceMs` | `number`                        | `120`     | Debounce window for search input. `0` to apply immediately.                            |
| `multiSelect`      | `boolean`                       | `false`   | Allow selecting multiple items with click + meta or Space.                             |
| `itemSize`         | `number`                        | `40`      | Row height in pixels for `CdkVirtualScrollViewport`.                                   |
| `selectableTypes`  | `'files' \| 'folders' \| 'all'` | `'files'` | Which item kinds can be selected. Use `'folders'` for a folder picker.                 |
| `readOnly`         | `boolean`                       | `false`   | Disable drag/rename/delete/add UI.                                                     |
| `actions`          | `NgxTreeActions`                | `{}`      | Per-action availability. See below.                                                    |

### `actions` input

`NgxTreeActions` has four optional keys — `add`, `rename`, `delete`, `move`.
Each value can be a `boolean` or a per-row predicate
`(item: NgxTreeProxyItem) => boolean`. **Omitted keys default to `true`.**

```html
<!-- Disable delete globally; keep add/rename/move -->
<ngx-powerful-tree [nodes]="nodes()" [actions]="{ delete: false }" />

<!-- Disable delete only for folders that still have children -->
<ngx-powerful-tree [nodes]="nodes()" [actions]="{ delete: deleteWhenEmpty }" />
```

```ts
deleteWhenEmpty = (item: NgxTreeProxyItem) => !item.isFolder || item.children.length === 0;
```

### Truncate vs wrap

Names are truncated with an ellipsis by default. To let names wrap onto
multiple lines, add the `ngx-tree-wrap` class on the host:

```html
<ngx-powerful-tree [nodes]="nodes()" class="ngx-tree-wrap" />
```

## Headless Theming (CSS Variables)

The tree provides a clean, wireframed design that delegates all colors, spacings, and borders to CSS variables. You can easily override these variables on the component host to integrate the tree seamlessly with your application's design system:

```css
.tree-wrapper ngx-powerful-tree {
  /* Demonstrate headless design overrides - customize to match playground container theme */
  --ngx-tree-background: var(--pg-surface);
  --ngx-tree-text-color: var(--pg-color);
  --ngx-tree-selection-bg: rgba(59, 130, 246, 0.15);
  --ngx-tree-row-hover-bg: rgba(255, 255, 255, 0.03);
  --ngx-tree-focus-ring: var(--pg-accent-blue);
  --ngx-tree-drag-line: var(--pg-accent-blue);
  --ngx-tree-container-border: var(--pg-border);
  --ngx-tree-container-border-radius: 8px;
  --ngx-tree-font-size-base: 0.92rem;
  --ngx-tree-row-height-min: 38px;
  --ngx-tree-row-padding-base: 5px 12px;
}
```

## Outputs

| Output             | Payload                                                          |
| ------------------ | ---------------------------------------------------------------- |
| `itemMoved`        | `{ draggedId, targetId, position: 'before'\|'after'\|'inside' }` |
| `itemRenamed`      | `{ id, name }`                                                   |
| `itemAdded`        | `{ parentId, node }`                                             |
| `itemDeleted`      | `id`                                                             |
| `selectionChanged` | `string[]` (sorted ids)                                          |
| `focusedChanged`   | `string \| null`                                                 |
| `moveRequested`    | `id` (consumer opens a relocation picker)                        |

`selectionChanged` and `focusedChanged` emit raw — they fire on every
underlying state change, even when the payload is identical. Dedupe in the
consumer if you need to.

## Locked subtrees

Set `locked: true` on any node to make it and its descendants read-only.
The lock is enforced by the store: `addItem`, `deleteItem`, `renameItem`,
`moveItem`, and `setEditingItemId` reject operations on locked nodes and
return `false`. Lock state propagates down at runtime — child items
inherit the lock through `parentMap` traversal, you don't need to set
`locked` on every descendant.

## Custom templates

Project `<ng-template #itemTemplate>` to override every row, or
`<ng-template #fileTemplate>` to override only files. Both are looked up
reactively, so wrapping them in `@if` blocks for conditional rendering is
supported:

```html
<ngx-powerful-tree [nodes]="nodes()">
  @if (useCustomFileTemplate()) {
  <ng-template #fileTemplate let-item>
    <!-- your custom file row -->
  </ng-template>
  }
</ngx-powerful-tree>
```

### Aligning custom rows with default rows

The default folder row starts with a 26px-wide chevron button (or
placeholder when the folder has no visible children). If you write a custom
`#fileTemplate`, files won't have that chevron — to make custom files align
horizontally with sibling folders, reserve the same 26px of leading space
yourself:

```html
<ng-template #fileTemplate let-item>
  <div class="ngx-tree-row-content">
    <!-- Offset expand button space (26px) so custom files align perfectly with folders -->
    <div style="width: 26px; flex-shrink: 0" aria-hidden="true"></div>

    <span class="ngx-tree-item-icon"><i class="fa-solid fa-file"></i></span>
    <span class="ngx-tree-item-name">{{ item.name }}</span>
  </div>
</ng-template>
```

## Running unit tests

```sh
nx test ngx-powerful-tree
```
