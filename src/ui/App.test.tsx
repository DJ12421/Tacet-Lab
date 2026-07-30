import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../storage/database'
import App from './App'

describe('application shell', () => {
  beforeEach(async () => {
    window.history.replaceState({}, '', '/home')
    db.close()
    await db.delete()
    await db.open()
  })

  afterEach(() => db.close())

  it('opens the local archive and navigates core workflows', async () => {
    render(<App/>)
    expect(await screen.findByText('Tacet Lab Optimizer')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /^Echoes$/ }))
    expect(await screen.findByText('Echo inventory')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Scanner/ }))
    expect(await screen.findByText('Decode Echo details and build cards', {}, { timeout: 5_000 })).toBeInTheDocument()
  })

  it('warns before leaving a scanner session with unsaved Echo data', async () => {
    render(<App/>)
    await screen.findByText('Tacet Lab Optimizer')
    fireEvent.click(screen.getByRole('button', { name: /Scanner/ }))
    fireEvent.click(await screen.findByRole('button', { name: /add Echo manually/i }, { timeout: 5_000 }))
    expect(await screen.findByRole('heading', { name: /^Scanned Echoes 1$/i })).toBeInTheDocument()

    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    fireEvent.click(screen.getByRole('button', { name: /^Echoes$/ }))
    expect(screen.getByText('Decode Echo details and build cards')).toBeInTheDocument()
    expect(confirm).toHaveBeenCalledWith('Leave the scanner? Screen sharing will stop and all scanned Echo data that has not been approved and saved will be lost.')

    confirm.mockReturnValue(true)
    fireEvent.click(screen.getByRole('button', { name: /^Echoes$/ }))
    expect(await screen.findByText('Echo inventory')).toBeInTheDocument()
  })
})
