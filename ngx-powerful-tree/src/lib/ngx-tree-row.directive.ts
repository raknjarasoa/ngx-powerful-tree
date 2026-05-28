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

  // Kept for backward compatibility — NgxPowerfulTree now emits itemMoved
  // directly from its centralized drop handler, but consumers may still
  // listen on this row-level output.
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

  // Drag-over indicators read from the centralized store. No DOM mutation
  // happens here — Angular applies the classes via host bindings when these
  // computeds change.
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

      el.addEventListener('dragstart', onDragStart);

      this.destroyRef.onDestroy(() => {
        el.removeEventListener('dragstart', onDragStart);
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

      // Lightweight text ghost rather than cloneNode(true). Deep-cloning a
      // styled row at dragstart forces a full document reflow; a small
      // single-purpose element keeps the start of the drag jank-free.
      const ghost = document.createElement('div');
      ghost.textContent = this.item().name;
      ghost.style.cssText =
        'position:fixed;top:-9999px;left:-9999px;pointer-events:none;box-sizing:border-box;' +
        `width:${Math.min(rect.width, 300)}px;height:${rect.height}px;` +
        'display:flex;align-items:center;padding:0 12px;' +
        'font:14px/1 system-ui,sans-serif;background:var(--ngx-tree-bg,#fff);' +
        'color:var(--ngx-tree-color,#0f172a);' +
        'border:1px solid var(--ngx-tree-border,#cbd5e1);border-radius:4px;' +
        'white-space:nowrap;overflow:hidden;text-overflow:ellipsis;';
      document.body.appendChild(ghost);
      this.dragGhostEl = ghost;

      event.dataTransfer.setDragImage(ghost, event.clientX - rect.left, event.clientY - rect.top);
    }

    // dragstart fires inside the zone block (runOutsideAngular). Wrap the
    // signal write so dependent effects see the change.
    this.ngZone.run(() => {
      this.store.setDragState(this.item().id, null, null);
    });

    // dragend on the source element is the only reliable cleanup for the
    // ghost when the drop happens outside any handler.
    const onDragEnd = () => {
      this.removeDragGhost();
      sourceEl.removeEventListener('dragend', onDragEnd);
    };
    sourceEl.addEventListener('dragend', onDragEnd);
  }

  private removeDragGhost() {
    if (this.dragGhostEl) {
      this.dragGhostEl.remove();
      this.dragGhostEl = null;
    }
  }
}
