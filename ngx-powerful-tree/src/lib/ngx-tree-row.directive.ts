import { Directive, ElementRef, inject, input, output, computed, signal } from '@angular/core';
import { NgxTreeStore } from './ngx-tree.store';
import { DragPosition, NgxTreeProxyItem } from './ngx-tree.types';

@Directive({
  selector: '[ngxTreeRow]',
  standalone: true,
  host: {
    role: 'treeitem',
    '[attr.aria-expanded]': 'ariaExpanded()',
    '[attr.aria-selected]': 'ariaSelected()',
    '[attr.aria-level]': 'ariaLevel()',
    '[attr.tabindex]': 'tabindex()',
    '[class.ngx-tree-row]': 'isRow()',
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
    '(dragstart)': 'onDragStart($event)',
    '(dragover)': 'onDragOver($event)',
    '(dragleave)': 'onDragLeave()',
    '(drop)': 'onDrop($event)',
    '(dragend)': 'onDragEnd()',
  },
})
export class NgxTreeRowDirective {
  private el = inject(ElementRef);
  private store = inject(NgxTreeStore);
  private hoverTimer: number | null = null;

  // Modern Signal Inputs
  item = input.required<NgxTreeProxyItem>();
  readOnly = input<boolean>(false);
  locked = input<boolean>(false);

  // Outputs for parent notification
  itemMoved = output<{ draggedId: string; targetId: string; position: DragPosition }>();

  // Derived state signals to avoid legacy getters
  ariaExpanded = computed(() => (this.item().isFolder ? this.item().expanded.toString() : null));
  ariaSelected = computed(() => this.item().selected);
  ariaLevel = computed(() => this.item().depth + 1);
  tabindex = computed(() => (this.item().focused ? '0' : '-1'));

  isRow = signal(true);
  isFolder = computed(() => this.item().isFolder);
  isFile = computed(() => !this.item().isFolder);
  isExpanded = computed(() => this.item().isFolder && this.item().expanded);
  isCollapsed = computed(() => this.item().isFolder && !this.item().expanded);
  isSelected = computed(() => this.item().selected);
  isFocused = computed(() => this.item().focused);
  isEditing = computed(() => this.item().editing);
  isLocked = computed(() => this.locked());
  isDragging = computed(() => this.store.dragState().draggedItemId === this.item().id);

  isDragOverBefore = computed(() => this.isDragOverState('before'));
  isDragOverAfter = computed(() => this.isDragOverState('after'));
  isDragOverInside = computed(() => this.isDragOverState('inside'));

  cssDepth = computed(() => this.item().depth);
  isDepth0 = computed(() => this.item().depth === 0);
  isDraggable = computed(() => !this.readOnly() && !this.locked() && !this.item().editing);

  // --- HTML5 Native Drag & Drop Event Listeners ---

  onDragStart(event: DragEvent) {
    if (this.readOnly() || this.locked() || this.item().editing) {
      event.preventDefault();
      return;
    }

    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', this.item().id);
    }

    // Set global store drag state
    this.store.setDragState(this.item().id, null, null);
  }

  onDragOver(event: DragEvent) {
    if (this.readOnly() || this.locked()) {
      return;
    }
    const dragState = this.store.dragState();
    const draggedId = dragState.draggedItemId;

    // Prevent dragging over oneself
    if (!draggedId || draggedId === this.item().id) {
      return;
    }

    event.preventDefault(); // Required to allow drop!

    // Calculate hover position
    const rect = this.el.nativeElement.getBoundingClientRect();
    const relativeY = event.clientY - rect.top;
    const height = rect.height;
    let position: DragPosition = 'inside';

    if (this.item().isFolder) {
      // Folder allows inserting before, after, or dropping inside
      if (relativeY < height * 0.25) {
        position = 'before';
      } else if (relativeY > height * 0.75) {
        position = 'after';
      } else {
        position = 'inside';
      }
    } else {
      // File only allows inserting before or after
      if (relativeY < height * 0.5) {
        position = 'before';
      } else {
        position = 'after';
      }
    }

    // Only patch the store state if the target row or position has actually changed!
    if (dragState.dragOverItemId !== this.item().id || dragState.position !== position) {
      this.store.setDragState(draggedId, this.item().id, position);
    }

    // Spring-loaded folder expansion: if dragging over a folder and position is inside, auto-expand it after 800ms
    if (this.item().isFolder && position === 'inside' && !this.item().expanded) {
      if (!this.hoverTimer) {
        this.hoverTimer = window.setTimeout(() => {
          this.store.setExpanded(this.item().id, true);
          this.hoverTimer = null;
        }, 800);
      }
    } else {
      this.clearHoverTimer();
    }
  }

  onDragLeave() {
    if (this.readOnly() || this.locked()) {
      return;
    }
    this.clearHoverTimer();
    const dragState = this.store.dragState();
    if (dragState.dragOverItemId === this.item().id) {
      this.store.setDragState(dragState.draggedItemId, null, null);
    }
  }

  onDrop(event: DragEvent) {
    if (this.readOnly() || this.locked()) {
      return;
    }
    event.preventDefault();
    this.clearHoverTimer();

    const dragState = this.store.dragState();
    const draggedId = dragState.draggedItemId;
    const position = dragState.position;

    if (draggedId && draggedId !== this.item().id && position) {
      // Perform the move in local state store
      this.store.moveItem(draggedId, this.item().id, position);

      // Emit event for consumer syncing
      this.itemMoved.emit({
        draggedId,
        targetId: this.item().id,
        position,
      });
    }

    this.store.clearDragState();
  }

  onDragEnd() {
    if (this.readOnly() || this.locked()) {
      return;
    }
    this.clearHoverTimer();
    this.store.clearDragState();
  }

  // --- Helper Methods ---

  private clearHoverTimer() {
    if (this.hoverTimer) {
      window.clearTimeout(this.hoverTimer);
      this.hoverTimer = null;
    }
  }

  private isDragOverState(pos: DragPosition): boolean {
    const dragState = this.store.dragState();
    return dragState.dragOverItemId === this.item().id && dragState.position === pos;
  }
}
