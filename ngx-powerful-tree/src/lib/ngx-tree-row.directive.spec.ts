import { ComponentFixture, TestBed } from '@angular/core/testing';
import { describe, it, expect, beforeEach } from 'vitest';
import { NgxPowerfulTree } from './ngx-powerful-tree/ngx-powerful-tree';
import { NgxTreeNode } from './ngx-tree.types';

// Drag handlers live on the row directive. These tests mount the tree,
// dispatch synthetic drag events on individual row elements, and assert
// store state. Per-row getBoundingClientRect is stubbed so the math is
// deterministic in jsdom (which doesn't compute layout).

const ROW_HEIGHT = 40;

const stubRect = (el: HTMLElement, top: number, height: number) => {
  el.getBoundingClientRect = () =>
    ({
      top,
      bottom: top + height,
      height,
      left: 0,
      right: 300,
      width: 300,
      x: 0,
      y: top,
      toJSON: () => ({}),
    }) as DOMRect;
};

const dispatchDragOver = (el: HTMLElement, clientY: number) => {
  const event = new Event('dragover', { bubbles: true, cancelable: true }) as Event & {
    clientY: number;
    clientX: number;
  };
  event.clientY = clientY;
  event.clientX = 50;
  el.dispatchEvent(event);
  return event;
};

const dispatchDragLeave = (el: HTMLElement, relatedTarget: EventTarget | null = null) => {
  const event = new Event('dragleave', { bubbles: true, cancelable: true }) as Event & {
    relatedTarget: EventTarget | null;
  };
  event.relatedTarget = relatedTarget;
  el.dispatchEvent(event);
};

const dispatchDrop = (el: HTMLElement) => {
  const event = new Event('drop', { bubbles: true, cancelable: true });
  el.dispatchEvent(event);
};

const dispatchDragEnd = (el: HTMLElement) => {
  const event = new Event('dragend', { bubbles: true, cancelable: true });
  el.dispatchEvent(event);
};

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

  // Layout in tests:
  //   row 0: folder        (collapsed) → y ∈ [0, 40)
  //   row 1: file-a                    → y ∈ [40, 80)
  //   row 2: file-b                    → y ∈ [80, 120)
  //   row 3: locked-file (locked)      → y ∈ [120, 160)
  const seed = (): NgxTreeNode[] => [
    { id: 'folder', name: 'Folder', isFolder: true, children: [] },
    { id: 'file-a', name: 'A', isFolder: false },
    { id: 'file-b', name: 'B', isFolder: false },
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
    rows.forEach((row, i) => stubRect(row, i * ROW_HEIGHT, ROW_HEIGHT));
  });

  // ----- dragstart gating ----------------------------------------------------

  it('marks unlocked, non-readonly rows as draggable', () => {
    expect(rows[0].getAttribute('draggable')).toBe('true');
    expect(rows[1].getAttribute('draggable')).toBe('true');
  });

  it('refuses to mark locked rows as draggable', () => {
    expect(rows[3].getAttribute('draggable')).toBe('false');
  });

  it('refuses to start a drag for a locked row (preventDefault)', () => {
    const event = dispatchDragStart(rows[3]);
    expect(event.defaultPrevented).toBe(true);
    expect(component.store.draggedItemId()).toBeNull();
  });

  it('sets store.draggedItemId on dragstart of a normal row', () => {
    dispatchDragStart(rows[1]);
    expect(component.store.draggedItemId()).toBe('file-a');
  });

  // ----- drag teardown / freeze recovery ------------------------------------
  //
  // All cleanup used to hang off `dragend`. But that event is not guaranteed
  // to fire (debugger pause during dragstart, source element detached mid-drag
  // by an overlay/popover, OS-level cancel). When it was swallowed the row
  // stayed stuck with draggedItemId set — grayed out and freezing the tree.
  // These assert the non-drag recovery paths self-heal that stuck state.

  it('clears drag state on dragend (happy path)', () => {
    dispatchDragStart(rows[1]);
    expect(component.store.draggedItemId()).toBe('file-a');

    dispatchDragEnd(rows[1]);
    expect(component.store.draggedItemId()).toBeNull();
  });

  it('recovers stuck drag state on mouseup when dragend never fires', () => {
    dispatchDragStart(rows[1]);
    expect(component.store.draggedItemId()).toBe('file-a');

    // Simulate the drag dying without a dragend (the freeze scenario). A real
    // native drag suppresses mouse events, so a mouseup reaching us means the
    // drag never armed — recover.
    document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    expect(component.store.draggedItemId()).toBeNull();
  });

  it('detaches recovery listeners after teardown (no cross-drag leakage)', () => {
    dispatchDragStart(rows[1]);
    dispatchDragEnd(rows[1]);
    expect(component.store.draggedItemId()).toBeNull();

    // A later, unrelated drag is set directly in the store. The previous
    // drag's mouseup listener must already be gone, so it cannot clobber it.
    component.store.setDragState('file-b', null, null);
    document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    expect(component.store.draggedItemId()).toBe('file-b');
  });

  // ----- dragover position math ---------------------------------------------

  it('targets a collapsed folder as "before" in its top quarter', () => {
    component.store.setDragState('file-a', null, null);
    dispatchDragOver(rows[0], 4);
    expect(component.store.dragTargetId()).toBe('folder');
    expect(component.store.dragPosition()).toBe('before');
  });

  it('targets a collapsed folder as "inside" in its middle band', () => {
    component.store.setDragState('file-a', null, null);
    dispatchDragOver(rows[0], 20);
    expect(component.store.dragTargetId()).toBe('folder');
    expect(component.store.dragPosition()).toBe('inside');
  });

  it('targets a collapsed folder as "after" in its bottom quarter', () => {
    component.store.setDragState('file-a', null, null);
    dispatchDragOver(rows[0], 38);
    expect(component.store.dragTargetId()).toBe('folder');
    expect(component.store.dragPosition()).toBe('after');
  });

  it('splits a file row at the midpoint into "before" / "after"', () => {
    component.store.setDragState('folder', null, null);
    dispatchDragOver(rows[1], 50); // y=50 within row 1 (top=40) → relativeY=10 → before
    expect(component.store.dragTargetId()).toBe('file-a');
    expect(component.store.dragPosition()).toBe('before');

    dispatchDragOver(rows[1], 70); // relativeY=30 → after
    expect(component.store.dragPosition()).toBe('after');
  });

  // ----- refusal cases -------------------------------------------------------

  it('refuses to set the dragged item as its own target', () => {
    component.store.setDragState('folder', null, null);
    dispatchDragOver(rows[0], 20);
    expect(component.store.dragTargetId()).toBeNull();
    expect(component.store.dragPosition()).toBeNull();
  });

  it('refuses to process dragover on a locked target row', () => {
    component.store.setDragState('file-a', null, null);
    dispatchDragOver(rows[3], 140); // locked-file
    expect(component.store.dragTargetId()).toBeNull();
    expect(component.store.dragPosition()).toBeNull();
  });

  it('does nothing when readOnly is true', async () => {
    fixture.componentRef.setInput('readOnly', true);
    fixture.detectChanges();
    await fixture.whenStable();

    component.store.setDragState('file-a', null, null);
    dispatchDragOver(rows[0], 20);
    expect(component.store.dragTargetId()).toBeNull();
  });

  // ----- redundant-write suppression ----------------------------------------

  it('skips redundant store writes when position does not change', () => {
    component.store.setDragState('file-a', null, null);
    dispatchDragOver(rows[0], 20);
    const targetRef = component.store.dragTargetId();
    const posRef = component.store.dragPosition();

    // Same position evaluated again — should not toggle anything.
    dispatchDragOver(rows[0], 21);
    dispatchDragOver(rows[0], 22);
    expect(component.store.dragTargetId()).toBe(targetRef);
    expect(component.store.dragPosition()).toBe(posRef);
  });

  // ----- dragleave -----------------------------------------------------------

  it('clears the store target on dragleave (cursor exits this row)', () => {
    component.store.setDragState('file-a', null, null);
    dispatchDragOver(rows[0], 20);
    expect(component.store.dragTargetId()).toBe('folder');

    dispatchDragLeave(rows[0], null);
    expect(component.store.dragTargetId()).toBeNull();
    expect(component.store.dragPosition()).toBeNull();
  });

  it('does not clobber a sibling row that already became the target', () => {
    component.store.setDragState('file-a', null, null);
    // Sibling row 1 (file-a is dragged, so target b) already claimed target:
    component.store.setDragState('file-a', 'file-b', 'before');
    // Now row 0's dragleave fires (we left the folder row).
    dispatchDragLeave(rows[0], null);
    // Should NOT clobber the live state for file-b.
    expect(component.store.dragTargetId()).toBe('file-b');
    expect(component.store.dragPosition()).toBe('before');
  });

  // ----- drop ----------------------------------------------------------------

  it('moves item and emits itemMoved on drop', async () => {
    component.store.setDragState('file-b', null, null);
    dispatchDragOver(rows[1], 50); // before file-a

    let emittedCount = 0;
    let emittedDraggedId = '';
    let emittedTargetId = '';
    component.itemMoved.subscribe((e) => {
      emittedCount++;
      emittedDraggedId = e.draggedId;
      emittedTargetId = e.targetId;
    });

    dispatchDrop(rows[1]);
    fixture.detectChanges();
    await fixture.whenStable();

    expect(emittedCount).toBe(1);
    expect(emittedDraggedId).toBe('file-b');
    expect(emittedTargetId).toBe('file-a');
    expect(component.store.draggedItemId()).toBeNull();
    expect(component.store.dragTargetId()).toBeNull();
  });

  it('does not emit itemMoved when drop target is the dragged item', () => {
    component.store.setDragState('folder', null, null);
    dispatchDragOver(rows[0], 20); // dragging 'folder' over 'folder' → no target

    let emitted = false;
    component.itemMoved.subscribe(() => (emitted = true));

    dispatchDrop(rows[0]);
    expect(emitted).toBe(false);
    expect(component.store.draggedItemId()).toBeNull();
  });

  // ----- spring-load ---------------------------------------------------------

  it('expands a collapsed folder after the spring-load delay elapses', () => {
    const originalNow = performance.now.bind(performance);
    let nowValue = 1_000_000;
    performance.now = () => nowValue;
    try {
      component.store.setDragState('file-a', null, null);

      // First hover at t=0: should NOT expand yet.
      dispatchDragOver(rows[0], 20);
      expect(component.store.expandedItems().has('folder')).toBe(false);

      // 500 ms later: still under threshold.
      nowValue += 500;
      dispatchDragOver(rows[0], 20);
      expect(component.store.expandedItems().has('folder')).toBe(false);

      // 900 ms total: past 800 ms threshold → expand.
      nowValue += 400;
      dispatchDragOver(rows[0], 20);
      expect(component.store.expandedItems().has('folder')).toBe(true);
    } finally {
      performance.now = originalNow;
    }
  });

  it('resets the spring-load clock when the cursor leaves the row', () => {
    const originalNow = performance.now.bind(performance);
    let nowValue = 1_000_000;
    performance.now = () => nowValue;
    try {
      component.store.setDragState('file-a', null, null);

      dispatchDragOver(rows[0], 20);
      nowValue += 500;
      dispatchDragLeave(rows[0], null);

      // Coming back later — even if total elapsed > 800ms, the clock reset.
      nowValue += 2000;
      dispatchDragOver(rows[0], 20);
      expect(component.store.expandedItems().has('folder')).toBe(false);

      // Then another 900 ms past re-entry → expand.
      nowValue += 900;
      dispatchDragOver(rows[0], 20);
      expect(component.store.expandedItems().has('folder')).toBe(true);
    } finally {
      performance.now = originalNow;
    }
  });

  // ----- host bindings -------------------------------------------------------

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
