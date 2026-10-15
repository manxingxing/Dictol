import '../assets/main.css'
import './external-excerpt.css'

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { ExternalExcerptApp } from './ExternalExcerptApp'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ExternalExcerptApp />
  </StrictMode>
)
