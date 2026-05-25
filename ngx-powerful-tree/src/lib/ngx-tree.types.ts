export interface NgxTreeItem<T = any> {
  id: string;
  name: string;
  isFolder: boolean;
  children?: string[]; // IDs of children (only for folders)
  data?: T; // Custom optional payload
  locked?: boolean; // Lock state for folder and all descendants
  icon?: string; // Optional class string for custom icons (e.g. FontAwesome)
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
}

export interface NgxTreeState<T = any> {
  items: Record<string, NgxTreeItem<T>>;
  rootIds: string[];
  expandedItems: Set<string>;
  selectedItems: Set<string>;
  focusedItemId: string | null;
  editingItemId: string | null;
  searchQuery: string;
  dragState: DragState;
  foldersOnly: boolean;
}
