import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { Toaster } from 'react-hot-toast'
import App from './App'
import './styles/globals.css'

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
      <Toaster
        position="top-right"
        toastOptions={{
          duration: 3000,
          style: {
            background: '#1f2436',
            color: '#f0f2f8',
            border: '0.5px solid rgba(255,255,255,0.13)',
            borderRadius: '10px',
            fontSize: '13px',
          },
        }}
      />
    </BrowserRouter>
  </React.StrictMode>
)
