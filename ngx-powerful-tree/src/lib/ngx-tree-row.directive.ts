import {
  Directive,
  ElementRef,
  inject,
  input,
  output,
  computed,
  OnInit,
  NgZone,
  DestroyRef,
  PLATFORM_ID,
} from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { NgxTreeStore } from './ngx-tree.store';
import { DragPosition, NgxTreeStructuralItem } from './ngx-tree.types';

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
    '[class.ngx-tree-row--drag-over-before]': 'isDragOverBefore()',
    '[class.ngx-tree-row--drag-over-after]': 'isDragOverAfter()',
    '[class.ngx-tree-row--drag-over-inside]': 'isDragOverInside()',
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
  private hoverTimer: number | null = null;
  private dragOverRafId: number | null = null;
  private dragOverPendingY: number | null = null;
  private dragGhostEl: HTMLElement | null = null;

  item = input.required<NgxTreeStructuralItem>();
  readOnly = input<boolean>(false);
  locked = input<boolean>(false);

  // Outputs for parent notification
  itemMoved = output<{ draggedId: string; targetId: string; position: DragPosition }>();

  // Derived state signals to avoid legacy getters
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
  private dragOverPosition = computed(() => {
    const ds = this.store.dragState();
    if (ds.dragOverItemId !== this.item().id) return null;
    return ds.position;
  });
  isDragging = computed(() => this.store.dragState().draggedItemId === this.item().id);
  isDragOverBefore = computed(() => this.dragOverPosition() === 'before');
  isDragOverAfter = computed(() => this.dragOverPosition() === 'after');
  isDragOverInside = computed(() => this.dragOverPosition() === 'inside');

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
      const el = this.el.nativeElement;

      const onDragStartBind = (e: DragEvent) => this.handleDragStart(e);
      const onDragOverBind = (e: DragEvent) => this.handleDragOver(e);
      const onDragLeaveBind = () => this.handleDragLeave();
      const onDropBind = (e: DragEvent) => this.handleDrop(e);
      const onDragEndBind = () => this.handleDragEnd();

      el.addEventListener('dragstart', onDragStartBind);
      el.addEventListener('dragover', onDragOverBind);
      el.addEventListener('dragleave', onDragLeaveBind);
      el.addEventListener('drop', onDropBind);
      el.addEventListener('dragend', onDragEndBind);

      this.destroyRef.onDestroy(() => {
        el.removeEventListener('dragstart', onDragStartBind);
        el.removeEventListener('dragover', onDragOverBind);
        el.removeEventListener('dragleave', onDragLeaveBind);
        el.removeEventListener('drop', onDropBind);
        el.removeEventListener('dragend', onDragEndBind);
        this.clearHoverTimer();
        this.cancelDragOverRaf();
        this.removeDragGhost();
      });
    });
  }

  // --- HTML5 Native Drag & Drop Event Handlers (Outside Angular Zone for 60 FPS) ---

  private handleDragStart(event: DragEvent) {
    if (this.readOnly() || this.locked() || this.store.editingItemId() === this.item().id) {
      event.preventDefault();
      return;
    }

    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', this.item().id);

      const sourceEl = this.el.nativeElement as HTMLElement;
      const rect = sourceEl.getBoundingClientRect();
      const ghost = sourceEl.cloneNode(true) as HTMLElement;
      ghost.style.position = 'fixed';
      ghost.style.top = '-9999px';
      ghost.style.left = '-9999px';
      ghost.style.width = `${rect.width}px`;
      ghost.style.opacity = '1';
      ghost.style.pointerEvents = 'none';
      ghost.style.boxSizing = 'border-box';
      ghost.style.background = 'var(--ngx-tree-bg, #ffffff)';
      ghost.classList.remove(
        'ngx-tree-row--dragging',
        'ngx-tree-row--drag-over-before',
        'ngx-tree-row--drag-over-after',
        'ngx-tree-row--drag-over-inside'
      );
      document.body.appendChild(ghost);
      this.dragGhostEl = ghost;

      event.dataTransfer.setDragImage(ghost, event.clientX - rect.left, event.clientY - rect.top);
    }

    this.ngZone.run(() => {
      this.store.setDragState(this.item().id, null, null);
    });
  }

  private handleDragOver(event: DragEvent) {
    if (this.readOnly() || this.locked()) return;

    const dragState = this.store.dragState();
    const draggedId = dragState.draggedItemId;
    if (!draggedId || draggedId === this.item().id) return;

    event.preventDefault(); // Required to allow drop!

    // Coalesce multiple dragover events per row into a single rAF tick.
    this.dragOverPendingY = event.clientY;
    if (this.dragOverRafId !== null) return;
    this.dragOverRafId = requestAnimationFrame(() => {
      this.dragOverRafId = null;
      const y = this.dragOverPendingY;
      this.dragOverPendingY = null;
      if (y === null) return;
      this.processDragOver(y);
    });
  }

  private processDragOver(clientY: number) {
    const dragState = this.store.dragState();
    const draggedId = dragState.draggedItemId;
    if (!draggedId || draggedId === this.item().id) return;

    const rect = this.el.nativeElement.getBoundingClientRect();
    const relativeY = clientY - rect.top;
    const height = rect.height;
    let position: DragPosition = 'inside';

    if (this.item().isFolder) {
      if (relativeY < height * 0.25) position = 'before';
      else if (relativeY > height * 0.75 && !this.item().expanded) position = 'after';
      else position = 'inside';
    } else {
      position = relativeY < height * 0.5 ? 'before' : 'after';
    }

    // Map 'after' to 'before next sibling' using the O(1) indexById cache.
    let targetId = this.item().id;
    let finalPosition = position;
    if (position === 'after') {
      const struct = this.store.flattenedStructure();
      const idx = struct.indexById[this.item().id];
      if (idx !== undefined && idx < struct.list.length - 1) {
        const nextItem = struct.list[idx + 1];
        if (nextItem.id !== draggedId) {
          targetId = nextItem.id;
          finalPosition = 'before';
        }
      }
    }

    if (dragState.dragOverItemId !== targetId || dragState.position !== finalPosition) {
      this.ngZone.run(() => {
        this.store.setDragState(draggedId, targetId, finalPosition);
      });
    }

    // Spring-loaded folder expansion at 800ms hover.
    if (this.item().isFolder && position === 'inside' && !this.item().expanded) {
      if (!this.hoverTimer) {
        this.hoverTimer = window.setTimeout(() => {
          this.ngZone.run(() => {
            this.store.setExpanded(this.item().id, true);
          });
          this.hoverTimer = null;
        }, 800);
      }
    } else {
      this.clearHoverTimer();
    }
  }

  private handleDragLeave() {
    if (this.readOnly() || this.locked()) return;
    this.clearHoverTimer();
    this.cancelDragOverRaf();
    const dragState = this.store.dragState();

    let isTarget = dragState.dragOverItemId === this.item().id;
    if (!isTarget) {
      const struct = this.store.flattenedStructure();
      const idx = struct.indexById[this.item().id];
      if (idx !== undefined && idx < struct.list.length - 1) {
        const nextItem = struct.list[idx + 1];
        if (dragState.dragOverItemId === nextItem.id && dragState.position === 'before') {
          isTarget = true;
        }
      }
    }

    if (isTarget) {
      this.ngZone.run(() => {
        this.store.setDragState(dragState.draggedItemId, null, null);
      });
    }
  }

  private cancelDragOverRaf() {
    if (this.dragOverRafId !== null) {
      cancelAnimationFrame(this.dragOverRafId);
      this.dragOverRafId = null;
    }
    this.dragOverPendingY = null;
  }

  private handleDrop(event: DragEvent) {
    if (this.readOnly() || this.locked()) return;
    event.preventDefault();
    this.clearHoverTimer();
    this.cancelDragOverRaf();

    const dragState = this.store.dragState();
    const draggedId = dragState.draggedItemId;
    const position = dragState.position;
    const dragOverItemId = dragState.dragOverItemId;

    if (draggedId && dragOverItemId && position && draggedId !== dragOverItemId) {
      this.ngZone.run(() => {
        if (this.store.moveItem(draggedId, dragOverItemId, position)) {
          this.itemMoved.emit({
            draggedId,
            targetId: dragOverItemId,
            position,
          });
        }
        this.store.clearDragState();
      });
    } else {
      this.ngZone.run(() => {
        this.store.clearDragState();
      });
    }
  }

  private handleDragEnd() {
    this.clearHoverTimer();
    this.cancelDragOverRaf();
    this.removeDragGhost();
    this.ngZone.run(() => {
      this.store.clearDragState();
    });
  }

  // --- Helper Methods ---

  private clearHoverTimer() {
    if (this.hoverTimer) {
      window.clearTimeout(this.hoverTimer);
      this.hoverTimer = null;
    }
  }

  private removeDragGhost() {
    if (this.dragGhostEl) {
      this.dragGhostEl.remove();
      this.dragGhostEl = null;
    }
  }
}
