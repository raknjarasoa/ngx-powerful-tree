import { Route } from '@angular/router';

export const appRoutes: Route[] = [
  {
    path: '',
    pathMatch: 'full',
    loadComponent: () => import('./home/home').then((m) => m.HomeComponent),
  },
  {
    path: 'playground',
    loadComponent: () => import('./playground/playground').then((m) => m.PlaygroundComponent),
  },
  {
    path: 'full',
    loadComponent: () => import('./playground/full').then((m) => m.FullComponent),
  },
  {
    path: 'chips',
    loadComponent: () => import('./chips/chips').then((m) => m.ChipsComponent),
  },
  { path: '**', redirectTo: '' },
];
