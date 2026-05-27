import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  PLATFORM_ID,
  afterNextRender,
  computed,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { DecimalPipe, isPlatformBrowser } from '@angular/common';
import {
  DragPosition,
  NgxPowerfulTree,
  NgxTreeActions,
  NgxTreeNode,
  NgxTreeStructuralItem,
  expandItems,
} from 'ngx-powerful-tree';

@Component({
  selector: 'app-playground',
  standalone: true,
  imports: [DecimalPipe, NgxPowerfulTree],
  templateUrl: './playground.html',
  styleUrl: './playground.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PlaygroundComponent {
  private platformId = inject(PLATFORM_ID);
  private destroyRef = inject(DestroyRef);
  primaryTree = viewChild<NgxPowerfulTree>('primaryTree');

  // --- Tree input signals ---
  treeNodes = signal<NgxTreeNode[]>([]);
  pickerNodes = signal<NgxTreeNode[]>([]);
  searchQuery = signal<string>('');
  multiSelect = signal<boolean>(false);
  allowRename = signal<boolean>(true);
  allowDelete = signal<boolean>(true);
  truncateNames = signal<boolean>(true);
  useCustomFileTemplate = signal<boolean>(false);

  // Per-action availability. Omitted keys keep their defaults (`true`).
  // `delete` uses a predicate: disable when a folder still has children.
  primaryActions = computed<NgxTreeActions>(() => ({
    rename: this.allowRename(),
    delete: this.allowDelete()
      ? (item: NgxTreeStructuralItem) => !item.isFolder || item.children.length === 0
      : false,
  }));

  // --- Stats & UI state ---
  totalItemCount = signal<number>(100000);
  benchmarkDuration = signal<number>(0);
  selectedIds = signal<string[]>([]);
  focusedId = signal<string | null>(null);
  currentFps = signal<number>(60);
  private animFrameId: number | null = null;

  // --- Move overlay state ---
  movingItemId = signal<string | null>(null);
  targetFolderId = signal<string | null>(null);
  isMoveOverlayOpen = signal<boolean>(false);
  overlaySearchQuery = signal<string>('');

  movingItemName = computed(() => {
    const itemId = this.movingItemId();
    if (!itemId) return '';
    const tree = this.primaryTree();
    return tree?.store.getItem(itemId)?.name ?? '';
  });

  constructor() {
    this.loadMockTree(this.totalItemCount());
    afterNextRender(() => {
      this.startFpsTracker();
    });
    this.destroyRef.onDestroy(() => {
      if (this.animFrameId !== null && isPlatformBrowser(this.platformId)) {
        cancelAnimationFrame(this.animFrameId);
        this.animFrameId = null;
      }
    });
  }

  private startFpsTracker() {
    if (!isPlatformBrowser(this.platformId)) return;
    let lastTime = performance.now();
    let frameCount = 0;

    const loop = () => {
      frameCount++;
      const now = performance.now();
      const delta = now - lastTime;

      if (delta >= 1000) {
        const computedFps = Math.min(60, Math.round((frameCount * 1000) / delta));
        this.currentFps.set(computedFps);
        frameCount = 0;
        lastTime = now;
      }

      this.animFrameId = requestAnimationFrame(loop);
    };

    this.animFrameId = requestAnimationFrame(loop);
  }

  // Generate 100k+ nodes on the fly and track loading time.
  loadMockTree(count: number) {
    const start = performance.now();

    const lookup = new Map<string, NgxTreeNode>();
    const roots: NgxTreeNode[] = [];

    const makeNode = (node: NgxTreeNode): NgxTreeNode => {
      lookup.set(node.id, node);
      return node;
    };

    for (let i = 1; i <= 14; i++) {
      const node = makeNode({
        id: `root-folder-${i}`,
        name: `Archive Volume ${i}`,
        isFolder: true,
        children: [],
      });
      roots.push(node);
    }

    const otherUsers = makeNode({
      id: 'root-folder-15',
      name: 'Other Users (Locked Branch)',
      isFolder: true,
      locked: true,
      children: [],
    });
    roots.push(otherUsers);

    const userNames = ['John Doe', 'Jane Smith', 'Alex Carter'];
    userNames.forEach((userName, userIdx) => {
      const user = makeNode({
        id: `other-user-${userIdx}`,
        name: userName,
        isFolder: true,
        locked: true,
        children: [],
      });
      otherUsers.children!.push(user);

      const files = [
        { name: 'quarterly_review.xlsx', icon: 'fa-solid fa-file-excel' },
        { name: 'personal_notes.txt', icon: 'fa-solid fa-file-lines' },
        { name: 'profile_pic.png', icon: 'fa-solid fa-file-image' },
      ];
      files.forEach((file, fileIdx) => {
        user.children!.push(
          makeNode({
            id: `other-user-file-${userIdx}-${fileIdx}`,
            name: file.name,
            isFolder: false,
            locked: true,
            icon: file.icon,
          })
        );
      });
    });

    const folderPool: NgxTreeNode[] = roots.filter((n) => n.id !== otherUsers.id);
    const extensions = [
      'pdf',
      'txt',
      'csv',
      'json',
      'png',
      'ts',
      'js',
      'html',
      'css',
      'zip',
      'md',
      'mp4',
      'xlsx',
    ];

    for (let i = 1; i <= count; i++) {
      const isFolder = Math.random() < 0.15;
      const id = `item-${i}`;
      const parent = folderPool[Math.floor(Math.random() * folderPool.length)];
      parent.children = parent.children ?? [];

      if (isFolder) {
        const folder = makeNode({ id, name: `Collection_${i}`, isFolder: true, children: [] });
        parent.children.push(folder);
        folderPool.push(folder);
      } else {
        const ext = extensions[Math.floor(Math.random() * extensions.length)];
        parent.children.push(
          makeNode({ id, name: `document_report_${i}.${ext}`, isFolder: false })
        );
      }
    }

    // Guarantee item-80 exists with the canonical name so the e2e test can find it.
    const item80Id = 'item-80';
    const existing = lookup.get(item80Id);
    if (existing) {
      existing.name = 'document_report_80.html';
      existing.isFolder = false;
    } else if (roots.length > 0) {
      const fallback = roots[0];
      fallback.children = fallback.children ?? [];
      fallback.children.push(
        makeNode({ id: item80Id, name: 'document_report_80.html', isFolder: false })
      );
    }

    this.treeNodes.set(roots);

    const end = performance.now();
    const duration = Math.round(end - start);
    this.benchmarkDuration.set(duration);

    // Pre-select item-80 and expand its ancestors once the tree has rendered.
    afterNextRender(() => {
      setTimeout(() => {
        const tree = this.primaryTree();
        if (!tree) return;
        tree.store.selectItem(item80Id, false);
        let parentId = tree.store.getParentId(item80Id);
        while (parentId) {
          tree.store.setExpanded(parentId, true);
          parentId = tree.store.getParentId(parentId);
        }
      }, 100);
    });
  }

  // --- Output listeners ---

  onItemMoved(event: { draggedId: string; targetId: string; position: DragPosition }) {}

  onItemRenamed(event: { id: string; name: string }) {}

  onItemAdded(event: { parentId: string | null; node: NgxTreeNode }) {}

  onItemDeleted(id: string) {}

  onSelectionChanged(selected: string[]) {
    this.selectedIds.set(selected);
  }

  onFocusedChanged(focused: string | null) {
    this.focusedId.set(focused);
  }

  // --- Control panel handlers ---

  onSearchChange(event: Event) {
    const value = (event.target as HTMLInputElement).value;
    this.searchQuery.set(value);
  }

  toggleMultiSelect() {
    this.multiSelect.update((v) => !v);
  }

  changeItemCount(count: number) {
    this.totalItemCount.set(count);
    this.loadMockTree(count);
  }

  // --- Relocation flow ---

  onMoveRequested(id: string) {
    const tree = this.primaryTree();
    if (!tree) return;
    this.pickerNodes.set(expandItems(tree.store.getAllItemsAsRecord(), tree.store.getRootIds()));
    this.movingItemId.set(id);
    this.targetFolderId.set(null);
    this.overlaySearchQuery.set('');
    this.isMoveOverlayOpen.set(true);
  }

  onDestinationSelected(selected: string[]) {
    this.targetFolderId.set(selected[0] || null);
  }

  confirmMove() {
    const draggedId = this.movingItemId();
    const targetId = this.targetFolderId();
    const tree = this.primaryTree();
    if (draggedId && targetId && tree) {
      tree.moveItem(draggedId, targetId, 'inside');
      this.cancelMove();
    }
  }

  cancelMove() {
    this.movingItemId.set(null);
    this.targetFolderId.set(null);
    this.overlaySearchQuery.set('');
    this.isMoveOverlayOpen.set(false);
  }
}
