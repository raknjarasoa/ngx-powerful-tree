import { describe, it, expect, beforeEach } from 'vitest';
import { NgxTreeStore } from './ngx-tree.store';
import { NgxTreeItem } from './ngx-tree.types';

describe('NgxTreeStore', () => {
  let store: any;

  // Set up mock tree hierarchy:
  // Root A (Folder)
  //   - Child A1 (File)
  //   - Child A2 (Folder)
  //     - Grandchild A2a (File)
  // Root B (File)
  const mockItems: Record<string, NgxTreeItem> = {
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
  };
  const mockRootIds = ['root-a', 'root-b'];

  beforeEach(() => {
    store = new NgxTreeStore();
    store.setItems(mockItems, mockRootIds);
  });

  it('should initialize with flattened visible items of root nodes only when collapsed', () => {
    const list = store.flattenedVisibleItems();
    expect(list.length).toBe(2);
    expect(list[0].id).toBe('root-a');
    expect(list[0].depth).toBe(0);
    expect(list[1].id).toBe('root-b');
    expect(list[1].depth).toBe(0);
  });

  it('should expand folders and update flattened visible items', () => {
    store.toggleExpand('root-a');

    let list = store.flattenedVisibleItems();
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
    list = store.flattenedVisibleItems();
    // Expected: Root A, Child A1, Child A2, Grandchild A2a, Root B
    expect(list.length).toBe(5);
    expect(list[3].id).toBe('grandchild-a2a');
    expect(list[3].parentId).toBe('child-a2');
    expect(list[3].depth).toBe(2);
  });

  it('should support fluid search query and expand ancestor paths', () => {
    store.setSearchQuery('Grandchild');

    const list = store.flattenedVisibleItems();
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

    const list = store.flattenedVisibleItems();
    expect(list.length).toBe(5); // Root A, Child A1, Child A2, Child A3, Root B
    expect(list[3].id).toBe('child-a3');
    expect(store.items()['child-a3']).toBeDefined();
    expect(store.items()['root-a'].children).toContain('child-a3');
  });

  it('should delete item recursively and clean selections', () => {
    store.toggleExpand('root-a');
    store.toggleExpand('child-a2');
    store.selectItem('grandchild-a2a');

    expect(store.selectedItems().has('grandchild-a2a')).toBe(true);

    // Delete Child A2 (containing Grandchild A2a)
    store.deleteItem('child-a2');

    const list = store.flattenedVisibleItems();
    // Expected remaining: Root A, Child A1, Root B
    expect(list.length).toBe(3);
    expect(store.items()['child-a2']).toBeUndefined();
    expect(store.items()['grandchild-a2a']).toBeUndefined();
    expect(store.selectedItems().has('grandchild-a2a')).toBe(false);
  });

  it('should move items in the hierarchy via drag and drop mechanics', () => {
    store.toggleExpand('root-a');

    // Move Child A1 to be before Root A
    store.moveItem('child-a1', 'root-a', 'before');

    const list = store.flattenedVisibleItems();
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
    expect(store.items()['root-a'].children[0]).toBe('new-child-folder');
  });

  it('should drop inside an expanded folder at index 0 and a collapsed folder at the end', () => {
    // 1. Expanded target folder
    store.setExpanded('child-a2', true); // Expand child-a2
    // child-a2 children initially has: ['grandchild-a2a']
    store.moveItem('root-b', 'child-a2', 'inside');
    expect(store.items()['child-a2'].children[0]).toBe('root-b'); // Placed at first index
    expect(store.items()['child-a2'].children[1]).toBe('grandchild-a2a');

    // 2. Collapsed target folder
    store.setExpanded('root-a', false); // Collapse root-a
    // root-a children: ['child-a1', 'child-a2']
    store.moveItem('root-b', 'root-a', 'inside');
    const rootAChildren = store.items()['root-a'].children;
    expect(rootAChildren[rootAChildren.length - 1]).toBe('root-b'); // Placed at the end
  });

  it('should deselect the dragged item when dropped', () => {
    store.selectItem('root-b');
    expect(store.selectedItems().has('root-b')).toBe(true);

    // Drop root-b inside child-a2
    store.moveItem('root-b', 'child-a2', 'inside');
    expect(store.selectedItems().has('root-b')).toBe(false); // Should be deselected
  });
});
