import {
  Directive,
  ElementRef,
  HostBinding,
  HostListener,
  inject,
  input,
  output,
} from '@angular/core';
import { NgxTreeStore } from './ngx-tree.store';
import { DragPosition, NgxTreeProxyItem } from './ngx-tree.types';

@Directive({
  selector: '[ngxTreeRow]',
  standalone: true,
})
export class NgxTreeRowDirective {
  private el = inject(ElementRef);
  private store = inject(NgxTreeStore);
  private hoverTimer: number | null = null;

  // Modern Signal Inputs
  item = input.required<NgxTreeProxyItem>();

  // Outputs for parent notification
  itemMoved = output<{ draggedId: string; targetId: string; position: DragPosition }>();

  // ARIA Host Bindings
  @HostBinding('attr.role') get role() {
    return 'treeitem';
  }

  @HostBinding('attr.aria-expanded') get ariaExpanded() {
    return this.item().isFolder ? this.item().expanded.toString() : null;
  }

  @HostBinding('attr.aria-selected') get ariaSelected() {
    return this.item().selected;
  }

  @HostBinding('attr.aria-level') get ariaLevel() {
    return this.item().depth + 1;
  }

  @HostBinding('attr.tabindex') get tabindex() {
    // Only the focused item is in the tab sequence. If none focused, the first item is.
    return this.item().focused ? '0' : '-1';
  }

  // Dynamic status CSS classes
  @HostBinding('class.ngx-tree-row') get isRow() {
    return true;
  }

  @HostBinding('class.ngx-tree-row--folder') get isFolder() {
    return this.item().isFolder;
  }

  @HostBinding('class.ngx-tree-row--file') get isFile() {
    return !this.item().isFolder;
  }

  @HostBinding('class.ngx-tree-row--expanded') get isExpanded() {
    return this.item().isFolder && this.item().expanded;
  }

  @HostBinding('class.ngx-tree-row--collapsed') get isCollapsed() {
    return this.item().isFolder && !this.item().expanded;
  }

  @HostBinding('class.ngx-tree-row--selected') get isSelected() {
    return this.item().selected;
  }

  @HostBinding('class.ngx-tree-row--focused') get isFocused() {
    return this.item().focused;
  }

  @HostBinding('class.ngx-tree-row--editing') get isEditing() {
    return this.item().editing;
  }

  @HostBinding('class.ngx-tree-row--dragging') get isDragging() {
    return this.store.dragState().draggedItemId === this.item().id;
  }

  // Drag Over positions CSS classes
  @HostBinding('class.ngx-tree-row--drag-over-before') get isDragOverBefore() {
    return this.isDragOverState('before');
  }

  @HostBinding('class.ngx-tree-row--drag-over-after') get isDragOverAfter() {
    return this.isDragOverState('after');
  }

  @HostBinding('class.ngx-tree-row--drag-over-inside') get isDragOverInside() {
    return this.isDragOverState('inside');
  }

  // Bind CSS custom variables dynamically
  @HostBinding('style.--ngx-tree-depth') get cssDepth() {
    return this.item().depth;
  }

  @HostBinding('attr.draggable') get isDraggable() {
    // Prevent dragging if renaming to avoid conflict
    return !this.item().editing;
  }

  // --- HTML5 Native Drag & Drop Event Listeners ---

  @HostListener('dragstart', ['$event'])
  onDragStart(event: DragEvent) {
    if (this.item().editing) {
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

  @HostListener('dragover', ['$event'])
  onDragOver(event: DragEvent) {
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

    this.store.setDragState(draggedId, this.item().id, position);

    // Spring-loaded folder expansion: if dragging over a folder and position is inside, auto-expand it after 800ms
    if (this.item().isFolder && position === 'inside' && !this.item().expanded) {
      if (!this.hoverTimer) {
        this.hoverTimer = setTimeout(() => {
          this.store.setExpanded(this.item().id, true);
          this.hoverTimer = null;
        }, 800);
      }
    } else {
      this.clearHoverTimer();
    }
  }

  @HostListener('dragleave', ['$event'])
  onDragLeave(event: DragEvent) {
    this.clearHoverTimer();
    const dragState = this.store.dragState();
    if (dragState.dragOverItemId === this.item().id) {
      this.store.setDragState(dragState.draggedItemId, null, null);
    }
  }

  @HostListener('drop', ['$event'])
  onDrop(event: DragEvent) {
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

  @HostListener('dragend', ['$event'])
  onDragEnd(event: DragEvent) {
    this.clearHoverTimer();
    this.store.clearDragState();
  }

  // --- Helper Methods ---

  private clearHoverTimer() {
    if (this.hoverTimer) {
      clearTimeout(this.hoverTimer);
      this.hoverTimer = null;
    }
  }

  private isDragOverState(pos: DragPosition): boolean {
    const dragState = this.store.dragState();
    return dragState.dragOverItemId === this.item().id && dragState.position === pos;
  }
}
