import { Component, OnInit, signal, effect } from '@angular/core';
import { CommonModule } from '@angular/common';
import { NgxPowerfulTree, NgxTreeItem, DragPosition } from 'ngx-powerful-tree';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, NgxPowerfulTree],
  templateUrl: './app.html',
  styleUrl: './app.css',
})
export class AppComponent implements OnInit {
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

  ngOnInit() {
    this.loadMockTree(this.totalItemCount());
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
    const extensions = ['pdf', 'txt', 'csv', 'json', 'png', 'ts', 'js', 'html', 'css', 'zip', 'md', 'mp4', 'xlsx'];

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
    this.addLog(
      `[Move] Node "${event.draggedId}" moved ${event.position} "${event.targetId}"`
    );
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

  // Helper to add events in list logs
  private addLog(message: string) {
    const timestamp = new Date().toLocaleTimeString();
    this.logs.update((l) => [`[${timestamp}] ${message}`, ...l.slice(0, 49)]);
  }
}
