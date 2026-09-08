import '@/assets/main.css'
import './custom-css-editor.css'

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import CustomCssEditorApp from './CustomCssEditorApp'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <CustomCssEditorApp />
  </StrictMode>
)
