import {
  Component,
  ElementRef,
  HostListener,
  TemplateRef,
  contentChild,
  effect,
  inject,
  input,
  output,
  untracked,
  viewChild,
  viewChildren,
  ChangeDetectionStrategy,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { CdkVirtualScrollViewport, ScrollingModule } from '@angular/cdk/scrolling';
import { NgxTreeStore } from '../ngx-tree.store';
import { NgxTreeRowDirective } from '../ngx-tree-row.directive';
import { NgxTreeItem, NgxTreeProxyItem, DragPosition } from '../ngx-tree.types';

@Component({
  selector: 'ngx-powerful-tree',
  standalone: true,
  imports: [CommonModule, ScrollingModule, NgxTreeRowDirective],
  providers: [NgxTreeStore],
  templateUrl: './ngx-powerful-tree.html',
  styleUrl: './ngx-powerful-tree.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class NgxPowerfulTree {
  // Inject the local state store provided at the component level
  public store = inject(NgxTreeStore);

  // --- Modern Signal Inputs ---
  items = input.required<Record<string, NgxTreeItem>>();
  rootIds = input.required<string[]>();
  searchQuery = input<string>('');
  multiSelect = input<boolean>(false);
  itemSize = input<number>(40); // Pixel height of a row for virtual scroll
  foldersOnly = input<boolean>(false);
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
  itemTemplate = contentChild<TemplateRef<any>>('itemTemplate');
  viewport = viewChild<CdkVirtualScrollViewport>(CdkVirtualScrollViewport);
  editInputs = viewChildren<ElementRef<HTMLInputElement>>('editInput');

  constructor() {
    // 1. Sync external items & rootIds into the local reactive store
    effect(() => {
      const itemsVal = this.items();
      const rootsVal = this.rootIds();
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

    // 3. Emit selections to consumer whenever changed
    effect(() => {
      const selected = Array.from(this.store.selectedItems());
      untracked(() => {
        this.selectionChanged.emit(selected);
      });
    });

    // 4. Emit focus changes to consumer
    effect(() => {
      const focused = this.store.focusedItemId();
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

    // 6. Sync foldersOnly setting for Picker view mode
    effect(() => {
      const foldersOnlyVal = this.foldersOnly();
      untracked(() => {
        this.store.setFoldersOnly(foldersOnlyVal);
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

  public moveItem(draggedId: string, targetId: string, position: DragPosition) {
    this.store.moveItem(draggedId, targetId, position);
    this.itemMoved.emit({ draggedId, targetId, position });
  }

  triggerRename(id: string, event: MouseEvent) {
    event.stopPropagation();
    this.store.setEditingItemId(id);
  }

  saveRename(id: string, newName: string) {
    const trimmed = newName.trim();
    if (trimmed && trimmed !== this.store.items()[id]?.name) {
      this.store.renameItem(id, trimmed);
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
    this.store.deleteItem(id);
    this.itemDeleted.emit(id);
  }

  triggerAddFolder(parentId: string, event: MouseEvent) {
    event.stopPropagation();
    const newId = `new-folder-${Math.random().toString(36).substr(2, 9)}`;
    const newItem: NgxTreeItem = {
      id: newId,
      name: 'New Folder',
      isFolder: true,
      children: [],
    };
    this.store.addItem(parentId, newItem);
    this.itemAdded.emit({ parentId, item: newItem });
    // Trigger editing state for immediate renaming
    setTimeout(() => {
      this.store.setEditingItemId(newId);
    }, 50);
  }

  // Public component methods for programmatically adding folders at root
  public addRootFolder(name = 'New Root Folder') {
    const newId = `new-folder-${Math.random().toString(36).substr(2, 9)}`;
    const newItem: NgxTreeItem = {
      id: newId,
      name,
      isFolder: true,
      children: [],
    };
    this.store.addItem(null, newItem);
    this.itemAdded.emit({ parentId: null, item: newItem });
    setTimeout(() => {
      this.store.setEditingItemId(newId);
    }, 50);
  }

  // --- Keyboard Event Handler ---

  @HostListener('keydown', ['$event'])
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
        if (!this.readOnly() && !currentItem.locked) {
          this.store.deleteItem(currentItem.id);
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
}
