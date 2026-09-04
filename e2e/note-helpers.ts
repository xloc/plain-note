import { expect, type Locator, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'

const markdownFeatureTest = readFileSync('e2e/markdown-feature-test.md', 'utf8')
const demo = process.env.PLAYWRIGHT_DEMO === '1'
const primaryModifier = process.platform === 'darwin' ? 'Meta' : 'Control'

export async function pauseForDemo(page: Page, duration = 700) {
  if (demo) await page.waitForTimeout(duration)
}

export async function typeText(editor: Locator, text: string) {
  await editor.pressSequentially(text, { delay: demo ? 30 : 0 })
}

export async function focusDocument(editorSurface: Locator) {
  await editorSurface.click({ position: { x: 200, y: 160 } })
}

export async function writeLoremNote(editor: Locator, editorSurface: Locator) {
  await focusDocument(editorSurface)
  await typeText(editor, '# ')
  await typeText(editor, 'Lorem Ipsum')
  await editor.press('Enter')
  await typeText(editor, 'Lorem ipsum dolor sit amet, ')
  await editor.press(`${primaryModifier}+b`)
  await typeText(editor, 'consectetur adipiscing elit')
  await editor.press(`${primaryModifier}+b`)
  await typeText(editor, '.')
  await editor.press('Enter')
  await typeText(editor, '## ')
  await typeText(editor, 'Markdown Examples')
  await editor.press('Enter')
  await typeText(editor, '- ')
  await typeText(editor, 'Headings organize the page')
  await editor.press('Enter')
  await typeText(editor, 'Lists keep ideas concise')
  await editor.press('Enter')
  await typeText(editor, 'Inline code: `const note = "local-first"`')
}

export async function importMarkdown(page: Page) {
  const noteList = page.locator('aside')
  const dataTransfer = await page.evaluateHandle((content) => {
    const transfer = new DataTransfer()
    transfer.items.add(new File([content], 'markdown-feature-test.md', { type: 'text/markdown' }))
    return transfer
  }, markdownFeatureTest)

  await noteList.dispatchEvent('dragenter', { dataTransfer })
  await noteList.dispatchEvent('dragover', { dataTransfer })
  await expect(page.getByText('Drop Markdown to import')).toBeVisible()
  await pauseForDemo(page, 1_000)
  await noteList.dispatchEvent('drop', { dataTransfer })
  await dataTransfer.dispose()
}
