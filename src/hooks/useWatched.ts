import { useEffect, useRef, useState } from 'react'
import type { Movie } from '../types'
import { supabase } from '../services/supabase'

const STORAGE_KEY = 'the-last-button-watched'

function readWatched(): Movie[] {
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

export function useWatched(userId: string | undefined) {
  const [movies, setMovies] = useState<Movie[]>(readWatched)
  const [loading, setLoading] = useState(Boolean(userId))
  const [error, setError] = useState('')
  const [reloadKey, setReloadKey] = useState(0)
  const moviesRef = useRef(movies)
  moviesRef.current = movies

  useEffect(() => {
    let active = true
    setError('')

    if (!userId) {
      setMovies(readWatched())
      setLoading(false)
      return () => { active = false }
    }

    if (!supabase) {
      setMovies([])
      setLoading(false)
      setError('Account watched lists are unavailable because Supabase is not configured.')
      return () => { active = false }
    }

    setMovies([])
    setLoading(true)

    async function loadAccountWatched() {
      const { data, error: queryError } = await supabase!
        .from('watched_movies')
        .select('movie_data')
        .order('created_at', { ascending: false })

      if (queryError) throw queryError

      const accountMovies = (data ?? []).map((row) => row.movie_data).filter(isMovie)
      const guestMovies = readWatched()
      const accountIds = new Set(accountMovies.map((movie) => movie.id))
      const guestOnly = guestMovies.filter((movie) => !accountIds.has(movie.id))

      if (guestOnly.length) {
        const { error: migrationError } = await supabase!
          .from('watched_movies')
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

    loadAccountWatched().catch((cause: unknown) => {
      if (active) setError(cause instanceof Error ? cause.message : 'Could not load your watched films.')
    }).finally(() => {
      if (active) setLoading(false)
    })

    return () => { active = false }
  }, [userId, reloadKey])

  const contains = (id: number) => movies.some((movie) => movie.id === id)

  const markWatched = async (movie: Movie): Promise<boolean> => {
    setError('')
    if (contains(movie.id)) return true

    const previousMovies = movies
    const nextMovies = [movie, ...movies]
    setMovies(nextMovies)

    if (!userId) {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(nextMovies))
        return true
      } catch (cause) {
        setMovies(previousMovies)
        setError(cause instanceof Error ? cause.message : 'Could not save your watched films.')
        return false
      }
    }

    if (!supabase) {
      setMovies(previousMovies)
      setError('Account watched lists are unavailable because Supabase is not configured.')
      return false
    }

    try {
      const { error: saveError } = await supabase
        .from('watched_movies')
        .upsert(
          { user_id: userId, movie_id: movie.id, movie_data: movie },
          { onConflict: 'user_id,movie_id' },
        )
      if (saveError) throw saveError
      return true
    } catch (cause) {
      setMovies(previousMovies)
      setError(cause instanceof Error ? cause.message : 'Could not sync your watched films.')
      return false
    }
  }

  const addMany = async (newMovies: Movie[]): Promise<boolean> => {
    setError('')
    const uniqueMovies = [...new Map(newMovies.map((movie) => [movie.id, movie])).values()]
    const previousMovies = moviesRef.current
    const additions = uniqueMovies.filter((movie) => !previousMovies.some((saved) => saved.id === movie.id))
    if (!additions.length) return true

    const nextMovies = [...additions, ...previousMovies]
    moviesRef.current = nextMovies
    setMovies(nextMovies)

    if (!userId) {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(nextMovies))
        return true
      } catch (cause) {
        moviesRef.current = previousMovies
        setMovies(previousMovies)
        setError(cause instanceof Error ? cause.message : 'Could not save imported watched films.')
        return false
      }
    }

    if (!supabase) {
      moviesRef.current = previousMovies
      setMovies(previousMovies)
      setError('Account watched lists are unavailable because Supabase is not configured.')
      return false
    }

    try {
      const { error: saveError } = await supabase
        .from('watched_movies')
        .upsert(
          additions.map((movie) => ({ user_id: userId, movie_id: movie.id, movie_data: movie })),
          { onConflict: 'user_id,movie_id', ignoreDuplicates: true },
        )
      if (saveError) throw saveError
      return true
    } catch (cause) {
      moviesRef.current = previousMovies
      setMovies(previousMovies)
      setError(cause instanceof Error ? cause.message : 'Could not sync imported watched films.')
      return false
    }
  }

  const setRating = async (movieId: number, rating: number | null, review?: string, liked?: boolean): Promise<boolean> => {
    setError('')
    if (rating !== null && (rating < 0.5 || rating > 5 || rating * 2 % 1 !== 0)) {
      setError('Ratings must be between 0.5 and 5 stars in half-star steps.')
      return false
    }

    const previousMovies = moviesRef.current
    const movie = previousMovies.find((saved) => saved.id === movieId)
    if (!movie) {
      setError('Could not find this film in your watched list.')
      return false
    }

    const updatedMovie: Movie = {
      ...movie,
      user_rating: rating,
      ...(review === undefined ? {} : { user_review: review }),
      ...(liked === undefined ? {} : { user_liked: liked }),
    }
    const nextMovies = previousMovies.map((saved) => saved.id === movieId ? updatedMovie : saved)
    moviesRef.current = nextMovies
    setMovies(nextMovies)

    if (!userId) {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(nextMovies))
        return true
      } catch (cause) {
        moviesRef.current = previousMovies
        setMovies(previousMovies)
        setError(cause instanceof Error ? cause.message : 'Could not save this rating.')
        return false
      }
    }

    if (!supabase) {
      moviesRef.current = previousMovies
      setMovies(previousMovies)
      setError('Account watched lists are unavailable because Supabase is not configured.')
      return false
    }

    try {
      const { error: saveError } = await supabase
        .from('watched_movies')
        .upsert(
          { user_id: userId, movie_id: movieId, movie_data: updatedMovie },
          { onConflict: 'user_id,movie_id' },
        )
      if (saveError) throw saveError
      return true
    } catch (cause) {
      moviesRef.current = previousMovies
      setMovies(previousMovies)
      setError(cause instanceof Error ? cause.message : 'Could not sync this rating.')
      return false
    }
  }

  const removeWatched = async (movie: Movie) => {
    setError('')
    const previousMovies = movies
    setMovies(movies.filter((saved) => saved.id !== movie.id))

    if (!userId) {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(previousMovies.filter((saved) => saved.id !== movie.id)))
      } catch (cause) {
        setMovies(previousMovies)
        setError(cause instanceof Error ? cause.message : 'Could not update your watched films.')
      }
      return
    }

    if (!supabase) {
      setMovies(previousMovies)
      setError('Account watched lists are unavailable because Supabase is not configured.')
      return
    }

    try {
      const { error: deleteError } = await supabase
        .from('watched_movies')
        .delete()
        .eq('user_id', userId)
        .eq('movie_id', movie.id)
      if (deleteError) throw deleteError
    } catch (cause) {
      setMovies(previousMovies)
      setError(cause instanceof Error ? cause.message : 'Could not sync your watched films.')
    }
  }

  return { movies, contains, loading, error, markWatched, addMany, setRating, removeWatched, retry: () => setReloadKey((key) => key + 1) }
}
