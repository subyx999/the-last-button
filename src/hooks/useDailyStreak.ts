import { useEffect, useState } from 'react'
import { supabase } from '../services/supabase'

const STORAGE_KEY = 'the-last-button-daily-streak'

interface DailyWatch {
  watchedDate: string
  movieId: number
}

function isDailyWatch(value: unknown): value is DailyWatch {
  return Boolean(
    value
    && typeof value === 'object'
    && 'watchedDate' in value
    && isDateKey(value.watchedDate)
    && 'movieId' in value
    && typeof value.movieId === 'number'
    && value.movieId > 0,
  )
}

function readGuestWatches(): DailyWatch[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]')
    if (!Array.isArray(value)) return []
    const uniqueWatches = new Map<string, DailyWatch>()
    for (const watch of value) {
      if (isDailyWatch(watch) && !uniqueWatches.has(watch.watchedDate)) {
        uniqueWatches.set(watch.watchedDate, watch)
      }
    }
    return [...uniqueWatches.values()]
  } catch {
    return []
  }
}

function isDateKey(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const date = new Date(`${value}T00:00:00.000Z`)
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value
}

function dateOrdinal(date: string) {
  return Date.parse(`${date}T00:00:00.000Z`) / 86_400_000
}

function streakSummary(dates: string[], today: string) {
  const ordinals = [...new Set(dates.filter(isDateKey).map(dateOrdinal))].sort((a, b) => a - b)
  const watchedDays = new Set(ordinals)
  let current = 0
  let currentDay = dateOrdinal(today)

  if (!watchedDays.has(currentDay)) currentDay -= 1
  while (watchedDays.has(currentDay)) {
    current += 1
    currentDay -= 1
  }

  let best = 0
  let run = 0
  let previous: number | undefined
  for (const day of ordinals) {
    run = previous !== undefined && day === previous + 1 ? run + 1 : 1
    best = Math.max(best, run)
    previous = day
  }

  return { current, best }
}

export function useDailyStreak(userId: string | undefined, today: string) {
  const [watches, setWatches] = useState<DailyWatch[]>(readGuestWatches)
  const [loading, setLoading] = useState(Boolean(userId))
  const [error, setError] = useState('')
  const [reloadKey, setReloadKey] = useState(0)
  const [pendingWatch, setPendingWatch] = useState<DailyWatch | null>(null)

  useEffect(() => {
    let active = true
    setError('')

    if (!userId) {
      setWatches(readGuestWatches())
      setLoading(false)
      return () => { active = false }
    }

    if (!supabase) {
      setWatches([])
      setLoading(false)
      setError('Account streak sync is unavailable because Supabase is not configured.')
      return () => { active = false }
    }

    setLoading(true)
    async function loadStreak() {
      const { data, error: queryError } = await supabase!
        .from('daily_movie_watches')
        .select('watched_date, movie_id')
        .order('watched_date', { ascending: false })
      if (queryError) throw queryError

      const accountWatches = (data ?? [])
        .filter((row): row is { watched_date: string; movie_id: number } =>
          isDateKey(row.watched_date) && typeof row.movie_id === 'number',
        )
        .map((row) => ({ watchedDate: row.watched_date, movieId: row.movie_id }))
      const guestWatches = readGuestWatches()
      const accountDates = new Set(accountWatches.map((watch) => watch.watchedDate))
      const guestOnly = guestWatches.filter((watch) => !accountDates.has(watch.watchedDate))
      const mergedWatches = [...guestOnly, ...accountWatches]

      if (guestOnly.length) {
        const { error: migrationError } = await supabase!
          .from('daily_movie_watches')
          .upsert(
            guestOnly.map(({ watchedDate, movieId }) => ({
              user_id: userId,
              watched_date: watchedDate,
              movie_id: movieId,
            })),
            { onConflict: 'user_id,watched_date', ignoreDuplicates: true },
          )
        if (migrationError) throw migrationError
      }

      if (!active) return
      if (guestWatches.length) localStorage.removeItem(STORAGE_KEY)
      setWatches(mergedWatches)
    }

    loadStreak().catch((cause: unknown) => {
      if (active) setError(cause instanceof Error ? cause.message : 'Could not load your daily streak.')
    }).finally(() => {
      if (active) setLoading(false)
    })

    return () => { active = false }
  }, [userId, reloadKey])

  async function saveWatch(watch: DailyWatch): Promise<boolean> {
    const previousWatches = watches
    const nextWatches = [...previousWatches, watch]
    setWatches(nextWatches)
    setError('')

    if (!userId) {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(nextWatches))
        setPendingWatch(null)
        return true
      } catch (cause) {
        setWatches(previousWatches)
        setPendingWatch(watch)
        setError(cause instanceof Error ? cause.message : 'Could not save your daily streak.')
        return false
      }
    }

    if (!supabase) {
      setWatches(previousWatches)
      setPendingWatch(watch)
      setError('Account streak sync is unavailable because Supabase is not configured.')
      return false
    }

    try {
      const { error: saveError } = await supabase
        .from('daily_movie_watches')
        .upsert(
          { user_id: userId, watched_date: watch.watchedDate, movie_id: watch.movieId },
          { onConflict: 'user_id,watched_date', ignoreDuplicates: true },
        )
      if (saveError) throw saveError
      setPendingWatch(null)
      return true
    } catch (cause) {
      setWatches(previousWatches)
      setPendingWatch(watch)
      setError(cause instanceof Error ? cause.message : 'Could not sync your daily streak.')
      return false
    }
  }

  async function markTodayWatched(movieId: number, watchedDate: string) {
    if (!isDateKey(watchedDate) || !movieId) {
      setError('Could not record the daily movie streak because the movie or date is invalid.')
      return false
    }
    if (watches.some((watch) => watch.watchedDate === watchedDate)) return true
    return saveWatch({ watchedDate, movieId })
  }

  async function retry() {
    if (pendingWatch) {
      await saveWatch(pendingWatch)
      return
    }
    setReloadKey((key) => key + 1)
  }

  return {
    ...streakSummary(watches.map((watch) => watch.watchedDate), today),
    loading,
    error,
    markTodayWatched,
    retry,
  }
}
