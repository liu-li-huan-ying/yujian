import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import './styles/tokens.css'
import './styles/scrollbar.css'
import './styles/base.css'
import './styles/zen.css'

createApp(App).use(createPinia()).mount('#app')
