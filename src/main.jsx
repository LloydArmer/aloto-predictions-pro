import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { Toaster } from 'react-hot-toast'
import App from './App'
import './styles/globals.css'
import { initTheme } from './lib/theme'

initTheme()

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
      <Toaster
        position="top-right"
        toastOptions={{
          duration: 3000,
          style: {
            background: 'var(--bg-elevated)',
            color: 'var(--txt-primary)',
            border: '0.5px solid var(--border-med)',
            borderRadius: '10px',
            fontSize: '13px',
          },
        }}
      />
    </BrowserRouter>
  </React.StrictMode>
)
