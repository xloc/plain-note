import { expect, test, type Locator, type Page } from '@playwright/test'
import { focusDocument, importMarkdown, pauseForDemo, typeText, writeLoremNote } from './note-helpers'

const initialKey = 'pn1-11111-11111-11111-11111-11111-11111-11'

test.beforeEach(async ({ page }) => {
  await page.addInitScript((key) => localStorage.setItem('plain-note:vault-key', key), initialKey)
})

test('creates, edits, navigates, and reloads notes', async ({ page }) => {
  const editor = page.locator('.ProseMirror')
  const editorSurface = page.locator('.editor-scroll')
  const noteList = page.locator('aside')

  await test.step('Create a formatted Lorem Ipsum note', async () => {
    await page.goto('/')
    await expect(editor).toBeEditable()
    await writeLoremNote(editor, editorSurface)

    await expect(editor.locator('h1')).toHaveText('Lorem Ipsum')
    await expect(editor.locator('strong')).toHaveText('consectetur adipiscing elit')
    await expect(editor.locator('h2')).toHaveText('Markdown Examples')
    await expect(editor.locator('li')).toHaveCount(3)
    await expect(editor.locator('code')).toHaveText('const note = "local-first"')
    await expect(noteList.getByText('Lorem Ipsum', { exact: true })).toBeVisible()
    await expect(page).toHaveURL(/\/notes\/[0-9a-f-]{36}$/)
    await pauseForDemo(page)
  })

  const loremUrl = page.url()

  await test.step('Create a second note', async () => {
    await page.locator('article header').getByTitle('New note').click()
    await expect(page).not.toHaveURL(loremUrl)
    await focusDocument(editorSurface)
    await typeText(editor, '# ')
    await typeText(editor, 'Dolor Sit Amet')
    await editor.press('Enter')
    await typeText(editor, 'Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.')

    await expect(editor.locator('h1')).toHaveText('Dolor Sit Amet')
    await expect(noteList.getByText('Dolor Sit Amet', { exact: true })).toBeVisible()
    await pauseForDemo(page)
  })

  const dolorUrl = page.url()

  await test.step('Import the Markdown feature document', async () => {
    await importMarkdown(page)

    await expect(editor.locator('h1').first()).toHaveText('Markdown Feature Test')
    await expect(editor).toContainText('CommonMark')
    await expect(noteList.getByText('Markdown Feature Test', { exact: true })).toBeVisible()
    await expect(page).not.toHaveURL(dolorUrl)
    await pauseForDemo(page)
  })

  const markdownUrl = page.url()

  await test.step('Navigate with the note list and browser history', async () => {
    await noteList.getByText('Lorem Ipsum', { exact: true }).click()
    await expect(page).toHaveURL(loremUrl)
    await expect(editor.locator('h1')).toHaveText('Lorem Ipsum')

    await noteList.getByText('Markdown Feature Test', { exact: true }).click()
    await expect(page).toHaveURL(markdownUrl)

    await page.goBack()
    await expect(page).toHaveURL(loremUrl)
    await expect(editor.locator('h1')).toHaveText('Lorem Ipsum')

    await page.goForward()
    await expect(page).toHaveURL(markdownUrl)
    await expect(editor.locator('h1').first()).toHaveText('Markdown Feature Test')
    await pauseForDemo(page)
  })

  await test.step('Reload the selected note from browser storage', async () => {
    await page.reload()
    await expect(page).toHaveURL(markdownUrl)
    await expect(editor.locator('h1').first()).toHaveText('Markdown Feature Test')

    await expect(noteList.getByText('Lorem Ipsum', { exact: true })).toBeVisible()
    await expect(noteList.getByText('Dolor Sit Amet', { exact: true })).toBeVisible()
    await expect(noteList.getByText('Markdown Feature Test', { exact: true })).toBeVisible()

    await noteList.getByText('Lorem Ipsum', { exact: true }).click()
    await expect(editor.locator('strong')).toHaveText('consectetur adipiscing elit')
    await expect(editor.locator('li')).toHaveCount(3)
    await pauseForDemo(page, 1_200)
  })
})

test('synchronizes an encrypted cloud envelope', async ({ page }) => {
  await page.goto('/')
  await page.locator('article header').getByTitle('Offline').click()
  const dialog = page.getByRole('dialog')
  await dialog.getByRole('button', { name: 'Sign in to view sessions' }).click()
  await expect(dialog.getByRole('button', { name: 'Sync now' })).toBeVisible()
  await dialog.getByTitle('Close').click()

  const editor = page.locator('.ProseMirror')
  await focusDocument(page.locator('.editor-scroll'))
  await typeText(editor, 'Server must not see this sentence')
  await expect(page.locator('article header').getByTitle('Synced')).toBeVisible()

  const noteId = new URL(page.url()).pathname.split('/').at(-1)
  const remote = await page.evaluate(async (id) => {
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new Uint8Array(32)))
    let binary = ''
    for (const byte of digest) binary += String.fromCharCode(byte)
    const keyId = btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
    return fetch(`/api/notes/${id}`, { headers: { 'X-Vault-Key-Id': keyId } }).then((response) => response.json())
  }, noteId)

  expect(remote.note.resourceIds).toEqual([])
  expect(remote.note.encrypted).toBeTruthy()
  expect(JSON.stringify(remote)).not.toContain('Server must not see this sentence')
})

test('warns before rebuilding without a local attachment and signs out other sessions', async ({ browser, page }) => {
  await page.goto('/')
  await page.locator('article header').getByTitle('Offline').click()
  const cloudDialog = page.getByRole('dialog')
  const firstVaultRequest = page.waitForRequest((request) => request.headers()['x-vault-key-id'] !== undefined)
  await cloudDialog.getByRole('button', { name: 'Sign in to view sessions' }).click()
  const keyId = (await firstVaultRequest).headers()['x-vault-key-id']!
  await cloudDialog.getByTitle('Close').click()

  const editor = page.locator('.ProseMirror')
  await page.locator('article header').getByTitle('New note').click()
  await focusDocument(page.locator('.editor-scroll'))
  await typeText(editor, '# Rebuild warning')
  const transfer = await page.evaluateHandle(() => {
    const value = new DataTransfer()
    value.items.add(new File(['cloud-only bytes'], 'cloud-only.txt', { type: 'text/plain' }))
    return value
  })
  await page.locator('.editor-scroll').dispatchEvent('drop', { dataTransfer: transfer })
  await transfer.dispose()
  await expect(editor.getByText('cloud-only.txt')).toBeVisible()
  await expect(page.locator('article header').getByTitle('Synced')).toBeVisible()

  const noteId = new URL(page.url()).pathname.split('/').at(-1)!
  const before = await encryptedNote(page, noteId, keyId)
  const resourceId = before.resourceIds[0]!
  const otherDevice = await browser.newContext()
  await otherDevice.addInitScript((key) => localStorage.setItem('plain-note:vault-key', key), initialKey)
  const otherPage = await otherDevice.newPage()

  try {
    await otherPage.goto('/')
    await otherPage.locator('article header').getByTitle('Offline').click()
    const otherCloudDialog = otherPage.getByRole('dialog')
    await otherCloudDialog.getByRole('button', { name: 'Sign in to view sessions' }).click()
    await otherCloudDialog.getByTitle('Close').click()
    await expect(otherPage.locator('article header').getByTitle('Synced')).toBeVisible()
    expect(await authStatus(page)).toBe(200)
    expect(await authStatus(otherPage)).toBe(200)

    await deleteLocalResource(page, noteId, resourceId)

    await page.locator('article header').getByTitle('Synced').click()
    const rebuildButton = cloudDialog.getByRole('button', { name: 'Rebuild cloud from this device' })
    let rebuildRequests = 0
    page.on('request', (request) => {
      if (new URL(request.url()).pathname === '/api/vault/rebuild') rebuildRequests++
    })

    await answerRebuildDialogs(page, rebuildButton, false)

    expect(rebuildRequests).toBe(0)
    expect(await encryptedNote(page, noteId, keyId)).toMatchObject({
      revision: before.revision,
      updatedAt: before.updatedAt,
      resourceIds: [resourceId],
    })
    expect(await remoteResourceStatus(page, noteId, resourceId, keyId)).toBe(200)
    expect((await localNote(page, noteId)).resources).toHaveLength(1)

    const rebuilt = page.waitForResponse(
      (response) => new URL(response.url()).pathname === '/api/vault/rebuild' && response.ok(),
    )
    await answerRebuildDialogs(page, rebuildButton, true)
    await rebuilt
    await expect(cloudDialog.getByText('Cloud data rebuilt from this device.')).toBeVisible()

    expect(rebuildRequests).toBe(1)
    const after = await encryptedNote(page, noteId, keyId)
    expect(after).toMatchObject({
      revision: before.revision,
      updatedAt: before.updatedAt,
      resourceIds: [],
    })
    expect(await remoteResourceStatus(page, noteId, resourceId, keyId)).toBe(404)
    expect((await localNote(page, noteId)).resources).toEqual([])
    expect(await authStatus(page)).toBe(200)

    const rejectedUpload = await otherPage.evaluate(
      async ({ noteId, keyId, note }) => {
        const response = await fetch(`/api/notes/${noteId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json', 'X-Vault-Key-Id': keyId },
          body: JSON.stringify({
            baseRevision: note.revision,
            note: { ...note, revision: crypto.randomUUID(), updatedAt: note.updatedAt + 1 },
          }),
        })
        return { status: response.status, body: await response.json() }
      },
      { noteId, keyId, note: after },
    )
    expect(rejectedUpload).toEqual({ status: 401, body: { error: 'session_required' } })
    expect(await encryptedNote(page, noteId, keyId)).toEqual(after)

    await otherPage.reload()
    await otherPage.locator('article header').getByTitle('Offline').click()
    await expect(otherPage.getByRole('dialog').getByRole('button', { name: 'Sign in to view sessions' })).toBeVisible()
  } finally {
    await otherDevice.close()
  }
})

test('rotates the encryption key and rebuilds the cloud vault', async ({ browser, page }) => {
  await page.goto('/')
  await page.locator('article header').getByTitle('Offline').click()
  const cloudDialog = page.getByRole('dialog')
  const firstVaultRequest = page.waitForRequest((request) => request.headers()['x-vault-key-id'] !== undefined)
  await cloudDialog.getByRole('button', { name: 'Sign in to view sessions' }).click()
  const oldKeyId = (await firstVaultRequest).headers()['x-vault-key-id']!
  await expect(cloudDialog.getByRole('button', { name: 'Sync now' })).toBeEnabled()
  await cloudDialog.getByTitle('Close').click()

  const editor = page.locator('.ProseMirror')
  await page.locator('article header').getByTitle('New note').click()
  await focusDocument(page.locator('.editor-scroll'))
  await typeText(editor, '# Rotated vault')
  await editor.press('Enter')
  await typeText(editor, 'The trusted device keeps this plaintext.')
  const noteId = new URL(page.url()).pathname.split('/').at(-1)!

  const transfer = await page.evaluateHandle(() => {
    const value = new DataTransfer()
    value.items.add(new File(['resource survives rotation'], 'rotation-proof.txt', { type: 'text/plain' }))
    return value
  })
  await page.locator('.editor-scroll').dispatchEvent('drop', { dataTransfer: transfer })
  await transfer.dispose()
  await expect(editor.getByText('rotation-proof.txt')).toBeVisible()
  await expect(page.locator('article header').getByTitle('Synced')).toBeVisible()

  const before = await encryptedVault(page, noteId, oldKeyId)
  expect(before.note.resourceIds).toHaveLength(1)
  expect(JSON.stringify(before)).not.toContain('The trusted device keeps this plaintext.')

  await page.locator('article header').getByTitle('Synced').click()
  page.once('dialog', (dialog) => dialog.accept())
  const rebuildRequest = page.waitForRequest(
    (request) => new URL(request.url()).pathname === '/api/vault/rebuild' && request.method() === 'POST',
  )
  await cloudDialog.getByRole('button', { name: 'Rotate key' }).click()
  const newKeyId = (await rebuildRequest).postDataJSON().keyId as string

  await expect(cloudDialog.getByText('Encryption key rotated and cloud data rebuilt.')).toBeVisible()
  const newKey = (await cloudDialog.locator('.font-mono').textContent())!.trim()
  expect(newKey).not.toBe(initialKey)
  expect(newKeyId).not.toBe(oldKeyId)
  await cloudDialog.getByTitle('Close').click()
  await expect(page.locator('article header').getByTitle('Synced')).toBeVisible()

  const after = await encryptedVault(page, noteId, newKeyId)
  expect(after.note).toMatchObject({
    id: before.note.id,
    revision: before.note.revision,
    updatedAt: before.note.updatedAt,
    resourceIds: before.note.resourceIds,
  })
  expect(after.note.encrypted).not.toBe(before.note.encrypted)
  expect(after.resource).not.toEqual(before.resource)
  expect(await remoteStatus(page, noteId, oldKeyId)).toBe(403)
  await expect(editor).toContainText('The trusted device keeps this plaintext.')
  await expect(editor.getByText('rotation-proof.txt')).toBeVisible()

  const otherDevice = await browser.newContext()
  try {
    await otherDevice.addInitScript((key) => {
      if (!localStorage.getItem('plain-note:vault-key')) localStorage.setItem('plain-note:vault-key', key)
    }, initialKey)
    const otherPage = await otherDevice.newPage()
    await otherPage.goto('/')
    await otherPage.locator('article header').getByTitle('Offline').click()
    const otherCloudDialog = otherPage.getByRole('dialog')
    const rejectedSync = otherPage.waitForResponse(
      (response) => response.status() === 403 && response.request().headers()['x-vault-key-id'] === oldKeyId,
    )
    await otherCloudDialog.getByRole('button', { name: 'Sign in to view sessions' }).click()
    await rejectedSync

    otherPage.on('dialog', (dialog) => {
      if (dialog.type() === 'prompt') void dialog.accept(newKey)
      else void dialog.accept()
    })
    const reloaded = otherPage.waitForEvent('load')
    await otherCloudDialog.getByRole('button', { name: 'Change key' }).click()
    await reloaded
    await otherPage.getByRole('dialog').getByTitle('Close').click()
    await expect(otherPage.locator('aside').getByText('Rotated vault', { exact: true })).toBeVisible()
    await expect(otherPage.locator('article header').getByTitle('Synced')).toBeVisible()
  } finally {
    await otherDevice.close()
  }
})

async function encryptedVault(page: Page, noteId: string, keyId: string) {
  return page.evaluate(
    async ({ noteId, keyId }) => {
      const response = await fetch(`/api/notes/${noteId}`, { headers: { 'X-Vault-Key-Id': keyId } })
      if (!response.ok) throw new Error(`Reading encrypted note failed with ${response.status}`)
      const { note } = (await response.json()) as {
        note: { id: string; revision: string; updatedAt: number; resourceIds: string[]; encrypted: string }
      }
      const resourceResponse = await fetch(`/api/notes/${noteId}/resources/${note.resourceIds[0]}`, {
        headers: { 'X-Vault-Key-Id': keyId },
      })
      if (!resourceResponse.ok) throw new Error(`Reading encrypted resource failed with ${resourceResponse.status}`)
      return { note, resource: Array.from(new Uint8Array(await resourceResponse.arrayBuffer())) }
    },
    { noteId, keyId },
  )
}

async function encryptedNote(page: Page, noteId: string, keyId: string) {
  return page.evaluate(
    async ({ noteId, keyId }) => {
      const response = await fetch(`/api/notes/${noteId}`, { headers: { 'X-Vault-Key-Id': keyId } })
      if (!response.ok) throw new Error(`Reading encrypted note failed with ${response.status}`)
      return (await response.json()).note as {
        id: string
        revision: string
        updatedAt: number
        resourceIds: string[]
        encrypted: string
      }
    },
    { noteId, keyId },
  )
}

async function answerRebuildDialogs(page: Page, button: Locator, continueRebuild: boolean) {
  const initialDialog = page.waitForEvent('dialog')
  const clicked = button.click()
  const initial = await initialDialog
  expect(initial.message()).toContain('Permanently replace all cloud notes and attachments')

  const missingDialog = page.waitForEvent('dialog')
  await initial.accept()
  const missing = await missingDialog
  expect(missing.message()).toContain('Some attachments are not stored on this device:')
  expect(missing.message()).toContain('• cloud-only.txt')
  if (continueRebuild) await missing.accept()
  else await missing.dismiss()
  await clicked
}

async function deleteLocalResource(page: Page, noteId: string, resourceId: string) {
  await page.evaluate(
    ({ noteId, resourceId }) =>
      new Promise<void>((resolve, reject) => {
        const opened = indexedDB.open('plain-note', 5)
        opened.onerror = () => reject(opened.error)
        opened.onsuccess = () => {
          const transaction = opened.result.transaction('resources', 'readwrite')
          transaction.objectStore('resources').delete([noteId, resourceId])
          transaction.oncomplete = () => {
            opened.result.close()
            resolve()
          }
          transaction.onerror = () => reject(transaction.error)
        }
      }),
    { noteId, resourceId },
  )
}

async function localNote(page: Page, noteId: string) {
  return page.evaluate(
    (noteId) =>
      new Promise<{ resources: { id: string }[] }>((resolve, reject) => {
        const opened = indexedDB.open('plain-note', 5)
        opened.onerror = () => reject(opened.error)
        opened.onsuccess = () => {
          const request = opened.result.transaction('notes').objectStore('notes').get(noteId)
          request.onsuccess = () => {
            opened.result.close()
            resolve(request.result)
          }
          request.onerror = () => reject(request.error)
        }
      }),
    noteId,
  )
}

async function remoteResourceStatus(page: Page, noteId: string, resourceId: string, keyId: string) {
  return page.evaluate(
    ({ noteId, resourceId, keyId }) =>
      fetch(`/api/notes/${noteId}/resources/${resourceId}`, {
        headers: { 'X-Vault-Key-Id': keyId },
      }).then((response) => response.status),
    { noteId, resourceId, keyId },
  )
}

async function remoteStatus(page: Page, noteId: string, keyId: string) {
  return page.evaluate(
    ({ noteId, keyId }) =>
      fetch(`/api/notes/${noteId}`, { headers: { 'X-Vault-Key-Id': keyId } }).then((response) => response.status),
    { noteId, keyId },
  )
}

async function authStatus(page: Page) {
  return page.evaluate(() => fetch('/api/auth/status').then((response) => response.status))
}
