export interface Movie {
  id: number
  title: string
  overview: string
  release_date?: string
  poster_path?: string | null
  backdrop_path?: string | null
  vote_average?: number
  user_rating?: number | null
  user_review?: string
  user_liked?: boolean
  watched_at?: string
  viewings?: MovieViewing[]
  runtime?: number | null
  genres?: Array<{ id: number; name: string }>
  tagline?: string
  original_language?: string
  production_countries?: Array<{ iso_3166_1: string; name: string }>
  production_companies?: Array<{ id: number; name: string }>
  spoken_languages?: Array<{ english_name: string; name: string }>
  credits?: {
    cast?: Array<{ id: number; name: string; character: string; profile_path?: string | null }>
    crew?: Array<{ id: number; name: string; job: string }>
  }
  videos?: {
    results?: Array<{
      key: string
      name: string
      site: string
      type: string
      official: boolean
    }>
  }
}

export interface MovieViewing {
  id: string
  watched_at?: string
  user_rating?: number | null
  user_review?: string
  user_liked?: boolean
  is_rewatch: boolean
}

export interface MovieCollection {
  id: string
  name: string
  movies: Movie[]
}

export type ThemePreference = 'light' | 'dark' | 'system'

export type ReleasePeriod =
  | 'any'
  | 'before-1960'
  | '1960s'
  | '1970s'
  | '1980s'
  | '1990s'
  | '2000s'
  | '2010s'
  | '2020s'

export interface TasteProfile {
  preferredGenreIds: number[]
  dislikedGenreIds: number[]
  releasePeriod: ReleasePeriod
  preferredLanguages: string[]
}

export const EMPTY_TASTE_PROFILE: TasteProfile = {
  preferredGenreIds: [],
  dislikedGenreIds: [],
  releasePeriod: 'any',
  preferredLanguages: [],
}
