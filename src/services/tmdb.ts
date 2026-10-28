import type { Movie } from '../types'

const API_ROOT = 'https://api.themoviedb.org/3'
const API_KEY = import.meta.env.VITE_TMDB_API_KEY
const DAILY_MOVIE_IDS = [11, 13, 28, 155, 238, 278, 424, 597, 603, 680, 550, 27205, 157336, 496243]
const RESPONSE_CACHE_TTL_MS = 5 * 60 * 1000
const RESPONSE_CACHE_LIMIT = 80
const responseCache = new Map<string, { value: unknown; expiresAt: number }>()
const pendingRequests = new Map<string, Promise<unknown>>()

export interface MovieGenre {
  id: number
  name: string
}

function currentDateString(date = new Date()) {
  return date.toISOString().slice(0, 10)
}

export function isReleasedMovie(movie: Pick<Movie, 'release_date'>, today = currentDateString()) {
  const releaseDate = movie.release_date
  if (!releaseDate || !/^\d{4}-\d{2}-\d{2}$/.test(releaseDate)) return false
  const parsedDate = new Date(`${releaseDate}T00:00:00.000Z`)
  return Number.isFinite(parsedDate.getTime()) && parsedDate.toISOString().slice(0, 10) === releaseDate && releaseDate <= today
}

function normalizeMovieTitle(title: string) {
  return title
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
}

export function imageUrl(path: string | null | undefined, size: 'w500' | 'original' = 'w500') {
  return path ? `https://image.tmdb.org/t/p/${size}${path}` : ''
}

async function request<T>(endpoint: string): Promise<T> {
  if (!API_KEY) {
    throw new Error('TMDB is not connected yet. Add VITE_TMDB_API_KEY to a .env file, then restart the app.')
  }

  const cached = responseCache.get(endpoint)
  if (cached && cached.expiresAt > Date.now()) return cached.value as T
  if (cached) responseCache.delete(endpoint)

  const pending = pendingRequests.get(endpoint)
  if (pending) return pending as Promise<T>

  const separator = endpoint.includes('?') ? '&' : '?'
  const requestPromise = (async () => {
    const response = await fetch(`${API_ROOT}${endpoint}${separator}api_key=${encodeURIComponent(API_KEY)}&language=en-US`)
    if (!response.ok) {
      throw new Error(`TMDB could not load this movie (HTTP ${response.status}). Please try again.`)
    }

    const value: unknown = await response.json()
    if (responseCache.size >= RESPONSE_CACHE_LIMIT) {
      const oldestKey = responseCache.keys().next().value
      if (oldestKey !== undefined) responseCache.delete(oldestKey)
    }
    responseCache.set(endpoint, { value, expiresAt: Date.now() + RESPONSE_CACHE_TTL_MS })
    return value
  })()
  pendingRequests.set(endpoint, requestPromise)
  try {
    return await requestPromise as T
  } finally {
    pendingRequests.delete(endpoint)
  }
}

export async function getMovie(id: number): Promise<Movie> {
  const movie = await request<Movie>(`/movie/${id}?append_to_response=credits,videos`)
  if (!movie?.id || !movie.title) throw new Error('TMDB returned an incomplete movie. Please try again.')
  return movie
}

export async function findExactMovie(title: string, year: number): Promise<Movie | null> {
  const query = new URLSearchParams({ query: title, year: String(year), include_adult: 'false' })
  const result = await request<{ results?: Array<Movie & { original_title?: string }> }>(
    `/search/movie?${query.toString()}`,
  )
  const normalizedTitle = normalizeMovieTitle(title)
  const matches = new Map<number, Movie>()

  for (const movie of result.results ?? []) {
    const movieYear = movie.release_date?.slice(0, 4)
    const titleMatches = [movie.title, movie.original_title].some(
      (candidate) => candidate && normalizeMovieTitle(candidate) === normalizedTitle,
    )
    if (titleMatches && movieYear === String(year)) matches.set(movie.id, movie)
  }

  return matches.size === 1 ? [...matches.values()][0] : null
}

export async function searchMovies(query: string): Promise<Movie[]> {
  const normalizedQuery = query.trim()
  if (normalizedQuery.length < 2) return []
  const params = new URLSearchParams({ query: normalizedQuery, include_adult: 'false', page: '1' })
  const result = await request<{ results?: Movie[] }>(`/search/movie?${params.toString()}`)
  return (result.results ?? []).filter((movie) => Boolean(movie.id && movie.title)).slice(0, 8)
}

export async function getMovieGenres(): Promise<MovieGenre[]> {
  const result = await request<{ genres?: MovieGenre[] }>('/genre/movie/list')
  return (result.genres ?? []).filter((genre) => genre.id && genre.name)
}

export async function discoverMoviesByGenre(genreIds: readonly number[]): Promise<Movie[]> {
  if (!genreIds.length) return []

  const params = new URLSearchParams({
    include_adult: 'false',
    sort_by: 'popularity.desc',
    page: '1',
    with_genres: genreIds.join('|'),
    'primary_release_date.lte': currentDateString(),
  })
  const result = await request<{ results?: Movie[] }>(`/discover/movie?${params.toString()}`)
  return (result.results ?? [])
    .filter((movie) => movie.id && movie.title && isReleasedMovie(movie))
    .slice(0, 8)
}

export async function getMovieOfTheDay(date = new Date()): Promise<Movie> {
  const day = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()) / 86_400_000
  const id = DAILY_MOVIE_IDS[((day % DAILY_MOVIE_IDS.length) + DAILY_MOVIE_IDS.length) % DAILY_MOVIE_IDS.length]
  const movie = await getMovie(id)
  if (!isReleasedMovie(movie, currentDateString(date))) {
    throw new Error('Today’s movie does not have a valid past release date. Please try again later.')
  }
  return movie
}

export async function getRandomMovie(excludedIds: ReadonlySet<number> = new Set()): Promise<Movie> {
  const attemptedPages = new Set<number>()
  const sortModes: Array<{ sortBy: string; minimumVotes?: string }> = [
    { sortBy: 'popularity.desc' },
    { sortBy: 'vote_average.desc', minimumVotes: '100' },
    { sortBy: 'primary_release_date.desc' },
    { sortBy: 'revenue.desc' },
  ]
  const sortMode = sortModes[Math.floor(Math.random() * sortModes.length)]
  const today = currentDateString()

  for (let attempt = 0; attempt < 5; attempt += 1) {
    let page = Math.floor(Math.random() * 500) + 1
    while (attemptedPages.has(page)) page = (page % 500) + 1
    attemptedPages.add(page)

    const params = new URLSearchParams({
      include_adult: 'false',
      page: String(page),
      'primary_release_date.lte': today,
      sort_by: sortMode.sortBy,
    })
    if (sortMode.minimumVotes) params.set('vote_count.gte', sortMode.minimumVotes)
    const result = await request<{ results?: Movie[] }>(
      `/discover/movie?${params.toString()}`,
    )
    const validMovies = (result.results ?? []).filter(
      (movie) => movie.id && movie.title && isReleasedMovie(movie, today) && !excludedIds.has(movie.id),
    )

    if (!validMovies.length) continue
    const movie = validMovies[Math.floor(Math.random() * validMovies.length)]
    const details = await getMovie(movie.id)
    if (isReleasedMovie(details, today)) return details
  }

  throw new Error('No new movies found in the random picks. Please try again.')
}
