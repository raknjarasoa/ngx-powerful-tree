import { ComponentFixture, TestBed } from '@angular/core/testing';
import { describe, it, expect, beforeEach } from 'vitest';
import { NgxPowerfulTree } from './ngx-powerful-tree';
import { DragPosition, NgxTreeNode } from '../ngx-tree.types';

// These tests exercise the centralized drag-position math living on
// NgxPowerfulTree (NOT per-row event handlers). The math derives the
// hovered row index from `scrollTop + clientY` divided by `itemSize`, so
// tests work even when virtual scroll layout is inert (jsdom).

// Each row in the seed tree renders at 40px (the default itemSize).
const VIEWPORT_TOP = 0;
const VIEWPORT_HEIGHT = 600;

const stubViewportRect = (el: HTMLElement) => {
  el.getBoundingClientRect = () =>
    ({
      top: VIEWPORT_TOP,
      bottom: VIEWPORT_TOP + VIEWPORT_HEIGHT,
      height: VIEWPORT_HEIGHT,
      left: 0,
      right: 300,
      width: 300,
      x: 0,
      y: VIEWPORT_TOP,
      toJSON: () => ({}),
    }) as DOMRect;
  Object.defineProperty(el, 'scrollTop', {
    configurable: true,
    get: () => 0,
    set: () => undefined,
  });
};

const dispatchDragOver = (el: HTMLElement, clientY: number) => {
  const event = new Event('dragover', { bubbles: true, cancelable: true }) as Event & {
    clientY: number;
    clientX: number;
  };
  event.clientY = clientY;
  event.clientX = 50;
  el.dispatchEvent(event);
};

const dispatchDrop = (el: HTMLElement, clientY: number) => {
  const event = new Event('drop', { bubbles: true, cancelable: true }) as Event & {
    clientY: number;
    clientX: number;
  };
  event.clientY = clientY;
  event.clientX = 50;
  el.dispatchEvent(event);
};

const flushRaf = () =>
  new Promise<void>((resolve) => {
    requestAnimationFrame(() => resolve());
  });

describe('NgxPowerfulTree centralized drag math', () => {
  let component: NgxPowerfulTree;
  let fixture: ComponentFixture<NgxPowerfulTree>;
  let viewportEl: HTMLElement;

  // Tree layout (each row is 40px tall):
  //   index 0: folder (collapsed, isFolder=true)   → y ∈ [0, 40)
  //   index 1: file-a (isFolder=false)             → y ∈ [40, 80)
  //   index 2: file-b (isFolder=false)             → y ∈ [80, 120)
  //   index 3: locked-folder (isFolder=true)       → y ∈ [120, 160)
  const seed = (): NgxTreeNode[] => [
    { id: 'folder', name: 'Folder', isFolder: true, children: [] },
    { id: 'file-a', name: 'A', isFolder: false },
    { id: 'file-b', name: 'B', isFolder: false },
    { id: 'locked-folder', name: 'Locked', isFolder: true, locked: true, children: [] },
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

    const vpt = component.viewport();
    if (!vpt) throw new Error('viewport not initialized');
    viewportEl = vpt.elementRef.nativeElement;
    stubViewportRect(viewportEl);
  });

  it('targets a collapsed folder as "before" in its top quarter', async () => {
    component.store.draggedItemId.set('file-a');
    dispatchDragOver(viewportEl, 4); // y=4 → relativeYToRow=4 → < 10 → before
    await flushRaf();
    expect(component.store.dragTargetId()).toBe('folder');
    expect(component.store.dragPosition()).toBe('before');
  });

  it('targets a collapsed folder as "inside" in its middle band', async () => {
    component.store.draggedItemId.set('file-a');
    dispatchDragOver(viewportEl, 20);
    await flushRaf();
    expect(component.store.dragTargetId()).toBe('folder');
    expect(component.store.dragPosition()).toBe('inside');
  });

  it('targets a collapsed folder as "after" in its bottom quarter', async () => {
    component.store.draggedItemId.set('file-a');
    dispatchDragOver(viewportEl, 38);
    await flushRaf();
    expect(component.store.dragTargetId()).toBe('folder');
    expect(component.store.dragPosition()).toBe('after');
  });

  it('splits a file row at the midpoint into "before" / "after"', async () => {
    component.store.draggedItemId.set('folder');
    dispatchDragOver(viewportEl, 50); // y=50, row index 1, relativeYToRow=10, < 20 → before
    await flushRaf();
    expect(component.store.dragTargetId()).toBe('file-a');
    expect(component.store.dragPosition()).toBe('before');

    dispatchDragOver(viewportEl, 70); // relativeYToRow=30, >= 20 → after
    await flushRaf();
    expect(component.store.dragPosition()).toBe('after');
  });

  it('refuses to set the dragged item as its own target', async () => {
    component.store.draggedItemId.set('folder');
    dispatchDragOver(viewportEl, 20); // would otherwise target 'folder' inside
    await flushRaf();
    expect(component.store.dragTargetId()).toBeNull();
    expect(component.store.dragPosition()).toBeNull();
  });

  it('refuses to set a locked item as the target', async () => {
    component.store.draggedItemId.set('file-a');
    dispatchDragOver(viewportEl, 140); // row index 3 = locked-folder
    await flushRaf();
    expect(component.store.dragTargetId()).toBeNull();
    expect(component.store.dragPosition()).toBeNull();
  });

  it('snaps cursor past the last row to last item with position "after"', async () => {
    component.store.draggedItemId.set('folder');
    // y=500 → rawIndex=12, list.length=4 → snap to last (index 3) with "after"
    // But the last row is locked-folder, which we refuse — switch dragged so
    // last visible row is the only file before locked-folder. Use file-b as
    // dragged, and ensure last unlocked row (file-b at index 2) is the snap.
    // Actually our list has the locked folder last; the snap should refuse
    // because targetItem.locked === true. Confirm that behavior first:
    dispatchDragOver(viewportEl, 500);
    await flushRaf();
    expect(component.store.dragTargetId()).toBeNull();

    // Reload without the locked row so the snap can succeed.
    component.reload([
      { id: 'folder', name: 'Folder', isFolder: true, children: [] },
      { id: 'file-a', name: 'A', isFolder: false },
      { id: 'file-b', name: 'B', isFolder: false },
    ]);
    fixture.detectChanges();
    await fixture.whenStable();
    stubViewportRect(viewportEl);

    component.store.draggedItemId.set('folder');
    dispatchDragOver(viewportEl, 500);
    await flushRaf();
    expect(component.store.dragTargetId()).toBe('file-b');
    expect(component.store.dragPosition()).toBe('after');
  });

  it('coalesces a burst of dragover events into a single rAF tick', async () => {
    component.store.draggedItemId.set('file-a');
    dispatchDragOver(viewportEl, 4);
    dispatchDragOver(viewportEl, 8);
    dispatchDragOver(viewportEl, 38);
    // Before rAF flushes, nothing has been written yet.
    expect(component.store.dragTargetId()).toBeNull();
    await flushRaf();
    // Last queued Y wins — y=38 maps to "after" on the folder row.
    expect(component.store.dragTargetId()).toBe('folder');
    expect(component.store.dragPosition()).toBe('after');
  });

  it('skips redundant store writes when position does not change', async () => {
    component.store.draggedItemId.set('file-a');
    dispatchDragOver(viewportEl, 20);
    await flushRaf();
    const dragTargetRef = component.store.dragTargetId();

    // Same position evaluated again should not toggle anything.
    dispatchDragOver(viewportEl, 21);
    dispatchDragOver(viewportEl, 22);
    await flushRaf();
    expect(component.store.dragTargetId()).toBe(dragTargetRef);
    expect(component.store.dragPosition()).toBe('inside');
  });

  it('moves item and emits itemMoved on drop', async () => {
    component.store.draggedItemId.set('file-b');
    dispatchDragOver(viewportEl, 50); // before file-a
    await flushRaf();

    type MoveEvent = { draggedId: string; targetId: string; position: DragPosition };
    let emitted: MoveEvent | null = null;
    component.itemMoved.subscribe((e) => (emitted = e));

    dispatchDrop(viewportEl, 50);
    fixture.detectChanges();
    await fixture.whenStable();

    if (!emitted) throw new Error('itemMoved was not emitted');
    const e: MoveEvent = emitted;
    expect(e.draggedId).toBe('file-b');
    expect(e.targetId).toBe('file-a');
    expect(e.position).toBe('before');

    // Drag state cleared after drop.
    expect(component.store.draggedItemId()).toBeNull();
    expect(component.store.dragTargetId()).toBeNull();
  });

  it('does not emit itemMoved when drop target is null', async () => {
    component.store.draggedItemId.set('folder');
    dispatchDragOver(viewportEl, 20); // dragging 'folder' over 'folder' → no target
    await flushRaf();
    expect(component.store.dragTargetId()).toBeNull();

    let emitted = false;
    component.itemMoved.subscribe(() => (emitted = true));

    dispatchDrop(viewportEl, 20);
    fixture.detectChanges();
    await fixture.whenStable();
    expect(emitted).toBe(false);
    expect(component.store.draggedItemId()).toBeNull();
  });

  it('does nothing when readOnly is true', async () => {
    fixture.componentRef.setInput('readOnly', true);
    fixture.detectChanges();
    await fixture.whenStable();

    component.store.draggedItemId.set('file-a');
    dispatchDragOver(viewportEl, 20);
    await flushRaf();
    expect(component.store.dragTargetId()).toBeNull();
  });
});
