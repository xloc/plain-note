export function isLocalRequest(request: Request) {
  const hostname = new URL(request.url).hostname
  return hostname === 'localhost'
    || hostname === '0.0.0.0'
    || hostname === '127.0.0.1'
    || hostname === '[::1]'
    || hostname.endsWith('.local')
    || /^10\./.test(hostname)
    || /^192\.168\./.test(hostname)
    || /^172\.(1[6-9]|2\d|3[01])\./.test(hostname)
    || /^\[(?:fc|fd|fe80:)/i.test(hostname)
}
