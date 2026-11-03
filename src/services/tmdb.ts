import type { Movie, TasteProfile } from '../types'

const API_ROOT = 'https://api.themoviedb.org/3'
const API_KEY = import.meta.env.VITE_TMDB_API_KEY
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
  if (!normalizedQuery) return []
  const params = new URLSearchParams({ query: normalizedQuery, include_adult: 'false', page: '1' })
  const result = await request<{ results?: Movie[] }>(`/search/movie?${params.toString()}`)
  return (result.results ?? []).filter((movie) => Boolean(movie.id && movie.title)).slice(0, 8)
}

export async function getMovieGenres(): Promise<MovieGenre[]> {
  const result = await request<{ genres?: MovieGenre[] }>('/genre/movie/list')
  return (result.genres ?? []).filter((genre) => genre.id && genre.name)
}

type DiscoveryCandidate = Movie & {
  genre_ids?: number[]
  vote_count?: number
}

type DiscoveryLane = {
  name: string
  country?: string
  movies: DiscoveryCandidate[]
}

type DiscoveryLaneName = 'international' | 'classics' | 'underseen' | 'mainstream'

const DISCOVERY_PAGE_SIZE = 12
const DAILY_DISCOVERY_LANES: DiscoveryLaneName[] = ['international', 'underseen', 'classics', 'mainstream']
const DISCOVERY_COUNTRIES = [
  'JP', 'KR', 'IN', 'FR', 'IT', 'ES', 'DE', 'BR', 'MX', 'IR',
  'EG', 'TR', 'NG', 'TH', 'ID', 'PH', 'SE',
]
const DISCOVERY_ERAS = [
  { start: '1920-01-01', end: '1939-12-31' },
  { start: '1940-01-01', end: '1949-12-31' },
  { start: '1950-01-01', end: '1959-12-31' },
]

function discoveryPage(page: number, values: Record<string, string>) {
  const params = new URLSearchParams({
    include_adult: 'false',
    page: String(page),
    'primary_release_date.lte': currentDateString(),
    ...values,
  })
  return request<{ results?: DiscoveryCandidate[] }>(`/discover/movie?${params.toString()}`)
}

function selectDiverseRecommendations(
  lanes: DiscoveryLane[],
  excludedIds: ReadonlySet<number>,
  tieSeed?: number,
) {
  const candidates = new Map<number, { movie: DiscoveryCandidate; lane: string; country?: string }>()
  for (const lane of lanes) {
    for (const movie of lane.movies) {
      if (
        !movie.id
        || !movie.title
        || excludedIds.has(movie.id)
        || !isReleasedMovie(movie)
        || (movie.vote_average ?? 0) < 5.8
        || (movie.vote_count ?? 0) < 5
        || candidates.has(movie.id)
      ) continue
      candidates.set(movie.id, { movie, lane: lane.name, country: lane.country })
    }
  }

  const selected: Movie[] = []
  const genreCounts = new Map<number, number>()
  const decadeCounts = new Map<number, number>()
  const languageCounts = new Map<string, number>()
  const laneCounts = new Map<string, number>()
  const countryCounts = new Map<string, number>()
  let lowVoteSelectionCount = 0

  while (selected.length < DISCOVERY_PAGE_SIZE && candidates.size) {
    let bestId: number | undefined
    let bestScore = Number.NEGATIVE_INFINITY

    for (const [id, candidate] of candidates) {
      const { movie, lane, country } = candidate
      const genres = movie.genre_ids ?? []
      const genreCount = genres.length
        ? Math.max(...genres.map((genre) => genreCounts.get(genre) ?? 0))
        : 0
      const year = Number(movie.release_date?.slice(0, 4))
      const decade = Math.floor(year / 10) * 10
      const language = movie.original_language ?? 'unknown'
      const voteCount = movie.vote_count ?? 0
      if (
        genreCount >= 3
        || (decadeCounts.get(decade) ?? 0) >= 4
        || (languageCounts.get(language) ?? 0) >= 3
        || (laneCounts.get(lane) ?? 0) >= 4
        || (country && (countryCounts.get(country) ?? 0) >= 2)
        || (voteCount < 50 && lowVoteSelectionCount >= 5)
      ) continue

      const voteConfidence = Math.min(1, Math.log10(voteCount + 1) / 4)
      const adjustedRating = (
        (movie.vote_average ?? 0) * voteCount + 6.5 * 80
      ) / (voteCount + 80)
      const ratingQuality = Math.max(0, Math.min(1, (adjustedRating - 5.8) / 4.2))
      const tieBreak = tieSeed === undefined
        ? Math.random() * 0.015
        : (((id * 31 + tieSeed * 17) % 1009) / 1009) * 0.015
      const score = ratingQuality * 0.5
        + voteConfidence * 0.1
        + 0.14 / (1 + genreCount)
        + 0.12 / (1 + (decadeCounts.get(decade) ?? 0))
        + 0.12 / (1 + (languageCounts.get(language) ?? 0))
        + 0.12 / (1 + (laneCounts.get(lane) ?? 0))
        + (country ? 0.08 / (1 + (countryCounts.get(country) ?? 0)) : 0)
        + tieBreak

      if (score > bestScore) {
        bestId = id
        bestScore = score
      }
    }

    if (bestId === undefined) break
    const candidate = candidates.get(bestId)!
    candidates.delete(bestId)
    selected.push(candidate.movie)
    if ((candidate.movie.vote_count ?? 0) < 50) lowVoteSelectionCount += 1

    for (const genre of candidate.movie.genre_ids ?? []) {
      genreCounts.set(genre, (genreCounts.get(genre) ?? 0) + 1)
    }
    const year = Number(candidate.movie.release_date?.slice(0, 4))
    const decade = Math.floor(year / 10) * 10
    decadeCounts.set(decade, (decadeCounts.get(decade) ?? 0) + 1)
    const language = candidate.movie.original_language ?? 'unknown'
    languageCounts.set(language, (languageCounts.get(language) ?? 0) + 1)
    laneCounts.set(candidate.lane, (laneCounts.get(candidate.lane) ?? 0) + 1)
    if (candidate.country) {
      countryCounts.set(candidate.country, (countryCounts.get(candidate.country) ?? 0) + 1)
    }
  }

  return selected
}

function selectLaneRecommendation(
  lanes: DiscoveryLane[],
  laneName: DiscoveryLaneName,
  excludedIds: ReadonlySet<number>,
  seed: number,
) {
  const candidates = lanes.find((lane) => lane.name === laneName)?.movies.filter(
    (movie) => movie.id
      && movie.title
      && !excludedIds.has(movie.id)
      && isReleasedMovie(movie)
      && (movie.vote_average ?? 0) >= 5.8
      && (movie.vote_count ?? 0) >= 5,
  ) ?? []
  if (!candidates.length) return []
  const index = ((seed % candidates.length) + candidates.length) % candidates.length
  return [candidates[index]]
}

export async function getDiscoveryRecommendations(
  seed: number,
  batch: number,
  excludedIds: ReadonlySet<number> = new Set(),
  deterministicSeed?: number,
  preferredLane?: DiscoveryLaneName,
): Promise<Movie[]> {
  const era = DISCOVERY_ERAS[(seed + batch) % DISCOVERY_ERAS.length]
  const country = DISCOVERY_COUNTRIES[(seed + batch) % DISCOVERY_COUNTRIES.length]
  const pages = [
    ((seed + batch * 3) % 100) + 1,
    (batch % 5) + 1,
    (batch % 3) + 1,
    (batch % 3) + 1,
  ]
  const queryResults = await Promise.all([
    discoveryPage(pages[0], {
      sort_by: 'popularity.desc',
      'vote_average.gte': '5.8',
      'vote_count.gte': '25',
    }),
    discoveryPage(pages[1], {
      sort_by: 'vote_average.desc',
      'vote_average.gte': '6.3',
      'vote_count.gte': '10',
      'vote_count.lte': '1200',
    }),
    discoveryPage(pages[2], {
      sort_by: 'vote_average.desc',
      'vote_average.gte': '6.2',
      'vote_count.gte': '10',
      'primary_release_date.gte': era.start,
      'primary_release_date.lte': era.end,
    }),
    discoveryPage(pages[3], {
      sort_by: 'vote_average.desc',
      'vote_average.gte': '6.2',
      'vote_count.gte': '10',
      with_origin_country: country,
    }),
  ])
  const lanes: DiscoveryLane[] = [
    { name: 'international', country, movies: queryResults[3].results ?? [] },
    { name: 'classics', movies: queryResults[2].results ?? [] },
    { name: 'underseen', movies: queryResults[1].results ?? [] },
    { name: 'mainstream', movies: queryResults[0].results ?? [] },
  ]
  const recommendations = preferredLane
    ? selectLaneRecommendation(lanes, preferredLane, excludedIds, deterministicSeed ?? seed)
    : selectDiverseRecommendations(lanes, excludedIds, deterministicSeed)
  if (!recommendations.length && preferredLane) {
    recommendations.push(...selectDiverseRecommendations(lanes, excludedIds, deterministicSeed))
  }
  if (!recommendations.length) {
    throw new Error('TMDB could not find more quality films for this discovery feed. Please try again.')
  }
  return recommendations
}

export async function discoverMoviesByGenre(genreIds: readonly number[]): Promise<Movie[]> {
  const selectedGenres = [...new Set(genreIds.filter((genreId) => Number.isInteger(genreId) && genreId > 0))]
  if (!selectedGenres.length) return []

  const params = new URLSearchParams({
    include_adult: 'false',
    sort_by: 'popularity.desc',
    page: '1',
    with_genres: selectedGenres.join(','),
    'primary_release_date.lte': currentDateString(),
  })
  const result = await request<{ results?: Movie[] }>(`/discover/movie?${params.toString()}`)
  return (result.results ?? [])
    .filter((movie) => movie.id && movie.title && isReleasedMovie(movie))
    .slice(0, 8)
}

export async function getMovieOfTheDay(date = new Date()): Promise<Movie> {
  const day = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()) / 86_400_000
  const laneIndex = ((day % DAILY_DISCOVERY_LANES.length) + DAILY_DISCOVERY_LANES.length) % DAILY_DISCOVERY_LANES.length
  const lane = DAILY_DISCOVERY_LANES[laneIndex]
  const [recommendation] = await getDiscoveryRecommendations(day, day, new Set(), day, lane)
  const movie = await getMovie(recommendation.id)
  if (!isReleasedMovie(movie, currentDateString(date))) {
    throw new Error('Today’s movie does not have a valid past release date. Please try again later.')
  }
  return movie
}

export async function getRandomMovie(
  excludedIds: ReadonlySet<number> = new Set(),
  tasteProfile?: TasteProfile,
): Promise<Movie> {
  const attemptedPages = new Set<number>()
  const sortModes: Array<{ sortBy: string; minimumVotes?: string }> = [
    { sortBy: 'popularity.desc' },
    { sortBy: 'vote_average.desc', minimumVotes: '100' },
    { sortBy: 'primary_release_date.desc' },
    { sortBy: 'revenue.desc' },
  ]
  const sortMode = sortModes[Math.floor(Math.random() * sortModes.length)]
  const today = currentDateString()
  const filters = new URLSearchParams()
  const usesTasteFilters = Boolean(tasteProfile && (
    tasteProfile.preferredGenreIds.length
    || tasteProfile.dislikedGenreIds.length
    || tasteProfile.preferredLanguages.length
    || tasteProfile.releasePeriod !== 'any'
  ))
  if (tasteProfile) {
    if (tasteProfile.preferredGenreIds.length) {
      filters.set('with_genres', tasteProfile.preferredGenreIds.join('|'))
    }
    if (tasteProfile.dislikedGenreIds.length) {
      filters.set('without_genres', tasteProfile.dislikedGenreIds.join(','))
    }
    if (tasteProfile.preferredLanguages.length) {
      filters.set('with_original_language', tasteProfile.preferredLanguages.join('|'))
    }
    if (tasteProfile.releasePeriod !== 'any') {
      const periodStart = tasteProfile.releasePeriod === 'before-1960'
        ? undefined
        : Number(tasteProfile.releasePeriod.slice(0, 4))
      const periodEnd = tasteProfile.releasePeriod === 'before-1960'
        ? '1959-12-31'
        : tasteProfile.releasePeriod === '2020s'
          ? today
          : `${Number(tasteProfile.releasePeriod.slice(0, 4)) + 9}-12-31`
      if (periodStart) filters.set('primary_release_date.gte', `${periodStart}-01-01`)
      filters.set('primary_release_date.lte', periodEnd)
    }
  }
  let maximumPage = usesTasteFilters ? 1 : 500

  for (let attempt = 0; attempt < 5; attempt += 1) {
    if (attemptedPages.size >= maximumPage) break
    let page = usesTasteFilters && attempt === 0
      ? 1
      : Math.floor(Math.random() * maximumPage) + 1
    while (attemptedPages.has(page)) page = (page % maximumPage) + 1
    attemptedPages.add(page)

    const params = new URLSearchParams({
      include_adult: 'false',
      page: String(page),
      'primary_release_date.lte': today,
      sort_by: sortMode.sortBy,
    })
    filters.forEach((value, key) => {
      if (key !== 'primary_release_date.lte') params.set(key, value)
    })
    if (filters.has('primary_release_date.lte')) {
      params.set('primary_release_date.lte', filters.get('primary_release_date.lte') ?? today)
    }
    if (sortMode.minimumVotes) params.set('vote_count.gte', sortMode.minimumVotes)
    const result = await request<{ results?: Movie[]; total_pages?: number }>(
      `/discover/movie?${params.toString()}`,
    )
    if (usesTasteFilters && result.total_pages) {
      maximumPage = Math.max(1, Math.min(500, result.total_pages))
    }
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
