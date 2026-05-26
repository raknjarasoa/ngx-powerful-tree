import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { NgxPowerfulTree, NgxTreeNode } from 'ngx-powerful-tree';

@Component({
  selector: 'app-home',
  standalone: true,
  imports: [NgxPowerfulTree, RouterLink],
  templateUrl: './home.html',
  styleUrl: './home.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class HomeComponent {
  selectedId = signal<string | null>(null);

  nodes = signal<NgxTreeNode[]>([
    {
      id: 'src',
      name: 'src',
      isFolder: true,
      children: [
        {
          id: 'app',
          name: 'app',
          isFolder: true,
          children: [
            { id: 'app.ts', name: 'app.ts', isFolder: false },
            { id: 'app.html', name: 'app.html', isFolder: false },
            { id: 'app.css', name: 'app.css', isFolder: false },
          ],
        },
        { id: 'main.ts', name: 'main.ts', isFolder: false },
        { id: 'styles.css', name: 'styles.css', isFolder: false },
      ],
    },
    {
      id: 'public',
      name: 'public (Locked)',
      isFolder: true,
      locked: true,
      children: [
        { id: 'favicon.ico', name: 'favicon.ico', isFolder: false },
        { id: 'robots.txt', name: 'robots.txt', isFolder: false },
      ],
    },
    { id: 'package.json', name: 'package.json', isFolder: false },
    { id: 'tsconfig.json', name: 'tsconfig.json', isFolder: false },
    { id: 'README.md', name: 'README.md', isFolder: false },
  ]);

  onSelectionChanged(selected: string[]) {
    this.selectedId.set(selected[0] ?? null);
  }
}
