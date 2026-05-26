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
import { DragPosition, NgxTreeItem, NgxTreeProxyItem, SelectableTypes } from '../ngx-tree.types';

// SSR-safe id generator. `crypto.randomUUID` exists in browsers and modern
// Node, but not in older runtimes — fall back to a stronger random than the
// deprecated Math.random/substr combo.
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
  // Inject the local state store provided at the component level
  public store = inject(NgxTreeStore);
  private ngZone = inject(NgZone);
  private destroyRef = inject(DestroyRef);
  private platformId = inject(PLATFORM_ID);
  private injector = inject(Injector);

  // --- Modern Signal Inputs ---
  // `items` and `rootIds` seed the tree on first emission. After that, the
  // store owns truth. Use `reload()` to swap the dataset explicitly.
  items = input.required<Record<string, NgxTreeItem>>();
  rootIds = input.required<string[]>();
  searchQuery = input<string>('');
  multiSelect = input<boolean>(false);
  itemSize = input<number>(40); // Pixel height of a row for virtual scroll
  foldersOnly = input<boolean>(false);
  selectableTypes = input<SelectableTypes | null>(null);
  readOnly = input<boolean>(false);
  folderIcon = input<string>(''); // Global folder icon CSS class (e.g. 'fa-solid fa-folder')
  fileIcon = input<string>(''); // Global file icon CSS class (e.g. 'fa-solid fa-file')
  truncate = input<boolean>(true); // Truncate text names with ellipsis by default
  allowAdd = input<boolean>(true); // Allow child folders creation
  allowRename = input<boolean>(true); // Allow node renaming
  allowDelete = input<boolean>(true); // Allow node deletion
  allowMove = input<boolean>(true); // Allow node relocation movement

  // --- Outputs (Events) ---
  itemMoved = output<{
    draggedId: string;
    targetId: string;
    position: DragPosition;
  }>();
  itemRenamed = output<{ id: string; name: string }>();
  itemAdded = output<{ parentId: string | null; item: NgxTreeItem }>();
  itemDeleted = output<string>();
  selectionChanged = output<string[]>();
  focusedChanged = output<string | null>();
  moveRequested = output<string>();

  // --- Signal-based View & Content Queries ---
  itemTemplate = contentChild<TemplateRef<unknown>>('itemTemplate');
  // eslint-disable-next-line @angular-eslint/no-input-rename
  fileTemplateInput = input<TemplateRef<unknown> | null>(null, { alias: 'fileTemplate' });
  fileTemplateContent = contentChild<TemplateRef<unknown>>('fileTemplate');
  fileTemplate = computed(() => this.fileTemplateInput() || this.fileTemplateContent() || null);

  viewport = viewChild<CdkVirtualScrollViewport>(CdkVirtualScrollViewport);
  editInputs = viewChildren<ElementRef<HTMLInputElement>>('editInput');

  private initialized = false;

  constructor() {
    // 1. One-shot seed of the store from the inputs. Subsequent emissions are
    // ignored on purpose — the store owns truth after init. Use `reload()` to
    // swap the dataset explicitly.
    effect(() => {
      const itemsVal = this.items();
      const rootsVal = this.rootIds();
      if (this.initialized) return;
      this.initialized = true;
      untracked(() => {
        this.store.setItems(itemsVal, rootsVal);
      });
    });

    // 2. Sync search queries dynamically for real-time fluid searching
    effect(() => {
      const searchVal = this.searchQuery();
      untracked(() => {
        this.store.setSearchQuery(searchVal);
      });
    });

    // 3. Emit selections to consumer when membership changes
    let lastSelectionKey = '';
    effect(() => {
      const selectedSet = this.store.selectedItems();
      const selected = Array.from(selectedSet).sort();
      const key = selected.join('');
      if (key === lastSelectionKey) return;
      lastSelectionKey = key;
      untracked(() => {
        this.selectionChanged.emit(selected);
      });
    });

    // 4. Emit focus changes to consumer when value actually changes
    let lastFocused: string | null | undefined = undefined;
    effect(() => {
      const focused = this.store.focusedItemId();
      if (focused === lastFocused) return;
      lastFocused = focused;
      untracked(() => {
        this.focusedChanged.emit(focused);
      });
    });

    // 5. Automatically focus and highlight the text field when renaming starts
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

    // 6. Sync foldersOnly visual filter (controls whether files are flattened)
    effect(() => {
      const foldersOnlyVal = this.foldersOnly();
      untracked(() => {
        this.store.setFoldersOnly(foldersOnlyVal);
      });
    });

    // 7. Sync selectableTypes. When the consumer doesn't pass it, infer from
    // foldersOnly so legacy usage keeps working (picker = folders selectable).
    effect(() => {
      const explicit = this.selectableTypes();
      const foldersOnlyVal = this.foldersOnly();
      const resolved: SelectableTypes = explicit ?? (foldersOnlyVal ? 'folders' : 'files');
      untracked(() => {
        this.store.setSelectableTypes(resolved);
      });
    });
  }

  // TrackBy function to avoid unnecessary DOM element recreating
  trackById(index: number, item: NgxTreeProxyItem): string {
    return item.id;
  }

  // --- Action Handlers ---

  onItemClick(item: NgxTreeProxyItem, event: MouseEvent) {
    // If the click is on a button inside row, ignore selection click
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
    // Bubble up to consumer
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

  // Public component methods for programmatically adding folders at root
  public addRootFolder(name = 'New Root Folder') {
    this.createFolder(null, name);
  }

  // Public method to reload the dataset. Clears expand/select/focus/search/drag state.
  public reload(items: Record<string, NgxTreeItem>, rootIds: string[]) {
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
    this.itemAdded.emit({ parentId, item: newItem });
    // Defer editing-state activation until the row is rendered by virtual scroll.
    afterNextRender(
      () => {
        this.store.setEditingItemId(newId);
      },
      { injector: this.injector }
    );
  }

  // --- Keyboard Event Handler ---

  onKeyDown(event: KeyboardEvent) {
    const list = this.store.flattenedVisibleItems();
    if (list.length === 0) return;

    const focusedId = this.store.focusedItemId();
    const focusedIdx = list.findIndex((item) => item.id === focusedId);

    // If no item is focused, default to focusing the first visible item
    if (focusedIdx === -1) {
      this.store.setFocusedItemId(list[0].id);
      this.scrollToIndex(0);
      return;
    }

    const currentItem = list[focusedIdx];

    // If user is currently editing an item name, ignore hotkeys except Enter/Esc
    if (currentItem.editing) {
      if (event.key === 'Escape' || event.key === 'Enter') {
        // Handled by the inline input fields
        return;
      }
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
            // Focus first child
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
          // Focus parent
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
        // Wrap-around Typeahead search: jump focus to next item matching character pressed
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

  // Helper method to scroll viewport index into focus view safely
  private scrollToIndex(index: number) {
    const vpt = this.viewport();
    if (vpt) {
      const range = vpt.getRenderedRange();
      // Scroll only if out of rendered boundaries to avoid heavy redraws
      if (index < range.start || index >= range.end - 1) {
        vpt.scrollToIndex(index);
      }
    }
  }

  // --- Smooth Auto-Scrolling during Drag-n-Drop outside Angular Zone ---
  private scrollSpeed = 15; // Max pixels to scroll per frame
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
          // Near the top: scroll up
          const intensity = Math.max(0, (topThreshold - mouseY) / 40); // 0 to 1
          this.startAutoScroll(viewportEl, -1, intensity);
        } else if (mouseY > bottomThreshold) {
          // Near the bottom: scroll down
          const intensity = Math.max(0, (mouseY - bottomThreshold) / 40); // 0 to 1
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

      // Also register on document to ensure cleanup
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
