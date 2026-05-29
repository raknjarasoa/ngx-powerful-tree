import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NgZone } from '@angular/core';
import { vi } from 'vitest';
import { NgxPowerfulTree } from './ngx-powerful-tree';
import { NgxTreeNode } from '../ngx-tree.types';

describe('NgxPowerfulTree', () => {
  let component: NgxPowerfulTree;
  let fixture: ComponentFixture<NgxPowerfulTree>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [NgxPowerfulTree],
    }).compileComponents();

    fixture = TestBed.createComponent(NgxPowerfulTree);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('nodes', []);
    fixture.detectChanges();
    await fixture.whenStable();
  });

  const getItemsMap = () => (component.store as any)['itemsMap'];

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should default readOnly to false', () => {
    expect(component.readOnly()).toBe(false);
  });

  it('should accept readOnly input as true', async () => {
    fixture.componentRef.setInput('readOnly', true);
    fixture.detectChanges();
    await fixture.whenStable();
    expect(component.readOnly()).toBe(true);
  });

  it('should not allow triggering edit rename when readOnly is true', async () => {
    fixture.componentRef.setInput('readOnly', true);
    component.reload([{ id: 'folder-1', name: 'Folder 1', isFolder: true, children: [] }]);
    fixture.detectChanges();
    await fixture.whenStable();

    component.store.setFocusedItemId('folder-1');
    component.onKeyDown(new KeyboardEvent('keydown', { key: 'F2' }));

    fixture.detectChanges();
    expect(component.store.editingItemId()).toBeNull();
  });

  it('should propagate locked property from parent folder to children recursively', async () => {
    component.reload([
      {
        id: 'locked-folder',
        name: 'Locked Folder',
        isFolder: true,
        locked: true,
        children: [{ id: 'child-file', name: 'Child File', isFolder: false }],
      },
    ]);
    fixture.detectChanges();
    await fixture.whenStable();

    component.store.setExpanded('locked-folder', true);
    fixture.detectChanges();

    const flattened = component.store.flattenedStructure().list;
    const parentNode = flattened.find((i: any) => i.id === 'locked-folder');
    const childNode = flattened.find((i: any) => i.id === 'child-file');

    expect(parentNode?.locked).toBe(true);
    expect(childNode?.locked).toBe(true);
  });

  it('should block renaming locked items via F2 keydown', async () => {
    component.reload([{ id: 'locked-file', name: 'Locked File', isFolder: false, locked: true }]);
    fixture.detectChanges();
    await fixture.whenStable();

    component.store.setFocusedItemId('locked-file');
    component.onKeyDown(new KeyboardEvent('keydown', { key: 'F2' }));

    fixture.detectChanges();
    expect(component.store.editingItemId()).toBeNull();
  });

  it('should expose a reload() method that swaps the dataset and clears state', async () => {
    component.reload([
      {
        id: 'a',
        name: 'A',
        isFolder: true,
        children: [{ id: 'b', name: 'B', isFolder: false }],
      },
    ]);
    component.store.toggleExpand('a');
    component.store.selectItem('b');
    fixture.detectChanges();
    await fixture.whenStable();
    expect(component.store.selectedItems().has('b')).toBe(true);

    component.reload([{ id: 'c', name: 'C', isFolder: false }]);
    fixture.detectChanges();
    await fixture.whenStable();
    expect(getItemsMap().get('a')).toBeUndefined();
    expect(getItemsMap().get('c')).toBeDefined();
    expect(component.store.selectedItems().size).toBe(0);
    expect(component.store.expandedItems().size).toBe(0);
  });

  it('should expose contentChild fileTemplate via signal getter', () => {
    expect(component.fileTemplate()).toBeUndefined();
  });

  it('should run dragover events outside Angular Zone to optimize FPS and prevent change detection cycles', async () => {
    component.reload([
      {
        id: 'folder-1',
        name: 'Folder 1',
        isFolder: true,
        children: [{ id: 'file-1', name: 'File 1', isFolder: false }],
      },
    ]);
    fixture.detectChanges();
    await fixture.whenStable();

    component.store.setExpanded('folder-1', true);
    fixture.detectChanges();

    component.store.draggedItemId.set('file-1');
    fixture.detectChanges();

    const rowElements = fixture.nativeElement.querySelectorAll('.ngx-tree-row-wrapper');
    const folderRowEl = rowElements[0];

    const ngZone = TestBed.inject(NgZone);
    const runSpy = vi.spyOn(ngZone, 'run');

    const createDragOverEvent = (clientY: number) => {
      const event = new Event('dragover', { bubbles: true, cancelable: true }) as Event & {
        clientY: number;
      };
      event.clientY = clientY;
      return event;
    };

    folderRowEl.dispatchEvent(createDragOverEvent(10));
    folderRowEl.dispatchEvent(createDragOverEvent(11));
    folderRowEl.dispatchEvent(createDragOverEvent(12));

    // Bursts collapse into a single rAF tick; nothing has fired yet here.
    expect(runSpy.mock.calls.length).toBeLessThan(3);
  });

  it('getStructure() returns the current nested NgxTreeNode structure', async () => {
    component.reload([
      {
        id: 'a',
        name: 'A',
        isFolder: true,
        children: [{ id: 'b', name: 'B', isFolder: false }],
      },
    ]);
    fixture.detectChanges();
    await fixture.whenStable();

    const structure = component.getStructure();
    expect(structure).toEqual([
      {
        id: 'a',
        name: 'A',
        isFolder: true,
        children: [{ id: 'b', name: 'B', isFolder: false, children: undefined }],
        data: undefined,
        locked: undefined,
        icon: undefined,
      },
    ]);
  });

  it('does not emit structureChanged when emitStructureChanges is false', async () => {
    const emitted: any[] = [];
    component.structureChanged.subscribe((s) => emitted.push(s));
    fixture.detectChanges();
    await fixture.whenStable();

    component.store.addItem(null, { id: 'x', name: 'X', isFolder: true, children: [] });
    fixture.detectChanges();
    await fixture.whenStable();

    expect(emitted.length).toBe(0);
  });

  it('emits structureChanged with the full structure on changes (not the initial seed)', async () => {
    fixture.componentRef.setInput('emitStructureChanges', true);
    const emitted: NgxTreeNode[][] = [];
    component.structureChanged.subscribe((s) => emitted.push(s));

    component.reload([{ id: 'root', name: 'Root', isFolder: true, children: [] }]);
    fixture.detectChanges();
    await fixture.whenStable();
    // The seed/baseline is not emitted.
    expect(emitted.length).toBe(0);

    component.store.addItem('root', { id: 'child', name: 'Child', isFolder: false });
    fixture.detectChanges();
    await fixture.whenStable();

    expect(emitted.length).toBe(1);
    expect(emitted[0]).toEqual([
      {
        id: 'root',
        name: 'Root',
        isFolder: true,
        children: [
          {
            id: 'child',
            name: 'Child',
            isFolder: false,
            children: undefined,
            data: undefined,
            locked: undefined,
            icon: undefined,
          },
        ],
        data: undefined,
        locked: undefined,
        icon: undefined,
      },
    ]);
  });

  it('coalesces multiple synchronous mutations into a single structureChanged emission', async () => {
    fixture.componentRef.setInput('emitStructureChanges', true);
    component.reload([{ id: 'root', name: 'Root', isFolder: true, children: [] }]);
    fixture.detectChanges();
    await fixture.whenStable();

    const emitted: NgxTreeNode[][] = [];
    component.structureChanged.subscribe((s) => emitted.push(s));

    // Three mutations in the same tick should collapse into one emission.
    component.store.addItem('root', { id: 'c1', name: 'C1', isFolder: false });
    component.store.addItem('root', { id: 'c2', name: 'C2', isFolder: false });
    component.store.addItem('root', { id: 'c3', name: 'C3', isFolder: false });
    fixture.detectChanges();
    await fixture.whenStable();

    expect(emitted.length).toBe(1);
    expect(emitted[0][0].children?.map((c) => c.id).sort()).toEqual(['c1', 'c2', 'c3']);
  });
});
