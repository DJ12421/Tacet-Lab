import '@testing-library/jest-dom/vitest'
import 'fake-indexeddb/auto'
import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'

if (typeof HTMLMediaElement !== 'undefined') {
  Object.defineProperties(HTMLMediaElement.prototype, {
    pause: { configurable: true, value: () => undefined },
    load: { configurable: true, value: () => undefined }
  })
}

afterEach(cleanup)
