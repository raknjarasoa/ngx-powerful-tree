import { ComponentFixture, TestBed } from '@angular/core/testing';
import { describe, it, expect, beforeEach } from 'vitest';
import { NgxPowerfulTree } from './ngx-powerful-tree/ngx-powerful-tree';
import { NgxTreeNode } from './ngx-tree.types';

// Drag *math* is exercised in ngx-powerful-tree.drag.spec.ts — the row
// directive no longer owns position computation. These tests cover what
// the directive still does: dragstart gating, draggable attribute, and
// host-bound drag-over classes driven by store signals.

const dispatchDragStart = (el: HTMLElement) => {
  const event = new Event('dragstart', { bubbles: true, cancelable: true }) as Event & {
    dataTransfer: DataTransfer | null;
    clientX: number;
    clientY: number;
  };
  event.dataTransfer = null; // jsdom does not synthesize a DataTransfer
  event.clientX = 0;
  event.clientY = 0;
  el.dispatchEvent(event);
  return event;
};

describe('NgxTreeRowDirective', () => {
  let component: NgxPowerfulTree;
  let fixture: ComponentFixture<NgxPowerfulTree>;
  let rows: HTMLElement[];

  const seed = (): NgxTreeNode[] => [
    { id: 'folder', name: 'Folder', isFolder: true, children: [] },
    { id: 'file-a', name: 'A', isFolder: false },
    { id: 'locked-file', name: 'Locked', isFolder: false, locked: true },
  ];

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [NgxPowerfulTree],
    }).compileComponents();

    fixture = TestBed.createComponent(NgxPowerfulTree);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('nodes', []);
    fixture.detectChanges();
    await fixture.whenStable();

    component.reload(seed());
    fixture.detectChanges();
    await fixture.whenStable();

    rows = Array.from(fixture.nativeElement.querySelectorAll('.ngx-tree-row')) as HTMLElement[];
  });

  it('marks unlocked, non-readonly rows as draggable', () => {
    expect(rows[0].getAttribute('draggable')).toBe('true');
    expect(rows[1].getAttribute('draggable')).toBe('true');
  });

  it('refuses to mark locked rows as draggable', () => {
    const locked = rows.find((r) => r.classList.contains('ngx-tree-row--locked'));
    expect(locked?.getAttribute('draggable')).toBe('false');
  });

  it('refuses to start a drag for a locked row (preventDefault)', () => {
    const locked = rows.find((r) => r.classList.contains('ngx-tree-row--locked'));
    if (!locked) throw new Error('locked row not found');
    const event = dispatchDragStart(locked);
    expect(event.defaultPrevented).toBe(true);
    expect(component.store.draggedItemId()).toBeNull();
  });

  it('sets store.draggedItemId on dragstart of a normal row', () => {
    dispatchDragStart(rows[1]);
    expect(component.store.draggedItemId()).toBe('file-a');
  });

  it('applies drag-over classes via host bindings when store state matches', async () => {
    component.store.setDragState('file-a', 'folder', 'inside');
    fixture.detectChanges();
    await fixture.whenStable();
    expect(rows[0].classList.contains('ngx-tree-row--drag-over-inside')).toBe(true);
    expect(rows[0].classList.contains('ngx-tree-row--drag-over-before')).toBe(false);

    component.store.setDragState('file-a', 'folder', 'before');
    fixture.detectChanges();
    await fixture.whenStable();
    expect(rows[0].classList.contains('ngx-tree-row--drag-over-before')).toBe(true);
    expect(rows[0].classList.contains('ngx-tree-row--drag-over-inside')).toBe(false);
  });
});
