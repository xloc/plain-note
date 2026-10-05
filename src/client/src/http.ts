export class HttpError extends Error {
  constructor(
    public status: number,
    public body: Record<string, unknown> = {},
  ) {
    super(typeof body?.error === 'string' ? body.error : `Request failed with ${status}`)
  }
}

export async function fetchResponse(input: RequestInfo | URL, init?: RequestInit) {
  const response = await fetch(input, init)
  if (!response.ok) throw new HttpError(response.status, parseJson(await response.text(), response.status))
  return response
}

export async function request<T = { ok: true }>(input: RequestInfo | URL, init?: RequestInit) {
  const response = await fetchResponse(input, init)
  return parseJson(await response.text(), response.status) as T
}

export function upload(
  path: string,
  blob: Blob,
  headers: Record<string, string>,
  onProgress: (progress: number) => void,
) {
  return new Promise<void>((resolve, reject) => {
    const request = new XMLHttpRequest()
    request.open('PUT', path)
    for (const [name, value] of Object.entries(headers)) request.setRequestHeader(name, value)
    request.upload.onprogress = (event) => onProgress(event.total ? event.loaded / event.total : 0)
    request.onerror = () => reject(new Error('Resource upload failed'))
    request.onload = () => {
      try {
        const body = parseJson(request.responseText, request.status)
        if (request.status < 200 || request.status >= 300) throw new HttpError(request.status, body)
        onProgress(1)
        resolve()
      } catch (error) {
        reject(error)
      }
    }
    request.send(blob)
  })
}

function parseJson(text: string, status: number) {
  try {
    return JSON.parse(text) as Record<string, unknown>
  } catch {
    throw new HttpError(status)
  }
}
