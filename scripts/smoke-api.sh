#!/usr/bin/env bash
set -euo pipefail

origin="${1:-http://127.0.0.1:8787}"
note_id="smoke-${RANDOM}-${RANDOM}"
revision_1="revision-1-${note_id}"
revision_2="revision-2-${note_id}"
revision_3="revision-3-${note_id}"
deleted_revision="deleted-${note_id}"
resource_id="resource-${note_id}"
response_file="$(mktemp)"
trap 'rm -f "$response_file"' EXIT

curl --fail --silent "${origin}/api/health" | jq -e '.ok == true' >/dev/null

initial_sync="$(curl --fail --silent "${origin}/api/sync?after=0")"
generation="$(jq -r '.generation' <<<"$initial_sync")"
if [[ -n "${EXPECTED_NOTE_ID:-}" ]]; then
  jq -e ".changes | any(.id == \"${EXPECTED_NOTE_ID}\")" <<<"$initial_sync" >/dev/null
fi

curl --fail --silent \
  --request PUT \
  --header 'Content-Type: text/plain' \
  --header 'X-Resource-Name: smoke.txt' \
  --header 'X-Resource-Size: 14' \
  --header 'X-Resource-Created-At: 1' \
  --data-binary 'resource bytes' \
  "${origin}/api/notes/${note_id}/resources/${resource_id}" \
  | jq -e ".resource.id == \"${resource_id}\"" >/dev/null

curl --fail --silent \
  --request PUT \
  --header 'Content-Type: application/json' \
  --data "{\"baseRevision\":null,\"note\":{\"id\":\"${note_id}\",\"title\":\"Smoke note\",\"content\":\"Hello **Markdown**\",\"tags\":[],\"resources\":[{\"id\":\"${resource_id}\",\"name\":\"smoke.txt\",\"mime\":\"text/plain\",\"size\":14,\"createdAt\":1}],\"createdAt\":1,\"updatedAt\":1,\"revision\":\"${revision_1}\"}}" \
  "${origin}/api/notes/${note_id}" | jq -e ".note.revision == \"${revision_1}\"" >/dev/null

curl --fail --silent "${origin}/api/notes/${note_id}" | jq -e '.note.content == "Hello **Markdown**"' >/dev/null
test "$(curl --fail --silent "${origin}/api/notes/${note_id}/resources/${resource_id}")" = 'resource bytes'

conflict_status="$(curl --silent --output "$response_file" --write-out '%{http_code}' \
  --request PUT \
  --header 'Content-Type: application/json' \
  --data "{\"baseRevision\":\"wrong\",\"note\":{\"id\":\"${note_id}\",\"title\":\"Conflict\",\"content\":\"\",\"tags\":[],\"resources\":[],\"createdAt\":1,\"updatedAt\":2,\"revision\":\"wrong-revision\"}}" \
  "${origin}/api/notes/${note_id}")"
test "$conflict_status" = 409
jq -e ".current.revision == \"${revision_1}\"" "$response_file" >/dev/null

curl --fail --silent \
  --request PUT \
  --header 'Content-Type: application/json' \
  --data "{\"baseRevision\":\"${revision_1}\",\"note\":{\"id\":\"${note_id}\",\"content\":\"Hello **Markdown**\",\"tags\":[],\"resources\":[],\"createdAt\":1,\"updatedAt\":2,\"revision\":\"${revision_2}\"}}" \
  "${origin}/api/notes/${note_id}" | jq -e ".note.revision == \"${revision_2}\"" >/dev/null

resource_status="$(curl --silent --output "$response_file" --write-out '%{http_code}' \
  "${origin}/api/notes/${note_id}/resources/${resource_id}")"
test "$resource_status" = 404

curl --fail --silent \
  --request DELETE \
  --header 'Content-Type: application/json' \
  --data "{\"baseRevision\":\"${revision_2}\",\"revision\":\"${deleted_revision}\",\"updatedAt\":3}" \
  "${origin}/api/notes/${note_id}" | jq -e '.tombstone.deleted == true' >/dev/null

deleted_status="$(curl --silent --output "$response_file" --write-out '%{http_code}' "${origin}/api/notes/${note_id}")"
test "$deleted_status" = 410

curl --fail --silent \
  --request PUT \
  --header 'Content-Type: application/json' \
  --data "{\"baseRevision\":\"${deleted_revision}\",\"note\":{\"id\":\"${note_id}\",\"title\":\"Restored note\",\"content\":\"Restored\",\"tags\":[],\"resources\":[],\"createdAt\":1,\"updatedAt\":4,\"revision\":\"${revision_3}\"}}" \
  "${origin}/api/notes/${note_id}" | jq -e ".note.revision == \"${revision_3}\"" >/dev/null

curl --fail --silent "${origin}/api/sync?generation=${generation}&after=0" \
  | jq -e ".changes | map(select(.id == \"${note_id}\")) | length == 4" >/dev/null

echo "API smoke test passed for ${note_id}"
