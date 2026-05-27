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
  { path: '**', redirectTo: '' },
];
