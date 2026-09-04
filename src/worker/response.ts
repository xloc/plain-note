export function error(message: string, status: number) {
  return json({ error: message }, status)
}

export function json(value: unknown, status = 200) {
  return Response.json(value, { status, headers: { 'Cache-Control': 'no-store' } })
}
