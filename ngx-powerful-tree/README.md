# ngx-powerful-tree

A virtualized Angular tree component with native HTML5 drag-and-drop, fluid
search, locked subtrees, and folder/file picker modes. Built on
`@ngrx/signals` and `@angular/cdk/scrolling`.

## Installation

```sh
npm i ngx-powerful-tree @angular/cdk @ngrx/signals
```

## Quick start

```ts
import { NgxPowerfulTree, NgxTreeItem } from 'ngx-powerful-tree';

@Component({
  imports: [NgxPowerfulTree],
  template: `
    <ngx-powerful-tree
      [items]="items()"
      [rootIds]="rootIds()"
      [searchQuery]="search()"
      (itemMoved)="onMoved($event)"
      (itemRenamed)="onRenamed($event)"
      (itemDeleted)="onDeleted($event)"
    />
  `,
})
export class MyTree {
  items = signal<Record<string, NgxTreeItem>>({...});
  rootIds = signal<string[]>(['root']);
  ...
}
```

## State ownership: the contract

**The tree owns its state after the first input emission.** `items` and
`rootIds` are read once on mount and then ignored — internal mutations
(move/rename/add/delete via the UI or store) survive parent re-emissions
without being silently overwritten.

To swap the dataset entirely (e.g. after loading from a server), call the
public `reload()` method:

```ts
@ViewChild('tree') tree!: NgxPowerfulTree;

async refresh() {
  const data = await this.api.fetchTree();
  this.tree.reload(data.items, data.rootIds);
}
```

`reload()` also clears expand/select/focus/search/drag state so the new
dataset starts from a clean slate.

To keep an external mirror in sync, subscribe to the fine-grained outputs
(`itemMoved`, `itemRenamed`, `itemAdded`, `itemDeleted`,
`selectionChanged`, `focusedChanged`). The tree never emits a full-tree
snapshot — at 100k+ items that would dwarf the cost of the mutation itself.

## Inputs

| Input                | Type                                    | Default | Description                                                                                     |
| -------------------- | --------------------------------------- | ------- | ----------------------------------------------------------------------------------------------- |
| `items` (required)   | `Record<string, NgxTreeItem>`           | —       | Seed item registry. Read once on first emission.                                                |
| `rootIds` (required) | `string[]`                              | —       | Seed root order. Read once on first emission.                                                   |
| `searchQuery`        | `string`                                | `''`    | Substring filter. Debounced by `searchDebounceMs`.                                              |
| `searchDebounceMs`   | `number`                                | `120`   | Debounce window for search input. `0` to apply immediately.                                     |
| `multiSelect`        | `boolean`                               | `false` | Allow selecting multiple items with click + meta or Space.                                      |
| `itemSize`           | `number`                                | `40`    | Row height in pixels for `CdkVirtualScrollViewport`.                                            |
| `foldersOnly`        | `boolean`                               | `false` | Visual filter: hide files entirely. Useful for folder pickers.                                  |
| `selectableTypes`    | `'files' \| 'folders' \| 'all' \| null` | `null`  | Which item kinds can be selected. When `null`, inferred from `foldersOnly` (`'folders'` if on). |
| `readOnly`           | `boolean`                               | `false` | Disable drag/rename/delete/add UI.                                                              |
| `folderIcon`         | `string`                                | `''`    | Global folder icon CSS class (e.g. `'fa-solid fa-folder'`).                                     |
| `fileIcon`           | `string`                                | `''`    | Global file icon CSS class (e.g. `'fa-solid fa-file'`).                                         |
| `truncate`           | `boolean`                               | `true`  | Truncate row names with ellipsis when they overflow.                                            |
| `allowAdd`           | `boolean`                               | `true`  | Show the inline add-folder button on hover.                                                     |
| `allowRename`        | `boolean`                               | `true`  | Show the inline rename button on hover.                                                         |
| `allowDelete`        | `boolean`                               | `true`  | Show the inline delete button on hover.                                                         |
| `allowMove`          | `boolean`                               | `true`  | Show the inline move-to button on hover (emits `moveRequested`).                                |

## Outputs

| Output             | Payload                                                          |
| ------------------ | ---------------------------------------------------------------- |
| `itemMoved`        | `{ draggedId, targetId, position: 'before'\|'after'\|'inside' }` |
| `itemRenamed`      | `{ id, name }`                                                   |
| `itemAdded`        | `{ parentId, item }`                                             |
| `itemDeleted`      | `id`                                                             |
| `selectionChanged` | `string[]` (sorted ids)                                          |
| `focusedChanged`   | `string \| null`                                                 |
| `moveRequested`    | `id` (consumer opens a relocation picker)                        |

`selectionChanged` and `focusedChanged` only fire when the payload
actually changes — identity-equality is checked before emit.

## Locked subtrees

Set `locked: true` on any item to make it and its descendants read-only.
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
<ngx-powerful-tree [items]="..." [rootIds]="...">
  @if (useCustomFileTemplate()) {
  <ng-template #fileTemplate let-item>
    <!-- your custom file row -->
  </ng-template>
  }
</ngx-powerful-tree>
```

## Running unit tests

```sh
nx test ngx-powerful-tree
```
