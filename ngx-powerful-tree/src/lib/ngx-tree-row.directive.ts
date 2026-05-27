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
  isDragging = computed(() => this.store.draggedItemId() === this.item().id);

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
      const el = this.el.nativeElement;

      const onDragStartBind = (e: DragEvent) => this.handleDragStart(e);

      el.addEventListener('dragstart', onDragStartBind);

      this.destroyRef.onDestroy(() => {
        el.removeEventListener('dragstart', onDragStartBind);
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
      this.store.draggedItemId.set(this.item().id);
    });

    // We must bind dragend here so that if the element is recycled by virtual scroll,
    // the event target will still capture the dragend event natively.
    const onDragEnd = () => {
      this.ngZone.run(() => {
        this.store.clearDragState();
      });
      this.removeDragGhost();
      sourceEl.removeEventListener('dragend', onDragEnd);
    };
    const sourceEl = this.el.nativeElement as HTMLElement;
    sourceEl.addEventListener('dragend', onDragEnd);
  }

  // --- Helper Methods ---

  private removeDragGhost() {
    if (this.dragGhostEl) {
      this.dragGhostEl.remove();
      this.dragGhostEl = null;
    }
  }
}
