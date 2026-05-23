import { computed } from '@angular/core';
import { signalStore, withState, withComputed, withMethods, patchState } from '@ngrx/signals';
import { NgxTreeItem, NgxTreeProxyItem, NgxTreeState, DragPosition } from './ngx-tree.types';

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
};

export const NgxTreeStore = signalStore(
  withState(initialState),
  withComputed((store) => {
    // 1. Build a parent map and children lookup for quick traversals
    const parentMap = computed(() => {
      const items = store.items();
      const mapping: Record<string, string> = {};
      for (const [id, item] of Object.entries(items)) {
        if (item.children) {
          for (const childId of item.children) {
            mapping[childId] = id;
          }
        }
      }
      return mapping;
    });

    // 2. Perform high-performance search indexing
    const searchIndex = computed(() => {
      const items = store.items();
      const query = store.searchQuery().trim().toLowerCase();
      const matchedIds = new Set<string>();
      const ancestorIds = new Set<string>();

      if (!query) {
        return { matchedIds, ancestorIds, isSearching: false };
      }

      // Find direct matches
      for (const [id, item] of Object.entries(items)) {
        if (item.name.toLowerCase().includes(query)) {
          matchedIds.add(id);
        }
      }

      // Build ancestors list for matches to ensure they are visible
      const parents = parentMap();
      for (const matchedId of matchedIds) {
        let parentId = parents[matchedId];
        while (parentId) {
          if (ancestorIds.has(parentId)) {
            break; // Already traversed this path
          }
          ancestorIds.add(parentId);
          parentId = parents[parentId];
        }
      }

      return { matchedIds, ancestorIds, isSearching: true };
    });

    // 3. Compute flattened list of visible items using depth-first search (DFS)
    const flattenedVisibleItems = computed(() => {
      const items = store.items();
      const rootIds = store.rootIds();
      const expandedItems = store.expandedItems();
      const selectedItems = store.selectedItems();
      const focusedItemId = store.focusedItemId();
      const editingItemId = store.editingItemId();
      const { matchedIds, ancestorIds, isSearching } = searchIndex();

      const list: NgxTreeProxyItem[] = [];

      const traverse = (id: string, depth: number, parentId: string | null) => {
        const item = items[id];
        if (!item) return;

        const matches = matchedIds.has(id);
        const isAncestor = ancestorIds.has(id);

        // If searching is active, only show items that match or are parents of matches
        if (isSearching && !matches && !isAncestor) {
          return;
        }

        // Ancestors of matches are forced to be expanded so search results are visible
        const isExpanded = isSearching
          ? isAncestor || expandedItems.has(id)
          : expandedItems.has(id);
        const isSelected = selectedItems.has(id);
        const isFocused = focusedItemId === id;
        const isEditing = editingItemId === id;

        list.push({
          id,
          name: item.name,
          isFolder: item.isFolder,
          parentId,
          children: item.children || [],
          depth,
          expanded: isExpanded,
          selected: isSelected,
          focused: isFocused,
          editing: isEditing,
          matchesSearch: matches,
          data: item.data,
        });

        // Recursively traverse children if expanded (or if under active search)
        if (item.isFolder && item.children) {
          // If searching, we traverse children even if folder isn't expanded in UI,
          // because we need to find matching descendants.
          const shouldTraverseChildren = isSearching ? true : isExpanded;
          if (shouldTraverseChildren) {
            for (const childId of item.children) {
              traverse(childId, depth + 1, id);
            }
          }
        }
      };

      for (const rootId of rootIds) {
        traverse(rootId, 0, null);
      }

      return list;
    });

    return {
      parentMap,
      searchIndex,
      flattenedVisibleItems,
      totalVisibleCount: computed(() => flattenedVisibleItems().length),
    };
  }),
  withMethods((store) => {
    return {
      setItems(items: Record<string, NgxTreeItem>, rootIds: string[]) {
        patchState(store, { items, rootIds });
      },

      toggleExpand(id: string) {
        const expanded = new Set(store.expandedItems());
        if (expanded.has(id)) {
          expanded.delete(id);
        } else {
          expanded.add(id);
        }
        patchState(store, { expandedItems: expanded });
      },

      setExpanded(id: string, isExpanded: boolean) {
        const expanded = new Set(store.expandedItems());
        if (isExpanded) {
          expanded.add(id);
        } else {
          expanded.delete(id);
        }
        patchState(store, { expandedItems: expanded });
      },

      expandAll() {
        const expanded = new Set<string>();
        for (const [id, item] of Object.entries(store.items())) {
          if (item.isFolder) {
            expanded.add(id);
          }
        }
        patchState(store, { expandedItems: expanded });
      },

      collapseAll() {
        patchState(store, { expandedItems: new Set<string>() });
      },

      selectItem(id: string, multiSelect = false) {
        const selected = new Set<string>(multiSelect ? store.selectedItems() : []);
        if (multiSelect && selected.has(id)) {
          selected.delete(id);
        } else {
          selected.add(id);
        }
        patchState(store, { selectedItems: selected, focusedItemId: id });
      },

      clearSelection() {
        patchState(store, { selectedItems: new Set<string>() });
      },

      setFocusedItemId(id: string | null) {
        patchState(store, { focusedItemId: id });
      },

      setEditingItemId(id: string | null) {
        patchState(store, { editingItemId: id });
      },

      setSearchQuery(query: string) {
        patchState(store, { searchQuery: query });
      },

      renameItem(id: string, newName: string) {
        const currentItems = { ...store.items() };
        if (currentItems[id]) {
          currentItems[id] = { ...currentItems[id], name: newName };
          patchState(store, { items: currentItems, editingItemId: null });
        }
      },

      addItem(parentId: string | null, newItem: NgxTreeItem) {
        const currentItems = { ...store.items() };
        currentItems[newItem.id] = newItem;

        const rootIds = [...store.rootIds()];
        if (parentId === null) {
          rootIds.push(newItem.id);
        } else {
          const parentItem = currentItems[parentId];
          if (parentItem && parentItem.isFolder) {
            const children = parentItem.children ? [...parentItem.children] : [];
            children.push(newItem.id);
            currentItems[parentId] = { ...parentItem, children };
          }
        }

        // Auto-expand parent so new child is visible
        const expanded = new Set(store.expandedItems());
        if (parentId) {
          expanded.add(parentId);
        }

        patchState(store, {
          items: currentItems,
          rootIds,
          expandedItems: expanded,
          focusedItemId: newItem.id,
        });
      },

      deleteItem(id: string) {
        const currentItems = { ...store.items() };
        if (!currentItems[id]) return;

        // 1. Remove reference from parent or roots
        let rootIds = [...store.rootIds()];
        const parents = store.parentMap();
        const parentId = parents[id];

        if (parentId) {
          const parentItem = currentItems[parentId];
          if (parentItem && parentItem.children) {
            currentItems[parentId] = {
              ...parentItem,
              children: parentItem.children.filter((childId) => childId !== id),
            };
          }
        } else {
          rootIds = rootIds.filter((rootId) => rootId !== id);
        }

        // 2. Recursively delete children from the items record
        const deletedIds = new Set<string>();
        const recursiveDelete = (itemId: string) => {
          const item = currentItems[itemId];
          if (item) {
            deletedIds.add(itemId);
            if (item.children) {
              for (const childId of item.children) {
                recursiveDelete(childId);
              }
            }
            delete currentItems[itemId];
          }
        };
        recursiveDelete(id);

        // 3. Clear selections & focus if deleted items were involved
        const selected = new Set(store.selectedItems());
        const expanded = new Set(store.expandedItems());
        for (const deletedId of deletedIds) {
          selected.delete(deletedId);
          expanded.delete(deletedId);
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
          items: currentItems,
          rootIds,
          selectedItems: selected,
          expandedItems: expanded,
          focusedItemId,
          editingItemId,
        });
      },

      moveItem(draggedId: string, targetId: string, position: DragPosition) {
        const currentItems = { ...store.items() };
        if (!currentItems[draggedId] || !currentItems[targetId] || draggedId === targetId) return;

        // Prevent dragging an item into its own descendant!
        const isDescendant = (parent: string, child: string): boolean => {
          const item = currentItems[parent];
          if (!item || !item.children) return false;
          if (item.children.includes(child)) return true;
          return item.children.some((cId) => isDescendant(cId, child));
        };
        if (isDescendant(draggedId, targetId)) return;

        let rootIds = [...store.rootIds()];
        const parents = store.parentMap();

        // 1. Remove draggedId from its current parent
        const sourceParentId = parents[draggedId];
        if (sourceParentId) {
          const sourceParent = currentItems[sourceParentId];
          if (sourceParent && sourceParent.children) {
            currentItems[sourceParentId] = {
              ...sourceParent,
              children: sourceParent.children.filter((cId) => cId !== draggedId),
            };
          }
        } else {
          rootIds = rootIds.filter((cId) => cId !== draggedId);
        }

        // 2. Insert draggedId into target location based on position
        if (position === 'inside') {
          // Add as child of target (which must be a folder)
          const target = currentItems[targetId];
          if (target && target.isFolder) {
            const children = target.children ? [...target.children] : [];
            children.push(draggedId);
            currentItems[targetId] = { ...target, children };

            // Expand parent target automatically
            const expanded = new Set(store.expandedItems());
            expanded.add(targetId);
            patchState(store, { expandedItems: expanded });
          }
        } else {
          // 'before' or 'after' - find target's parent list
          const destParentId = parents[targetId];
          if (destParentId) {
            const destParent = currentItems[destParentId];
            if (destParent && destParent.children) {
              const children = [...destParent.children];
              const idx = children.indexOf(targetId);
              const insertIdx = position === 'before' ? idx : idx + 1;
              children.splice(insertIdx, 0, draggedId);
              currentItems[destParentId] = { ...destParent, children };
            }
          } else {
            const idx = rootIds.indexOf(targetId);
            const insertIdx = position === 'before' ? idx : idx + 1;
            rootIds.splice(insertIdx, 0, draggedId);
          }
        }

        patchState(store, {
          items: currentItems,
          rootIds,
          focusedItemId: draggedId,
          dragState: {
            draggedItemId: null,
            dragOverItemId: null,
            position: null,
          },
        });
      },

      setDragState(
        draggedItemId: string | null,
        dragOverItemId: string | null,
        position: DragPosition
      ) {
        patchState(store, {
          dragState: { draggedItemId, dragOverItemId, position },
        });
      },

      clearDragState() {
        patchState(store, {
          dragState: {
            draggedItemId: null,
            dragOverItemId: null,
            position: null,
          },
        });
      },
    };
  })
);
