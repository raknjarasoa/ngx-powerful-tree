import { isPlatformBrowser } from '@angular/common';
import {
  computed,
  DestroyRef,
  Directive,
  ElementRef,
  inject,
  input,
  NgZone,
  OnInit,
  output,
  PLATFORM_ID,
} from '@angular/core';
import { NgxTreeStore } from './ngx-tree.store';
import { DragPosition, NgxTreeStructuralItem } from './ngx-tree.types';

// Spring-load delay for auto-expanding a folder when the cursor lingers
// over its "inside" zone. Measured by performance.now() diff rather than a
// setTimeout id, so cancellation is implicit (a new hover resets the clock).
const SPRING_LOAD_DELAY_MS = 800;

@Directive({
  selector: '[ngxTreeRow]',
  standalone: true,
  host: {
    role: 'treeitem',
    '[attr.aria-expanded]': 'ariaExpanded()',
    '[attr.aria-selected]': 'ariaSelected()',
    '[attr.aria-level]': 'ariaLevel()',
    '[attr.tabindex]': 'tabindex()',
    class: 'ngx-tree-row',
    '[class.ngx-tree-row--folder]': 'isFolder()',
    '[class.ngx-tree-row--file]': 'isFile()',
    '[class.ngx-tree-row--expanded]': 'isExpanded()',
    '[class.ngx-tree-row--collapsed]': 'isCollapsed()',
    '[class.ngx-tree-row--selected]': 'isSelected()',
    '[class.ngx-tree-row--focused]': 'isFocused()',
    '[class.ngx-tree-row--editing]': 'isEditing()',
    '[class.ngx-tree-row--locked]': 'isLocked()',
    '[class.ngx-tree-row--dragging]': 'isDragging()',
    '[class.ngx-tree-row--drag-over-inside]': 'isDragOverInside()',
    '[class.ngx-tree-row--drag-over-before]': 'isDragOverBefore()',
    '[class.ngx-tree-row--drag-over-after]': 'isDragOverAfter()',
    '[style.--ngx-tree-depth]': 'cssDepth()',
    '[class.ngx-tree-row--depth-0]': 'isDepth0()',
    '[attr.draggable]': 'isDraggable()',
  },
})
export class NgxTreeRowDirective implements OnInit {
  private el = inject(ElementRef);
  private store = inject(NgxTreeStore);
  private ngZone = inject(NgZone);
  private destroyRef = inject(DestroyRef);
  private platformId = inject(PLATFORM_ID);

  private dragGhostEl: HTMLElement | null = null;
  // Detaches the drag teardown safety-net listeners registered on dragstart.
  // Non-null only while this row is the active drag source; calling it is
  // idempotent via endDrag().
  private detachDragEndListeners: (() => void) | null = null;
  // Timestamp of when the cursor first entered this row's "inside" zone
  // during the current drag. Used for timestamp-diff spring-load instead
  // of a setTimeout — cancellation is implicit (cleared on dragleave).
  private springLoadHoverStartedAt: number | null = null;

  item = input.required<NgxTreeStructuralItem>();
  readOnly = input<boolean>(false);
  locked = input<boolean>(false);

  itemMoved = output<{ draggedId: string; targetId: string; position: DragPosition }>();

  ariaExpanded = computed(() => (this.item().isFolder ? this.item().expanded.toString() : null));
  ariaSelected = computed(() => this.store.selectedItems().has(this.item().id));
  ariaLevel = computed(() => this.item().depth + 1);
  tabindex = computed(() => (this.store.focusedItemId() === this.item().id ? '0' : '-1'));

  isFolder = computed(() => this.item().isFolder);
  isFile = computed(() => !this.item().isFolder);
  isExpanded = computed(() => this.item().isFolder && this.item().expanded);
  isCollapsed = computed(() => this.item().isFolder && !this.item().expanded);
  isSelected = computed(() => this.store.selectedItems().has(this.item().id));
  isFocused = computed(() => this.store.focusedItemId() === this.item().id);
  isEditing = computed(() => this.store.editingItemId() === this.item().id);
  isLocked = computed(() => this.locked());
  isDragging = computed(() => this.store.draggedItemId() === this.item().id);

  // Drag-over classes are driven by store signals — no row mutates the DOM
  // directly. Host bindings make Angular swap classes when the computed flips.
  isDragOverInside = computed(
    () => this.store.dragTargetId() === this.item().id && this.store.dragPosition() === 'inside'
  );
  isDragOverBefore = computed(
    () => this.store.dragTargetId() === this.item().id && this.store.dragPosition() === 'before'
  );
  isDragOverAfter = computed(
    () => this.store.dragTargetId() === this.item().id && this.store.dragPosition() === 'after'
  );

  cssDepth = computed(() => this.item().depth);
  isDepth0 = computed(() => this.item().depth === 0);
  isDraggable = computed(
    () => !this.readOnly() && !this.locked() && this.store.editingItemId() !== this.item().id
  );

  ngOnInit() {
    if (!isPlatformBrowser(this.platformId)) {
      return;
    }
    this.ngZone.runOutsideAngular(() => {
      const el = this.el.nativeElement as HTMLElement;
      const onDragStart = (e: DragEvent) => this.handleDragStart(e);
      const onDragOver = (e: DragEvent) => this.handleDragOver(e);
      const onDragLeave = (e: DragEvent) => this.handleDragLeave(e);
      const onDrop = (e: DragEvent) => this.handleDrop(e);

      el.addEventListener('dragstart', onDragStart);
      el.addEventListener('dragover', onDragOver);
      el.addEventListener('dragleave', onDragLeave);
      el.addEventListener('drop', onDrop);

      this.destroyRef.onDestroy(() => {
        el.removeEventListener('dragstart', onDragStart);
        el.removeEventListener('dragover', onDragOver);
        el.removeEventListener('dragleave', onDragLeave);
        el.removeEventListener('drop', onDrop);
        // If the row is destroyed mid-drag (e.g. virtual-scroll recycling),
        // tear down the active drag so listeners and the ghost don't leak.
        this.endDrag();
        this.removeDragGhost();
      });
    });
  }

  private handleDragStart(event: DragEvent) {
    if (this.readOnly() || this.locked() || this.store.editingItemId() === this.item().id) {
      event.preventDefault();
      return;
    }

    const sourceEl = this.el.nativeElement as HTMLElement;
    const rect = sourceEl.getBoundingClientRect();

    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', this.item().id);

      // Lightweight text ghost instead of cloneNode(true): a deep clone of
      // a styled row forces a full document reflow at dragstart.
      const ghost = document.createElement('div');
      ghost.textContent = this.item().name;
      ghost.classList.add('ngx-tree-drag-ghost');
      ghost.style.width = `${Math.min(rect.width, 300)}px`;
      ghost.style.height = `${rect.height}px`;
      ghost.style.position = 'fixed';
      ghost.style.top = '-9999px';
      ghost.style.left = '-9999px';
      document.body.appendChild(ghost);
      this.dragGhostEl = ghost;

      event.dataTransfer.setDragImage(ghost, event.clientX - rect.left, event.clientY - rect.top);
    }

    this.ngZone.run(() => {
      this.store.setDragState(this.item().id, null, null);
    });

    this.attachDragEndSafetyNet(sourceEl);
  }

  // Wire up drag teardown. `dragend` is the happy path, but it is NOT
  // guaranteed to fire: pausing in the debugger during `dragstart`, the
  // source element being detached mid-drag (e.g. a PrimeNG overlay/popover
  // re-rendering or virtual-scroll recycling), or an OS-level drag cancel can
  // all swallow it. When that happens the row stays stuck with the
  // `--dragging` class (grayed out), the ghost leaks, and the tree believes a
  // drag is still in progress — freezing further interaction.
  //
  // So we don't rely on `dragend` alone. During a real native drag the browser
  // suppresses mouse events, so a `mouseup`/`pointerup` reaching us means the
  // drag never truly armed (or already ended) — a safe signal to recover.
  // Escape covers keyboard cancels. Document-level `dragend`/`drop` (capture)
  // still fire even if the source element is recycled out from under us. Every
  // listener is removed the moment teardown runs, so nothing leaks between
  // drags.
  private attachDragEndSafetyNet(sourceEl: HTMLElement) {
    // Defensively clear any stale set from a prior drag before re-arming.
    this.detachDragEndListeners?.();

    const teardown = () => this.endDrag();
    const onKeydown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') this.endDrag();
    };

    sourceEl.addEventListener('dragend', teardown);
    document.addEventListener('dragend', teardown, true);
    document.addEventListener('drop', teardown, true);
    document.addEventListener('mouseup', teardown, true);
    document.addEventListener('pointerup', teardown, true);
    document.addEventListener('keydown', onKeydown, true);

    this.detachDragEndListeners = () => {
      sourceEl.removeEventListener('dragend', teardown);
      document.removeEventListener('dragend', teardown, true);
      document.removeEventListener('drop', teardown, true);
      document.removeEventListener('mouseup', teardown, true);
      document.removeEventListener('pointerup', teardown, true);
      document.removeEventListener('keydown', onKeydown, true);
    };
  }

  // Idempotent drag teardown: detach the safety-net listeners, drop the ghost,
  // reset spring-load, and clear the global drag state. Safe to call from any
  // of the (possibly several) teardown triggers — the first call wins and the
  // rest no-op because `detachDragEndListeners` is nulled out.
  private endDrag() {
    if (!this.detachDragEndListeners) return; // already torn down / not dragging
    this.detachDragEndListeners();
    this.detachDragEndListeners = null;
    this.removeDragGhost();
    this.springLoadHoverStartedAt = null;
    if (this.store.draggedItemId() !== null) {
      this.ngZone.run(() => this.store.clearDragState());
    }
  }

  private handleDragOver(event: DragEvent) {
    if (this.readOnly() || this.locked()) return;
    const draggedId = this.store.draggedItemId();
    if (!draggedId || draggedId === this.item().id) return;

    if (this.store.isDescendantOf(this.item().id, draggedId)) return;

    event.preventDefault(); // allow drop

    // Use the row's own rect (one element, not the whole viewport). Modern
    // browsers cache this and the cost is amortized; the original feedback
    // loop came from layout-shifting CSS, not from reading rects.
    const el = this.el.nativeElement as HTMLElement;
    const rect = el.getBoundingClientRect();
    const height = rect.height || 1;
    const relativeY = event.clientY - rect.top;

    let position: DragPosition;
    if (this.item().isFolder) {
      if (relativeY < height * 0.25) position = 'before';
      else if (
        relativeY > height * 0.75 &&
        (!this.item().expanded || !this.item().hasVisibleChildren)
      )
        position = 'after';
      else position = 'inside';
    } else {
      position = relativeY < height * 0.5 ? 'before' : 'after';
    }

    // Spring-load expansion via timestamp diff. No setTimeout, no timer id
    // to track — cancellation is "cursor leaves" resetting the timestamp.
    if (this.item().isFolder && position === 'inside' && !this.item().expanded) {
      const now = performance.now();
      if (this.springLoadHoverStartedAt === null) {
        this.springLoadHoverStartedAt = now;
      } else if (now - this.springLoadHoverStartedAt > SPRING_LOAD_DELAY_MS) {
        this.springLoadHoverStartedAt = null; // expand once per hover session
        this.ngZone.run(() => this.store.setExpanded(this.item().id, true));
      }
    } else {
      this.springLoadHoverStartedAt = null;
    }

    // Only write to the store when the result changes; otherwise every
    // dragover (~60 Hz) would needlessly re-run row computeds.
    if (this.store.dragTargetId() !== this.item().id || this.store.dragPosition() !== position) {
      this.ngZone.run(() => this.store.setDragState(draggedId, this.item().id, position));
    }
  }

  private handleDragLeave(event: DragEvent) {
    // dragleave also fires when the cursor enters a child element. Use
    // relatedTarget to distinguish: if we're moving to a descendant of this
    // row, we haven't really left.
    const related = event.relatedTarget as Node | null;
    const el = this.el.nativeElement as HTMLElement;
    if (related && el.contains(related)) return;

    this.springLoadHoverStartedAt = null;

    // Only clear the store target if WE'RE still it. Otherwise another row
    // already claimed it via its own dragover (browsers fire dragenter+over
    // on the new target before dragleave on the old one).
    if (this.store.dragTargetId() === this.item().id) {
      this.ngZone.run(() => {
        this.store.dragTargetId.set(null);
        this.store.dragPosition.set(null);
      });
    }
  }

  private handleDrop(event: DragEvent) {
    if (this.readOnly() || this.locked()) return;
    event.preventDefault();
    this.springLoadHoverStartedAt = null;

    const draggedId = this.store.draggedItemId();
    const targetId = this.store.dragTargetId();
    const position = this.store.dragPosition();

    this.ngZone.run(() => {
      if (draggedId && targetId && position && draggedId !== targetId) {
        if (this.store.moveItem(draggedId, targetId, position)) {
          this.itemMoved.emit({ draggedId, targetId, position });
        }
      }
      this.store.clearDragState();
    });
  }

  private removeDragGhost() {
    if (this.dragGhostEl) {
      this.dragGhostEl.remove();
      this.dragGhostEl = null;
    }
  }
}
