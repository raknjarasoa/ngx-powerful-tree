/**
 * Public, nested tree shape used by the `nodes` input. Children are embedded
 * directly. Pass this to <ngx-powerful-tree [nodes]="..."> and to reload().
 */
export interface NgxTreeNode<T = any> {
  id: string;
  name: string;
  isFolder: boolean;
  children?: NgxTreeNode<T>[];
  data?: T;
  locked?: boolean;
  icon?: string;
}

/**
 * Internal flat-map shape stored by NgxTreeStore. The store keeps a
 * `Record<id, NgxTreeItem>` plus a `rootIds` array so move/rename/delete
 * are O(1) on item lookup. Most consumers don't need this type — use
 * `NgxTreeNode` for inputs and outputs.
 */
export interface NgxTreeItem<T = any> {
  id: string;
  name: string;
  isFolder: boolean;
  children?: string[];
  data?: T;
  locked?: boolean;
  icon?: string;
}

export type DragPosition = 'before' | 'after' | 'inside' | null;

export interface DragState {
  draggedItemId: string | null;
  dragOverItemId: string | null;
  position: DragPosition;
}

/**
 * Structural item in the flattened visible list. Contains everything needed
 * for layout and rendering but NOT transient row state (selected, focused,
 * editing) — those are O(1) store lookups performed per-directive instance
 * so that a focus/selection change doesn't rebuild the full array.
 */
export interface NgxTreeStructuralItem<T = any> {
  id: string;
  name: string;
  isFolder: boolean;
  parentId: string | null;
  children: string[];
  depth: number;
  expanded: boolean;
  matchesSearch: boolean;
  locked: boolean;
  data?: T;
  icon?: string;
  hasVisibleChildren: boolean;
}

/**
 * Full proxy item with transient row state merged in. Used by the keyboard
 * handler and kept as backward-compatible accessor via `flattenedVisibleItems`.
 */
export interface NgxTreeProxyItem<T = any> extends NgxTreeStructuralItem<T> {
  selected: boolean;
  focused: boolean;
  editing: boolean;
}

export type SelectableTypes = 'files' | 'folders' | 'all';

export type NgxTreeSearchPredicate<T = any> = (item: NgxTreeItem<T>, query: string) => boolean;

export interface NgxTreeState<T = any> {
  items: Record<string, NgxTreeItem<T>>;
  rootIds: string[];
  expandedItems: Set<string>;
  selectedItems: Set<string>;
  focusedItemId: string | null;
  editingItemId: string | null;
  searchQuery: string;
  dragState: DragState;
  selectableTypes: SelectableTypes;
}
