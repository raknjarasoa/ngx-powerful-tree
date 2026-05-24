import {
  Component,
  OnInit,
  OnDestroy,
  signal,
  effect,
  inject,
  PLATFORM_ID,
  viewChild,
  computed,
} from '@angular/core';
import { CommonModule, isPlatformBrowser } from '@angular/common';
import { NgxPowerfulTree, NgxTreeItem, DragPosition } from 'ngx-powerful-tree';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, NgxPowerfulTree],
  templateUrl: './app.html',
  styleUrl: './app.css',
})
export class AppComponent implements OnInit, OnDestroy {
  private platformId = inject(PLATFORM_ID);
  primaryTree = viewChild<NgxPowerfulTree>('primaryTree');

  // Tree Inputs Signals
  treeItems = signal<Record<string, NgxTreeItem>>({});
  treeRootIds = signal<string[]>([]);
  searchQuery = signal<string>('');
  multiSelect = signal<boolean>(true);

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
    return itemId ? this.treeItems()[itemId]?.name || '' : '';
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

  // Generate 100k+ elements recursively on the fly and track loading time
  loadMockTree(count: number) {
    this.addLog(`Initializing generation of ${count} tree items...`);
    const start = performance.now();

    const items: Record<string, NgxTreeItem> = {};
    const rootIds: string[] = [];

    // Create 15 top-level root folders
    const rootFolders = 15;
    for (let i = 1; i <= rootFolders; i++) {
      const id = `root-folder-${i}`;
      items[id] = {
        id,
        name: `📁 Archive Volume ${i}`,
        isFolder: true,
        children: [],
      };
      rootIds.push(id);
    }

    const folderPool = [...rootIds];
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
      const isFolder = Math.random() < 0.15; // 15% folders
      const id = `item-${i}`;
      const parentId = folderPool[Math.floor(Math.random() * folderPool.length)];

      if (isFolder) {
        items[id] = {
          id,
          name: `📁 Collection_${i}`,
          isFolder: true,
          children: [],
        };
        items[parentId].children?.push(id);
        folderPool.push(id);
      } else {
        const ext = extensions[Math.floor(Math.random() * extensions.length)];
        items[id] = {
          id,
          name: `📄 document_report_${i}.${ext}`,
          isFolder: false,
        };
        items[parentId].children?.push(id);
      }
    }

    this.treeItems.set(items);
    this.treeRootIds.set(rootIds);

    const end = performance.now();
    const duration = Math.round(end - start);
    this.benchmarkDuration.set(duration);
    this.addLog(`Loaded ${count} nodes in ${duration}ms! Virtualization renders in real-time.`);
  }

  // --- Output Listeners ---

  onItemMoved(event: { draggedId: string; targetId: string; position: DragPosition }) {
    this.addLog(`[Move] Node "${event.draggedId}" moved ${event.position} "${event.targetId}"`);
  }

  onItemRenamed(event: { id: string; name: string }) {
    this.addLog(`[Rename] Node "${event.id}" renamed to "${event.name}"`);
  }

  onItemAdded(event: { parentId: string | null; item: NgxTreeItem }) {
    this.addLog(
      `[Add] New Folder "${event.item.name}" (${event.item.id}) added into parent: ${event.parentId || 'Root'}`
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
