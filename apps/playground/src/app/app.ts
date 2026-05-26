import {
  Component,
  OnInit,
  OnDestroy,
  signal,
  inject,
  PLATFORM_ID,
  viewChild,
  computed,
  ChangeDetectionStrategy,
} from '@angular/core';
import { CommonModule, isPlatformBrowser } from '@angular/common';
import { NgxPowerfulTree, NgxTreeNode, DragPosition, expandItems } from 'ngx-powerful-tree';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, NgxPowerfulTree],
  templateUrl: './app.html',
  styleUrl: './app.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AppComponent implements OnInit, OnDestroy {
  private platformId = inject(PLATFORM_ID);
  primaryTree = viewChild<NgxPowerfulTree>('primaryTree');

  // Tree Inputs Signals
  treeNodes = signal<NgxTreeNode[]>([]);
  pickerNodes = signal<NgxTreeNode[]>([]);
  searchQuery = signal<string>('');
  multiSelect = signal<boolean>(false);
  useCustomIcons = signal<boolean>(true); // Enable FontAwesome custom icons by default
  allowRename = signal<boolean>(true); // Dynamic user access control for renaming
  allowDelete = signal<boolean>(true); // Dynamic user access control for deleting
  truncateNames = signal<boolean>(true); // Dynamic control for name truncation
  useCustomFileTemplate = signal<boolean>(false); // Enable premium file template demo

  // Stats & States Signals
  totalItemCount = signal<number>(100000);
  benchmarkDuration = signal<number>(0);
  selectedIds = signal<string[]>([]);
  focusedId = signal<string | null>(null);
  isOverlayOpen = signal<boolean>(false);
  logs = signal<string[]>([]);
  currentFps = signal<number>(60);
  private animFrameId: number | null = null;

  // Move Overlay states
  movingItemId = signal<string | null>(null);
  targetFolderId = signal<string | null>(null);
  isMoveOverlayOpen = signal<boolean>(false);
  overlaySearchQuery = signal<string>('');

  movingItemName = computed(() => {
    const itemId = this.movingItemId();
    if (!itemId) return '';
    const tree = this.primaryTree();
    return tree?.store.items()[itemId]?.name ?? '';
  });

  ngOnInit() {
    this.loadMockTree(this.totalItemCount());
    this.startFpsTracker();
  }

  ngOnDestroy() {
    if (this.animFrameId && isPlatformBrowser(this.platformId)) {
      cancelAnimationFrame(this.animFrameId);
    }
  }

  private startFpsTracker() {
    if (!isPlatformBrowser(this.platformId)) {
      return;
    }
    let lastTime = performance.now();
    let frameCount = 0;

    const loop = () => {
      frameCount++;
      const now = performance.now();
      const delta = now - lastTime;

      if (delta >= 1000) {
        // Average frame rate calculation capped at 60 FPS
        const computedFps = Math.min(60, Math.round((frameCount * 1000) / delta));
        this.currentFps.set(computedFps);
        frameCount = 0;
        lastTime = now;
      }

      this.animFrameId = requestAnimationFrame(loop);
    };

    this.animFrameId = requestAnimationFrame(loop);
  }

  // Generate 100k+ elements recursively on the fly and track loading time.
  // Builds the nested NgxTreeNode shape directly — no flat-map intermediate.
  loadMockTree(count: number) {
    this.addLog(`Initializing generation of ${count} tree items...`);
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
    this.addLog(`Loaded ${count} nodes in ${duration}ms! Virtualization renders in real-time.`);

    // Pre-select item-80 and expand its ancestors so it lands in view.
    setTimeout(() => {
      const tree = this.primaryTree();
      if (!tree) return;
      tree.store.selectItem(item80Id, false);
      const parentMap = tree.store.parentMap();
      let parentId = parentMap[item80Id];
      while (parentId) {
        tree.store.setExpanded(parentId, true);
        parentId = parentMap[parentId];
      }
      this.addLog(
        `[Selection Change] Pre-selected 'document_report_80.html' (item-80) and expanded ancestors.`
      );
    }, 100);
  }

  // --- Output Listeners ---

  onItemMoved(event: { draggedId: string; targetId: string; position: DragPosition }) {
    this.addLog(`[Move] Node "${event.draggedId}" moved ${event.position} "${event.targetId}"`);
  }

  onItemRenamed(event: { id: string; name: string }) {
    this.addLog(`[Rename] Node "${event.id}" renamed to "${event.name}"`);
  }

  onItemAdded(event: { parentId: string | null; node: NgxTreeNode }) {
    this.addLog(
      `[Add] New Folder "${event.node.name}" (${event.node.id}) added into parent: ${event.parentId || 'Root'}`
    );
  }

  onItemDeleted(id: string) {
    this.addLog(`[Delete] Node "${id}" deleted recursively.`);
  }

  onSelectionChanged(selected: string[]) {
    this.selectedIds.set(selected);
  }

  onFocusedChanged(focused: string | null) {
    this.focusedId.set(focused);
  }

  // --- Control Panel Handlers ---

  onSearchChange(event: Event) {
    const value = (event.target as HTMLInputElement).value;
    this.searchQuery.set(value);
  }

  toggleMultiSelect() {
    this.multiSelect.update((v) => !v);
    this.addLog(`[Config] Multi-Select toggled to: ${this.multiSelect()}`);
  }

  changeItemCount(count: number) {
    this.totalItemCount.set(count);
    this.loadMockTree(count);
  }

  toggleOverlay() {
    this.isOverlayOpen.update((v) => !v);
    this.addLog(`[Config] Overlay system toggled to: ${this.isOverlayOpen()}`);
  }

  clearLogs() {
    this.logs.set([]);
  }

  // --- Relocation Methods ---

  onMoveRequested(id: string) {
    const tree = this.primaryTree();
    if (!tree) return;
    // Snapshot the primary tree's structure as nested nodes for the picker.
    this.pickerNodes.set(expandItems(tree.store.items(), tree.store.rootIds()));
    this.movingItemId.set(id);
    this.targetFolderId.set(null);
    this.overlaySearchQuery.set('');
    this.isMoveOverlayOpen.set(true);
    this.addLog(`[Move Request] Started relocate workflow for item: ${id}`);
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
      this.addLog(`[Relocate] Moved item "${draggedId}" into folder "${targetId}"`);
      this.cancelMove();
    }
  }

  cancelMove() {
    this.movingItemId.set(null);
    this.targetFolderId.set(null);
    this.overlaySearchQuery.set('');
    this.isMoveOverlayOpen.set(false);
  }

  // Helper to add events in list logs
  private addLog(message: string) {
    const timestamp = new Date().toLocaleTimeString();
    this.logs.update((l) => [`[${timestamp}] ${message}`, ...l.slice(0, 49)]);
  }
}
