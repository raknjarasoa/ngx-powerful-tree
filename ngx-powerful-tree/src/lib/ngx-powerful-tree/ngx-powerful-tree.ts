import { CdkVirtualScrollViewport, ScrollingModule } from '@angular/cdk/scrolling';
import { CommonModule, isPlatformBrowser } from '@angular/common';
import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  Injector,
  NgZone,
  PLATFORM_ID,
  TemplateRef,
  afterNextRender,
  computed,
  contentChild,
  effect,
  inject,
  input,
  output,
  untracked,
  viewChild,
  viewChildren,
} from '@angular/core';
import { NgxTreeRowDirective } from '../ngx-tree-row.directive';
import { NgxTreeStore } from '../ngx-tree.store';
import {
  DragPosition,
  NgxTreeItem,
  NgxTreeNode,
  NgxTreeProxyItem,
  SelectableTypes,
} from '../ngx-tree.types';
import { flattenNodes } from '../ngx-tree.utils';

/**
 * Per-action enable resolver. `true`/`false` toggles every row; a function
 * is called per row and receives the rendered NgxTreeProxyItem.
 */
export type NgxTreeActionResolver = boolean | ((item: NgxTreeProxyItem) => boolean);

/**
 * Inline-action availability. Each key defaults to `true` when omitted, so
 * `[actions]="{ delete: false }"` keeps add/rename/move enabled.
 */
export interface NgxTreeActions {
  add?: NgxTreeActionResolver;
  rename?: NgxTreeActionResolver;
  delete?: NgxTreeActionResolver;
  move?: NgxTreeActionResolver;
}

const DEFAULT_ACTIONS: Required<NgxTreeActions> = {
  add: true,
  rename: true,
  delete: true,
  move: true,
};

export function isActionEnabled(
  resolver: NgxTreeActionResolver | undefined,
  item: NgxTreeProxyItem
): boolean {
  if (resolver === undefined) return true;
  return typeof resolver === 'function' ? resolver(item) : resolver;
}

// SSR-safe id generator. crypto.randomUUID exists in browsers and modern
// Node; fall back to a stronger random when missing.
function generateNodeId(): string {
  const c: Crypto | undefined =
    typeof globalThis !== 'undefined' ? (globalThis as { crypto?: Crypto }).crypto : undefined;
  if (c?.randomUUID) return `node-${c.randomUUID()}`;
  if (c?.getRandomValues) {
    const buf = new Uint8Array(8);
    c.getRandomValues(buf);
    let hex = '';
    for (const b of buf) hex += b.toString(16).padStart(2, '0');
    return `node-${hex}`;
  }
  return `node-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

@Component({
  selector: 'ngx-powerful-tree',
  standalone: true,
  imports: [CommonModule, ScrollingModule, NgxTreeRowDirective],
  providers: [NgxTreeStore],
  templateUrl: './ngx-powerful-tree.html',
  styleUrl: './ngx-powerful-tree.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '(keydown)': 'onKeyDown($event)',
  },
})
export class NgxPowerfulTree implements AfterViewInit {
  public store = inject(NgxTreeStore);
  private ngZone = inject(NgZone);
  private destroyRef = inject(DestroyRef);
  private platformId = inject(PLATFORM_ID);
  private injector = inject(Injector);

  // --- Signal Inputs ---
  // `nodes` seeds the tree on first emission; the store owns truth after that.
  // Use `reload(nodes)` to swap the dataset explicitly.
  nodes = input.required<NgxTreeNode[]>();
  searchQuery = input<string>('');
  multiSelect = input<boolean>(false);
  itemSize = input<number>(40);
  selectableTypes = input<SelectableTypes>('files');
  searchDebounceMs = input<number>(120);
  readOnly = input<boolean>(false);
  /**
   * Per-inline-action availability. Omitted keys default to `true`, so
   * `[actions]="{ delete: false }"` keeps the other actions enabled.
   * Each action accepts a boolean or a predicate fn that receives the row.
   */
  actions = input<NgxTreeActions>({});

  /** Merged actions with defaults applied. Read by the template. */
  resolvedActions = computed<Required<NgxTreeActions>>(() => {
    const v = this.actions();
    return {
      add: v.add ?? DEFAULT_ACTIONS.add,
      rename: v.rename ?? DEFAULT_ACTIONS.rename,
      delete: v.delete ?? DEFAULT_ACTIONS.delete,
      move: v.move ?? DEFAULT_ACTIONS.move,
    };
  });

  /** Template helper: flatten boolean|fn resolver to a boolean per row. */
  isActionEnabled = isActionEnabled;

  // --- Outputs ---
  itemMoved = output<{
    draggedId: string;
    targetId: string;
    position: DragPosition;
  }>();
  itemRenamed = output<{ id: string; name: string }>();
  itemAdded = output<{ parentId: string | null; node: NgxTreeNode }>();
  itemDeleted = output<string>();
  selectionChanged = output<string[]>();
  focusedChanged = output<string | null>();
  moveRequested = output<string>();

  // --- Signal queries ---
  itemTemplate = contentChild<TemplateRef<unknown>>('itemTemplate');
  fileTemplate = contentChild<TemplateRef<unknown>>('fileTemplate');

  viewport = viewChild<CdkVirtualScrollViewport>(CdkVirtualScrollViewport);
  editInputs = viewChildren<ElementRef<HTMLInputElement>>('editInput');

  private initialized = false;
  private searchDebounceTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    // 1. One-shot seed from the `nodes` input. Subsequent emissions are
    // ignored on purpose; use `reload(nodes)` to swap the dataset.
    effect(() => {
      const nodesVal = this.nodes();
      if (this.initialized) return;
      this.initialized = true;
      untracked(() => {
        const { items, rootIds } = flattenNodes(nodesVal);
        this.store.setItems(items, rootIds);
      });
    });

    // 2. Debounced search sync. Clearing the field is applied immediately.
    effect(() => {
      const searchVal = this.searchQuery();
      const debounceMs = untracked(() => this.searchDebounceMs());
      untracked(() => {
        if (this.searchDebounceTimer !== null) {
          clearTimeout(this.searchDebounceTimer);
          this.searchDebounceTimer = null;
        }
        if (!searchVal || debounceMs <= 0) {
          this.store.setSearchQuery(searchVal);
          return;
        }
        this.searchDebounceTimer = setTimeout(() => {
          this.searchDebounceTimer = null;
          this.store.setSearchQuery(searchVal);
        }, debounceMs);
      });
    });

    this.destroyRef.onDestroy(() => {
      if (this.searchDebounceTimer !== null) {
        clearTimeout(this.searchDebounceTimer);
        this.searchDebounceTimer = null;
      }
    });

    // 3. Emit selection changes raw. Consumers dedupe if they need to.
    effect(() => {
      const selected = Array.from(this.store.selectedItems()).sort();
      untracked(() => {
        this.selectionChanged.emit(selected);
      });
    });

    // 4. Emit focus changes raw. Consumers dedupe if they need to.
    effect(() => {
      const focused = this.store.focusedItemId();
      untracked(() => {
        this.focusedChanged.emit(focused);
      });
    });

    // 5. Focus and select the inline rename input when editing starts.
    effect(() => {
      const inputs = this.editInputs();
      if (inputs.length > 0) {
        untracked(() => {
          const inputEl = inputs[0].nativeElement;
          inputEl.focus();
          inputEl.select();
        });
      }
    });

    // 6. Sync selectableTypes input to the store.
    effect(() => {
      const types = this.selectableTypes();
      untracked(() => {
        this.store.setSelectableTypes(types);
      });
    });
  }

  trackById(index: number, item: NgxTreeProxyItem): string {
    return item.id;
  }

  // --- Action Handlers ---

  onItemClick(item: NgxTreeProxyItem, event: MouseEvent) {
    const target = event.target as HTMLElement;
    if (target.closest('button') || target.closest('input')) {
      return;
    }

    event.stopPropagation();
    this.store.selectItem(item.id, this.multiSelect());
  }

  toggleExpand(id: string, event: MouseEvent) {
    event.stopPropagation();
    this.store.toggleExpand(id);
  }

  onItemMoved(event: { draggedId: string; targetId: string; position: DragPosition }) {
    this.itemMoved.emit(event);
  }

  triggerMove(id: string, event: MouseEvent) {
    event.stopPropagation();
    this.moveRequested.emit(id);
  }

  public moveItem(draggedId: string, targetId: string, position: DragPosition): boolean {
    if (!this.store.moveItem(draggedId, targetId, position)) return false;
    this.itemMoved.emit({ draggedId, targetId, position });
    return true;
  }

  triggerRename(id: string, event: MouseEvent) {
    event.stopPropagation();
    this.store.setEditingItemId(id);
  }

  saveRename(id: string, newName: string) {
    const trimmed = newName.trim();
    if (this.store.renameItem(id, trimmed)) {
      this.itemRenamed.emit({ id, name: trimmed });
    } else {
      this.cancelRename();
    }
  }

  cancelRename() {
    this.store.setEditingItemId(null);
  }

  triggerDelete(id: string, event: MouseEvent) {
    event.stopPropagation();
    if (this.store.deleteItem(id)) {
      this.itemDeleted.emit(id);
    }
  }

  triggerAddFolder(parentId: string, event: MouseEvent) {
    event.stopPropagation();
    this.createFolder(parentId);
  }

  public addRootFolder(name = 'New Root Folder') {
    this.createFolder(null, name);
  }

  /**
   * Reload the dataset. Clears expand/select/focus/search/drag state.
   * Accepts the same nested NgxTreeNode[] shape as the `nodes` input.
   */
  public reload(nodes: NgxTreeNode[]) {
    const { items, rootIds } = flattenNodes(nodes);
    this.store.reload(items, rootIds);
  }

  private createFolder(parentId: string | null, name = 'New Folder') {
    const newId = generateNodeId();
    const newItem: NgxTreeItem = {
      id: newId,
      name,
      isFolder: true,
      children: [],
    };
    if (!this.store.addItem(parentId, newItem)) return;
    const node: NgxTreeNode = {
      id: newId,
      name,
      isFolder: true,
      children: [],
    };
    this.itemAdded.emit({ parentId, node });
    afterNextRender(
      () => {
        this.store.setEditingItemId(newId);
      },
      { injector: this.injector }
    );
  }

  // --- Keyboard Handler ---

  onKeyDown(event: KeyboardEvent) {
    const list = this.store.flattenedVisibleItems();
    if (list.length === 0) return;

    const focusedId = this.store.focusedItemId();
    const focusedIdx = list.findIndex((item) => item.id === focusedId);

    if (focusedIdx === -1) {
      this.store.setFocusedItemId(list[0].id);
      this.scrollToIndex(0);
      return;
    }

    const currentItem = list[focusedIdx];

    if (currentItem.editing) {
      return;
    }

    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        if (focusedIdx < list.length - 1) {
          const nextId = list[focusedIdx + 1].id;
          this.store.setFocusedItemId(nextId);
          this.scrollToIndex(focusedIdx + 1);
        }
        break;

      case 'ArrowUp':
        event.preventDefault();
        if (focusedIdx > 0) {
          const prevId = list[focusedIdx - 1].id;
          this.store.setFocusedItemId(prevId);
          this.scrollToIndex(focusedIdx - 1);
        }
        break;

      case 'ArrowRight':
        event.preventDefault();
        if (currentItem.isFolder) {
          if (!currentItem.expanded) {
            this.store.setExpanded(currentItem.id, true);
          } else if (focusedIdx < list.length - 1) {
            const nextItem = list[focusedIdx + 1];
            if (nextItem.parentId === currentItem.id) {
              this.store.setFocusedItemId(nextItem.id);
              this.scrollToIndex(focusedIdx + 1);
            }
          }
        }
        break;

      case 'ArrowLeft':
        event.preventDefault();
        if (currentItem.isFolder && currentItem.expanded) {
          this.store.setExpanded(currentItem.id, false);
        } else if (currentItem.parentId) {
          const parentId = currentItem.parentId;
          const parentIdx = list.findIndex((item) => item.id === parentId);
          if (parentIdx !== -1) {
            this.store.setFocusedItemId(parentId);
            this.scrollToIndex(parentIdx);
          }
        }
        break;

      case ' ':
        event.preventDefault();
        this.store.selectItem(currentItem.id, this.multiSelect());
        break;

      case 'Enter':
        event.preventDefault();
        if (currentItem.isFolder) {
          this.store.toggleExpand(currentItem.id);
        } else {
          this.store.selectItem(currentItem.id, this.multiSelect());
        }
        break;

      case 'F2':
        event.preventDefault();
        if (!this.readOnly() && !currentItem.locked) {
          this.store.setEditingItemId(currentItem.id);
        }
        break;

      case 'Delete':
        event.preventDefault();
        if (!this.readOnly() && this.store.deleteItem(currentItem.id)) {
          this.itemDeleted.emit(currentItem.id);
        }
        break;

      case 'Escape':
        event.preventDefault();
        this.store.clearSelection();
        break;

      case 'Home':
        event.preventDefault();
        this.store.setFocusedItemId(list[0].id);
        this.scrollToIndex(0);
        break;

      case 'End':
        event.preventDefault();
        this.store.setFocusedItemId(list[list.length - 1].id);
        this.scrollToIndex(list.length - 1);
        break;

      default:
        // Wrap-around typeahead: jump focus to next item starting with key.
        if (event.key.length === 1 && !event.ctrlKey && !event.altKey && !event.metaKey) {
          const char = event.key.toLowerCase();
          for (let i = 1; i <= list.length; i++) {
            const idx = (focusedIdx + i) % list.length;
            if (list[idx].name.toLowerCase().startsWith(char)) {
              this.store.setFocusedItemId(list[idx].id);
              this.scrollToIndex(idx);
              break;
            }
          }
        }
        break;
    }
  }

  private scrollToIndex(index: number) {
    const vpt = this.viewport();
    if (vpt) {
      const range = vpt.getRenderedRange();
      if (index < range.start || index >= range.end - 1) {
        vpt.scrollToIndex(index);
      }
    }
  }

  // --- Auto-scroll during drag-and-drop (runs outside Angular zone) ---
  private scrollSpeed = 15;
  private animationFrameId: number | null = null;

  ngAfterViewInit() {
    if (!isPlatformBrowser(this.platformId)) {
      return;
    }
    const vpt = this.viewport();
    if (!vpt) return;

    const viewportEl = vpt.elementRef.nativeElement;

    this.ngZone.runOutsideAngular(() => {
      const handleDragOver = (event: DragEvent) => {
        const dragState = this.store.dragState();
        if (!dragState.draggedItemId) {
          this.stopAutoScroll();
          return;
        }

        const rect = viewportEl.getBoundingClientRect();
        const mouseY = event.clientY;

        const topThreshold = rect.top + 40;
        const bottomThreshold = rect.bottom - 40;

        if (mouseY < topThreshold) {
          const intensity = Math.max(0, (topThreshold - mouseY) / 40);
          this.startAutoScroll(viewportEl, -1, intensity);
        } else if (mouseY > bottomThreshold) {
          const intensity = Math.max(0, (mouseY - bottomThreshold) / 40);
          this.startAutoScroll(viewportEl, 1, intensity);
        } else {
          this.stopAutoScroll();
        }
      };

      const handleDragLeaveOrEnd = () => {
        this.stopAutoScroll();
      };

      viewportEl.addEventListener('dragover', handleDragOver);
      viewportEl.addEventListener('dragleave', handleDragLeaveOrEnd);
      viewportEl.addEventListener('drop', handleDragLeaveOrEnd);
      document.addEventListener('dragend', handleDragLeaveOrEnd);

      this.destroyRef.onDestroy(() => {
        viewportEl.removeEventListener('dragover', handleDragOver);
        viewportEl.removeEventListener('dragleave', handleDragLeaveOrEnd);
        viewportEl.removeEventListener('drop', handleDragLeaveOrEnd);
        document.removeEventListener('dragend', handleDragLeaveOrEnd);
        this.stopAutoScroll();
      });
    });
  }

  private startAutoScroll(element: HTMLElement, direction: number, intensity: number) {
    this.stopAutoScroll();

    const scrollFn = () => {
      const amount = direction * this.scrollSpeed * intensity;
      element.scrollTop += amount;
      this.animationFrameId = requestAnimationFrame(scrollFn);
    };

    this.animationFrameId = requestAnimationFrame(scrollFn);
  }

  private stopAutoScroll() {
    if (this.animationFrameId !== null) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }
  }
}
