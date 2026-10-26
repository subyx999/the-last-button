import type { Movie } from '../types'

const API_ROOT = 'https://api.themoviedb.org/3'
const API_KEY = import.meta.env.VITE_TMDB_API_KEY
const DAILY_MOVIE_IDS = [11, 13, 28, 155, 238, 278, 424, 597, 603, 680, 550, 27205, 157336, 496243]

export function imageUrl(path: string | null | undefined, size: 'w500' | 'original' = 'w500') {
  return path ? `https://image.tmdb.org/t/p/${size}${path}` : ''
}

async function request<T>(endpoint: string): Promise<T> {
  if (!API_KEY) {
    throw new Error('TMDB is not connected yet. Add VITE_TMDB_API_KEY to a .env file, then restart the app.')
  }

  const separator = endpoint.includes('?') ? '&' : '?'
  const response = await fetch(`${API_ROOT}${endpoint}${separator}api_key=${encodeURIComponent(API_KEY)}&language=en-US`)

  if (!response.ok) {
    throw new Error(`TMDB could not load this movie (HTTP ${response.status}). Please try again.`)
  }

  return response.json() as Promise<T>
}

export async function getMovie(id: number): Promise<Movie> {
  const movie = await request<Movie>(`/movie/${id}?append_to_response=credits,videos`)
  if (!movie?.id || !movie.title) throw new Error('TMDB returned an incomplete movie. Please try again.')
  return movie
}

export async function getMovieOfTheDay(date = new Date()): Promise<Movie> {
  const day = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()) / 86_400_000
  const id = DAILY_MOVIE_IDS[((day % DAILY_MOVIE_IDS.length) + DAILY_MOVIE_IDS.length) % DAILY_MOVIE_IDS.length]
  return getMovie(id)
}

export async function getRandomMovie(excludedIds: ReadonlySet<number> = new Set()): Promise<Movie> {
  const attemptedPages = new Set<number>()
  const sortModes = [
    'popularity.desc',
    'vote_average.desc&vote_count.gte=100',
    'primary_release_date.desc',
    'revenue.desc',
  ]
  const sortMode = sortModes[Math.floor(Math.random() * sortModes.length)]

  for (let attempt = 0; attempt < 5; attempt += 1) {
    let page = Math.floor(Math.random() * 500) + 1
    while (attemptedPages.has(page)) page = (page % 500) + 1
    attemptedPages.add(page)

    const result = await request<{ results?: Movie[] }>(
      `/discover/movie?include_adult=false&sort_by=${sortMode}&page=${page}`,
    )
    const validMovies = (result.results ?? []).filter(
      (movie) => movie.id && movie.title && !excludedIds.has(movie.id),
    )

    if (!validMovies.length) continue
    const movie = validMovies[Math.floor(Math.random() * validMovies.length)]
    return getMovie(movie.id)
  }

  throw new Error('No new movies found in the random picks. Please try again.')
}
