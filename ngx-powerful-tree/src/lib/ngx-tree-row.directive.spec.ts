import { ComponentFixture, TestBed } from '@angular/core/testing';
import { describe, it, expect, beforeEach } from 'vitest';
import { NgxPowerfulTree } from './ngx-powerful-tree/ngx-powerful-tree';
import { NgxTreeNode } from './ngx-tree.types';

// Tests exercise the drag math of NgxTreeRowDirective through real DOM events
// against a mounted NgxPowerfulTree. Drag rect calculations are short-circuited
// by mocking getBoundingClientRect on each row.

const dispatchDragOver = (el: HTMLElement, clientY: number) => {
  const event = new Event('dragover', { bubbles: true, cancelable: true }) as Event & {
    clientY: number;
  };
  event.clientY = clientY;
  el.dispatchEvent(event);
};

const dispatchDragStart = (el: HTMLElement) => {
  const event = new Event('dragstart', { bubbles: true, cancelable: true }) as Event & {
    dataTransfer: DataTransfer | null;
  };
  // jsdom does not attach a dataTransfer; the directive guards on null.
  event.dataTransfer = null;
  el.dispatchEvent(event);
};

const stubRect = (el: HTMLElement, top: number, height: number) => {
  el.getBoundingClientRect = () =>
    ({
      top,
      bottom: top + height,
      height,
      left: 0,
      right: 0,
      width: 0,
      x: 0,
      y: top,
      toJSON: () => ({}),
    }) as DOMRect;
};

const flushRaf = () =>
  new Promise<void>((resolve) => {
    requestAnimationFrame(() => resolve());
  });

describe('NgxTreeRowDirective drag math', () => {
  let component: NgxPowerfulTree;
  let fixture: ComponentFixture<NgxPowerfulTree>;
  let rows: HTMLElement[];

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [NgxPowerfulTree],
    }).compileComponents();

    fixture = TestBed.createComponent(NgxPowerfulTree);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('nodes', []);
    fixture.detectChanges();
    await fixture.whenStable();

    const nodes: NgxTreeNode[] = [
      { id: 'folder', name: 'Folder', isFolder: true, children: [] },
      { id: 'a', name: 'A', isFolder: false },
      { id: 'b', name: 'B', isFolder: false },
    ];
    component.reload(nodes);
    fixture.detectChanges();
    await fixture.whenStable();

    rows = Array.from(
      fixture.nativeElement.querySelectorAll('.ngx-tree-row-wrapper')
    ) as HTMLElement[];
    rows.forEach((row, i) => stubRect(row, i * 40, 40));
  });

  it('drops above the top quarter of a folder as before', async () => {
    component.store.setDragState('a', null, null);
    dispatchDragOver(rows[0], 0 + 4); // top of folder row
    await flushRaf();
    const state = component.store.dragState();
    expect(state.dragOverItemId).toBe('folder');
    expect(state.position).toBe('before');
  });

  it('drops in the middle of a collapsed folder as inside', async () => {
    component.store.setDragState('a', null, null);
    dispatchDragOver(rows[0], 0 + 20); // middle of folder row
    await flushRaf();
    const state = component.store.dragState();
    expect(state.dragOverItemId).toBe('folder');
    expect(state.position).toBe('inside');
  });

  it('maps after-of-row to before-of-next-sibling via indexById', async () => {
    // Drag the folder over the bottom half of file 'a'. The next sibling 'b'
    // is not the dragged id, so the mapping fires.
    component.store.setDragState('folder', null, null);
    dispatchDragOver(rows[1], 40 + 38); // bottom of file 'a'
    await flushRaf();
    const state = component.store.dragState();
    expect(state.dragOverItemId).toBe('b');
    expect(state.position).toBe('before');
  });

  it('keeps after-position when the next sibling is the dragged item', async () => {
    // Drag 'b' over the bottom half of file 'a' — the only sibling after 'a'
    // is 'b' itself, so the mapping should be skipped and position stays 'after'.
    component.store.setDragState('b', null, null);
    dispatchDragOver(rows[1], 40 + 38);
    await flushRaf();
    const state = component.store.dragState();
    expect(state.dragOverItemId).toBe('a');
    expect(state.position).toBe('after');
  });

  it('refuses to set drag state when hovering over the dragged item itself', async () => {
    component.store.setDragState('folder', null, null);
    dispatchDragOver(rows[0], 0 + 20);
    await flushRaf();
    const state = component.store.dragState();
    expect(state.dragOverItemId).toBeNull();
    expect(state.position).toBeNull();
  });

  it('coalesces multiple dragover events into a single store write per frame', async () => {
    component.store.setDragState('a', null, null);
    // Three rapid events at different Ys — only one rAF tick will run.
    dispatchDragOver(rows[0], 4);
    dispatchDragOver(rows[0], 10);
    dispatchDragOver(rows[0], 38);
    await flushRaf();
    const state = component.store.dragState();
    // Last queued Y (38) determined the final position: bottom of a collapsed folder = 'after'
    // -> mapped to before next sibling 'a', but 'a' is the dragged id so mapping skips and
    //    we keep 'after' on the folder.
    expect(state.dragOverItemId).toBe('folder');
    expect(state.position).toBe('after');
  });
});
