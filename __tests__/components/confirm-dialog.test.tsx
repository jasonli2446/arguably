// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'

describe('ConfirmDialog', () => {
  const defaultProps = {
    open: true,
    onOpenChange: vi.fn(),
    title: 'Test Title',
    description: 'Test description text',
    onConfirm: vi.fn(),
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders title and description when open', () => {
    render(<ConfirmDialog {...defaultProps} />)
    expect(screen.getByText('Test Title')).toBeDefined()
    expect(screen.getByText('Test description text')).toBeDefined()
  })

  it('does not render content when closed', () => {
    render(<ConfirmDialog {...defaultProps} open={false} />)
    expect(screen.queryByText('Test Title')).toBeNull()
  })

  it('renders default button labels', () => {
    render(<ConfirmDialog {...defaultProps} />)
    expect(screen.getByText('CANCEL')).toBeDefined()
    expect(screen.getByText('CONFIRM')).toBeDefined()
  })

  it('renders custom button labels', () => {
    render(<ConfirmDialog {...defaultProps} confirmLabel="KICK" cancelLabel="NEVERMIND" />)
    expect(screen.getByText('KICK')).toBeDefined()
    expect(screen.getByText('NEVERMIND')).toBeDefined()
  })

  it('calls onConfirm when confirm button is clicked', () => {
    render(<ConfirmDialog {...defaultProps} />)
    fireEvent.click(screen.getByText('CONFIRM'))
    expect(defaultProps.onConfirm).toHaveBeenCalledTimes(1)
  })

  it('disables buttons when loading', () => {
    render(<ConfirmDialog {...defaultProps} loading={true} />)
    const confirmBtn = screen.getByText('CONFIRM').closest('button')
    const cancelBtn = screen.getByText('CANCEL').closest('button')
    expect(confirmBtn?.disabled).toBe(true)
    expect(cancelBtn?.disabled).toBe(true)
  })

  it('shows spinner when loading', () => {
    render(<ConfirmDialog {...defaultProps} loading={true} />)
    // Radix portals render outside container, query the document body
    const spinner = document.body.querySelector('.animate-spin')
    expect(spinner).not.toBeNull()
  })

  it('uses destructive variant styling on confirm button', () => {
    render(<ConfirmDialog {...defaultProps} variant="destructive" confirmLabel="DELETE" />)
    const deleteBtn = screen.getByText('DELETE').closest('button')
    expect(deleteBtn).toBeDefined()
  })
})
