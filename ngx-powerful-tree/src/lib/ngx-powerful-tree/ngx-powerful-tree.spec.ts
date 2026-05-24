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
});
