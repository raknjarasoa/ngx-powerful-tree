import {
  Directive,
  ElementRef,
  inject,
  input,
  output,
  computed,
  signal,
  OnInit,
  NgZone,
  DestroyRef,
  PLATFORM_ID,
} from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
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
  },
})
export class NgxTreeRowDirective implements OnInit {
  private el = inject(ElementRef);
  private store = inject(NgxTreeStore);
  private ngZone = inject(NgZone);
  private destroyRef = inject(DestroyRef);
  private platformId = inject(PLATFORM_ID);
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
      });
    });
  }

  // --- HTML5 Native Drag & Drop Event Handlers (Outside Angular Zone for 60 FPS) ---

  private handleDragStart(event: DragEvent) {
    if (this.readOnly() || this.locked() || this.item().editing) {
      event.preventDefault();
      return;
    }

    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', this.item().id);
    }

    // Set global store drag state inside Angular Zone so UI reacts
    this.ngZone.run(() => {
      this.store.setDragState(this.item().id, null, null);
    });
  }

  private handleDragOver(event: DragEvent) {
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
      } else if (relativeY > height * 0.75 && !this.item().expanded) {
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

    // Modern Double Drop Zone Unification logic:
    // If drop position is 'after', we map it to 'before' of the next visible sibling row
    let targetId = this.item().id;
    let finalPosition = position;

    if (position === 'after') {
      const list = this.store.flattenedVisibleItems();
      const idx = list.findIndex((item) => item.id === this.item().id);
      if (idx !== -1 && idx < list.length - 1) {
        const nextItem = list[idx + 1];
        if (nextItem.id !== draggedId) {
          targetId = nextItem.id;
          finalPosition = 'before';
        }
      }
    }

    // Only patch the store state inside the Zone if the target row or position has actually changed!
    if (dragState.dragOverItemId !== targetId || dragState.position !== finalPosition) {
      this.ngZone.run(() => {
        this.store.setDragState(draggedId, targetId, finalPosition);
      });
    }

    // Spring-loaded folder expansion: if dragging over a folder and position is inside, auto-expand it after 800ms
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
    if (this.readOnly() || this.locked()) {
      return;
    }
    this.clearHoverTimer();
    const dragState = this.store.dragState();

    let isTarget = dragState.dragOverItemId === this.item().id;
    if (!isTarget) {
      // Also check if we had mapped 'after' of this item to 'before' of the next item
      const list = this.store.flattenedVisibleItems();
      const idx = list.findIndex((item) => item.id === this.item().id);
      if (idx !== -1 && idx < list.length - 1) {
        const nextItem = list[idx + 1];
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

  private handleDrop(event: DragEvent) {
    if (this.readOnly() || this.locked()) {
      return;
    }
    event.preventDefault();
    this.clearHoverTimer();

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
    if (this.readOnly() || this.locked()) {
      return;
    }
    this.clearHoverTimer();
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

  private isDragOverState(pos: DragPosition): boolean {
    const dragState = this.store.dragState();
    return dragState.dragOverItemId === this.item().id && dragState.position === pos;
  }
}
