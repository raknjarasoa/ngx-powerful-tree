import { describe, it, expect, beforeEach } from 'vitest';
import { NgxTreeStore } from './ngx-tree.store';
import { NgxTreeItem } from './ngx-tree.types';

type StoreInstance = InstanceType<typeof NgxTreeStore>;

describe('NgxTreeStore', () => {
  let store: StoreInstance;

  // Set up mock tree hierarchy:
  // Root A (Folder)
  //   - Child A1 (File)
  //   - Child A2 (Folder)
  //     - Grandchild A2a (File)
  // Root B (File)
  const getMockItems = (): Record<string, NgxTreeItem> => ({
    'root-a': {
      id: 'root-a',
      name: 'Root A Folder',
      isFolder: true,
      children: ['child-a1', 'child-a2'],
    },
    'child-a1': { id: 'child-a1', name: 'Child A1 File', isFolder: false },
    'child-a2': {
      id: 'child-a2',
      name: 'Child A2 Folder',
      isFolder: true,
      children: ['grandchild-a2a'],
    },
    'grandchild-a2a': { id: 'grandchild-a2a', name: 'Grandchild A2a File', isFolder: false },
    'root-b': { id: 'root-b', name: 'Root B File', isFolder: false },
  });
  const mockRootIds = ['root-a', 'root-b'];

  beforeEach(() => {
    store = new NgxTreeStore();
    store.setItems(getMockItems(), mockRootIds);
  });

  it('should initialize with flattened visible items of root nodes only when collapsed', () => {
    const list = store.flattenedStructure().list;
    expect(list.length).toBe(2);
    expect(list[0].id).toBe('root-a');
    expect(list[0].depth).toBe(0);
    expect(list[1].id).toBe('root-b');
    expect(list[1].depth).toBe(0);
  });

  it('should expand folders and update flattened visible items', () => {
    store.toggleExpand('root-a');

    let list = store.flattenedStructure().list;
    // Expected: Root A, Child A1, Child A2 (Collapsed), Root B
    expect(list.length).toBe(4);
    expect(list[0].id).toBe('root-a');
    expect(list[1].id).toBe('child-a1');
    expect(list[1].parentId).toBe('root-a');
    expect(list[1].depth).toBe(1);
    expect(list[2].id).toBe('child-a2');
    expect(list[3].id).toBe('root-b');

    // Expand grandchild's folder
    store.toggleExpand('child-a2');
    list = store.flattenedStructure().list;
    // Expected: Root A, Child A1, Child A2, Grandchild A2a, Root B
    expect(list.length).toBe(5);
    expect(list[3].id).toBe('grandchild-a2a');
    expect(list[3].parentId).toBe('child-a2');
    expect(list[3].depth).toBe(2);
  });

  it('should support fluid search query and expand ancestor paths', () => {
    store.setSearchQuery('Grandchild');

    const list = store.flattenedStructure().list;
    // Expected: Root A, Child A2, Grandchild A2a (all expanded automatically)
    // Child A1 and Root B should not match and should not be displayed!
    expect(list.length).toBe(3);
    expect(list[0].id).toBe('root-a');
    expect(list[1].id).toBe('child-a2');
    expect(list[2].id).toBe('grandchild-a2a');
    expect(list[2].matchesSearch).toBe(true);
    expect(list[0].matchesSearch).toBe(false);
  });

  it('should add item to parent and update lists', () => {
    store.toggleExpand('root-a');
    const newItem: NgxTreeItem = { id: 'child-a3', name: 'Child A3 File', isFolder: false };

    store.addItem('root-a', newItem);

    const list = store.flattenedStructure().list;
    expect(list.length).toBe(5); // Root A, Child A1, Child A2, Child A3, Root B
    expect(list[3].id).toBe('child-a3');
    expect(store.getItem('child-a3')).toBeDefined();
    expect(store.getItem('root-a')?.children).toContain('child-a3');
  });

  it('should delete item recursively and clean selections', () => {
    store.toggleExpand('root-a');
    store.toggleExpand('child-a2');
    store.selectItem('grandchild-a2a');

    expect(store.selectedItems().has('grandchild-a2a')).toBe(true);

    // Delete Child A2 (containing Grandchild A2a)
    store.deleteItem('child-a2');

    const list = store.flattenedStructure().list;
    // Expected remaining: Root A, Child A1, Root B
    expect(list.length).toBe(3);
    expect(store.getItem('child-a2')).toBeUndefined();
    expect(store.getItem('grandchild-a2a')).toBeUndefined();
    expect(store.selectedItems().has('grandchild-a2a')).toBe(false);
  });

  it('should move items in the hierarchy via drag and drop mechanics', () => {
    store.toggleExpand('root-a');

    // Move Child A1 to be before Root A
    store.moveItem('child-a1', 'root-a', 'before');

    const list = store.flattenedStructure().list;
    // Expected visible: Child A1 (root), Root A (root, expanded), Child A2 (child), Root B (root)
    expect(list.length).toBe(4);
    expect(list[0].id).toBe('child-a1');
    expect(list[0].depth).toBe(0);
    expect(list[1].id).toBe('root-a');
    expect(list[1].depth).toBe(0);
    expect(list[2].id).toBe('child-a2');
    expect(list[2].depth).toBe(1);
    expect(list[3].id).toBe('root-b');
    expect(list[3].depth).toBe(0);
  });

  it('should add new folders at the start of children and roots', () => {
    // 1. Add folder at root
    const newRootFolder: NgxTreeItem = {
      id: 'new-root-folder',
      name: 'New Root Folder',
      isFolder: true,
      children: [],
    };
    store.addItem(null, newRootFolder);
    expect(store.rootIds()[0]).toBe('new-root-folder');

    // 2. Add folder inside parent
    store.toggleExpand('root-a');
    const newChildFolder: NgxTreeItem = {
      id: 'new-child-folder',
      name: 'New Child Folder',
      isFolder: true,
      children: [],
    };
    store.addItem('root-a', newChildFolder);
    expect(store.getItem('root-a')?.children?.[0]).toBe('new-child-folder');
  });

  it('should drop inside an expanded folder and a collapsed folder at the first index', () => {
    // 1. Expanded target folder
    store.setExpanded('child-a2', true); // Expand child-a2
    // child-a2 children initially has: ['grandchild-a2a']
    store.moveItem('root-b', 'child-a2', 'inside');
    expect(store.getItem('child-a2')?.children?.[0]).toBe('root-b'); // Placed at first index
    expect(store.getItem('child-a2')?.children?.[1]).toBe('grandchild-a2a');

    // 2. Collapsed target folder
    store.setExpanded('root-a', false); // Collapse root-a
    // root-a children initially: ['child-a1', 'child-a2']
    // Let's reset store to make a clean assertion
    store.setItems(getMockItems(), mockRootIds);
    store.moveItem('root-b', 'root-a', 'inside');
    const rootAChildren = store.getItem('root-a')?.children;
    expect(rootAChildren?.[0]).toBe('root-b'); // Placed at the first index (index 0)
  });

  it('should preserve the selection state of the dragged file item when dropped', () => {
    store.selectItem('root-b');
    expect(store.selectedItems().has('root-b')).toBe(true);

    // Drop root-b inside child-a2
    store.moveItem('root-b', 'child-a2', 'inside');
    expect(store.selectedItems().has('root-b')).toBe(true); // Should remain selected
  });

  it('should not allow selecting folder items', () => {
    store.selectItem('child-a2');
    expect(store.selectedItems().has('child-a2')).toBe(false); // Folder should not be selected
  });

  it('should allow selecting folder items when selectableTypes is "folders"', () => {
    store.setSelectableTypes('folders');
    store.selectItem('child-a2');
    expect(store.selectedItems().has('child-a2')).toBe(true);
  });

  it('should allow selecting both files and folders when selectableTypes is "all"', () => {
    store.setSelectableTypes('all');
    store.selectItem('child-a2');
    store.selectItem('child-a1', true);
    expect(store.selectedItems().has('child-a2')).toBe(true);
    expect(store.selectedItems().has('child-a1')).toBe(true);
  });

  it('should refuse to delete a locked item and return false', () => {
    const lockedItems: Record<string, NgxTreeItem> = {
      'locked-root': {
        id: 'locked-root',
        name: 'Locked',
        isFolder: true,
        children: ['child'],
        locked: true,
      },
      child: { id: 'child', name: 'Child', isFolder: false },
    };
    store.setItems(lockedItems, ['locked-root']);
    expect(store.deleteItem('child')).toEqual([]);
    expect(store.getItem('child')).toBeDefined();
  });

  it('should refuse to rename a locked item and return false', () => {
    store.setItems(
      {
        'locked-file': { id: 'locked-file', name: 'Locked', isFolder: false, locked: true },
      },
      ['locked-file']
    );
    expect(store.renameItem('locked-file', 'NewName')).toBe(false);
    expect(store.getItem('locked-file')?.name).toBe('Locked');
  });

  it('should refuse to move into a locked target and return false', () => {
    store.setItems(
      {
        a: { id: 'a', name: 'A', isFolder: false },
        b: { id: 'b', name: 'B', isFolder: true, children: [], locked: true },
      },
      ['a', 'b']
    );
    expect(store.moveItem('a', 'b', 'inside')).toBe(false);
    expect(store.getItem('b')?.children).toEqual([]);
  });

  it('should refuse duplicate ids on addItem', () => {
    expect(store.addItem(null, { id: 'root-a', name: 'Dup', isFolder: false } as NgxTreeItem)).toBe(
      false
    );
  });

  it('should reload() and clear ephemeral state', () => {
    store.toggleExpand('root-a');
    store.selectItem('child-a1');
    store.setSearchQuery('something');
    store.reload({ x: { id: 'x', name: 'X', isFolder: false } as NgxTreeItem }, ['x']);
    expect(store.getItem('x')).toBeDefined();
    expect(store.getItem('root-a')).toBeUndefined();
    expect(store.expandedItems().size).toBe(0);
    expect(store.selectedItems().size).toBe(0);
    expect(store.searchQuery()).toBe('');
  });

  it('should set and clear centralized drag state atomically', () => {
    store.setDragState('child-a1', 'child-a2', 'inside');
    expect(store.draggedItemId()).toBe('child-a1');
    expect(store.dragTargetId()).toBe('child-a2');
    expect(store.dragPosition()).toBe('inside');

    store.clearDragState();
    expect(store.draggedItemId()).toBeNull();
    expect(store.dragTargetId()).toBeNull();
    expect(store.dragPosition()).toBeNull();
  });

  it('should cascade-clear dragTargetId when the target is deleted', () => {
    store.setDragState('child-a1', 'child-a2', 'inside');
    store.toggleExpand('root-a'); // make child-a2 visible
    store.deleteItem('child-a2');
    expect(store.dragTargetId()).toBeNull();
    expect(store.dragPosition()).toBeNull();
    // Source still being dragged though, since only the target was deleted.
    expect(store.draggedItemId()).toBe('child-a1');
  });

  it('should cascade-clear all drag state when the dragged item is deleted', () => {
    store.setDragState('child-a1', 'child-a2', 'inside');
    store.toggleExpand('root-a');
    store.deleteItem('child-a1');
    expect(store.draggedItemId()).toBeNull();
    expect(store.dragTargetId()).toBeNull();
    expect(store.dragPosition()).toBeNull();
  });

  it('setExpanded is a no-op when state already matches (preserves Set identity)', () => {
    const before = store.expandedItems();
    store.setExpanded('root-a', false); // root-a starts collapsed
    expect(store.expandedItems()).toBe(before);

    store.setExpanded('root-a', true);
    const afterExpand = store.expandedItems();
    expect(afterExpand).not.toBe(before);

    store.setExpanded('root-a', true); // already expanded
    expect(store.expandedItems()).toBe(afterExpand);
  });

  it('selectItem is a no-op when the same single item is already selected', () => {
    store.selectItem('root-b'); // selects root-b
    const ref = store.selectedItems();
    store.selectItem('root-b'); // same item, single-select mode
    expect(store.selectedItems()).toBe(ref);
  });

  it('should support custom search predicate', () => {
    const customItems: Record<string, NgxTreeItem> = {
      'item-1': {
        id: 'item-1',
        name: 'Item One',
        isFolder: false,
        data: { description: 'Special Tag A' },
      },
      'item-2': {
        id: 'item-2',
        name: 'Item Two',
        isFolder: false,
        data: { description: 'Special Tag B' },
      },
    };
    store.setItems(customItems, ['item-1', 'item-2']);

    store.searchPredicate.set((item, query) => {
      const description = (item.data as any)?.description;
      return (
        typeof description === 'string' && description.toLowerCase().includes(query.toLowerCase())
      );
    });

    store.setSearchQuery('Tag A');
    let list = store.flattenedStructure().list;

    expect(list.length).toBe(1);
    expect(list[0].id).toBe('item-1');

    store.setSearchQuery('One');
    list = store.flattenedStructure().list;
    expect(list.length).toBe(0);
  });
});
