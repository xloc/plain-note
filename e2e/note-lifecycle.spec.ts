import { expect, test } from '@playwright/test'
import { focusDocument, importMarkdown, pauseForDemo, typeText, writeLoremNote } from './note-helpers'

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
