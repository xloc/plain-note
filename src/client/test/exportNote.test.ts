import { expect, test } from 'vite-plus/test'
import { parseMarkdownImport, renderMarkdownWithMetadata } from '../src/editor/exportNote.ts'

test('imports Markdown metadata without preserving the note UUID or resource references', () => {
  const source = renderMarkdownWithMetadata({
    id: 'old-uuid',
    content: '# Imported note',
    tags: ['imported'],
    resources: [{ id: 'resource-id', name: 'image.png', mime: 'image/png', size: 42, createdAt: 100 }],
    createdAt: 100,
    updatedAt: 200,
  })

  expect(source).toContain('uuid: "old-uuid"')
  expect(parseMarkdownImport(source)).toEqual({
    content: '# Imported note',
    tags: ['imported'],
    resources: [],
    createdAt: 100,
    updatedAt: 200,
  })
})

test('replaces invalid imported timestamps', () => {
  const before = Date.now()
  const imported = parseMarkdownImport('---\ncreatedAt: -1\nupdatedAt: 1.5\n---\n\nImported')

  expect(imported.createdAt).toBeGreaterThanOrEqual(before)
  expect(imported.updatedAt).toBeGreaterThanOrEqual(before)
})
