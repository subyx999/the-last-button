import { useEffect, useState } from 'react'
import type { Movie } from '../types'
import { supabase } from '../services/supabase'

const STORAGE_KEY = 'the-last-button-watchlist'

function readWatchlist(): Movie[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]')
    return Array.isArray(value) ? value.filter((movie): movie is Movie => Boolean(movie?.id && movie?.title)) : []
  } catch {
    return []
  }
}

function isMovie(value: unknown): value is Movie {
  return Boolean(value && typeof value === 'object' && 'id' in value && 'title' in value)
}

export function useWatchlist(userId: string | undefined) {
  const [movies, setMovies] = useState<Movie[]>(readWatchlist)
  const [loading, setLoading] = useState(Boolean(userId))
  const [error, setError] = useState('')
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    let active = true
    setError('')

    if (!userId) {
      setMovies(readWatchlist())
      setLoading(false)
      return () => { active = false }
    }

    if (!supabase) {
      setMovies([])
      setLoading(false)
      setError('Account watchlists are unavailable because Supabase is not configured.')
      return () => { active = false }
    }

    setMovies([])
    setLoading(true)

    async function loadAccountWatchlist() {
      const { data, error: queryError } = await supabase!
        .from('watchlist')
        .select('movie_id, movie_data')
        .order('created_at', { ascending: false })

      if (queryError) throw queryError

      const accountMovies = (data ?? [])
        .map((row) => row.movie_data)
        .filter(isMovie)
      const guestMovies = readWatchlist()
      const accountIds = new Set(accountMovies.map((movie) => movie.id))
      const guestOnly = guestMovies.filter((movie) => !accountIds.has(movie.id))

      if (guestOnly.length) {
        const { error: migrationError } = await supabase!
          .from('watchlist')
          .upsert(
            guestOnly.map((movie) => ({ user_id: userId, movie_id: movie.id, movie_data: movie })),
            { onConflict: 'user_id,movie_id' },
          )
        if (migrationError) throw migrationError
      }

      if (!active) return
      if (guestMovies.length) localStorage.removeItem(STORAGE_KEY)
      setMovies([...guestOnly, ...accountMovies])
    }

    loadAccountWatchlist().catch((cause: unknown) => {
      if (active) {
        setError(cause instanceof Error ? cause.message : 'Could not load your synced watchlist.')
      }
    }).finally(() => {
      if (active) setLoading(false)
    })

    return () => { active = false }
  }, [userId, reloadKey])

  const contains = (id: number) => movies.some((movie) => movie.id === id)

  const toggle = async (movie: Movie) => {
    setError('')
    const wasSaved = contains(movie.id)
    const previousMovies = movies
    const nextMovies = wasSaved
      ? movies.filter((saved) => saved.id !== movie.id)
      : [movie, ...movies]
    setMovies(nextMovies)

    if (!userId) {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(nextMovies))
      } catch (cause) {
        setMovies(previousMovies)
        setError(cause instanceof Error ? cause.message : 'Could not save the local watchlist.')
      }
      return
    }

    if (!supabase) {
      setMovies(previousMovies)
      setError('Account watchlists are unavailable because Supabase is not configured.')
      return
    }

    try {
      const result = wasSaved
        ? await supabase.from('watchlist').delete().eq('user_id', userId).eq('movie_id', movie.id)
        : await supabase.from('watchlist').upsert(
          { user_id: userId, movie_id: movie.id, movie_data: movie },
          { onConflict: 'user_id,movie_id' },
        )

      if (result.error) throw result.error
    } catch (cause) {
      setMovies(previousMovies)
      setError(cause instanceof Error ? cause.message : 'Could not update your synced watchlist.')
    }
  }

  return { movies, contains, toggle, loading, error, retry: () => setReloadKey((key) => key + 1) }
}
