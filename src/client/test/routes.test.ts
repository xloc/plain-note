import { expect, test } from 'vite-plus/test'
import { createMemoryHistory, createRouter } from 'vue-router'
import { routes } from '../src/routes.ts'

test('matches a note UUID as the note route parameter', () => {
  const router = createRouter({ history: createMemoryHistory(), routes })
  const route = router.resolve('/notes/550e8400-e29b-41d4-a716-446655440000')

  expect(route.name).toBe('note')
  expect(route.params.id).toBe('550e8400-e29b-41d4-a716-446655440000')
})
