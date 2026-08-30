import { onMounted, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useNotesStore } from './stores/notes'

export function useNoteRoute(notes: ReturnType<typeof useNotesStore>) {
  const route = useRoute()
  const router = useRouter()

  function routeNoteId() {
    const id = route.params.id
    return typeof id === 'string' ? id.toLowerCase() : undefined
  }

  function showSelectedNote() {
    if (notes.selectedId) void router.replace({ name: 'note', params: { id: notes.selectedId } })
  }

  function selectRoutedNote() {
    const id = routeNoteId()
    if (id && notes.activeNotes.some((note) => note.id === id)) {
      notes.select(id)
    } else if (notes.ready) {
      showSelectedNote()
    }
  }

  onMounted(async () => {
    await notes.initialize(routeNoteId())
    showSelectedNote()
  })

  watch(() => route.params.id, selectRoutedNote)
  watch(
    () => notes.selectedId,
    () => {
      if (notes.ready) showSelectedNote()
    },
  )

  return {
    openNote: (id: string) => router.push({ name: 'note', params: { id } }),
  }
}
