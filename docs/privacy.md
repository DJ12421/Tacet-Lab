# Privacy Boundary

## Data that stays local

- Shared WuWa video frames.
- Imported screenshots.
- OCR text and confidence values.
- Echo inventory, assignments, builds, teams, actions, buffs, and preferences.
- Exported PNG cards and JSON backups until the user chooses where to save or share them.

## Browser permissions

The scanner calls `navigator.mediaDevices.getDisplayMedia` only after the user selects **Share WuWa window**. The browser controls the permission prompt and selected surface. Audio is explicitly disabled. Tacet Lab cannot start capture silently.

Stopping capture calls `stop()` on every media track and disconnects the video element. Navigating away from the scanner also stops active tracks.

## Network behavior

The application has no API, account service, advertising system, cloud sync, or image-upload endpoint. The published site uses Cloudflare Web Analytics to report aggregate page views, visits, referrers, and browser performance. Its beacon does not use cookies or access local storage, session storage, or IndexedDB. Cloudflare receives the source IP address as part of ordinary request handling, then states that it discards the address at the nearest data center rather than storing it in its core databases or logs. The beacon does not receive Echo inventory, builds, screenshots, shared-window frames, OCR results, preferences, or exported files.

Catalog artwork is loaded from Nanoka, and opening a character loadout downloads that character's Spine skeleton, atlas, and texture from Nanoka for local browser rendering. Tesseract.js may fetch its worker, WASM runtime, and English language model from its configured public distribution hosts on the first OCR run. The PWA caches OCR resources after they are requested; other remote assets rely on the browser's normal HTTP cache.

## User controls

- Every OCR candidate requires approval before persistence.
- Individual Echoes can be edited or deleted.
- A full local JSON backup can be exported and restored.
- **Delete local data** resets IndexedDB to the empty seeded application state.
- Privacy mode removes the display name from exported build cards.
