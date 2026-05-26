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
    fixture.componentRef.setInput('items', {});
    fixture.componentRef.setInput('rootIds', []);
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
    component.reload(
      { 'folder-1': { id: 'folder-1', name: 'Folder 1', isFolder: true, children: [] } },
      ['folder-1']
    );
    fixture.detectChanges();
    await fixture.whenStable();

    component.store.setFocusedItemId('folder-1');
    const event = new KeyboardEvent('keydown', { key: 'F2' });
    component.onKeyDown(event);

    fixture.detectChanges();
    expect(component.store.editingItemId()).toBeNull();
  });

  it('should not allow deleting items when readOnly is true', async () => {
    fixture.componentRef.setInput('readOnly', true);
    component.reload(
      { 'folder-1': { id: 'folder-1', name: 'Folder 1', isFolder: true, children: [] } },
      ['folder-1']
    );
    fixture.detectChanges();
    await fixture.whenStable();

    component.store.setFocusedItemId('folder-1');
    const event = new KeyboardEvent('keydown', { key: 'Delete' });
    component.onKeyDown(event);

    fixture.detectChanges();
    expect(component.store.items()['folder-1']).toBeDefined();
  });

  it('should propagate locked property from parent folder to children recursively', async () => {
    component.reload(
      {
        'locked-folder': {
          id: 'locked-folder',
          name: 'Locked Folder',
          isFolder: true,
          children: ['child-file'],
          locked: true,
        },
        'child-file': { id: 'child-file', name: 'Child File', isFolder: false },
      },
      ['locked-folder']
    );
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
    component.reload(
      { 'locked-file': { id: 'locked-file', name: 'Locked File', isFolder: false, locked: true } },
      ['locked-file']
    );
    fixture.detectChanges();
    await fixture.whenStable();

    component.store.setFocusedItemId('locked-file');
    const event = new KeyboardEvent('keydown', { key: 'F2' });
    component.onKeyDown(event);

    fixture.detectChanges();
    expect(component.store.editingItemId()).toBeNull();
  });

  it('should block deleting locked items via Delete keydown', async () => {
    component.reload(
      { 'locked-file': { id: 'locked-file', name: 'Locked File', isFolder: false, locked: true } },
      ['locked-file']
    );
    fixture.detectChanges();
    await fixture.whenStable();

    component.store.setFocusedItemId('locked-file');
    const event = new KeyboardEvent('keydown', { key: 'Delete' });
    component.onKeyDown(event);

    fixture.detectChanges();
    expect(component.store.items()['locked-file']).toBeDefined();
  });

  it('should expose a reload() method that swaps the dataset and clears state', async () => {
    component.reload(
      {
        a: { id: 'a', name: 'A', isFolder: true, children: ['b'] },
        b: { id: 'b', name: 'B', isFolder: false },
      },
      ['a']
    );
    component.store.toggleExpand('a');
    component.store.selectItem('b');
    fixture.detectChanges();
    await fixture.whenStable();
    expect(component.store.selectedItems().has('b')).toBe(true);

    component.reload({ c: { id: 'c', name: 'C', isFolder: false } }, ['c']);
    fixture.detectChanges();
    await fixture.whenStable();
    expect(component.store.items()['a']).toBeUndefined();
    expect(component.store.items()['c']).toBeDefined();
    expect(component.store.selectedItems().size).toBe(0);
    expect(component.store.expandedItems().size).toBe(0);
  });

  it('should accept custom fileTemplate input and resolve it via computed property', () => {
    const dummyTemplate = {} as any; // mock TemplateRef
    fixture.componentRef.setInput('fileTemplate', dummyTemplate);
    fixture.detectChanges();
    expect(component.fileTemplate()).toBe(dummyTemplate);
  });

  it('should run dragover events outside Angular Zone to optimize FPS and prevent change detection cycles', async () => {
    component.reload(
      {
        'folder-1': { id: 'folder-1', name: 'Folder 1', isFolder: true, children: ['file-1'] },
        'file-1': { id: 'file-1', name: 'File 1', isFolder: false },
      },
      ['folder-1']
    );
    fixture.detectChanges();
    await fixture.whenStable();

    component.store.setExpanded('folder-1', true);
    fixture.detectChanges();

    // Set active dragged item in the store
    component.store.setDragState('file-1', null, null);
    fixture.detectChanges();

    const rowElements = fixture.nativeElement.querySelectorAll('.ngx-tree-row-wrapper');
    const folderRowEl = rowElements[0];

    // Spy on NgZone.run to see when we enter the Angular Zone
    const ngZone = TestBed.inject(NgZone);
    const runSpy = vi.spyOn(ngZone, 'run');

    // Helper to create mocked dragover event since DragEvent is not natively defined in the JSDOM test environment
    const createDragOverEvent = (clientY: number) => {
      const event = new Event('dragover', { bubbles: true, cancelable: true }) as any;
      event.clientY = clientY;
      return event;
    };

    // Trigger multiple dragover events that evaluate to the same target row & position
    folderRowEl.dispatchEvent(createDragOverEvent(10));
    folderRowEl.dispatchEvent(createDragOverEvent(11));
    folderRowEl.dispatchEvent(createDragOverEvent(12));

    // Standard template bindings would trigger Angular change detection 3 times.
    // Our optimized outside-zone listener should enter the zone at most once to transition state,
    // and subsequent occurrences must skip NgZone.run() entirely!
    expect(runSpy.mock.calls.length).toBeLessThan(3);
  });
});
