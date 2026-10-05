import { computed, onScopeDispose, ref, shallowRef, watch, type Ref } from 'vue'
import type { LocalNote } from './db'

export function useNoteSearch(source: Ref<LocalNote[]>, query: Ref<string>, limit: Ref<number>) {
  const terms = computed(() => query.value.toLowerCase().split(/\s+/).filter(Boolean))
  const matches = shallowRef<LocalNote[]>([])
  const complete = ref(false)
  const searching = ref(false)
  const showSpinner = ref(false)
  let candidates: LocalNote[] = []
  let cursor = 0
  let batchTimer: ReturnType<typeof setTimeout> | undefined
  let spinnerTimer: ReturnType<typeof setTimeout> | undefined

  function pause() {
    clearTimeout(batchTimer)
    clearTimeout(spinnerTimer)
    batchTimer = undefined
    searching.value = false
    showSpinner.value = false
  }

  function resume() {
    if (complete.value || matches.value.length >= limit.value) {
      pause()
      return
    }
    if (!searching.value) {
      searching.value = true
      spinnerTimer = setTimeout(() => (showSpinner.value = true), 200)
    }
    if (batchTimer === undefined) batchTimer = setTimeout(scan, 0)
  }

  function scan() {
    batchTimer = undefined
    const batch: LocalNote[] = []
    const deadline = performance.now() + 6
    let checked = 0
    while (cursor < candidates.length && matches.value.length + batch.length < limit.value) {
      const note = candidates[cursor++]!
      const content = note.content.toLowerCase()
      if (terms.value.every((term) => content.includes(term))) batch.push(note)
      // Bound both time and work, then yield so typing and painting can proceed.
      if (++checked >= 100 || performance.now() >= deadline) break
    }
    if (batch.length) matches.value = [...matches.value, ...batch]
    complete.value = cursor === candidates.length
    resume()
  }

  function restart() {
    pause()
    candidates = source.value
    cursor = 0
    // The unfiltered list needs no content scan; its rows are still virtualized.
    matches.value = terms.value.length ? [] : candidates
    complete.value = !terms.value.length || !candidates.length
    resume()
  }

  watch(terms, restart, { immediate: true })
  // Revisions catch edits even when a single-note list does not need re-sorting.
  watch(() => source.value.map((note) => note.revision), restart)
  watch(limit, resume)
  onScopeDispose(pause)

  return { terms, matches, complete, searching, showSpinner }
}
