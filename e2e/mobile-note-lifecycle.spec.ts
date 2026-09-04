import { expect, test } from '@playwright/test'
import { focusDocument, importMarkdown, pauseForDemo, typeText, writeLoremNote } from './note-helpers'

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() =>
    localStorage.setItem('plain-note:vault-key', 'pn1-11111-11111-11111-11111-11111-11111-11'),
  )
})

test('uses the mobile note list and editor workflow', async ({ page }) => {
  const noteList = page.locator('aside')
  const editorScreen = page.locator('article')
  const editor = page.locator('.ProseMirror')
  const editorSurface = page.locator('.editor-scroll')
  const showNotes = () => editorScreen.getByTitle('Notes')

  await test.step('Start from the mobile note list', async () => {
    await page.goto('/')
    await expect(noteList.getByRole('heading', { name: 'Notes' })).toBeVisible()
    await expect(noteList.getByText('Untitled', { exact: true })).toBeVisible()
    await expect(editorScreen).toBeHidden()
    await pauseForDemo(page)
  })

  await test.step('Open and edit the first note', async () => {
    await noteList.getByText('Untitled', { exact: true }).click()
    await expect(noteList).toBeHidden()
    await expect(editorScreen).toBeVisible()
    await expect(showNotes()).toBeVisible()
    await expect(editorScreen.getByTitle('Attach files')).toBeVisible()

    await writeLoremNote(editor, editorSurface)
    await expect(editor.locator('h1')).toHaveText('Lorem Ipsum')
    await expect(editor.locator('strong')).toHaveText('consectetur adipiscing elit')
    await expect(editor.locator('li')).toHaveCount(3)
    await pauseForDemo(page)
  })

  const loremUrl = page.url()

  await test.step('Return to the list and create another note', async () => {
    await showNotes().click()
    await expect(noteList).toBeVisible()
    await expect(editorScreen).toBeHidden()
    await expect(noteList.getByText('Lorem Ipsum', { exact: true })).toBeVisible()

    await noteList.locator('footer').getByTitle('New note').click()
    await expect(noteList).toBeHidden()
    await expect(page).not.toHaveURL(loremUrl)
    await focusDocument(editorSurface)
    await typeText(editor, '# ')
    await typeText(editor, 'Dolor Sit Amet')
    await editor.press('Enter')
    await typeText(editor, 'Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.')

    await expect(editor.locator('h1')).toHaveText('Dolor Sit Amet')
    await pauseForDemo(page)
  })

  const dolorUrl = page.url()

  await test.step('Navigate between mobile notes with browser history', async () => {
    await showNotes().click()
    await noteList.getByText('Lorem Ipsum', { exact: true }).click()
    await expect(page).toHaveURL(loremUrl)
    await expect(editor.locator('h1')).toHaveText('Lorem Ipsum')

    await page.goBack()
    await expect(page).toHaveURL(dolorUrl)
    await expect(editor.locator('h1')).toHaveText('Dolor Sit Amet')

    await page.goForward()
    await expect(page).toHaveURL(loremUrl)
    await expect(editor.locator('h1')).toHaveText('Lorem Ipsum')
    await pauseForDemo(page)
  })

  await test.step('Import Markdown from the full-screen note list', async () => {
    await showNotes().click()
    await importMarkdown(page)

    await expect(noteList).toBeHidden()
    await expect(editor.locator('h1').first()).toHaveText('Markdown Feature Test')
    await expect(editor).toContainText('CommonMark')
    await pauseForDemo(page)
  })

  const markdownUrl = page.url()

  await test.step('Reload into the editor and return to the list', async () => {
    await page.reload()
    await expect(page).toHaveURL(markdownUrl)
    await expect(noteList).toBeHidden()
    await expect(editor.locator('h1').first()).toHaveText('Markdown Feature Test')

    await showNotes().click()
    await expect(noteList).toBeVisible()
    await expect(noteList.getByText('Lorem Ipsum', { exact: true })).toBeVisible()
    await expect(noteList.getByText('Dolor Sit Amet', { exact: true })).toBeVisible()
    await expect(noteList.getByText('Markdown Feature Test', { exact: true })).toBeVisible()
    await pauseForDemo(page, 1_200)
  })
})
