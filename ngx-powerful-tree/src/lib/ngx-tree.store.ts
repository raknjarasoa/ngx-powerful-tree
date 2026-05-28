import { Injectable, computed, signal } from '@angular/core';
import {
  DragPosition,
  NgxTreeItem,
  NgxTreeSearchPredicate,
  NgxTreeStructuralItem,
  SelectableTypes,
  OTHER_USERS_ROOT_ID,
} from './ngx-tree.types';

const isItemSelectable = (item: NgxTreeItem | undefined, selectable: SelectableTypes): boolean => {
  if (!item) return false;
  if (selectable === 'all') return true;
  if (selectable === 'folders') return item.isFolder;
  return !item.isFolder;
};

@Injectable()
export class NgxTreeStore {
  // --- Mutable Data for O(1) mutations ---
  private readonly itemsMap = new Map<string, NgxTreeItem>();
  private readonly parentsMap = new Map<string, string | null>();

  // --- Signals ---
  readonly rootIds = signal<string[]>([]);
  readonly expandedItems = signal<Set<string>>(new Set());
  readonly selectedItems = signal<Set<string>>(new Set());
  readonly focusedItemId = signal<string | null>(null);
  readonly editingItemId = signal<string | null>(null);
  readonly searchQuery = signal<string>('');
  readonly selectableTypes = signal<SelectableTypes>('files');
  readonly searchPredicate = signal<NgxTreeSearchPredicate | null>(null);

  // Drag state. `draggedItemId` is set on dragstart; `dragTargetId` and
  // `dragPosition` are updated centrally by NgxPowerfulTree based on viewport
  // math so rows never mutate native DOM classes during drag.
  readonly draggedItemId = signal<string | null>(null);
  readonly dragTargetId = signal<string | null>(null);
  readonly dragPosition = signal<DragPosition | null>(null);

  // Bump this version signal whenever itemsMap/parentsMap/rootIds structurally change
  private readonly version = signal(0);

  // --- Computed Views ---
  readonly flattenedStructure = computed(() => {
    this.version(); // Dependency on structural changes
    const rootIds = this.rootIds();
    const expanded = this.expandedItems();
    const selectable = this.selectableTypes();
    const query = this.searchQuery().trim().toLowerCase();

    const isSearching = query.length > 0;
    const matchedIds = new Set<string>();
    const ancestorIds = new Set<string>();

    if (isSearching) {
      const customPredicate = this.searchPredicate();
      for (const [id, item] of this.itemsMap.entries()) {
        const matches = customPredicate
          ? customPredicate(item, query)
          : item.name.toLowerCase().includes(query);
        if (matches) {
          matchedIds.add(id);
          let curr = this.parentsMap.get(id);
          while (curr) {
            if (ancestorIds.has(curr)) break;
            ancestorIds.add(curr);
            curr = this.parentsMap.get(curr);
          }
        }
      }
    }

    const foldersOnly = selectable === 'folders';
    const list: NgxTreeStructuralItem[] = [];
    const indexById: Record<string, number> = {};

    interface StackItem {
      id: string;
      depth: number;
      parentId: string | null;
      parentLocked: boolean;
    }
    const stack: StackItem[] = [];

    for (let i = rootIds.length - 1; i >= 0; i--) {
      stack.push({ id: rootIds[i], depth: 0, parentId: null, parentLocked: false });
    }

    while (stack.length > 0) {
      const { id, depth, parentId, parentLocked } = stack.pop()!;
      const item = this.itemsMap.get(id);
      if (!item) continue;

      if (foldersOnly && !item.isFolder) continue;

      const matches = isSearching ? matchedIds.has(id) : false;
      const isAncestor = isSearching ? ancestorIds.has(id) : false;

      if (isSearching && !matches && !isAncestor) continue;

      const isExpanded = isSearching ? isAncestor || expanded.has(id) : expanded.has(id);
      const locked = parentLocked || !!item.locked;

      const children = item.children || [];
      let hasFolderChildren = false;
      if (foldersOnly) {
        for (const cid of children) {
          if (this.itemsMap.get(cid)?.isFolder) {
            hasFolderChildren = true;
            break;
          }
        }
      }

      const hasVisibleChildren = foldersOnly ? hasFolderChildren : children.length > 0;

      indexById[id] = list.length;
      list.push({
        id,
        depth,
        parentId,
        isFolder: item.isFolder,
        children,
        matchesSearch: matches,
        locked,
        hasVisibleChildren,
        expanded: isExpanded,
        name: item.name,
        icon: item.icon,
        data: item.data,
      });

      if (item.isFolder && children.length > 0) {
        const shouldTraverse = isSearching ? true : isExpanded;
        if (shouldTraverse) {
          for (let i = children.length - 1; i >= 0; i--) {
            stack.push({ id: children[i], depth: depth + 1, parentId: id, parentLocked: locked });
          }
        }
      }
    }

    return { list, indexById };
  });

  readonly totalVisibleCount = computed(() => this.flattenedStructure().list.length);

  // --- Methods ---

  isLocked(id: string): boolean {
    let curr: string | null | undefined = id;
    while (curr) {
      const item = this.itemsMap.get(curr);
      if (!item) return false;
      if (item.locked) return true;
      curr = this.parentsMap.get(curr);
    }
    return false;
  }

  isDescendantOf(childId: string, parentId: string): boolean {
    if (childId === parentId) return true;
    let curr = this.parentsMap.get(childId);
    while (curr !== undefined && curr !== null) {
      if (curr === parentId) return true;
      curr = this.parentsMap.get(curr);
    }
    return false;
  }

  setItems(itemsRecord: Record<string, NgxTreeItem>, rootIds: string[]) {
    this.itemsMap.clear();
    this.parentsMap.clear();
    for (const id in itemsRecord) {
      const item = itemsRecord[id];
      this.itemsMap.set(id, item);
      if (item.children) {
        for (const childId of item.children) {
          this.parentsMap.set(childId, id);
        }
      }
    }
    for (const rootId of rootIds) {
      this.parentsMap.set(rootId, null);
    }
    this.rootIds.set([...rootIds]);
    this.version.update((v) => v + 1);
  }

  reload(itemsRecord: Record<string, NgxTreeItem>, rootIds: string[]) {
    this.setItems(itemsRecord, rootIds);
    this.expandedItems.set(new Set());
    this.selectedItems.set(new Set());
    this.focusedItemId.set(null);
    this.editingItemId.set(null);
    this.searchQuery.set('');
    this.clearDragState();
  }

  setDragState(
    draggedId: string | null,
    targetId: string | null = null,
    position: DragPosition | null = null
  ) {
    this.draggedItemId.set(draggedId);
    this.dragTargetId.set(targetId);
    this.dragPosition.set(position);
  }

  clearDragState() {
    this.draggedItemId.set(null);
    this.dragTargetId.set(null);
    this.dragPosition.set(null);
  }

  toggleExpand(id: string) {
    this.expandedItems.update((set) => {
      const next = new Set(set);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  setExpanded(id: string, isExpanded: boolean) {
    this.expandedItems.update((set) => {
      // No-op shortcut: skip Set recreation when state already matches.
      // flattenedStructure depends on this signal, so spurious updates
      // recompute the entire visible list — expensive during drag.
      if (isExpanded === set.has(id)) return set;
      const next = new Set(set);
      if (isExpanded) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  expandAll() {
    const next = new Set<string>();
    for (const [id, item] of this.itemsMap.entries()) {
      if (item.isFolder) next.add(id);
    }
    this.expandedItems.set(next);
  }

  collapseAll() {
    this.expandedItems.set(new Set());
  }

  selectItem(id: string, multiSelect = false): boolean {
    const item = this.itemsMap.get(id);
    if (!item) return false;
    const selectable = this.selectableTypes();
    if (!isItemSelectable(item, selectable)) {
      this.focusedItemId.set(id);
      return false;
    }

    this.selectedItems.update((set) => {
      // Single-select no-op: already the sole selection.
      if (!multiSelect && set.size === 1 && set.has(id)) return set;
      const next = new Set(multiSelect ? set : []);
      if (multiSelect && next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    this.focusedItemId.set(id);
    return true;
  }

  clearSelection() {
    this.selectedItems.set(new Set());
  }

  setFocusedItemId(id: string | null) {
    this.focusedItemId.set(id);
  }

  setEditingItemId(id: string | null) {
    if (id !== null && this.isLocked(id)) return;
    this.editingItemId.set(id);
  }

  setSearchQuery(query: string) {
    this.searchQuery.set(query);
  }

  setSelectableTypes(types: SelectableTypes) {
    this.selectableTypes.set(types);
  }

  renameItem(id: string, newName: string): boolean {
    const item = this.itemsMap.get(id);
    if (!item || this.isLocked(id)) {
      this.editingItemId.set(null);
      return false;
    }
    const trimmed = newName.trim();
    if (!trimmed || trimmed === item.name) {
      this.editingItemId.set(null);
      return false;
    }
    item.name = trimmed; // Mutate in place
    this.editingItemId.set(null);
    this.version.update((v) => v + 1);
    return true;
  }

  addItem(parentId: string | null, newItem: NgxTreeItem): boolean {
    if (this.itemsMap.has(newItem.id)) return false;
    if (parentId && this.isLocked(parentId)) return false;

    // Mutate copy of children if provided
    const itemToStore = { ...newItem, children: newItem.children ? [...newItem.children] : [] };
    this.itemsMap.set(newItem.id, itemToStore);
    this.parentsMap.set(newItem.id, parentId);

    if (parentId === null) {
      this.rootIds.update((ids) => {
        const next = [...ids];
        if (itemToStore.isFolder) next.unshift(newItem.id);
        else next.push(newItem.id);
        return next;
      });
    } else {
      const parent = this.itemsMap.get(parentId);
      if (!parent || !parent.isFolder) {
        this.itemsMap.delete(newItem.id);
        this.parentsMap.delete(newItem.id);
        return false;
      }
      parent.children = parent.children || [];
      if (itemToStore.isFolder) parent.children.unshift(newItem.id);
      else parent.children.push(newItem.id);
      this.setExpanded(parentId, true);
    }

    this.version.update((v) => v + 1);
    this.focusedItemId.set(newItem.id);
    return true;
  }

  deleteItem(id: string): boolean {
    if (!this.itemsMap.has(id) || this.isLocked(id)) return false;

    const parentId = this.parentsMap.get(id);
    if (parentId !== undefined && parentId !== null) {
      const parent = this.itemsMap.get(parentId);
      if (parent && parent.children) {
        parent.children = parent.children.filter((cid) => cid !== id);
      }
    } else {
      this.rootIds.update((ids) => ids.filter((rid) => rid !== id));
    }

    const deletedIds = new Set<string>();
    const stack = [id];
    while (stack.length > 0) {
      const curr = stack.pop()!;
      if (deletedIds.has(curr)) continue;
      deletedIds.add(curr);
      const item = this.itemsMap.get(curr);
      if (item && item.children) {
        for (const cid of item.children) stack.push(cid);
      }
      this.itemsMap.delete(curr);
      this.parentsMap.delete(curr);
    }

    this.selectedItems.update((set) => {
      let changed = false;
      const next = new Set(set);
      for (const did of deletedIds) {
        if (next.delete(did)) changed = true;
      }
      return changed ? next : set;
    });

    this.expandedItems.update((set) => {
      let changed = false;
      const next = new Set(set);
      for (const did of deletedIds) {
        if (next.delete(did)) changed = true;
      }
      return changed ? next : set;
    });

    const focused = this.focusedItemId();
    if (focused && deletedIds.has(focused)) this.focusedItemId.set(null);

    const editing = this.editingItemId();
    if (editing && deletedIds.has(editing)) this.editingItemId.set(null);

    const dragged = this.draggedItemId();
    if (dragged && deletedIds.has(dragged)) {
      this.clearDragState();
    } else {
      const target = this.dragTargetId();
      if (target && deletedIds.has(target)) {
        this.dragTargetId.set(null);
        this.dragPosition.set(null);
      }
    }

    this.version.update((v) => v + 1);
    return true;
  }

  moveItem(draggedId: string, targetId: string, position: DragPosition): boolean {
    if (!position || draggedId === targetId) return false;
    const dragged = this.itemsMap.get(draggedId);
    const target = this.itemsMap.get(targetId);
    if (!dragged || !target || this.isLocked(draggedId)) return false;

    if (position === 'inside' && (!target.isFolder || this.isLocked(targetId))) return false;
    if (position !== 'inside') {
      const targetParentId = this.parentsMap.get(targetId);
      if (targetParentId && this.isLocked(targetParentId)) return false;
    }

    // Cycle check
    let curr: string | null | undefined = targetId;
    while (curr) {
      if (curr === draggedId) return false;
      curr = this.parentsMap.get(curr);
    }

    // Detach
    const sourceParentId = this.parentsMap.get(draggedId);
    if (sourceParentId !== undefined && sourceParentId !== null) {
      const sourceParent = this.itemsMap.get(sourceParentId);
      if (sourceParent && sourceParent.children) {
        sourceParent.children = sourceParent.children.filter((cid) => cid !== draggedId);
      }
    } else {
      this.rootIds.update((ids) => ids.filter((cid) => cid !== draggedId));
    }

    // Attach
    if (position === 'inside') {
      target.children = target.children || [];
      target.children.unshift(draggedId);
      this.parentsMap.set(draggedId, targetId);
      this.setExpanded(targetId, true);
    } else {
      const targetParentId = this.parentsMap.get(targetId);
      this.parentsMap.set(draggedId, targetParentId ?? null);
      if (targetParentId !== undefined && targetParentId !== null) {
        const targetParent = this.itemsMap.get(targetParentId);
        if (targetParent && targetParent.children) {
          const idx = targetParent.children.indexOf(targetId);
          const insertIdx = position === 'before' ? idx : idx + 1;
          targetParent.children.splice(insertIdx, 0, draggedId);
        }
      } else {
        this.rootIds.update((ids) => {
          const next = [...ids];
          const idx = next.indexOf(targetId);
          const insertIdx = position === 'before' ? idx : idx + 1;
          next.splice(insertIdx, 0, draggedId);
          return next;
        });
      }
    }

    this.focusedItemId.set(draggedId);
    this.version.update((v) => v + 1);
    return true;
  }

  moveToRoot(draggedId: string): boolean {
    if (this.isLocked(draggedId)) return false;
    const dragged = this.itemsMap.get(draggedId);
    if (!dragged) return false;

    const sourceParentId = this.parentsMap.get(draggedId);
    if (sourceParentId === undefined || sourceParentId === null) {
      return false; // Already at root!
    }

    // Detach from current parent
    const sourceParent = this.itemsMap.get(sourceParentId);
    if (sourceParent && sourceParent.children) {
      sourceParent.children = sourceParent.children.filter((cid) => cid !== draggedId);
    }

    // Attach to root level, placing it before OTHER_USERS_ROOT_ID if present, to preserve its end position
    this.parentsMap.set(draggedId, null);
    this.rootIds.update((ids) => {
      const next = ids.filter((cid) => cid !== draggedId);
      const otherUsersIdx = next.indexOf(OTHER_USERS_ROOT_ID);
      if (otherUsersIdx !== -1) {
        next.splice(otherUsersIdx, 0, draggedId);
      } else {
        next.push(draggedId);
      }
      return next;
    });

    this.focusedItemId.set(draggedId);
    this.version.update((v) => v + 1);
    return true;
  }

  // --- Public Accessors for External Integrations (e.g., Playground) ---

  getItem(id: string): NgxTreeItem | undefined {
    return this.itemsMap.get(id);
  }

  getParentId(id: string): string | null {
    return this.parentsMap.get(id) ?? null;
  }

  getRootIds(): string[] {
    return this.rootIds();
  }

  getAllItemsAsRecord(): Record<string, NgxTreeItem> {
    const record: Record<string, NgxTreeItem> = {};
    for (const [key, value] of this.itemsMap.entries()) {
      record[key] = value;
    }
    return record;
  }
}
