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
 * Proxy item representing a node in the tree at runtime.
 * We use this proxy to avoid mutating the original user items.
 */
export interface NgxTreeProxyItem<T = any> {
  id: string;
  name: string;
  isFolder: boolean;
  parentId: string | null;
  children: string[];
  depth: number;
  expanded: boolean;
  selected: boolean;
  focused: boolean;
  editing: boolean;
  matchesSearch: boolean;
  locked: boolean; // Inherited locked state at runtime
  data?: T;
  icon?: string; // Runtime resolved custom icon
  hasVisibleChildren: boolean; // Dynamic child count check for chevron rendering
}

export type SelectableTypes = 'files' | 'folders' | 'all';

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
  foldersOnly: boolean;
}
