import { ComponentFixture, TestBed } from '@angular/core/testing';
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
    fixture.componentRef.setInput('items', {
      'folder-1': { id: 'folder-1', name: 'Folder 1', isFolder: true, children: [] },
    });
    fixture.componentRef.setInput('rootIds', ['folder-1']);
    fixture.detectChanges();
    await fixture.whenStable();

    component.store.setFocusedItemId('folder-1');
    const event = new KeyboardEvent('keydown', { key: 'F2' });
    component.onKeyDown(event);

    fixture.detectChanges();
    expect(component.store.editingItemId()).toBeNull(); // Should not enter editing state!
  });

  it('should not allow deleting items when readOnly is true', async () => {
    fixture.componentRef.setInput('readOnly', true);
    fixture.componentRef.setInput('items', {
      'folder-1': { id: 'folder-1', name: 'Folder 1', isFolder: true, children: [] },
    });
    fixture.componentRef.setInput('rootIds', ['folder-1']);
    fixture.detectChanges();
    await fixture.whenStable();

    component.store.setFocusedItemId('folder-1');
    const event = new KeyboardEvent('keydown', { key: 'Delete' });
    component.onKeyDown(event);

    fixture.detectChanges();
    expect(component.store.items()['folder-1']).toBeDefined(); // Should not be deleted!
  });

  it('should propagate locked property from parent folder to children recursively', async () => {
    fixture.componentRef.setInput('items', {
      'locked-folder': {
        id: 'locked-folder',
        name: 'Locked Folder',
        isFolder: true,
        children: ['child-file'],
        locked: true,
      },
      'child-file': { id: 'child-file', name: 'Child File', isFolder: false },
    });
    fixture.componentRef.setInput('rootIds', ['locked-folder']);
    fixture.detectChanges();
    await fixture.whenStable();

    component.store.setExpanded('locked-folder', true);
    fixture.detectChanges();

    const flattened = component.store.flattenedVisibleItems();
    const parentNode = flattened.find((i) => i.id === 'locked-folder');
    const childNode = flattened.find((i) => i.id === 'child-file');

    expect(parentNode?.locked).toBe(true);
    expect(childNode?.locked).toBe(true); // Propagated successfully!
  });

  it('should block renaming locked items via F2 keydown', async () => {
    fixture.componentRef.setInput('items', {
      'locked-file': { id: 'locked-file', name: 'Locked File', isFolder: false, locked: true },
    });
    fixture.componentRef.setInput('rootIds', ['locked-file']);
    fixture.detectChanges();
    await fixture.whenStable();

    component.store.setFocusedItemId('locked-file');
    const event = new KeyboardEvent('keydown', { key: 'F2' });
    component.onKeyDown(event);

    fixture.detectChanges();
    expect(component.store.editingItemId()).toBeNull(); // Blocked!
  });

  it('should block deleting locked items via Delete keydown', async () => {
    fixture.componentRef.setInput('items', {
      'locked-file': { id: 'locked-file', name: 'Locked File', isFolder: false, locked: true },
    });
    fixture.componentRef.setInput('rootIds', ['locked-file']);
    fixture.detectChanges();
    await fixture.whenStable();

    component.store.setFocusedItemId('locked-file');
    const event = new KeyboardEvent('keydown', { key: 'Delete' });
    component.onKeyDown(event);

    fixture.detectChanges();
    expect(component.store.items()['locked-file']).toBeDefined(); // Blocked!
  });
});
