import { computed } from '@angular/core';
import { signalStore, withState, withComputed, withMethods, patchState } from '@ngrx/signals';
import {
  NgxTreeItem,
  NgxTreeProxyItem,
  NgxTreeStructuralItem,
  NgxTreeState,
  DragPosition,
  SelectableTypes,
} from './ngx-tree.types';

const initialState: NgxTreeState = {
  items: {},
  rootIds: [],
  expandedItems: new Set<string>(),
  selectedItems: new Set<string>(),
  focusedItemId: null,
  editingItemId: null,
  searchQuery: '',
  dragState: {
    draggedItemId: null,
    dragOverItemId: null,
    position: null,
  },
  selectableTypes: 'files',
};

const isItemSelectable = (item: NgxTreeItem | undefined, selectable: SelectableTypes): boolean => {
  if (!item) return false;
  if (selectable === 'all') return true;
  if (selectable === 'folders') return item.isFolder;
  return !item.isFolder;
};

export const NgxTreeStore = signalStore(
  withState(initialState),
  withComputed((store) => {
    // Reflects the last committed items snapshot. Methods that spread-copy
    // items and then read parentMap() will see the pre-mutation mapping.
    const parentMap = computed(() => {
      const items = store.items();
      const mapping: Record<string, string> = {};
      for (const id in items) {
        const item = items[id];
        if (item.children) {
          for (const childId of item.children) {
            mapping[childId] = id;
          }
        }
      }
      return mapping;
    });

    // Lowercase name index built once per items change. Reused across keystrokes.
    const nameIndex = computed(() => {
      const items = store.items();
      const idx: Record<string, string> = {};
      for (const id in items) {
        idx[id] = items[id].name.toLowerCase();
      }
      return idx;
    });

    const searchIndex = computed(() => {
      const items = store.items();
      const query = store.searchQuery().trim().toLowerCase();
      const matchedIds = new Set<string>();
      const ancestorIds = new Set<string>();

      if (!query) {
        return { matchedIds, ancestorIds, isSearching: false };
      }

      const names = nameIndex();
      for (const id in items) {
        if (names[id].includes(query)) {
          matchedIds.add(id);
        }
      }

      const parents = parentMap();
      for (const matchedId of matchedIds) {
        let parentId = parents[matchedId];
        while (parentId) {
          if (ancestorIds.has(parentId)) break;
          ancestorIds.add(parentId);
          parentId = parents[parentId];
        }
      }

      return { matchedIds, ancestorIds, isSearching: true };
    });

    // Structural flat list — depends only on items/rootIds/expanded/search/selectableTypes.
    // Row-state (focused/selected/editing/drag) is read separately in the directive so
    // a focus/selection change doesn't re-flatten the whole tree.
    const flattenedStructure = computed(() => {
      const items = store.items();
      const rootIds = store.rootIds();
      const expandedItems = store.expandedItems();
      const selectableTypes = store.selectableTypes();
      const foldersOnly = selectableTypes === 'folders'; // hide files in folder-only mode
      const { matchedIds, ancestorIds, isSearching } = searchIndex();

      const list: NgxTreeStructuralItem[] = [];
      const indexById: Record<string, number> = {};

      const traverse = (
        id: string,
        depth: number,
        parentId: string | null,
        parentLocked: boolean
      ) => {
        const item = items[id];
        if (!item) return;

        if (foldersOnly && !item.isFolder) return;

        const matches = matchedIds.has(id);
        const isAncestor = ancestorIds.has(id);
        if (isSearching && !matches && !isAncestor) return;

        const isExpanded = isSearching
          ? isAncestor || expandedItems.has(id)
          : expandedItems.has(id);
        const isLocked = parentLocked || !!item.locked;

        const hasChildren = !!(item.isFolder && item.children && item.children.length > 0);
        const hasFolderChildren = !!(
          item.isFolder &&
          item.children &&
          item.children.some((childId) => items[childId]?.isFolder)
        );
        const hasVisibleChildren = foldersOnly ? hasFolderChildren : hasChildren;

        indexById[id] = list.length;
        list.push({
          id,
          depth,
          parentId,
          isFolder: item.isFolder,
          children: item.children || [],
          matchesSearch: matches,
          locked: isLocked,
          hasVisibleChildren,
          expanded: isExpanded,
          name: item.name,
          icon: item.icon,
          data: item.data,
        });

        if (item.isFolder && item.children) {
          const shouldTraverseChildren = isSearching ? true : isExpanded;
          if (shouldTraverseChildren) {
            for (const childId of item.children) {
              traverse(childId, depth + 1, id, isLocked);
            }
          }
        }
      };

      for (const rootId of rootIds) {
        traverse(rootId, 0, null, false);
      }

      return { list, indexById };
    });

    // Backwards-compatible projection: merges structural and row state into the
    // legacy NgxTreeProxyItem shape. Read this only when the merged view is
    // genuinely needed (template, keyboard navigation). The directive should
    // read structural + state separately for hot paths.
    const flattenedVisibleItems = computed<NgxTreeProxyItem[]>(() => {
      const { list } = flattenedStructure();
      const selectedItems = store.selectedItems();
      const focusedItemId = store.focusedItemId();
      const editingItemId = store.editingItemId();

      const out: NgxTreeProxyItem[] = new Array(list.length);
      for (let i = 0; i < list.length; i++) {
        const node = list[i];
        out[i] = {
          id: node.id,
          name: node.name,
          isFolder: node.isFolder,
          parentId: node.parentId,
          children: node.children,
          depth: node.depth,
          expanded: node.expanded, // already computed by flattenedStructure
          selected: selectedItems.has(node.id),
          focused: focusedItemId === node.id,
          editing: editingItemId === node.id,
          matchesSearch: node.matchesSearch,
          locked: node.locked,
          data: node.data,
          icon: node.icon,
          hasVisibleChildren: node.hasVisibleChildren,
        };
      }
      return out;
    });

    return {
      parentMap,
      nameIndex,
      searchIndex,
      flattenedStructure,
      flattenedVisibleItems,
      totalVisibleCount: computed(() => flattenedStructure().list.length),
    };
  }),
  withMethods((store) => {
    const isLocked = (id: string): boolean => {
      const items = store.items();
      const parents = store.parentMap();
      let cursor: string | undefined = id;
      while (cursor) {
        const item = items[cursor];
        if (!item) return false;
        if (item.locked) return true;
        cursor = parents[cursor];
      }
      return false;
    };

    const applyExpanded = (id: string, isExpanded: boolean) => {
      const expanded = new Set(store.expandedItems());
      if (isExpanded) expanded.add(id);
      else expanded.delete(id);
      patchState(store, { expandedItems: expanded });
    };

    return {
      isLocked,

      setItems(items: Record<string, NgxTreeItem>, rootIds: string[]) {
        patchState(store, { items, rootIds });
      },

      reload(items: Record<string, NgxTreeItem>, rootIds: string[]) {
        patchState(store, {
          items,
          rootIds,
          expandedItems: new Set<string>(),
          selectedItems: new Set<string>(),
          focusedItemId: null,
          editingItemId: null,
          searchQuery: '',
          dragState: { draggedItemId: null, dragOverItemId: null, position: null },
        });
      },

      toggleExpand(id: string) {
        applyExpanded(id, !store.expandedItems().has(id));
      },

      setExpanded(id: string, isExpanded: boolean) {
        applyExpanded(id, isExpanded);
      },

      expandAll() {
        const expanded = new Set<string>();
        const items = store.items();
        for (const id in items) {
          if (items[id].isFolder) expanded.add(id);
        }
        patchState(store, { expandedItems: expanded });
      },

      collapseAll() {
        patchState(store, { expandedItems: new Set<string>() });
      },

      selectItem(id: string, multiSelect = false): boolean {
        const item = store.items()[id];
        if (!item) return false;
        const selectable = store.selectableTypes();
        if (!isItemSelectable(item, selectable)) {
          patchState(store, { focusedItemId: id });
          return false;
        }
        const current = store.selectedItems();
        const selected = new Set<string>(multiSelect ? current : []);
        if (multiSelect && selected.has(id)) selected.delete(id);
        else selected.add(id);
        // Skip emission if membership is unchanged in single-select case.
        if (!multiSelect && current.size === 1 && current.has(id)) {
          patchState(store, { focusedItemId: id });
          return true;
        }
        patchState(store, { selectedItems: selected, focusedItemId: id });
        return true;
      },

      clearSelection() {
        if (store.selectedItems().size === 0) return;
        patchState(store, { selectedItems: new Set<string>() });
      },

      setFocusedItemId(id: string | null) {
        if (store.focusedItemId() === id) return;
        patchState(store, { focusedItemId: id });
      },

      setEditingItemId(id: string | null) {
        if (id !== null && isLocked(id)) return;
        if (store.editingItemId() === id) return;
        patchState(store, { editingItemId: id });
      },

      setSearchQuery(query: string) {
        if (store.searchQuery() === query) return;
        patchState(store, { searchQuery: query });
      },

      setSelectableTypes(selectableTypes: SelectableTypes) {
        if (store.selectableTypes() === selectableTypes) return;
        patchState(store, { selectableTypes });
      },

      renameItem(id: string, newName: string): boolean {
        const current = store.items();
        const item = current[id];
        if (!item) return false;
        if (isLocked(id)) {
          patchState(store, { editingItemId: null });
          return false;
        }
        const trimmed = newName.trim();
        if (!trimmed || trimmed === item.name) {
          patchState(store, { editingItemId: null });
          return false;
        }
        const items = { ...current, [id]: { ...item, name: trimmed } };
        patchState(store, { items, editingItemId: null });
        return true;
      },

      addItem(parentId: string | null, newItem: NgxTreeItem): boolean {
        const current = store.items();
        if (current[newItem.id]) return false; // duplicate id
        if (parentId && isLocked(parentId)) return false;

        const items = { ...current, [newItem.id]: newItem };
        let rootIds = store.rootIds();
        if (parentId === null) {
          rootIds = newItem.isFolder ? [newItem.id, ...rootIds] : [...rootIds, newItem.id];
        } else {
          const parent = items[parentId];
          if (!parent || !parent.isFolder) return false;
          const children = parent.children ? [...parent.children] : [];
          if (newItem.isFolder) children.unshift(newItem.id);
          else children.push(newItem.id);
          items[parentId] = { ...parent, children };
        }

        const expanded = new Set(store.expandedItems());
        if (parentId) expanded.add(parentId);

        patchState(store, {
          items,
          rootIds,
          expandedItems: expanded,
          focusedItemId: newItem.id,
        });
        return true;
      },

      deleteItem(id: string): boolean {
        const current = store.items();
        if (!current[id]) return false;
        if (isLocked(id)) return false;

        const items = { ...current };
        const parents = store.parentMap();
        const parentId = parents[id];
        let rootIds = store.rootIds();

        if (parentId) {
          const parent = items[parentId];
          if (parent && parent.children) {
            items[parentId] = {
              ...parent,
              children: parent.children.filter((cId) => cId !== id),
            };
          }
        } else {
          rootIds = rootIds.filter((rId) => rId !== id);
        }

        const deletedIds = new Set<string>();
        const stack = [id];
        while (stack.length) {
          const cur = stack.pop()!;
          if (deletedIds.has(cur)) continue; // cycle protection
          deletedIds.add(cur);
          const item = items[cur];
          if (item?.children) {
            for (const child of item.children) {
              if (!deletedIds.has(child)) stack.push(child);
            }
          }
          delete items[cur];
        }

        const selected = new Set(store.selectedItems());
        const expanded = new Set(store.expandedItems());
        let selectedChanged = false;
        for (const dId of deletedIds) {
          if (selected.delete(dId)) selectedChanged = true;
          expanded.delete(dId);
        }

        const focusedItemId =
          store.focusedItemId() && deletedIds.has(store.focusedItemId()!)
            ? null
            : store.focusedItemId();
        const editingItemId =
          store.editingItemId() && deletedIds.has(store.editingItemId()!)
            ? null
            : store.editingItemId();

        patchState(store, {
          items,
          rootIds,
          selectedItems: selectedChanged ? selected : store.selectedItems(),
          expandedItems: expanded,
          focusedItemId,
          editingItemId,
        });
        return true;
      },

      moveItem(draggedId: string, targetId: string, position: DragPosition): boolean {
        if (!position) return false;
        const current = store.items();
        if (!current[draggedId] || !current[targetId] || draggedId === targetId) return false;
        if (isLocked(draggedId)) return false;
        if (position === 'inside' && isLocked(targetId)) return false;
        if (position !== 'inside') {
          const parents = store.parentMap();
          const destParentId = parents[targetId];
          if (destParentId && isLocked(destParentId)) return false;
        }

        // Cycle/descendant prevention with visited guard.
        const isDescendant = (parent: string, child: string): boolean => {
          const visited = new Set<string>();
          const stack = [parent];
          while (stack.length) {
            const cur = stack.pop()!;
            if (visited.has(cur)) continue;
            visited.add(cur);
            const item = current[cur];
            if (!item?.children) continue;
            if (item.children.includes(child)) return true;
            for (const c of item.children) stack.push(c);
          }
          return false;
        };
        if (isDescendant(draggedId, targetId)) return false;

        const items = { ...current };
        let rootIds = store.rootIds();
        const parents = store.parentMap();
        const sourceParentId = parents[draggedId];

        if (sourceParentId) {
          const sourceParent = items[sourceParentId];
          if (sourceParent?.children) {
            items[sourceParentId] = {
              ...sourceParent,
              children: sourceParent.children.filter((cId) => cId !== draggedId),
            };
          }
        } else {
          rootIds = rootIds.filter((cId) => cId !== draggedId);
        }

        let expandedNext: Set<string> | null = null;
        if (position === 'inside') {
          const target = items[targetId];
          if (!target || !target.isFolder) return false;
          const children = target.children ? [...target.children] : [];
          children.unshift(draggedId);
          items[targetId] = { ...target, children };
          expandedNext = new Set(store.expandedItems());
          expandedNext.add(targetId);
        } else {
          const destParentId = parents[targetId];
          if (destParentId) {
            const destParent = items[destParentId];
            if (destParent?.children) {
              const children = [...destParent.children];
              const idx = children.indexOf(targetId);
              const insertIdx = position === 'before' ? idx : idx + 1;
              children.splice(insertIdx, 0, draggedId);
              items[destParentId] = { ...destParent, children };
            }
          } else {
            rootIds = [...rootIds];
            const idx = rootIds.indexOf(targetId);
            const insertIdx = position === 'before' ? idx : idx + 1;
            rootIds.splice(insertIdx, 0, draggedId);
          }
        }

        patchState(store, {
          items,
          rootIds,
          focusedItemId: draggedId,
          ...(expandedNext ? { expandedItems: expandedNext } : {}),
          dragState: { draggedItemId: null, dragOverItemId: null, position: null },
        });
        return true;
      },

      setDragState(
        draggedItemId: string | null,
        dragOverItemId: string | null,
        position: DragPosition
      ) {
        const cur = store.dragState();
        if (
          cur.draggedItemId === draggedItemId &&
          cur.dragOverItemId === dragOverItemId &&
          cur.position === position
        ) {
          return;
        }
        patchState(store, { dragState: { draggedItemId, dragOverItemId, position } });
      },

      clearDragState() {
        const cur = store.dragState();
        if (!cur.draggedItemId && !cur.dragOverItemId && !cur.position) return;
        patchState(store, {
          dragState: { draggedItemId: null, dragOverItemId: null, position: null },
        });
      },
    };
  })
);
