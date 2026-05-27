import { ChangeDetectionStrategy, Component, computed, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { PopoverModule } from 'primeng/popover';
import { FolderTreeComponent } from './folder-tree.component';
import { NgxTreeNode } from 'ngx-powerful-tree';

export interface FolderStructureNode {
  id: string;
  name: string;
  isFolder: boolean;
  fileId?: string;
  children?: FolderStructureNode[];
  icon?: string;
  data?: any;
}

export function mergeFolderStructureAndFiles(
  folderStructure: FolderStructureNode[],
  files: { id: string; name: string; icon?: string; data?: any }[]
): NgxTreeNode[] {
  const filesMap = new Map<string, { id: string; name: string; icon?: string; data?: any }>();
  for (const f of files) {
    if (f && f.id) {
      filesMap.set(f.id, f);
    }
  }

  const recurse = (node: FolderStructureNode): NgxTreeNode | null => {
    if (node.isFolder) {
      const mergedChildren: NgxTreeNode[] = [];
      if (node.children) {
        for (const child of node.children) {
          const merged = recurse(child);
          if (merged) {
            mergedChildren.push(merged);
          }
        }
      }
      return {
        id: node.id,
        name: node.name,
        isFolder: true,
        children: mergedChildren,
        icon: node.icon || 'fas fa-folder',
        data: node.data,
      };
    } else {
      if (!node.fileId) return null;
      const matchingFile = filesMap.get(node.fileId);
      if (!matchingFile) return null;
      return {
        id: matchingFile.id,
        name: matchingFile.name,
        isFolder: false,
        icon: matchingFile.icon || node.icon || 'fas fa-file',
        data: { ...node.data, ...matchingFile.data },
      };
    }
  };

  const roots: NgxTreeNode[] = [];
  for (const node of folderStructure) {
    const merged = recurse(node);
    if (merged) {
      roots.push(merged);
    }
  }
  return roots;
}

@Component({
  selector: 'app-full-playground',
  standalone: true,
  imports: [CommonModule, PopoverModule, FolderTreeComponent],
  templateUrl: './full.html',
  styleUrl: './full.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FullComponent {
  // --- Selection and Pre-selection State ---
  selectedFile = signal<any>(null);
  selectedFileName = computed(() => this.selectedFile()?.name ?? '');

  initialSelectedFileId = signal<string | null>(null);

  // --- Dynamic Dynamic Files & Structure Fetching ---
  fetchedFiles = signal<any[]>([]);

  // --- Computed Tree Nodes specifically for full.ts ---
  treeNodesForPopover = computed(() => {
    const files = this.fetchedFiles();
    if (files && files.length > 0) {
      return mergeFolderStructureAndFiles(this.sampleFolderStructure, files);
    }
    return null;
  });

  sampleFolderStructure: FolderStructureNode[] = [
    {
      id: 'playground-root-folder-1',
      name: 'Dynamic Folder A',
      isFolder: true,
      icon: 'fas fa-folder',
      children: [
        {
          id: 'playground-sub-folder-1',
          name: 'Sub-Folder A1',
          isFolder: true,
          icon: 'fas fa-folder',
          children: [
            {
              id: 'file-ref-1',
              name: 'Original File Name (will be overridden)',
              isFolder: false,
              fileId: 'user-alice-file-0', // Alice Cooper tax declarations
            },
            {
              id: 'file-ref-nonexistent',
              name: 'Nonexistent File Reference (Should not be displayed)',
              isFolder: false,
              fileId: 'some-fake-id-12345', // Omitted because there's no correspondence!
            },
          ],
        },
        {
          id: 'file-ref-2',
          name: "Bob's chords",
          isFolder: false,
          fileId: 'user-bob-file-0', // Bob Marley chord archive
        },
      ],
    },
    {
      id: 'playground-root-folder-2',
      name: 'Dynamic Folder B',
      isFolder: true,
      icon: 'fas fa-folder',
      children: [
        {
          id: 'file-ref-3',
          name: "Charlie's script",
          isFolder: false,
          fileId: 'user-charlie-file-0', // Charlie Chaplin comedy movie script
        },
      ],
    },
  ];

  onPopoverShow() {
    console.log('Popover opened: fetching files dynamically...');
    // Simulated async fetch of files database records
    const files = [
      {
        id: 'user-alice-file-0',
        name: 'tax_statement.pdf',
        icon: 'fas fa-file-pdf',
        data: { description: 'Alice Cooper tax declarations (Fetched dynamically)' },
      },
      {
        id: 'user-bob-file-0',
        name: 'reggae_chords.docx',
        icon: 'fas fa-file-word',
        data: { description: 'Bob Marley chord archive (Fetched dynamically)' },
      },
      {
        id: 'user-charlie-file-0',
        name: 'silent_movie_script.pdf',
        icon: 'fas fa-file-pdf',
        data: { description: 'Charlie Chaplin comedy movie script (Fetched dynamically)' },
      },
    ];
    this.fetchedFiles.set(files);
  }

  // --- Handlers ---
  onFileSelected(file: any, popover: any) {
    this.selectedFile.set(file);
    this.initialSelectedFileId.set(file.id); // Save selected file ID to survive popover re-creation!
    popover.hide(); // auto-close popover on file selection!
  }

  onInitialFileChange(event: Event) {
    const fileId = (event.target as HTMLSelectElement).value;
    this.initialSelectedFileId.set(fileId || null);

    if (fileId) {
      const mockFiles: Record<string, string> = {
        'user-alice-file-0': 'tax_statement.pdf',
        'user-bob-file-0': 'reggae_chords.docx',
        'user-charlie-file-0': 'silent_movie_script.pdf',
      };
      this.selectedFile.set({ id: fileId, name: mockFiles[fileId] });
    } else {
      this.selectedFile.set(null);
    }
  }
}
