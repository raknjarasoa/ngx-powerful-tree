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
  isDevMode,
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
  NgxTreeSearchPredicate,
  NgxTreeStructuralItem,
  SelectableTypes,
} from '../ngx-tree.types';
import { flattenNodes } from '../ngx-tree.utils';

/**
 * Per-action enable resolver. `true`/`false` toggles every row; a function
 * is called per row and receives the rendered NgxTreeProxyItem.
 */
export type NgxTreeActionResolver = boolean | ((item: NgxTreeStructuralItem) => boolean);

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
  item: NgxTreeStructuralItem
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
  // Seed dataset. Read once on first emission; the store owns truth after
  // that. If your data arrives asynchronously, wait until it is ready
  // before binding, or call `reload(nodes)` to swap after initialization.
  nodes = input.required<NgxTreeNode[]>();
  searchQuery = input<string>('');
  multiSelect = input<boolean>(false);
  itemSize = input<number>(40);
  selectableTypes = input<SelectableTypes>('files');
  searchDebounceMs = input<number>(120);
  readOnly = input<boolean>(false);
  searchPredicate = input<NgxTreeSearchPredicate | null>(null);
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

    // 7. Sync searchPredicate input to the store.
    effect(() => {
      const predicate = this.searchPredicate();
      untracked(() => {
        this.store.searchPredicate.set(predicate);
      });
    });
  }

  trackById(index: number, item: NgxTreeStructuralItem): string {
    return item.id;
  }

  // --- Action Handlers ---

  onItemClick(item: NgxTreeStructuralItem, event: MouseEvent) {
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
    const { list, indexById } = this.store.flattenedStructure();
    if (list.length === 0) return;

    const focusedId = this.store.focusedItemId();
    const focusedIdx = focusedId !== null ? (indexById[focusedId] ?? -1) : -1;

    if (focusedIdx === -1) {
      this.store.setFocusedItemId(list[0].id);
      this.scrollToIndex(0);
      return;
    }

    const currentItem = list[focusedIdx];

    if (this.store.editingItemId() === currentItem.id) {
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
          const parentIdx = indexById[parentId] ?? -1;
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

  // --- Centralized drag-and-drop & auto-scroll (runs outside Angular zone)
  //
  // The viewport (not the rows) listens for dragover. We compute the target
  // row index arithmetically from `scrollTop + clientY` divided by `itemSize`,
  // so drag evaluation is fully decoupled from recycled row DOM elements.
  // This eliminates the auto-scroll feedback loop where a screen-stationary
  // cursor traversing many recycled rows would fire cascading native events.
  //
  // CONTRACT: every visible row must render at exactly `itemSize` pixels.
  // The library CSS locks `.ngx-tree-row-wrapper { height: var(...row-min-height) }`
  // to enforce this. Custom templates must match — a dev-mode warning fires
  // on first drag if the rendered height diverges from `itemSize()`.
  private readonly scrollSpeedBase = 10;
  private readonly scrollSpeedMax = 14;
  private animationFrameId: number | null = null;
  private lastDragClientY: number | null = null;
  private dragEvalRafId: number | null = null;
  private springLoadTimer: ReturnType<typeof setTimeout> | null = null;
  private springLoadTargetId: string | null = null;
  private itemSizeWarned = false;

  ngAfterViewInit() {
    if (!isPlatformBrowser(this.platformId)) {
      return;
    }
    const vpt = this.viewport();
    if (!vpt) return;

    const viewportEl = vpt.elementRef.nativeElement;

    this.ngZone.runOutsideAngular(() => {
      const handleDragOver = (event: DragEvent) => {
        if (this.readOnly()) return;
        if (!this.store.draggedItemId()) return;

        event.preventDefault(); // allow drop
        this.lastDragClientY = event.clientY;
        this.scheduleDragEval();
        this.updateAutoScroll(viewportEl, event.clientY);
      };

      const handleDragLeave = (event: DragEvent) => {
        // dragleave fires when entering child rows too. Only clear hover
        // state when we genuinely leave the viewport subtree.
        const related = event.relatedTarget as Node | null;
        if (related && viewportEl.contains(related)) return;
        this.cancelSpringLoad();
        this.stopAutoScroll();
        if (this.store.dragTargetId() !== null) {
          this.ngZone.run(() => {
            this.store.dragTargetId.set(null);
            this.store.dragPosition.set(null);
          });
        }
      };

      const handleDrop = (event: DragEvent) => {
        if (this.readOnly()) return;
        event.preventDefault();
        this.stopAutoScroll();
        this.cancelSpringLoad();
        this.cancelDragEval();

        // Evaluate one final time from the drop coordinate for accuracy.
        this.lastDragClientY = event.clientY;
        this.evaluateDragPosition();

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
        this.lastDragClientY = null;
      };

      const handleDragEnd = () => {
        // Universal cleanup. Fires on the drag source whether drop succeeded,
        // was cancelled, or the cursor left the document.
        this.stopAutoScroll();
        this.cancelSpringLoad();
        this.cancelDragEval();
        this.lastDragClientY = null;
        if (this.store.draggedItemId() !== null || this.store.dragTargetId() !== null) {
          this.ngZone.run(() => this.store.clearDragState());
        }
      };

      viewportEl.addEventListener('dragover', handleDragOver);
      viewportEl.addEventListener('dragleave', handleDragLeave);
      viewportEl.addEventListener('drop', handleDrop);
      document.addEventListener('dragend', handleDragEnd);

      this.destroyRef.onDestroy(() => {
        viewportEl.removeEventListener('dragover', handleDragOver);
        viewportEl.removeEventListener('dragleave', handleDragLeave);
        viewportEl.removeEventListener('drop', handleDrop);
        document.removeEventListener('dragend', handleDragEnd);
        this.stopAutoScroll();
        this.cancelSpringLoad();
        this.cancelDragEval();
      });
    });
  }

  private scheduleDragEval() {
    if (this.dragEvalRafId !== null) return;
    this.dragEvalRafId = requestAnimationFrame(() => {
      this.dragEvalRafId = null;
      this.evaluateDragPosition();
    });
  }

  private cancelDragEval() {
    if (this.dragEvalRafId !== null) {
      cancelAnimationFrame(this.dragEvalRafId);
      this.dragEvalRafId = null;
    }
  }

  private evaluateDragPosition() {
    if (this.lastDragClientY === null) return;
    const vpt = this.viewport();
    if (!vpt) return;
    const draggedId = this.store.draggedItemId();
    if (!draggedId) return;

    const viewportEl = vpt.elementRef.nativeElement;
    const rect = viewportEl.getBoundingClientRect();
    const itemSize = this.itemSize();
    const scrollTop = viewportEl.scrollTop;
    const relativeY = this.lastDragClientY - rect.top;
    const absoluteY = scrollTop + relativeY;

    this.maybeWarnItemSizeMismatch(viewportEl, itemSize);

    const { list } = this.store.flattenedStructure();
    if (list.length === 0) {
      this.applyDragState(draggedId, null, null);
      return;
    }

    // Drop-at-end affordance: if cursor is past the last row, snap to the
    // last item with position 'after' so the user can append at root level.
    const rawIndex = Math.floor(absoluteY / itemSize);
    let itemIndex = rawIndex;
    let forceAfter = false;
    if (rawIndex >= list.length) {
      itemIndex = list.length - 1;
      forceAfter = true;
    } else if (rawIndex < 0) {
      this.applyDragState(draggedId, null, null);
      return;
    }

    const targetItem = list[itemIndex];
    if (targetItem.id === draggedId || targetItem.locked) {
      this.cancelSpringLoad();
      this.applyDragState(draggedId, null, null);
      return;
    }

    let position: DragPosition;
    if (forceAfter) {
      position = 'after';
    } else {
      const relativeYToRow = absoluteY - itemIndex * itemSize;
      if (targetItem.isFolder) {
        if (relativeYToRow < itemSize * 0.25) position = 'before';
        else if (relativeYToRow > itemSize * 0.75 && !targetItem.expanded) position = 'after';
        else position = 'inside';
      } else {
        position = relativeYToRow < itemSize * 0.5 ? 'before' : 'after';
      }
    }

    this.scheduleSpringLoad(targetItem, position, viewportEl);
    this.applyDragState(draggedId, targetItem.id, position);
  }

  private applyDragState(
    draggedId: string,
    targetId: string | null,
    position: DragPosition | null
  ) {
    // Avoid redundant signal writes — the row directive's computed signals
    // would otherwise re-run for every frame even when nothing changed.
    if (this.store.dragTargetId() === targetId && this.store.dragPosition() === position) return;
    this.ngZone.run(() => this.store.setDragState(draggedId, targetId, position));
  }

  // Spring-loaded folder expansion. Hovering 'inside' a collapsed folder for
  // 800ms expands it so the user can drop deeper. We anchor `scrollTop`
  // around the expansion so the target row stays put under the cursor
  // (inserted children would otherwise push it down).
  private scheduleSpringLoad(
    targetItem: NgxTreeStructuralItem,
    position: DragPosition,
    viewportEl: HTMLElement
  ) {
    const shouldSpring =
      targetItem.isFolder && position === 'inside' && !targetItem.expanded && !targetItem.locked;
    if (!shouldSpring) {
      this.cancelSpringLoad();
      return;
    }
    if (this.springLoadTargetId === targetItem.id) return; // already scheduled

    this.cancelSpringLoad();
    this.springLoadTargetId = targetItem.id;
    this.springLoadTimer = setTimeout(() => {
      this.springLoadTimer = null;
      const id = this.springLoadTargetId;
      this.springLoadTargetId = null;
      if (id === null) return;

      const { indexById } = this.store.flattenedStructure();
      const idx = indexById[id];
      if (idx === undefined) return;
      const itemSize = this.itemSize();
      const expectedTopBefore = idx * itemSize;

      this.ngZone.run(() => this.store.setExpanded(id, true));

      requestAnimationFrame(() => {
        const { indexById: indexAfter } = this.store.flattenedStructure();
        const idxAfter = indexAfter[id];
        if (idxAfter === undefined) return;
        const expectedTopAfter = idxAfter * itemSize;
        const drift = expectedTopAfter - expectedTopBefore;
        if (drift !== 0) {
          viewportEl.scrollTop += drift;
          // After the scroll adjustment, the cursor now points at a
          // different absolute Y. Re-evaluate so the hover target updates.
          this.scheduleDragEval();
        }
      });
    }, 800);
  }

  private cancelSpringLoad() {
    if (this.springLoadTimer !== null) {
      clearTimeout(this.springLoadTimer);
      this.springLoadTimer = null;
    }
    this.springLoadTargetId = null;
  }

  private maybeWarnItemSizeMismatch(viewportEl: HTMLElement, itemSize: number) {
    if (this.itemSizeWarned || !isDevMode()) return;
    const row = viewportEl.querySelector<HTMLElement>('.ngx-tree-row-wrapper');
    if (!row) return;
    const measured = row.getBoundingClientRect().height;
    if (measured > 0 && Math.abs(measured - itemSize) > 1) {
      this.itemSizeWarned = true;
      console.warn(
        `[ngx-powerful-tree] Rendered row height (${measured}px) does not match [itemSize] (${itemSize}px). ` +
          `Drag hit-testing relies on a fixed itemSize. Either set [itemSize] to match your custom template ` +
          `height, or override --ngx-tree-row-height-min so the row matches itemSize.`
      );
    }
  }

  private updateAutoScroll(viewportEl: HTMLElement, mouseY: number) {
    const rect = viewportEl.getBoundingClientRect();
    const topThreshold = rect.top + 40;
    const bottomThreshold = rect.bottom - 40;

    if (mouseY < topThreshold) {
      const intensity = Math.min(1, Math.max(0, (topThreshold - mouseY) / 40));
      this.startAutoScroll(viewportEl, -1, intensity);
    } else if (mouseY > bottomThreshold) {
      const intensity = Math.min(1, Math.max(0, (mouseY - bottomThreshold) / 40));
      this.startAutoScroll(viewportEl, 1, intensity);
    } else {
      this.stopAutoScroll();
    }
  }

  private startAutoScroll(element: HTMLElement, direction: number, intensity: number) {
    this.stopAutoScroll();
    // intensity is clamped to [0,1]; cap speed so we don't fight CDK's own
    // scroll-tick handling. rAF is naturally ~60 fps.
    const speed = Math.min(
      this.scrollSpeedBase + intensity * this.scrollSpeedBase,
      this.scrollSpeedMax
    );

    const scrollFn = () => {
      element.scrollTop += direction * speed;
      // Cursor is screen-stationary; the row under it changed because we
      // scrolled. Re-evaluate so hover follows.
      this.evaluateDragPosition();
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
