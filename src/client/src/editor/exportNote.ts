import type { Note } from '../../../shared/note'
import { bareUrls, markdownParser } from './markdown'
import noteExportCss from './noteExport.css?raw'
import tailwindPreflightCss from 'tailwindcss/preflight.css?inline'

type MarkdownExportNote = Pick<Note, 'id' | 'content' | 'tags' | 'resources' | 'createdAt' | 'updatedAt'>
export type MarkdownImport = Omit<MarkdownExportNote, 'id'>

function filename(title: string, extension: string) {
  const stem = title.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-').trim() || 'Untitled'
  return `${stem}.${extension}`
}

function download(content: string, name: string, type: string): void {
  const url = URL.createObjectURL(new Blob([content], { type }))
  const link = document.createElement('a')
  link.href = url
  link.download = name
  document.body.append(link)
  link.click()
  link.remove()
  window.setTimeout(() => URL.revokeObjectURL(url))
}

function renderHtmlBody(markdown: string) {
  const template = document.createElement('template')
  template.innerHTML = markdownParser.tokenizer.render(markdown)
  const walker = document.createTreeWalker(template.content, NodeFilter.SHOW_TEXT)
  const textNodes: Text[] = []

  while (walker.nextNode()) {
    const text = walker.currentNode as Text
    if (!text.parentElement?.closest('a, code, pre') && bareUrls(text.data).length) textNodes.push(text)
  }

  for (const text of textNodes) {
    const fragment = document.createDocumentFragment()
    const urls = bareUrls(text.data)
    let offset = 0

    for (const url of urls) {
      fragment.append(text.data.slice(offset, url.from))
      const link = document.createElement('a')
      link.href = url.href
      link.textContent = url.href
      fragment.append(link)
      offset = url.to
    }

    fragment.append(text.data.slice(offset))
    text.replaceWith(fragment)
  }

  return template.innerHTML
}

function escapeHtml(text: string) {
  return text.replace(/[&<>"']/g, (character) => {
    const entities: Record<string, string> = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
    }
    return entities[character]
  })
}

export function exportMarkdown(content: string, title: string): void {
  download(content, filename(title, 'md'), 'text/markdown;charset=utf-8')
}

export function renderMarkdownWithMetadata(note: MarkdownExportNote): string {
  const metadata = [
    `uuid: ${JSON.stringify(note.id)}`,
    `tags: ${JSON.stringify(note.tags)}`,
    `resources: ${JSON.stringify(note.resources)}`,
    `createdAt: ${note.createdAt}`,
    `updatedAt: ${note.updatedAt}`,
  ].join('\n')
  return `---\n${metadata}\n---\n\n${note.content}`
}

export function exportMarkdownWithMetadata(note: MarkdownExportNote, title: string): void {
  download(renderMarkdownWithMetadata(note), filename(title, 'md'), 'text/markdown;charset=utf-8')
}

export function parseMarkdownImport(source: string): MarkdownImport {
  const now = Date.now()
  const plain = { content: source, tags: [], resources: [], createdAt: now, updatedAt: now }
  const frontMatter = source.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/)
  if (!frontMatter) return plain

  const metadata: Record<string, string> = {}
  for (const line of frontMatter[1].split(/\r?\n/)) {
    const separator = line.indexOf(':')
    if (separator !== -1) metadata[line.slice(0, separator)] = line.slice(separator + 1).trim()
  }
  if (!['uuid', 'tags', 'resources', 'createdAt', 'updatedAt'].some((key) => key in metadata)) return plain

  try {
    const tags = JSON.parse(metadata.tags ?? '[]') as unknown
    const resources = JSON.parse(metadata.resources ?? '[]') as unknown
    if (!Array.isArray(tags) || !tags.every((tag) => typeof tag === 'string') || !Array.isArray(resources)) return plain

    const createdAt = Number(metadata.createdAt)
    const updatedAt = Number(metadata.updatedAt)
    return {
      content: source.slice(frontMatter[0].length).replace(/^\r?\n/, ''),
      tags,
      resources: resources as Note['resources'],
      createdAt: Number.isFinite(createdAt) ? createdAt : now,
      updatedAt: Number.isFinite(updatedAt) ? updatedAt : now,
    }
  } catch {
    return plain
  }
}

export function renderHtml(content: string, title: string): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)}</title>
  <style>
${tailwindPreflightCss}
${noteExportCss}
  </style>
</head>
<body>
  <article class="note-content">
${renderHtmlBody(content)}
  </article>
</body>
</html>
`
}

export function exportHtml(content: string, title: string): void {
  download(renderHtml(content, title), filename(title, 'html'), 'text/html;charset=utf-8')
}
