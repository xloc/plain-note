import { defaultMarkdownParser } from 'prosemirror-markdown'

export const tokenizer = defaultMarkdownParser.tokenizer.enable('table')
tokenizer.block.ruler.before('paragraph', 'resource', (state, startLine, _endLine, silent) => {
  const start = state.bMarks[startLine] + state.tShift[startLine]
  const end = state.eMarks[startLine]
  const source = state.src.slice(start, end)
  const match = source.match(/^\[((?:\\.|[^\]])*)\]\(resource:([A-Za-z0-9_-]+)\)\s*$/)
  if (!match) return false
  if (silent) return true

  const token = state.push('resource', 'resource', 0)
  token.block = true
  token.map = [startLine, startLine + 1]
  token.meta = {
    id: match[2],
    name: match[1].replace(/\\(.)/g, '$1'),
  }
  state.line = startLine + 1
  return true
})
