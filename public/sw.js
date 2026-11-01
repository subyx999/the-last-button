const CACHE_NAME = 'button-static-v1'
const CACHE_PREFIX = 'button-static-'
const APP_SHELL_PATH = '/index.html'

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME)
    await cache.addAll(['/', '/manifest.webmanifest'])
  })())
})

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const cacheNames = await caches.keys()
    await Promise.all(cacheNames
      .filter((name) => name.startsWith(CACHE_PREFIX) && name !== CACHE_NAME)
      .map((name) => caches.delete(name)))
    await self.clients.claim()
  })())
})

self.addEventListener('fetch', (event) => {
  const { request } = event
  if (request.method !== 'GET') return

  const url = new URL(request.url)
  if (url.origin !== self.location.origin) return

  if (request.mode === 'navigate') {
    if (url.pathname !== '/' && url.pathname !== '/index.html') return

    event.respondWith((async () => {
      try {
        const response = await fetch(request)
        const contentType = response.headers.get('content-type')?.split(';', 1)[0].trim()
        const cacheControl = response.headers.get('cache-control') ?? ''
        if (
          response.ok
          && response.type === 'basic'
          && contentType === 'text/html'
          && !/(^|,)\s*(private|no-store)\b/i.test(cacheControl)
          && response.headers.get('vary') !== '*'
        ) {
          const cache = await caches.open(CACHE_NAME)
          try {
            await cache.put(APP_SHELL_PATH, response.clone())
          } catch (error) {
            console.error('Could not cache the application shell.', error)
          }
        }
        return response
      } catch (error) {
        const cache = await caches.open(CACHE_NAME)
        const offlineResponse = await cache.match(APP_SHELL_PATH) ?? await cache.match('/')
        if (offlineResponse) return offlineResponse
        throw error
      }
    })())
    return
  }

  const isStaticPath = url.pathname.startsWith('/assets/')
    || url.pathname.startsWith('/branding/')
    || url.pathname === '/tmdb-logo.svg'
  if (!isStaticPath || url.search || !['script', 'style', 'font', 'image'].includes(request.destination)) return

  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME)
    let response
    try {
      response = await fetch(request)
    } catch (error) {
      const cachedResponse = await cache.match(request)
      if (cachedResponse) return cachedResponse
      throw error
    }

    const contentType = response.headers.get('content-type')?.split(';', 1)[0].trim() ?? ''
    const isExpectedType = request.destination === 'script'
      ? contentType.includes('javascript')
      : request.destination === 'style'
        ? contentType === 'text/css'
        : request.destination === 'font'
          ? contentType.startsWith('font/') || contentType.includes('font')
          : contentType.startsWith('image/')
    const cacheControl = response.headers.get('cache-control') ?? ''
    if (
      response.ok
      && response.type === 'basic'
      && isExpectedType
      && !/(^|,)\s*(private|no-store)\b/i.test(cacheControl)
      && response.headers.get('vary') !== '*'
    ) {
      try {
        await cache.put(request, response.clone())
      } catch (error) {
        console.error('Could not cache a static application asset.', error)
      }
    }
    return response
  })())
})
