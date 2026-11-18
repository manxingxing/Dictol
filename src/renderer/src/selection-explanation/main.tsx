import '@/assets/main.css'
import './selection-explanation.css'

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import { SelectionExplanationApp } from './SelectionExplanationApp'

if (window.dictolSelectionExplanation.chromeMaterial) {
  document.documentElement.dataset.chromeMaterial = window.dictolSelectionExplanation.chromeMaterial
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <SelectionExplanationApp />
  </StrictMode>
)
