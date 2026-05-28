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
    // We REMOVED drag-over classes from bindings. They will be applied natively.
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
  private onDragEndBind = () => this.handleDragEnd();

  // Track current drop state locally so drop() knows exactly what was rendered
  private currentTargetId: string | null = null;
  private currentPosition: DragPosition | null = null;

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

      el.addEventListener('dragstart', onDragStartBind);
      el.addEventListener('dragover', onDragOverBind);
      el.addEventListener('dragleave', onDragLeaveBind);
      el.addEventListener('drop', onDropBind);
      el.addEventListener('dragend', this.onDragEndBind);

      this.destroyRef.onDestroy(() => {
        el.removeEventListener('dragstart', onDragStartBind);
        el.removeEventListener('dragover', onDragOverBind);
        el.removeEventListener('dragleave', onDragLeaveBind);
        el.removeEventListener('drop', onDropBind);

        if (this.store.draggedItemId() !== this.item().id) {
          el.removeEventListener('dragend', this.onDragEndBind);
          this.removeDragGhost();
        }

        this.clearHoverTimer();
        this.cancelDragOverRaf();
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

      const ghost = document.createElement('div');
      ghost.textContent = this.item().name;
      ghost.style.cssText =
        'position:fixed;top:-9999px;left:-9999px;pointer-events:none;box-sizing:border-box;' +
        `width:${Math.min(rect.width, 300)}px;height:${rect.height}px;` +
        'display:flex;align-items:center;padding:0 12px;' +
        'font:14px/1 system-ui,sans-serif;background:var(--ngx-tree-bg,#fff);' +
        'border:1px solid var(--ngx-tree-border,#cbd5e1);border-radius:4px;' +
        'white-space:nowrap;overflow:hidden;text-overflow:ellipsis;will-change:transform;';
      document.body.appendChild(ghost);
      this.dragGhostEl = ghost;

      event.dataTransfer.setDragImage(ghost, event.clientX - rect.left, event.clientY - rect.top);
    }

    this.store.draggedItemId.set(this.item().id);
  }

  private handleDragOver(event: DragEvent) {
    if (this.readOnly() || this.locked()) return;

    const draggedId = this.store.draggedItemId();
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
      this.processDragOver(y, draggedId);
    });
  }

  private processDragOver(clientY: number, draggedId: string) {
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

    let targetId = this.item().id;
    let finalPosition = position;

    this.currentTargetId = targetId;
    this.currentPosition = finalPosition;

    this.applyDragClasses(finalPosition, true);

    // Spring-loaded folder expansion at 800ms hover.
    // Anchor scroll position around the expansion so the target row doesn't shift.
    if (this.item().isFolder && position === 'inside' && !this.item().expanded) {
      if (!this.hoverTimer) {
        this.hoverTimer = window.setTimeout(() => {
          const el = this.el.nativeElement as HTMLElement;
          const scrollParent = el.closest('cdk-virtual-scroll-viewport');
          const rectBefore = el.getBoundingClientRect();
          const scrollBefore = scrollParent?.scrollTop ?? 0;

          this.ngZone.run(() => {
            this.store.setExpanded(this.item().id, true);
          });

          if (scrollParent) {
            requestAnimationFrame(() => {
              const rectAfter = el.getBoundingClientRect();
              const drift = rectAfter.top - rectBefore.top;
              if (Math.abs(drift) > 1) {
                scrollParent.scrollTop = scrollBefore + drift;
              }
            });
          }

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
    this.clearDragClasses();
    this.currentTargetId = null;
    this.currentPosition = null;
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

    const draggedId = this.store.draggedItemId();

    // Flush any pending rAF so currentPosition is computed before reading it.
    const pendingY = this.dragOverPendingY;
    this.cancelDragOverRaf();
    if (pendingY !== null && draggedId) {
      this.processDragOver(pendingY, draggedId);
    }
    this.clearDragClasses();
    const position = this.currentPosition;
    const dragOverItemId = this.currentTargetId;

    if (draggedId && dragOverItemId && position && draggedId !== dragOverItemId) {
      this.ngZone.run(() => {
        if (this.store.moveItem(draggedId, dragOverItemId, position)) {
          this.itemMoved.emit({
            draggedId,
            targetId: dragOverItemId,
            position,
          });
        }
        this.store.draggedItemId.set(null);
      });
    } else {
      this.store.draggedItemId.set(null);
    }

    this.currentTargetId = null;
    this.currentPosition = null;
  }

  private handleDragEnd() {
    this.clearHoverTimer();
    this.cancelDragOverRaf();
    this.removeDragGhost();
    this.clearDragClasses();
    this.store.draggedItemId.set(null);
    this.currentTargetId = null;
    this.currentPosition = null;
    this.el.nativeElement.removeEventListener('dragend', this.onDragEndBind);
  }

  // --- Helper Methods ---

  private applyDragClasses(position: DragPosition, isDirectTarget: boolean) {
    // Only paint the class if THIS row is the actual DOM target
    // (If position 'after' mapped to 'before' of next sibling, that sibling will paint)
    this.clearDragClasses();
    if (isDirectTarget) {
      const el = this.el.nativeElement as HTMLElement;
      if (position === 'inside') el.classList.add('ngx-tree-row--drag-over-inside');
      else if (position === 'before') el.classList.add('ngx-tree-row--drag-over-before');
      else if (position === 'after') el.classList.add('ngx-tree-row--drag-over-after');
    }
  }

  private clearDragClasses() {
    const el = this.el.nativeElement as HTMLElement;
    el.classList.remove(
      'ngx-tree-row--drag-over-inside',
      'ngx-tree-row--drag-over-before',
      'ngx-tree-row--drag-over-after'
    );
  }

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
