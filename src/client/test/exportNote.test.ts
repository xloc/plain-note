import { expect, test } from 'vite-plus/test'
import { parseMarkdownImport, renderMarkdownWithMetadata } from '../src/editor/exportNote.ts'

test('round-trips Markdown metadata without preserving the note UUID', () => {
  const source = renderMarkdownWithMetadata({
    id: 'old-uuid',
    content: '# Imported note',
    tags: ['imported'],
    resources: [{ id: 'resource-id', name: 'image.png', mime: 'image/png', size: 42 }],
    createdAt: 100,
    updatedAt: 200,
  })

  expect(source).toContain('uuid: "old-uuid"')
  expect(parseMarkdownImport(source)).toEqual({
    content: '# Imported note',
    tags: ['imported'],
    resources: [{ id: 'resource-id', name: 'image.png', mime: 'image/png', size: 42 }],
    createdAt: 100,
    updatedAt: 200,
  })
})
