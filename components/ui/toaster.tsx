'use client'

import { Toaster as Sonner } from 'sonner'

/** App-level Sonner toast host using the dark debate visual style. */
export function Toaster() {
  return (
    <Sonner
      position="bottom-right"
      theme="dark"
      toastOptions={{
        className: 'debate-mono',
        style: {
          background: 'rgb(17 24 39)',
          border: '2px solid rgba(255,255,255,0.2)',
          boxShadow: '4px 4px 0px rgba(0,0,0,0.3)',
          color: 'white',
        },
      }}
    />
  )
}
