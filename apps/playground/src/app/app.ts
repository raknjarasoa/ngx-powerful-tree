import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet, RouterLink, RouterLinkActive],
  template: `
    <nav class="app-nav">
      <a class="brand" routerLink="/">ngx-powerful-tree</a>
      <a routerLink="/" routerLinkActive="active" [routerLinkActiveOptions]="{ exact: true }">
        Home
      </a>
      <a routerLink="/playground" routerLinkActive="active">Playground</a>
      <a routerLink="/full" routerLinkActive="active">Full Showcase</a>
    </nav>
    <router-outlet />
  `,
  styles: [
    `
      :host {
        display: block;
        min-height: 100vh;
      }

      .app-nav {
        display: flex;
        align-items: center;
        gap: 16px;
        padding: 12px 24px;
        border-bottom: 1px solid var(--pg-border, #cbd5e1);
        font-family:
          system-ui,
          -apple-system,
          sans-serif;
        font-size: 0.9rem;
      }

      .app-nav a {
        color: var(--pg-text-muted, #475569);
        text-decoration: none;
        padding: 4px 8px;
        border-radius: 4px;
      }

      .app-nav a.brand {
        font-weight: 700;
        color: var(--pg-text, #0f172a);
        margin-right: auto;
      }

      .app-nav a:hover {
        background: var(--pg-card-bg, #f1f5f9);
      }

      .app-nav a.active {
        color: var(--pg-accent-blue, #2563eb);
        background: rgba(37, 99, 235, 0.08);
      }
    `,
  ],
})
export class AppComponent {}
