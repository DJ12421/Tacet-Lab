import { fireEvent, render, screen, within } from '@testing-library/react'
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
    expect(await screen.findByRole('heading', { level: 1 })).toHaveTextContent(/WUTHERING WAVES.*OPTIMIZER/)
    const navigation = within(screen.getByRole('complementary', { name: 'Primary navigation' }).querySelector('.desktop-nav') as HTMLElement)
    fireEvent.click(navigation.getByRole('button', { name: /^Echoes$/ }))
    expect(await screen.findByText('Your Echoes', {}, { timeout: 5_000 })).toBeInTheDocument()
    fireEvent.click(navigation.getByRole('button', { name: /Scanner/ }))
    expect(await screen.findByText('Scan Echoes. Skip the typing.', {}, { timeout: 5_000 })).toBeInTheDocument()
  }, 15_000)

  it('warns before leaving a scanner session with unsaved Echo data', async () => {
    render(<App/>)
    await screen.findByRole('heading', { level: 1 })
    const navigation = within(screen.getByRole('complementary', { name: 'Primary navigation' }).querySelector('.desktop-nav') as HTMLElement)
    fireEvent.click(navigation.getByRole('button', { name: /Scanner/ }))
    fireEvent.click(await screen.findByRole('button', { name: /Enter manually/i }, { timeout: 5_000 }))
    expect(await screen.findByRole('heading', { name: /^Review your scans 1$/i })).toBeInTheDocument()

    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    fireEvent.click(navigation.getByRole('button', { name: /^Echoes$/ }))
    expect(screen.getByText('Scan Echoes. Skip the typing.')).toBeInTheDocument()
    expect(confirm).toHaveBeenCalledWith('Leave the scanner? Screen sharing will stop and all scanned Echo data that has not been approved and saved will be lost.')

    confirm.mockReturnValue(true)
    fireEvent.click(navigation.getByRole('button', { name: /^Echoes$/ }))
    expect(await screen.findByText('Your Echoes')).toBeInTheDocument()
  }, 15_000)
})
