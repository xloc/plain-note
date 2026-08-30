import { createApp } from 'vue'
import { createPinia } from 'pinia'
import './style.css'
import Root from './Root.vue'
import { router } from './router'

createApp(Root).use(createPinia()).use(router).mount('#app')

if ('serviceWorker' in navigator) {
  if (import.meta.env.PROD) {
    window.addEventListener('load', () => void navigator.serviceWorker.register('/sw.js'))
  } else {
    void navigator.serviceWorker.getRegistration().then((registration) => registration?.unregister())
  }
}
