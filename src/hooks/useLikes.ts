import { useEffect, useRef, useState } from 'react'
import type { Movie } from '../types'
import { getMovieViewings } from '../services/watchHistory'
import { supabase } from '../services/supabase'

const STORAGE_KEY = 'the-last-button-likes'

function isMovie(value: unknown): value is Movie {
  return Boolean(value && typeof value === 'object' && 'id' in value && 'title' in value)
}

function uniqueMovies(movies: Movie[]) {
  return [...new Map(movies.map((movie) => [movie.id, movie])).values()]
}

function readLikes(): Movie[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]')
    return Array.isArray(value) ? uniqueMovies(value.filter(isMovie)) : []
  } catch {
    return []
  }
}

export function useLikes(userId: string | undefined, watchedMovies: Movie[], watchedLoading: boolean) {
  const [movies, setMovies] = useState<Movie[]>(readLikes)
  const [loading, setLoading] = useState(Boolean(userId))
  const [error, setError] = useState('')
  const [pendingMovieIds, setPendingMovieIds] = useState<Set<number>>(() => new Set())
  const [reloadKey, setReloadKey] = useState(0)
  const moviesRef = useRef(movies)
  const pendingRef = useRef(new Set<number>())
  moviesRef.current = movies

  useEffect(() => {
    if (watchedLoading) return

    let active = true
    setError('')

    async function loadLikes() {
      const guestMovies = readLikes()
      const legacyLikes = uniqueMovies(watchedMovies.filter((movie) =>
        getMovieViewings(movie).some((viewing) => viewing.user_liked),
      ))

      if (!userId) {
        const mergedMovies = uniqueMovies([...guestMovies, ...legacyLikes])
        try {
          if (mergedMovies.length) localStorage.setItem(STORAGE_KEY, JSON.stringify(mergedMovies))
        } catch (cause) {
          throw new Error(cause instanceof Error ? `Could not save your likes locally: ${cause.message}` : 'Could not save your likes locally.')
        }
        if (active) {
          moviesRef.current = mergedMovies
          setMovies(mergedMovies)
          setLoading(false)
        }
        return
      }

      if (!supabase) {
        throw new Error('Your synced likes are unavailable because Supabase is not configured.')
      }

      const { data, error: queryError } = await supabase
        .from('liked_movies')
        .select('movie_id, movie_data')
        .order('created_at', { ascending: false })
      if (queryError) throw queryError

      const accountMovies = uniqueMovies((data ?? []).flatMap((row) =>
        isMovie(row.movie_data) && row.movie_data.id === row.movie_id ? [row.movie_data] : [],
      ))
      const accountIds = new Set(accountMovies.map((movie) => movie.id))
      const additions = uniqueMovies([...guestMovies, ...legacyLikes])
        .filter((movie) => !accountIds.has(movie.id))

      if (additions.length) {
        const { error: saveError } = await supabase
          .from('liked_movies')
          .upsert(
            additions.map((movie) => ({ user_id: userId, movie_id: movie.id, movie_data: movie })),
            { onConflict: 'user_id,movie_id', ignoreDuplicates: true },
          )
        if (saveError) throw saveError
      }

      if (!active) return
      if (guestMovies.length) localStorage.removeItem(STORAGE_KEY)
      const mergedMovies = uniqueMovies([...additions, ...accountMovies])
      moviesRef.current = mergedMovies
      setMovies(mergedMovies)
      setLoading(false)
    }

    setLoading(true)
    loadLikes().catch((cause: unknown) => {
      if (active) {
        setError(cause instanceof Error ? cause.message : 'Could not load your liked films.')
        setLoading(false)
      }
    })

    return () => { active = false }
  }, [reloadKey, userId, watchedLoading])

  const contains = (movieId: number) => movies.some((movie) => movie.id === movieId)

  const setLiked = async (movie: Movie, liked: boolean): Promise<boolean> => {
    if (pendingRef.current.has(movie.id)) return false
    const previousMovies = moviesRef.current
    const wasLiked = previousMovies.some((saved) => saved.id === movie.id)
    if (wasLiked === liked) return true

    pendingRef.current.add(movie.id)
    setPendingMovieIds(new Set(pendingRef.current))
    setError('')
    const nextMovies = liked
      ? uniqueMovies([movie, ...previousMovies])
      : previousMovies.filter((saved) => saved.id !== movie.id)
    moviesRef.current = nextMovies
    setMovies(nextMovies)

    try {
      if (!userId) {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(nextMovies))
      } else {
        if (!supabase) throw new Error('Your synced likes are unavailable because Supabase is not configured.')
        const result = liked
          ? await supabase.from('liked_movies').upsert(
            { user_id: userId, movie_id: movie.id, movie_data: movie },
            { onConflict: 'user_id,movie_id', ignoreDuplicates: true },
          )
          : await supabase.from('liked_movies').delete().eq('user_id', userId).eq('movie_id', movie.id)
        if (result.error) throw result.error
      }
      return true
    } catch (cause) {
      moviesRef.current = previousMovies
      setMovies(previousMovies)
      setError(cause instanceof Error ? cause.message : 'Could not update your liked films.')
      return false
    } finally {
      pendingRef.current.delete(movie.id)
      setPendingMovieIds(new Set(pendingRef.current))
    }
  }

  return {
    movies,
    loading,
    error,
    contains,
    setLiked,
    toggle: (movie: Movie) => setLiked(movie, !contains(movie.id)),
    pendingMovieIds,
    retry: () => setReloadKey((key) => key + 1),
  }
}
