import type { RouteRecordRaw } from 'vue-router'

export const routes: RouteRecordRaw[] = [
  { path: '/cli-auth', name: 'cli-auth', component: () => import('./CliAuth.vue') },
  { path: '/', name: 'home', component: () => import('./App.vue') },
  { path: '/notes/:id', name: 'note', component: () => import('./App.vue') },
]
