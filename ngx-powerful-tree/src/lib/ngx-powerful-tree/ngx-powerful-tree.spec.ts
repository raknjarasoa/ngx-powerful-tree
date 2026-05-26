import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NgZone } from '@angular/core';
import { vi } from 'vitest';
import { NgxPowerfulTree } from './ngx-powerful-tree';

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

  it('should not allow deleting items when readOnly is true', async () => {
    fixture.componentRef.setInput('readOnly', true);
    component.reload([{ id: 'folder-1', name: 'Folder 1', isFolder: true, children: [] }]);
    fixture.detectChanges();
    await fixture.whenStable();

    component.store.setFocusedItemId('folder-1');
    component.onKeyDown(new KeyboardEvent('keydown', { key: 'Delete' }));

    fixture.detectChanges();
    expect(component.store.items()['folder-1']).toBeDefined();
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

    const flattened = component.store.flattenedVisibleItems();
    const parentNode = flattened.find((i) => i.id === 'locked-folder');
    const childNode = flattened.find((i) => i.id === 'child-file');

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

  it('should block deleting locked items via Delete keydown', async () => {
    component.reload([{ id: 'locked-file', name: 'Locked File', isFolder: false, locked: true }]);
    fixture.detectChanges();
    await fixture.whenStable();

    component.store.setFocusedItemId('locked-file');
    component.onKeyDown(new KeyboardEvent('keydown', { key: 'Delete' }));

    fixture.detectChanges();
    expect(component.store.items()['locked-file']).toBeDefined();
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
    expect(component.store.items()['a']).toBeUndefined();
    expect(component.store.items()['c']).toBeDefined();
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

    component.store.setDragState('file-1', null, null);
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
});
