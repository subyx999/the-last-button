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
