'use client'

import * as Dialog from '@radix-ui/react-dialog'
import { Button } from '@/components/ui/button'
import { Loader2, X } from 'lucide-react'

/** Props for the reusable confirmation dialog. */
export interface ConfirmDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description: string
  confirmLabel?: string
  cancelLabel?: string
  variant?: 'default' | 'destructive'
  loading?: boolean
  onConfirm: () => void | Promise<void>
}

/** Confirmation modal with optional destructive styling and loading state. */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = 'CONFIRM',
  cancelLabel = 'CANCEL',
  variant = 'default',
  loading = false,
  onConfirm,
}: ConfirmDialogProps) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-full max-w-md -translate-x-1/2 -translate-y-1/2 border-2 border-white/20 bg-gray-900 p-6 shadow-[6px_6px_0px_rgba(0,0,0,0.3)]">
          <div className="flex items-center justify-between mb-4">
            <Dialog.Title className="text-lg font-bold debate-title text-white">
              {title}
            </Dialog.Title>
            <Dialog.Close asChild>
              <button className="text-gray-400 hover:text-white transition-colors">
                <X className="w-5 h-5" />
              </button>
            </Dialog.Close>
          </div>
          <Dialog.Description className="text-gray-400 debate-mono text-sm mb-6">
            {description}
          </Dialog.Description>
          <div className="flex justify-end gap-3">
            <Dialog.Close asChild>
              <Button variant="outline" size="sm" className="debate-button" disabled={loading}>
                {cancelLabel}
              </Button>
            </Dialog.Close>
            <Button
              variant={variant === 'destructive' ? 'destructive' : 'default'}
              size="sm"
              className="debate-button"
              onClick={onConfirm}
              disabled={loading}
            >
              {loading && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              {confirmLabel}
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
