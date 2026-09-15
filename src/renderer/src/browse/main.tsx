import '../assets/main.css'

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowseApp } from './BrowseApp'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowseApp />
  </StrictMode>
)
