import { expect, test, type Page } from '@playwright/test'
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

  await expect(cloudDialog.getByText('Encryption key rotated. Cloud data is rebuilding.')).toBeVisible()
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

async function remoteStatus(page: Page, noteId: string, keyId: string) {
  return page.evaluate(
    ({ noteId, keyId }) =>
      fetch(`/api/notes/${noteId}`, { headers: { 'X-Vault-Key-Id': keyId } }).then((response) => response.status),
    { noteId, keyId },
  )
}
