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
  return `node-${performance.now().toString(36).replace('.', '')}-${Math.random().toString(36).slice(2, 10)}`;
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
   * Opt-in: when `true`, the component emits `structureChanged` with the full
   * nested structure after every add/rename/delete/move. Off by default
   * because rebuilding the whole tree on each mutation is O(N); leave it off
   * (and call `getStructure()` on demand) for very large trees. See the
   * `structureChanged` output for the batching semantics.
   */
  emitStructureChanges = input<boolean>(false);
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
  /**
   * Emits the new folder/file structure as a nested {@link NgxTreeNode}[] —
   * the same shape you load from the server — after each structural change.
   * Requires `[emitStructureChanges]="true"`.
   *
   * Emissions are coalesced: several mutations in the same tick (e.g. a move
   * that detaches and reattaches) produce a single emission with the final
   * state. The initial seed from `nodes` is NOT emitted (you already have it);
   * the first emission is the first change after load.
   */
  structureChanged = output<NgxTreeNode[]>();

  // --- Signal queries ---
  itemTemplate = contentChild<TemplateRef<unknown>>('itemTemplate');
  fileTemplate = contentChild<TemplateRef<unknown>>('fileTemplate');

  viewport = viewChild<CdkVirtualScrollViewport>(CdkVirtualScrollViewport);
  editInputs = viewChildren<ElementRef<HTMLInputElement>>('editInput');

  private initialized = false;
  private searchDebounceTimer: ReturnType<typeof setTimeout> | null = null;
  // Structure-version baseline for the structureChanged emitter. `null` until
  // the emit effect first observes the version; thereafter holds the last
  // emitted version so unchanged re-runs (e.g. toggling the flag) don't re-emit.
  private structureBaselineVersion: number | null = null;

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

    // 8. Stop autoscroll when dragging finishes (detected via store signal)
    // This perfectly syncs autoscroll with the global drag state, completely bypassing DOM event bubbling issues.
    effect(() => {
      const draggedId = this.store.draggedItemId();
      if (!draggedId) {
        untracked(() => this.stopAutoScroll());
      }
    });

    // 9. Emit the full nested structure after each structural change, but only
    // when opted in. When the flag is off the effect returns before touching
    // structureVersion, so it never tracks it and there's zero overhead. The
    // effect runs at most once per tick, so a burst of mutations coalesces
    // into a single O(N) rebuild + emission. The first observation establishes
    // a baseline (the seed/current state) and is NOT emitted.
    effect(() => {
      if (!this.emitStructureChanges()) return;
      const v = this.store.structureVersion();
      untracked(() => {
        if (this.structureBaselineVersion === null) {
          this.structureBaselineVersion = v;
          return;
        }
        if (v === this.structureBaselineVersion) return;
        this.structureBaselineVersion = v;
        this.structureChanged.emit(this.store.getStructure());
      });
    });
  }

  /**
   * Returns the current folder/file structure as a nested
   * {@link NgxTreeNode}[] — the same shape passed to the `nodes` input.
   * On-demand alternative to the `structureChanged` output: call it whenever
   * you actually need the snapshot (e.g. on save) instead of paying the O(N)
   * rebuild on every mutation.
   */
  public getStructure(): NgxTreeNode[] {
    return this.store.getStructure();
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
   *
   * Treated like the initial seed for `structureChanged`: swapping the dataset
   * does NOT emit (the caller already has the structure it just set), which
   * also avoids a save → reload → structureChanged feedback loop. The next
   * user-driven mutation after a reload emits as usual.
   */
  public reload(nodes: NgxTreeNode[]) {
    const { items, rootIds } = flattenNodes(nodes);
    this.store.reload(items, rootIds);
    // Re-baseline so the post-reload version becomes the new "no change yet"
    // reference instead of being reported as a structural change.
    this.structureBaselineVersion = null;
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

      case 'Escape':
        event.preventDefault();
        this.store.clearSelection();
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

  // --- Auto-scroll during drag (runs outside Angular zone)
  //
  // The component only handles auto-scroll near viewport edges. Drag hit-
  // testing (target row + before/after/inside) lives in NgxTreeRowDirective:
  // each row reads its own clientY/rect math from native dragover events.
  //
  // As the viewport auto-scrolls and rows move under the stationary cursor,
  // browsers fire dragover on whichever row is now under the cursor — no
  // central re-evaluation is needed. This works because the row CSS locks
  // every visible row to `itemSize` (no layout shift during drag).
  //
  // Custom templates that diverge from `itemSize` are flagged once via a
  // dev-mode warning the first time a drag starts.
  private readonly scrollSpeedBase = 10;
  private readonly scrollSpeedMax = 14;
  private animationFrameId: number | null = null;
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
        if (this.readOnly() || !this.store.draggedItemId()) {
          this.stopAutoScroll();
          return;
        }
        this.maybeWarnItemSizeMismatch(viewportEl, this.itemSize());
        this.updateAutoScroll(viewportEl, event.clientY);
      };
      const handleDragLeave = (event: DragEvent) => {
        const related = event.relatedTarget as Node | null;
        if (!related || !viewportEl.contains(related)) {
          this.stopAutoScroll();
        }
      };
      const handleWindowDragEnd = () => {
        if (this.store.draggedItemId()) {
          this.store.clearDragState();
        }
      };

      viewportEl.addEventListener('dragover', handleDragOver);
      viewportEl.addEventListener('dragleave', handleDragLeave);
      window.addEventListener('dragend', handleWindowDragEnd);

      this.destroyRef.onDestroy(() => {
        viewportEl.removeEventListener('dragover', handleDragOver);
        viewportEl.removeEventListener('dragleave', handleDragLeave);
        window.removeEventListener('dragend', handleWindowDragEnd);
        this.stopAutoScroll();
      });
    });
  }

  private maybeWarnItemSizeMismatch(viewportEl: HTMLElement, itemSize: number) {
    if (this.itemSizeWarned || !isDevMode()) return;
    const row = viewportEl.querySelector<HTMLElement>('.ngx-tree-row-wrapper');
    if (!row) return;
    const measured = row.getBoundingClientRect().height;
    if (measured > 0) {
      this.itemSizeWarned = true;
      if (Math.abs(measured - itemSize) > 1) {
        console.warn(
          `[ngx-powerful-tree] Rendered row height (${measured}px) does not match [itemSize] (${itemSize}px). ` +
            `Virtual scroll requires a fixed itemSize. Either set [itemSize] to match your custom template ` +
            `height, or override --ngx-tree-row-height-min so the row matches itemSize.`
        );
      }
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
