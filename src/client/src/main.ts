import { createApp } from 'vue'
import { createPinia } from 'pinia'
import './style.css'
import App from './App.vue'

createApp(App).use(createPinia()).mount('#app')

if ('serviceWorker' in navigator)
  window.addEventListener('load', () => void navigator.serviceWorker.register('/sw.js'))
