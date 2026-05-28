import { CommonModule } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  input,
  output,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { FormsModule } from '@angular/forms';

import {
  DragPosition,
  expandItems,
  NgxPowerfulTree,
  NgxTreeActions,
  NgxTreeNode,
  NgxTreeSearchPredicate,
  NgxTreeStructuralItem,
} from 'ngx-powerful-tree';

@Component({
  selector: 'app-folder-tree',
  standalone: true,
  imports: [CommonModule, FormsModule, NgxPowerfulTree],
  templateUrl: './folder-tree.component.html',
  styleUrl: './folder-tree.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FolderTreeComponent {
  primaryTree = viewChild<NgxPowerfulTree>('primaryTree');
  pickerTree = viewChild<NgxPowerfulTree>('pickerTree');

  searchPredicate: NgxTreeSearchPredicate = (item, query) => {
    const q = query.toLowerCase();
    const nameMatches = item.name.toLowerCase().includes(q);
    const description = item.data?.description;
    const descriptionMatches =
      typeof description === 'string' && description.toLowerCase().includes(q);
    return nameMatches || descriptionMatches;
  };

  // --- Signal Inputs & Outputs ---
  initialSelectedFileId = input<string | null>(null);
  customTreeNodes = input<NgxTreeNode[] | null>(null);
  fileSelected = output<any>();

  // --- Tree data signals ---
  defaultTreeNodes = signal<NgxTreeNode[]>([]);

  treeNodes = computed(() => {
    const custom = this.customTreeNodes();
    if (custom !== null) {
      return custom;
    }
    return this.defaultTreeNodes();
  });

  pickerNodes = signal<NgxTreeNode[]>([]);
  searchQuery = signal<string>('');

  // --- Actions config: can't delete non-empty folders ---
  primaryActions = computed<NgxTreeActions>(() => ({
    rename: true,
    add: true,
    move: true,
    delete: (item: NgxTreeStructuralItem) => !item.isFolder || item.children.length === 0,
  }));

  // --- Relocation state ---
  movingItemId = signal<string | null>(null);
  selectedDestinationId = signal<string | null>(null);
  isMoveOverlayOpen = signal<boolean>(false);
  overlaySearchQuery = signal<string>('');

  movingItemName = computed(() => {
    const itemId = this.movingItemId();
    if (!itemId) return '';
    const tree = this.primaryTree();
    return tree?.store.getItem(itemId)?.name ?? '';
  });

  selectAndExpandFile(fileId: string) {
    const tree = this.primaryTree();
    if (!tree) return;

    const trySelect = () => {
      const item = tree.store.getItem(fileId);
      if (item) {
        tree.store.selectItem(fileId, false);
        let parentId = tree.store.getParentId(fileId);
        while (parentId) {
          tree.store.setExpanded(parentId, true);
          parentId = tree.store.getParentId(parentId);
        }
        // Force scroll calculation to center pre-selected items in virtual scroll viewport
        const { indexById } = tree.store.flattenedStructure();
        const idx = indexById[fileId];
        if (idx !== undefined && idx >= 0) {
          (tree as any).scrollToIndex(idx);
        }
      }
    };

    // Run immediately
    untracked(() => trySelect());
    // Schedule a small delay to handle async virtual scroll / flattening ticks
    setTimeout(() => untracked(() => trySelect()), 150);
  }

  constructor() {
    this.generateMockTree();

    // Effect to programmatically sync selection and expansion when initial selection changes
    effect(() => {
      const fileId = this.initialSelectedFileId();
      const tree = this.primaryTree();
      if (fileId && tree) {
        untracked(() => {
          this.selectAndExpandFile(fileId);
        });
      }
    });
  }

  // --- Mock Tree Generation (1,000 items total) ---
  private generateMockTree() {
    const lookup = new Map<string, NgxTreeNode>();
    const roots: NgxTreeNode[] = [];

    const makeNode = (node: NgxTreeNode): NgxTreeNode => {
      lookup.set(node.id, node);
      return node;
    };

    // 1. Generate standard root folders
    const rootFoldersCount = 8;
    for (let i = 1; i <= rootFoldersCount; i++) {
      const node = makeNode({
        id: `root-folder-${i}`,
        name: `Cabinet Volume ${i}`,
        isFolder: true,
        icon: 'fas fa-folder',
        children: [],
        data: { description: `Cabinet storage container volume ${i} for general archiving` },
      });
      roots.push(node);
    }

    // 2. Generate standard root files
    for (let i = 1; i <= 2; i++) {
      const node = makeNode({
        id: `root-file-${i}`,
        name: `readme_first_${i}.txt`,
        isFolder: false,
        icon: 'fas fa-file-alt',
        data: { description: `General instruction file version ${i}` },
      });
      roots.push(node);
    }

    // 3. Setup "Other Users" Folder strictly at the end
    const otherUsers = makeNode({
      id: 'other-users-root',
      name: 'Other Users',
      isFolder: true,
      locked: true,
      icon: 'fas fa-folder', // Other folder has normal folder icon
      children: [],
      data: { description: 'Access-restricted user vaults directory' },
    });
    roots.push(otherUsers);

    // Create 3 user folders (Level 1) under Other Users
    const users = [
      { name: 'Alice Cooper', id: 'user-alice' },
      { name: 'Bob Marley', id: 'user-bob' },
      { name: 'Charlie Chaplin', id: 'user-charlie' },
    ];

    users.forEach((u) => {
      const userFolder = makeNode({
        id: u.id,
        name: u.name,
        isFolder: true,
        locked: true,
        icon: 'fas fa-user', // Inside folder has fas fa-user icon
        children: [],
        data: { description: `Secure document folder for user ${u.name}` },
      });
      otherUsers.children!.push(userFolder);

      // Create Level 2 files inside each user folder
      const files = [
        {
          name: 'tax_statement.pdf',
          icon: 'fas fa-file-pdf',
          desc: 'Alice Cooper tax declarations',
        },
        { name: 'w2_form.pdf', icon: 'fas fa-file-pdf', desc: 'Alice Cooper annual W2 form' },
      ];
      if (u.id === 'user-bob') {
        files[0] = {
          name: 'reggae_chords.docx',
          icon: 'fas fa-file-word',
          desc: 'Bob Marley chord archive',
        };
        files[1] = {
          name: 'tour_schedule.xlsx',
          icon: 'fas fa-file-excel',
          desc: 'Bob Marley 2026 concert spreadsheet',
        };
      } else if (u.id === 'user-charlie') {
        files[0] = {
          name: 'silent_movie_script.pdf',
          icon: 'fas fa-file-pdf',
          desc: 'Charlie Chaplin comedy movie script',
        };
        files[1] = {
          name: 'backstage_pass.png',
          icon: 'fas fa-file-image',
          desc: 'Charlie Chaplin high resolution credential image',
        };
      }

      files.forEach((f, idx) => {
        // Important: Guarantee matching IDs for select dropdown pre-selections
        const finalId = idx === 0 ? `${u.id}-file-0` : `${u.id}-file-${idx}`;
        userFolder.children!.push(
          makeNode({
            id: finalId,
            name: f.name,
            isFolder: false,
            locked: true,
            icon: f.icon,
            data: { description: f.desc },
          })
        );
      });
    });

    // 4. Fill standard pool to exactly 1,000 items
    const standardFoldersPool: NgxTreeNode[] = roots.filter(
      (n) => n.id !== 'other-users-root' && n.isFolder
    );

    const extensions = ['pdf', 'xlsx', 'txt', 'docx', 'png', 'zip', 'json', 'md'];
    const extensionsIcons: Record<string, string> = {
      pdf: 'fas fa-file-pdf',
      xlsx: 'fas fa-file-excel',
      txt: 'fas fa-file-alt',
      docx: 'fas fa-file-word',
      png: 'fas fa-file-image',
      zip: 'fas fa-file-archive',
      json: 'fas fa-file-code',
      md: 'fas fa-file-signature',
    };

    const targetTotal = 1000;
    let currentCount = lookup.size;
    let seq = 1;

    while (currentCount < targetTotal) {
      const isFolder = Math.random() < 0.15; // 15% folders
      const parent = standardFoldersPool[Math.floor(Math.random() * standardFoldersPool.length)];
      parent.children = parent.children ?? [];

      const id = `item-${seq++}`;

      if (isFolder) {
        const folderNode = makeNode({
          id,
          name: `Archive_Folder_${seq}`,
          isFolder: true,
          icon: 'fas fa-folder',
          children: [],
          data: { description: `Nested document collection folder number ${seq}` },
        });
        parent.children.push(folderNode);
        standardFoldersPool.push(folderNode);
      } else {
        const ext = extensions[Math.floor(Math.random() * extensions.length)];
        const icon = extensionsIcons[ext];
        parent.children.push(
          makeNode({
            id,
            name: `financial_report_${seq}.${ext}`,
            isFolder: false,
            icon,
            data: {
              description: `Consolidated financial balance sheet report for Q${(seq % 4) + 1} 2026`,
            },
          })
        );
      }

      currentCount = lookup.size;
    }

    this.defaultTreeNodes.set(roots);
  }

  // --- Handlers ---
  onSearchChange(event: Event) {
    const value = (event.target as HTMLInputElement).value;
    this.searchQuery.set(value);
  }

  onFileRowClick(item: any) {
    const tree = this.primaryTree();
    if (tree) {
      tree.store.selectItem(item.id, false);
    }
    // Log selection clicks even if clicking the exact same file
    console.log('File selected:', item.name, item.id);
    this.fileSelected.emit(item);
  }

  // --- Relocation flow ---
  onMoveRequested(id: string) {
    const tree = this.primaryTree();
    if (!tree) return;
    // Populate relocation tree with only folders, excluding locked subtrees so
    // they can't be chosen as destinations.
    const all = expandItems(tree.store.getAllItemsAsRecord(), tree.store.getRootIds());
    this.pickerNodes.set(this.stripLocked(all));
    this.movingItemId.set(id);
    this.overlaySearchQuery.set('');
    this.isMoveOverlayOpen.set(true);
  }

  private stripLocked(nodes: NgxTreeNode[]): NgxTreeNode[] {
    const out: NgxTreeNode[] = [];
    for (const n of nodes) {
      if (n.locked) continue;
      out.push({
        ...n,
        children: n.children ? this.stripLocked(n.children) : undefined,
      });
    }
    return out;
  }

  onDestinationSelected(selected: string[]) {
    this.selectedDestinationId.set(selected[0] || null);
  }

  confirmMove() {
    const draggedId = this.movingItemId();
    const targetId = this.selectedDestinationId();
    if (draggedId && targetId) {
      const tree = this.primaryTree();
      if (tree) {
        tree.moveItem(draggedId, targetId, 'inside');
      }
      this.cancelMove();
    }
  }

  onMoveToRoot() {
    const draggedId = this.movingItemId();
    if (draggedId) {
      const tree = this.primaryTree();
      if (tree) {
        const rootIds = tree.store.getRootIds();
        const otherUsersIdx = rootIds.indexOf('other-users-root');
        const insertIndex = otherUsersIdx !== -1 ? otherUsersIdx : undefined;
        const moved = tree.store.moveToRoot(draggedId, insertIndex);
        if (moved) {
          // Emit standard movement outputs for subscribers
          tree.itemMoved.emit({ draggedId, targetId: 'other-users-root', position: 'before' });
        }
      }
      this.cancelMove();
    }
  }

  cancelMove() {
    // The @defer block keeps the picker instance alive across close/reopen,
    // so its store retains the previously selected and focused ids. Both
    // contribute to the row highlight, so clear both — otherwise the row
    // still looks selected on reopen.
    const picker = this.pickerTree();
    if (picker) {
      picker.store.clearSelection();
      picker.store.setFocusedItemId(null);
    }
    this.movingItemId.set(null);
    this.selectedDestinationId.set(null);
    this.overlaySearchQuery.set('');
    this.isMoveOverlayOpen.set(false);
  }

  onItemMoved(event: { draggedId: string; targetId: string; position: DragPosition }) {
    // Standard event logging
  }
}
