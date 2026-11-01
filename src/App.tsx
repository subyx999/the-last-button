import { useEffect, useRef, useState, type FormEvent } from 'react'
import {
  discoverMoviesByGenre,
  findExactMovie,
  getMovie,
  getMovieGenres,
  getMovieOfTheDay,
  getRandomMovie,
  imageUrl,
  isReleasedMovie,
  searchMovies,
  type MovieGenre,
} from './services/tmdb'
import { parseLetterboxdDiary } from './services/letterboxd'
import { useWatchlist } from './hooks/useWatchlist'
import { useWatched } from './hooks/useWatched'
import { useLikes } from './hooks/useLikes'
import { useDailyStreak } from './hooks/useDailyStreak'
import { useAuth } from './hooks/useAuth'
import { isTasteProfileConfigured, profileImageUrl, useProfile } from './hooks/useProfile'
import ProfileEditor from './components/ProfileEditor'
import TasteProfileEditor from './components/TasteProfileEditor'
import UsernameEditor from './components/UsernameEditor'
import CinemaArchive from './components/CinemaArchive'
import ArchiveFilmView from './components/ArchiveFilmView'
import type { ArchiveSection } from './components/CinemaArchive'
import { getMovieViewings } from './services/watchHistory'
import { supabase, SUPABASE_SETUP_MESSAGE } from './services/supabase'
import { EMPTY_TASTE_PROFILE, type Movie, type ThemePreference } from './types'

type Screen = 'home' | 'discover' | 'watchlist' | 'watched' | 'detail' | 'archive-detail' | 'auth' | 'settings'
type DiscoverMode = 'search' | 'genres'
type AuthMode = 'sign-in' | 'sign-up' | 'reset-password' | 'update-password'
type RetryTarget = 'daily' | 'random' | { detail: Movie; archive?: boolean } | null
function isThemePreference(value: string | null | undefined): value is ThemePreference {
  return value === 'light' || value === 'dark' || value === 'system'
}

function initialThemePreference(): ThemePreference {
  const preference = document.documentElement.dataset.themePreference
  return isThemePreference(preference) ? preference : 'light'
}

function passwordRecoveryRedirectUrl() {
  const origin = import.meta.env.DEV ? window.location.origin : 'https://the-last-button.vercel.app'
  return new URL('/?flow=recovery', origin).toString()
}

function applyTheme(preference: ThemePreference) {
  const theme = preference === 'system'
    ? window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
    : preference
  const root = document.documentElement
  root.dataset.theme = theme
  root.dataset.themePreference = preference
  root.style.colorScheme = theme
  document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')?.setAttribute('content', theme === 'dark' ? '#171715' : '#f2efe7')
}

function utcDateKey(date = new Date()) {
  return date.toISOString().slice(0, 10)
}

function millisecondsUntilNextUtcDay(date = new Date()) {
  const nextUtcDay = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + 1)
  return nextUtcDay - date.getTime() + 50
}

function millisecondsUntilNextLocalDay(date = new Date()) {
  const nextLocalDay = new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1)
  return nextLocalDay.getTime() - date.getTime() + 50
}

function ErrorNotice({ message, onRetry, retryLabel = 'TRY AGAIN', disabled = false }: {
  message: string
  onRetry?: () => void
  retryLabel?: string
  disabled?: boolean
}) {
  return (
    <div className="inline-error" role="alert">
      <span>{message}</span>
      {onRetry && <button className="error-retry" onClick={onRetry} disabled={disabled}>{retryLabel} ↻</button>}
    </div>
  )
}

function yearOf(movie: Movie) {
  return movie.release_date?.slice(0, 4) || 'YEAR UNKNOWN'
}

function metadataNote(movie: Movie) {
  const genre = movie.genres?.[0]?.name
  if (movie.runtime) return `A ${movie.runtime}-minute feature${genre ? ` filed under ${genre.toLowerCase()}` : ''}.`
  if (movie.release_date) return `Released on ${movie.release_date}${genre ? `; genre: ${genre}` : ''}.`
  if (genre) return `TMDB categorizes this film as ${genre.toLowerCase()}.`
  return 'The archive has no verified trivia for this title yet.'
}

function RatingStars({ rating, onRate, label, disabled }: {
  rating: number | null | undefined
  onRate: (value: number | null) => void
  label: string
  disabled: boolean
}) {
  return (
    <div className="star-rating" role="group" aria-label={`${label}: ${rating ? `${rating} out of 5 stars` : 'not rated'}`}>
      {[1, 2, 3, 4, 5].map((star) => {
        const fill = Math.max(0, Math.min(100, ((rating ?? 0) - star + 1) * 100))
        return (
          <button
            className="rating-star"
            key={star}
            type="button"
            aria-label={`Rate ${label} ${star - 0.5} or ${star} stars`}
            title={`${star - 0.5}–${star} stars`}
            disabled={disabled}
            onClick={(event) => {
              const bounds = event.currentTarget.getBoundingClientRect()
              const value = star - (event.clientX < bounds.left + bounds.width / 2 ? 0.5 : 0)
              onRate(rating === value ? null : value)
            }}
          >
            <span style={{ backgroundImage: `linear-gradient(90deg, var(--red) ${fill}%, var(--star-empty) ${fill}%)` }}>★</span>
          </button>
        )
      })}
    </div>
  )
}

function App() {
  const [screen, setScreen] = useState<Screen>('home')
  const [localDate, setLocalDate] = useState(() => new Date())
  const [themePreference, setThemePreference] = useState<ThemePreference>(initialThemePreference)
  const [featured, setFeatured] = useState<Movie | null>(null)
  const [selected, setSelected] = useState<Movie | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [authMode, setAuthMode] = useState<AuthMode>('sign-in')
  const [authEmail, setAuthEmail] = useState('')
  const [authPassword, setAuthPassword] = useState('')
  const [authPasswordConfirmation, setAuthPasswordConfirmation] = useState('')
  const [authBusy, setAuthBusy] = useState(false)
  const [authMessage, setAuthMessage] = useState('')
  const [resetPasswordError, setResetPasswordError] = useState('')
  const [deleteConfirm, setDeleteConfirm] = useState(false)
  const [deleteBusy, setDeleteBusy] = useState(false)
  const [diaryImportBusy, setDiaryImportBusy] = useState(false)
  const [diaryImportProgress, setDiaryImportProgress] = useState('')
  const [diaryImportMessage, setDiaryImportMessage] = useState('')
  const [diaryImportReport, setDiaryImportReport] = useState<{ imported: number; alreadySaved: number; skipped: number } | null>(null)
  const [pendingWatchedMovie, setPendingWatchedMovie] = useState<Movie | null>(null)
  const [pendingRating, setPendingRating] = useState<number | null>(null)
  const [pendingReview, setPendingReview] = useState('')
  const [pendingLiked, setPendingLiked] = useState(false)
  const [pendingWatchedEditOnly, setPendingWatchedEditOnly] = useState(false)
  const [pendingWatchedViewingId, setPendingWatchedViewingId] = useState<string | undefined>(undefined)
  const [archiveSection, setArchiveSection] = useState<ArchiveSection>('overview')
  const [favoriteSearch, setFavoriteSearch] = useState('')
  const [favoriteResults, setFavoriteResults] = useState<Movie[]>([])
  const [favoriteSearchBusy, setFavoriteSearchBusy] = useState(false)
  const [favoriteSearchError, setFavoriteSearchError] = useState('')
  const [discoverMode, setDiscoverMode] = useState<DiscoverMode>('search')
  const [movieSearch, setMovieSearch] = useState('')
  const [searchResults, setSearchResults] = useState<Movie[]>([])
  const [searchBusy, setSearchBusy] = useState(false)
  const [searchError, setSearchError] = useState('')
  const [searchRetry, setSearchRetry] = useState(0)
  const [genres, setGenres] = useState<MovieGenre[]>([])
  const [genresLoading, setGenresLoading] = useState(false)
  const [genresError, setGenresError] = useState('')
  const [genresRetry, setGenresRetry] = useState(0)
  const [selectedGenreIds, setSelectedGenreIds] = useState<number[]>([])
  const [genreResults, setGenreResults] = useState<Movie[]>([])
  const [genreResultsBusy, setGenreResultsBusy] = useState(false)
  const [genreResultsError, setGenreResultsError] = useState('')
  const [genreResultsRetry, setGenreResultsRetry] = useState(0)
  const [utcDate, setUtcDate] = useState(() => utcDateKey())
  const randomMovieIds = useRef(new Set<number>())
  const retryTarget = useRef<RetryTarget>(null)
  const detailReturnScreen = useRef<Screen>('home')
  const archiveDetailHistory = useRef(false)
  const archiveViewingId = useRef<string | undefined>(undefined)
  const authSubmitInFlight = useRef(false)

  useEffect(() => {
    const timeout = window.setTimeout(
      () => setLocalDate(new Date()),
      millisecondsUntilNextLocalDay(localDate),
    )
    return () => window.clearTimeout(timeout)
  }, [localDate])

  const {
    user,
    loading: authLoading,
    error: sessionError,
    passwordRecovery,
    passwordRecoveryError,
    clearPasswordRecovery,
    clearPasswordRecoveryError,
    clearError: clearSessionError,
    setError: setSessionError,
  } = useAuth()
  const { profile, loading: profileLoading, error: profileError, saveCollections, saveFavorites, saveTasteProfile, saveUsername, updateImage } = useProfile(user?.id)
  const { movies: watchlist, contains, toggle, loading: watchlistLoading, error: watchlistError, retry: retryWatchlist } = useWatchlist(user?.id)
  const {
    movies: watchedMovies,
    contains: hasWatched,
    loading: watchedLoading,
    error: watchedError,
    markWatched,
    logRewatch,
    addMany: addWatchedMany,
    setRating: setWatchedRating,
    removeWatched,
    retry: retryWatched,
  } = useWatched(user?.id)
  const {
    movies: likedMovies,
    loading: likesLoading,
    error: likesError,
    contains: hasLiked,
    setLiked,
    toggle: toggleLike,
    pendingMovieIds: pendingLikeIds,
    retry: retryLikes,
  } = useLikes(user?.id, watchedMovies, watchedLoading)
  const {
    current: dailyStreak,
    best: bestDailyStreak,
    loading: streakLoading,
    error: streakError,
    markTodayWatched,
    retry: retryStreak,
  } = useDailyStreak(user?.id, utcDate)
  const dateLabel = new Intl.DateTimeFormat('en', {
    weekday: 'long', day: '2-digit', month: 'long', timeZone: 'UTC',
  }).format(new Date(`${utcDate}T00:00:00.000Z`))
  const ratedMovies = watchedMovies
    .filter((movie): movie is Movie & { user_rating: number } => movie.user_rating !== null && movie.user_rating !== undefined)
    .sort((a, b) => b.user_rating - a.user_rating)
  const averageRating = ratedMovies.length
    ? (ratedMovies.reduce((total, movie) => total + movie.user_rating, 0) / ratedMovies.length).toFixed(1)
    : '—'
  const tasteProfileReady = !profileLoading && !(user && profileError)
  const activeTasteProfile = tasteProfileReady ? profile.tasteProfile : EMPTY_TASTE_PROFILE
  const tasteProfileConfigured = tasteProfileReady && isTasteProfileConfigured(activeTasteProfile)

  useEffect(() => {
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)')
    const updateTheme = () => applyTheme(themePreference)
    const handleSystemThemeChange = () => {
      if (themePreference === 'system') updateTheme()
    }
    const handleStorageChange = (event: StorageEvent) => {
      if (event.key === 'tlb-theme') setThemePreference(isThemePreference(event.newValue) ? event.newValue : 'light')
    }

    updateTheme()
    try {
      window.localStorage.setItem('tlb-theme', themePreference)
    } catch (cause) {
      console.warn('Could not save the appearance preference.', cause)
    }

    if (themePreference === 'system') mediaQuery.addEventListener('change', handleSystemThemeChange)
    window.addEventListener('storage', handleStorageChange)
    return () => {
      mediaQuery.removeEventListener('change', handleSystemThemeChange)
      window.removeEventListener('storage', handleStorageChange)
    }
  }, [themePreference])

  useEffect(() => {
    function handleArchiveHistory(event: PopStateEvent) {
      const state = event.state as { tlbArchiveDetail?: boolean; tlbArchiveOriginalDetail?: boolean } | null
      if (state?.tlbArchiveOriginalDetail && selected) {
        archiveDetailHistory.current = true
        setScreen('detail')
        return
      }
      if (state?.tlbArchiveDetail && selected) {
        archiveDetailHistory.current = true
        setScreen('archive-detail')
        return
      }
      if (archiveDetailHistory.current) {
        archiveDetailHistory.current = false
        setScreen(detailReturnScreen.current)
        setError('')
      }
    }

    window.addEventListener('popstate', handleArchiveHistory)
    return () => window.removeEventListener('popstate', handleArchiveHistory)
  }, [selected])

  useEffect(() => {
    const query = favoriteSearch.trim()
    if (query.length < 2) {
      setFavoriteResults([])
      setFavoriteSearchBusy(false)
      setFavoriteSearchError('')
      return
    }

    let active = true
    const timer = window.setTimeout(() => {
      setFavoriteSearchBusy(true)
      setFavoriteSearchError('')
      searchMovies(query).then((movies) => {
        if (active) setFavoriteResults(movies)
      }).catch((cause: unknown) => {
        if (active) setFavoriteSearchError(cause instanceof Error ? cause.message : 'Could not search TMDB.')
      }).finally(() => {
        if (active) setFavoriteSearchBusy(false)
      })
    }, 280)

    return () => {
      active = false
      window.clearTimeout(timer)
    }
  }, [favoriteSearch])

  useEffect(() => {
    if (screen !== 'discover' || discoverMode !== 'search') return
    const query = movieSearch.trim()
    if (!query) {
      setSearchResults([])
      setSearchBusy(false)
      setSearchError('')
      return
    }

    let active = true
    setSearchResults([])
    setSearchBusy(true)
    setSearchError('')
    const timer = window.setTimeout(() => {
      searchMovies(query).then((movies) => {
        if (active) setSearchResults(movies)
      }).catch((cause: unknown) => {
        if (active) setSearchError(cause instanceof Error ? cause.message : 'Could not search TMDB.')
      }).finally(() => {
        if (active) setSearchBusy(false)
      })
    }, 280)

    return () => {
      active = false
      window.clearTimeout(timer)
    }
  }, [discoverMode, movieSearch, screen, searchRetry])

  useEffect(() => {
    if (screen !== 'discover' || discoverMode !== 'genres' || genres.length) return
    let active = true
    setGenresLoading(true)
    setGenresError('')
    getMovieGenres().then((items) => {
      if (active) setGenres(items)
    }).catch((cause: unknown) => {
      if (active) setGenresError(cause instanceof Error ? cause.message : 'Could not load TMDB genres.')
    }).finally(() => {
      if (active) setGenresLoading(false)
    })
    return () => { active = false }
  }, [discoverMode, genres.length, genresRetry, screen])

  useEffect(() => {
    if (screen !== 'discover' || discoverMode !== 'genres') return
    if (!selectedGenreIds.length) {
      setGenreResults([])
      setGenreResultsBusy(false)
      setGenreResultsError('')
      return
    }

    let active = true
    setGenreResults([])
    setGenreResultsBusy(true)
    setGenreResultsError('')
    discoverMoviesByGenre(selectedGenreIds).then((movies) => {
      if (active) setGenreResults(movies)
    }).catch((cause: unknown) => {
      if (active) setGenreResultsError(cause instanceof Error ? cause.message : 'Could not discover movies.')
    }).finally(() => {
      if (active) setGenreResultsBusy(false)
    })
    return () => { active = false }
  }, [discoverMode, genreResultsRetry, screen, selectedGenreIds])

  useEffect(() => {
    const checkForUtcDateChange = () => {
      const currentUtcDate = utcDateKey()
      if (currentUtcDate !== utcDate) setUtcDate(currentUtcDate)
    }
    const timer = window.setTimeout(checkForUtcDateChange, millisecondsUntilNextUtcDay())
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') checkForUtcDateChange()
    }
    document.addEventListener('visibilitychange', handleVisibilityChange)

    return () => {
      window.clearTimeout(timer)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }, [utcDate])

  useEffect(() => {
    let active = true
    setFeatured(null)
    setLoading(true)
    if (retryTarget.current === 'daily') {
      retryTarget.current = null
      setError('')
    }

    getMovieOfTheDay(new Date(`${utcDate}T00:00:00.000Z`)).then((movie) => {
      if (active) setFeatured(movie)
    }).catch((cause: unknown) => {
      if (active) {
        retryTarget.current = 'daily'
        setError(cause instanceof Error ? cause.message : 'The transmission failed. Please try again.')
      }
    }).finally(() => {
      if (active) setLoading(false)
    })
    return () => { active = false }
  }, [utcDate])

  useEffect(() => {
    if (passwordRecovery) {
      setAuthPassword('')
      setAuthPasswordConfirmation('')
      setAuthMode('update-password')
      setAuthMessage('')
      setScreen('settings')
    }
  }, [passwordRecovery])

  useEffect(() => {
    if (passwordRecoveryError) {
      setAuthMode('reset-password')
      setAuthMessage('')
      setScreen('settings')
    }
  }, [passwordRecoveryError])

  async function discoverRandom(additionalExcludedIds: ReadonlySet<number> = new Set()) {
    setBusy(true)
    setError('')
    try {
      const excludedIds = new Set(randomMovieIds.current)
      for (const id of additionalExcludedIds) excludedIds.add(id)
      for (const movie of watchedMovies) excludedIds.add(movie.id)
      if (featured) excludedIds.add(featured.id)
      if (selected) excludedIds.add(selected.id)
      const movie = await getRandomMovie(
        excludedIds,
        tasteProfileConfigured ? activeTasteProfile : undefined,
      )
      randomMovieIds.current.add(movie.id)
      if (screen !== 'detail') detailReturnScreen.current = screen
      setSelected(movie)
      setScreen('detail')
      retryTarget.current = null
    } catch (cause) {
      retryTarget.current = 'random'
      setError(cause instanceof Error ? cause.message : 'The randomizer missed. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  function requestWatched(movie: Movie, editOnly = false, viewingId?: string) {
    const savedMovie = watchedMovies.find((saved) => saved.id === movie.id)
    const viewing = editOnly && viewingId && savedMovie
      ? getMovieViewings(savedMovie).find((item) => item.id === viewingId)
      : undefined
    setPendingWatchedMovie(movie)
    setPendingRating(editOnly ? viewing?.user_rating ?? movie.user_rating ?? null : hasWatched(movie.id) ? null : movie.user_rating ?? null)
    setPendingReview(editOnly ? viewing?.user_review ?? movie.user_review ?? '' : hasWatched(movie.id) ? '' : movie.user_review ?? '')
    setPendingLiked(editOnly ? viewing?.user_liked ?? movie.user_liked ?? false : hasWatched(movie.id) ? false : movie.user_liked ?? false)
    setPendingWatchedEditOnly(editOnly)
    setPendingWatchedViewingId(editOnly ? viewingId : undefined)
  }

  async function markWatchedAndDiscover(movie: Movie, rating: number | null, review: string, liked: boolean): Promise<boolean> {
    setBusy(true)
    setError('')
    const movieToSave = { ...movie, user_rating: rating, user_review: review.trim(), user_liked: liked }
    const saved = hasWatched(movie.id)
      ? await logRewatch(movieToSave, rating, review.trim(), liked)
      : await markWatched(movieToSave)
    if (!saved) {
      setBusy(false)
      return false
    }

    if (featured?.id === movie.id) {
      const streakSaved = await markTodayWatched(movie.id, utcDateKey())
      if (!streakSaved) {
        setBusy(false)
        return false
      }
    }

    randomMovieIds.current.add(movie.id)
    setPendingWatchedMovie(null)
    setPendingWatchedViewingId(undefined)
    await discoverRandom(new Set([movie.id]))
    return true
  }

  async function saveArchiveReview(movie: Movie, rating: number | null, review: string, liked: boolean, viewingId?: string) {
    setBusy(true)
    setError('')
    const saved = await setWatchedRating(movie.id, rating, review.trim(), liked, viewingId)
    if (saved) {
      setSelected((current) => ({
        ...(current?.id === movie.id ? current : movie),
        user_rating: rating,
        user_review: review.trim(),
        user_liked: liked,
      }))
      setPendingWatchedMovie(null)
      setPendingWatchedEditOnly(false)
      setPendingWatchedViewingId(undefined)
    }
    setBusy(false)
  }

  async function importLetterboxdDiary(file: File) {
    setDiaryImportBusy(true)
    setDiaryImportProgress('Reading diary…')
    setDiaryImportMessage('')
    setDiaryImportReport(null)

    try {
      if (file.size > 5 * 1024 * 1024) throw new Error('This CSV is larger than 5 MB. Split the export into smaller files and try again.')
      const entries = parseLetterboxdDiary(await file.text())
      const matchedMovies = new Map<number, Movie>()
      let alreadySaved = 0
      let skipped = 0

      for (const [index, entry] of entries.entries()) {
        setDiaryImportProgress(`Matching ${index + 1} of ${entries.length}: ${entry.title}`)
        if (index > 0) await new Promise<void>((resolve) => window.setTimeout(resolve, 250))
        const movie = await findExactMovie(entry.title, entry.year)
        if (!movie) {
          skipped += 1
        } else if (hasWatched(movie.id) || matchedMovies.has(movie.id)) {
          alreadySaved += 1
        } else {
          matchedMovies.set(movie.id, movie)
        }
      }

      const additions = [...matchedMovies.values()]
      const saved = await addWatchedMany(additions)
      if (!saved) {
        setDiaryImportMessage('The matching films were found, but could not be saved. Check the sync error above and try again.')
        setDiaryImportReport({ imported: 0, alreadySaved, skipped })
        setDiaryImportProgress('')
        return
      }

      setDiaryImportReport({ imported: additions.length, alreadySaved, skipped })
      setDiaryImportProgress('')
    } catch (cause) {
      setDiaryImportMessage(cause instanceof Error ? cause.message : 'Could not import this diary file.')
      setDiaryImportProgress('')
    } finally {
      setDiaryImportBusy(false)
    }
  }

  async function openMovie(movie: Movie) {
    if (screen !== 'detail') detailReturnScreen.current = screen
    archiveDetailHistory.current = false
    archiveViewingId.current = undefined
    setSelected(movie)
    setScreen('detail')
    setError('')
    if (movie.credits) return

    setBusy(true)
    try {
      setSelected(await getMovie(movie.id))
      retryTarget.current = null
    } catch (cause) {
      retryTarget.current = { detail: movie }
      setError(cause instanceof Error ? cause.message : 'Movie details could not be loaded.')
    } finally {
      setBusy(false)
    }
  }

  async function openArchiveMovie(movie: Movie, viewingId?: string) {
    const returnScreen = screen === 'watched' ? 'watched' : 'auth'
    detailReturnScreen.current = returnScreen
    archiveDetailHistory.current = true
    archiveViewingId.current = viewingId
    setSelected(movie)
    setScreen('archive-detail')
    setError('')
    retryTarget.current = null
    try {
      window.history.pushState({ ...(window.history.state ?? {}), tlbArchiveDetail: true }, '')
    } catch (cause) {
      archiveDetailHistory.current = false
      setScreen(returnScreen)
      setError(cause instanceof Error ? `Could not open this archive entry: ${cause.message}` : 'Could not open this archive entry.')
      return
    }
    if (movie.credits) return

    setBusy(true)
    try {
      setSelected(await getMovie(movie.id))
      retryTarget.current = null
    } catch (cause) {
      retryTarget.current = { detail: movie, archive: true }
      setError(cause instanceof Error ? cause.message : 'Archive film details could not be loaded.')
    } finally {
      setBusy(false)
    }
  }

  function openOriginalMovieFromArchive(movie: Movie) {
    detailReturnScreen.current = 'archive-detail'
    archiveDetailHistory.current = true
    try {
      window.history.pushState({ tlbArchiveOriginalDetail: true }, '')
    } catch (cause) {
      setError(cause instanceof Error ? `Could not open movie details: ${cause.message}` : 'Could not open movie details.')
      return
    }

    setSelected(movie)
    setScreen('detail')
    setError('')
    retryTarget.current = null
  }

  async function retryFailedRequest() {
    const target = retryTarget.current
    setError('')
    if (target === 'daily') {
      setLoading(true)
      try {
        const movie = await getMovieOfTheDay()
        setFeatured(movie)
        retryTarget.current = null
      } catch (cause) {
        retryTarget.current = 'daily'
        setError(cause instanceof Error ? cause.message : 'The transmission failed. Please try again.')
      } finally {
        setLoading(false)
      }
    } else if (target === 'random') {
      await discoverRandom()
    } else if (target) {
      if (target.archive) {
        setBusy(true)
        try {
          setSelected(await getMovie(target.detail.id))
          retryTarget.current = null
        } catch (cause) {
          retryTarget.current = target
          setError(cause instanceof Error ? cause.message : 'Archive film details could not be loaded.')
        } finally {
          setBusy(false)
        }
      } else {
        await openMovie(target.detail)
      }
    }
  }

  async function submitAuth(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (authSubmitInFlight.current) return
    authSubmitInFlight.current = true
    setAuthBusy(true)
    setAuthMessage('')
    if (authMode === 'reset-password') setResetPasswordError('')
    clearSessionError()

    if (!supabase) {
      if (authMode === 'reset-password') setResetPasswordError(SUPABASE_SETUP_MESSAGE)
      else setSessionError(SUPABASE_SETUP_MESSAGE)
      setAuthBusy(false)
      authSubmitInFlight.current = false
      return
    }

    try {
      if (authMode === 'reset-password') {
        const { error: resetError } = await supabase.auth.resetPasswordForEmail(authEmail, {
          redirectTo: passwordRecoveryRedirectUrl(),
        })
        if (resetError) throw resetError
        clearPasswordRecoveryError()
        setAuthMessage('If an account exists for that email, a password reset link is on its way.')
        return
      }

      if (authMode === 'update-password') {
        if (authPassword !== authPasswordConfirmation) {
          setSessionError('Your passwords do not match.')
          return
        }
        const { error: updateError } = await supabase.auth.updateUser({ password: authPassword })
        if (updateError) throw updateError
        clearPasswordRecovery()
        clearPasswordRecoveryError()
        setAuthPassword('')
        setAuthPasswordConfirmation('')
        setAuthMode('sign-in')
        setScreen('home')
        setAuthMessage('Your password has been updated.')
        return
      }

      const result = authMode === 'sign-up'
        ? await supabase.auth.signUp({ email: authEmail, password: authPassword, options: { emailRedirectTo: window.location.origin } })
        : await supabase.auth.signInWithPassword({ email: authEmail, password: authPassword })

      if (result.error) throw result.error

      if (authMode === 'sign-up' && !result.data.session) {
        setAuthMessage('Check your email for a confirmation link, then sign in here.')
      } else {
        setAuthEmail('')
        setAuthPassword('')
        setScreen('home')
      }
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'Could not complete sign in. Please try again.'
      if (authMode === 'reset-password') setResetPasswordError(message)
      else setSessionError(message)
    } finally {
      authSubmitInFlight.current = false
      setAuthBusy(false)
    }
  }

  async function signInWithGoogle() {
    if (authSubmitInFlight.current) return
    authSubmitInFlight.current = true
    setAuthBusy(true)
    setAuthMessage('')
    clearSessionError()

    if (!supabase) {
      setSessionError(SUPABASE_SETUP_MESSAGE)
      setAuthBusy(false)
      authSubmitInFlight.current = false
      return
    }

    try {
      const { error: oauthError } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo: window.location.origin },
      })
      if (oauthError) throw oauthError
    } catch (cause) {
      setSessionError(cause instanceof Error ? cause.message : 'Could not sign in with Google. Please try again.')
    } finally {
      authSubmitInFlight.current = false
      setAuthBusy(false)
    }
  }

  async function signOut() {
    if (!supabase) return
    const { error: signOutError } = await supabase.auth.signOut()
    if (signOutError) {
      setSessionError(signOutError.message)
      return
    }
    setScreen('home')
  }

  async function deleteAccount() {
    if (!supabase || !user || !deleteConfirm) return
    setDeleteBusy(true)
    clearSessionError()
    try {
      const { error: deleteError } = await supabase.functions.invoke('delete-account')
      if (deleteError) throw deleteError
      const { error: localSignOutError } = await supabase.auth.signOut({ scope: 'local' })
      if (localSignOutError) throw new Error('Your account was deleted, but this device could not clear the local session. Refresh this page.')
      setDeleteConfirm(false)
      setScreen('home')
    } catch (cause) {
      setSessionError(cause instanceof Error ? cause.message : 'Could not delete the account. Please try again.')
    } finally {
      setDeleteBusy(false)
    }
  }

  function returnHome() {
    if (screen === 'archive-detail' && archiveDetailHistory.current) {
      const state = window.history.state as Record<string, unknown> | null
      if (state?.tlbArchiveDetail) {
        const nextState = { ...state }
        delete nextState.tlbArchiveDetail
        window.history.replaceState(nextState, '')
      }
      archiveDetailHistory.current = false
    }
    setScreen('home')
    setSelected(null)
    setError('')
  }

  function returnFromDetail() {
    if (screen === 'detail' && detailReturnScreen.current === 'archive-detail') {
      window.history.back()
      return
    }
    if (screen === 'archive-detail') {
      if (archiveDetailHistory.current) {
        window.history.back()
        return
      }
      setScreen(detailReturnScreen.current)
      setError('')
      return
    }
    setScreen(detailReturnScreen.current)
    setSelected(null)
    setError('')
  }

  function openDiscovery(mode: DiscoverMode) {
    setDiscoverMode(mode)
    setScreen('discover')
    setError('')
  }

  function toggleGenre(genreId: number) {
    setSelectedGenreIds((current) => current.includes(genreId)
      ? current.filter((id) => id !== genreId)
      : [...current, genreId])
  }

  const currentMovie = screen === 'detail' || screen === 'archive-detail' ? selected : featured
  const savedArchiveMovie = currentMovie ? watchedMovies.find((movie) => movie.id === currentMovie.id) : undefined
  const selectedArchiveViewing = savedArchiveMovie
    ? getMovieViewings(savedArchiveMovie).find((viewing) => viewing.id === archiveViewingId.current)
    : undefined
  const archivePersonalMovie = savedArchiveMovie && selectedArchiveViewing
    ? {
      ...savedArchiveMovie,
      watched_at: selectedArchiveViewing.watched_at,
      user_rating: selectedArchiveViewing.user_rating,
      user_review: selectedArchiveViewing.user_review,
      user_liked: selectedArchiveViewing.user_liked,
    }
    : savedArchiveMovie ?? currentMovie
  const trailer = currentMovie?.videos?.results?.find(
    (video) => video.site === 'YouTube' && video.type === 'Trailer',
  ) ?? currentMovie?.videos?.results?.find(
    (video) => video.site === 'YouTube' && video.type === 'Teaser',
  )
  const dateParts = new Intl.DateTimeFormat('en', {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
  }).formatToParts(localDate)
  const localDateLabel = `${dateParts.find((part) => part.type === 'day')?.value} ${dateParts.find((part) => part.type === 'month')?.value} ${dateParts.find((part) => part.type === 'year')?.value}`.toUpperCase()
  const localWeekday = new Intl.DateTimeFormat('en', { weekday: 'long' }).format(localDate).toUpperCase()

  return (
    <main className="site-shell">
      <header className="topbar">
        <button className="wordmark" onClick={returnHome} aria-label="Button., home">
          <span className="wordmark-icon">◉</span> Button.
        </button>
        <div className="topbar-status" aria-label={`Today's date: ${localDateLabel}, ${localWeekday}`}>
          <span className="topbar-date-label">TODAY’S DATE</span>
          <span className="topbar-date-main">{localDateLabel}</span>
          <span className="topbar-date-weekday">{localWeekday}</span>
        </div>
        <div className="topbar-actions">
          <button className={`watchlist-link ${screen === 'discover' ? 'is-current' : ''}`} onClick={() => openDiscovery('search')}>
            DISCOVER
          </button>
          <button className={`watchlist-link ${screen === 'watchlist' ? 'is-current' : ''}`} onClick={() => setScreen('watchlist')}>
            WATCHLIST <span className="watchlist-count">{watchlist.length.toString().padStart(2, '0')}</span>
          </button>
          <button className={`watchlist-link ${screen === 'watched' ? 'is-current' : ''}`} onClick={() => setScreen('watched')}>
            WATCHED <span className="watchlist-count">{watchedMovies.length.toString().padStart(2, '0')}</span>
          </button>
          <button className={`watchlist-link ${screen === 'settings' ? 'is-current' : ''}`} onClick={() => setScreen('settings')}>
            SETTINGS
          </button>
          <button className={`account-link ${screen === 'auth' ? 'is-current' : ''}`} onClick={() => {
            setAuthMessage('')
            setScreen('auth')
          }}>
            {authLoading ? 'PROFILE…' : 'PROFILE'}
          </button>
        </div>
      </header>

      <div className="date-strip">
        <span>ISSUE 01 — {dateLabel.toUpperCase()}</span>
        {screen !== 'detail' && (
          <button className="date-strip-action" onClick={() => { void discoverRandom() }} disabled={busy || watchedLoading}>
            {busy ? 'ROLLING…' : watchedLoading ? 'LOADING…' : 'DRAW A RANDOM FILM'} <span aria-hidden="true">↗</span>
          </button>
        )}
      </div>
      {sessionError && <ErrorNotice message={sessionError} />}
      {watchlistError && <ErrorNotice message={watchlistError} onRetry={retryWatchlist} disabled={watchlistLoading} />}
      {watchedError && <ErrorNotice message={watchedError} onRetry={retryWatched} disabled={watchedLoading} />}
      {likesError && <ErrorNotice message={likesError} onRetry={retryLikes} disabled={likesLoading} />}
      {streakError && <ErrorNotice message={streakError} onRetry={() => { void retryStreak() }} disabled={streakLoading} />}
      {error && <ErrorNotice
        message={error}
        onRetry={retryTarget.current ? () => { void retryFailedRequest() } : undefined}
        disabled={loading || busy}
      />}

      {screen === 'home' && (
        <>
          <section className="hero" aria-labelledby="daily-title">
            <div className="hero-copy">
              <p className="eyebrow"><span className="red-mark">✳</span> TODAY'S TRANSMISSION / 001</p>
              <h1 id="daily-title">Today's film.<br /><em>Chosen.</em></h1>
              <p className="hero-deck">
                {featured
                  ? `Today's pick: ${featured.title} (${yearOf(featured)}).`
                  : loading
                    ? 'Loading today’s movie…'
                    : 'Today’s movie could not be loaded.'}
              </p>
              <div className="hero-actions">
                <button className="button button-dark" onClick={() => featured && openMovie(featured)} disabled={!featured || loading}>
                  {loading ? 'TUNING IN…' : 'VIEW TODAY’S PICK'} <span aria-hidden="true">↗</span>
                </button>
                <button className="button button-secondary" onClick={() => featured && requestWatched(featured)} disabled={busy || loading || !featured || watchedLoading || streakLoading}>
                  {busy ? 'PICKING…' : featured && hasWatched(featured.id) ? 'LOG REWATCH' : 'WATCHED'} <span aria-hidden="true">↗</span>
                </button>
              </div>
              <div className="hero-footnote">
                <span>DECISION AUTHORITY: REVOKED</span>
                <span className="streak-count" aria-label={`${dailyStreak} day current streak, ${bestDailyStreak} day best streak`}>
                  STREAK {dailyStreak} / BEST {bestDailyStreak}
                </span>
                <span>01 / 01</span>
              </div>
            </div>

            <div className="poster-stage">
              <div className="stage-index">FRAME<br />{featured ? String(featured.id).padStart(6, '0') : '———'}</div>
              <div className="poster-wrap">
                {featured?.poster_path
                  ? <img src={imageUrl(featured.poster_path)} alt={`${featured.title} theatrical poster`} className="poster-image" fetchPriority="high" decoding="async" />
                  : <div className="image-placeholder"><span>{loading ? 'FETCHING<br />A FEELING' : 'IMAGE<br />MISSING'}</span></div>}
                <span className="poster-stamp">TODAY<br />ONLY</span>
              </div>
              <p className="poster-caption">THE DAILY PICK <span>— DO NOT OVERTHINK IT</span></p>
              <span className="orbit-mark" aria-hidden="true">✳</span>
            </div>
          </section>

          <footer className="site-footer"><span>Button. © 2026</span><span>YOUR NEXT TWO HOURS HAVE BEEN CLAIMED.</span><span>DATA: TMDB ↗</span></footer>
        </>
      )}

      {screen === 'discover' && (
        <section className="secondary-screen discovery-screen" aria-labelledby="discovery-title">
          <header className="discovery-masthead">
            <p className="eyebrow"><span className="red-mark">✳</span> INDEX 01 / THE UNSETTLED PICTURE ARCHIVE</p>
            <div className="discovery-heading">
              <div className="discovery-heading-main">
                <span className="discovery-edition">A FIELD GUIDE TO WHAT COMES NEXT</span>
                <h1 id="discovery-title"><span>Find a</span><br /><em>signal.</em></h1>
              </div>
              <div className="discovery-heading-note">
                <p>Not a recommendation engine. A loose thread through cinema, filed by title or feeling.</p>
                <button className="back-link" onClick={returnHome}>← TODAY'S TRANSMISSION</button>
              </div>
              <span className="discovery-masthead-mark" aria-hidden="true">01<br />/ 24</span>
            </div>
          </header>
          <div className="discovery-workbench">
            <aside className="discovery-rail" aria-label="Archive information">
              <span>Button.</span>
              <span>EST. IN THE MOMENT</span>
              <span>SEARCH / FILTER / WANDER</span>
            </aside>
            <div className="discovery-content">
              <div className="discovery-tabs" role="group" aria-label="Discovery method">
                <button className={discoverMode === 'search' ? 'is-selected' : ''} onClick={() => setDiscoverMode('search')} aria-pressed={discoverMode === 'search'}>
                  <span>01</span> TITLE SEARCH
                </button>
                <button className={discoverMode === 'genres' ? 'is-selected' : ''} onClick={() => setDiscoverMode('genres')} aria-pressed={discoverMode === 'genres'}>
                  <span>02</span> GENRE MIX
                </button>
              </div>
              {discoverMode === 'search' ? (
                <>
                  <label className="discovery-label" htmlFor="movie-search">
                    <span>OPEN QUERY</span><span>ONE WORD IS ENOUGH</span>
                  </label>
                  <div className="discovery-search-row">
                    <input
                      id="movie-search"
                      className="discovery-search"
                      type="search"
                      placeholder="Type a title…"
                      value={movieSearch}
                      onChange={(event) => setMovieSearch(event.target.value)}
                    />
                    <span className="discovery-search-mark" aria-hidden="true">↳</span>
                  </div>
                  {searchError && <ErrorNotice message={searchError} onRetry={() => setSearchRetry((count) => count + 1)} disabled={searchBusy} />}
                  {searchBusy ? <p className="discovery-status" role="status"><span className="discovery-status-mark" aria-hidden="true">◌</span> ASKING THE ARCHIVE…</p> : searchResults.length ? (
                    <>
                      <div className="discovery-results-heading">
                        <span>RETURN / “{movieSearch.trim()}”</span>
                        <span>{String(searchResults.length).padStart(2, '0')} FRAGMENTS</span>
                      </div>
                      <div className="discovery-results" aria-label="Movie search results">
                        {searchResults.map((movie, index) => {
                          const released = isReleasedMovie(movie)
                          const releaseLabel = released ? yearOf(movie) : movie.release_date ? 'UPCOMING' : 'RELEASE DATE UNKNOWN'
                          return (
                            <button className="discovery-card" key={movie.id} onClick={() => { void openMovie(movie) }} aria-label={`Open ${movie.title}, ${released ? yearOf(movie) : releaseLabel}`}>
                              <span className="discovery-card-index" aria-hidden="true">{String(index + 1).padStart(3, '0')} / FILM</span>
                              {movie.poster_path
                                ? <img src={imageUrl(movie.poster_path)} alt="" loading="lazy" decoding="async" />
                                : <span className="discovery-poster-placeholder">NO<br />IMAGE<br />ON FILE</span>}
                              <span className="discovery-card-title">{movie.title}</span>
                              <span className="discovery-card-meta-row">
                                <span className={`discovery-card-meta${released ? '' : ' is-upcoming'}`}>{releaseLabel}</span>
                                <span className="discovery-card-rating">{movie.vote_average && movie.vote_average > 0 ? `${movie.vote_average.toFixed(1)} / 10` : 'UNRATED'}</span>
                              </span>
                            </button>
                          )
                        })}
                      </div>
                    </>
                  ) : searchError ? null : movieSearch.trim() ? (
                    <p className="discovery-status" role="status">NO SIGNAL FOUND FOR THAT TITLE.</p>
                  ) : (
                    <p className="discovery-status">BEGIN WITH A TITLE — INCLUDING A SINGLE LETTER.</p>
                  )}
                </>
              ) : (
                <>
                  <div className="genre-toolbar">
                    <p className="discovery-label"><span>BUILD A GENRE MIX</span><span>FILMS MUST MATCH EVERY ACTIVE GENRE</span></p>
                    <div className="genre-selection-summary" aria-live="polite">
                      <span>{selectedGenreIds.length ? `${String(selectedGenreIds.length).padStart(2, '0')} ACTIVE` : 'NO FILTERS'}</span>
                      <button className="genre-clear" type="button" onClick={() => setSelectedGenreIds([])} disabled={!selectedGenreIds.length}>
                        CLEAR ALL <span aria-hidden="true">×</span>
                      </button>
                    </div>
                  </div>
                  {genresLoading ? <p className="discovery-status" role="status">OPENING THE GENRE INDEX…</p> : genresError ? (
                    <ErrorNotice message={genresError} onRetry={() => setGenresRetry((count) => count + 1)} disabled={genresLoading} />
                  ) : (
                    <div className="genre-filter-list" role="group" aria-label="Movie genres" aria-describedby="genre-filter-help">
                      <span id="genre-filter-help" className="sr-only">Select one or more genres. Results must include every selected genre.</span>
                      {genres.map((genre, index) => (
                        <button
                          key={genre.id}
                          className={`genre-filter${selectedGenreIds.includes(genre.id) ? ' is-selected' : ''}`}
                          onClick={() => toggleGenre(genre.id)}
                          aria-pressed={selectedGenreIds.includes(genre.id)}
                        >
                          <span className="genre-filter-index" aria-hidden="true">{String(index + 1).padStart(2, '0')}</span>
                          {genre.name}
                        </button>
                      ))}
                    </div>
                  )}
                  {genreResultsError && <ErrorNotice message={genreResultsError} onRetry={() => setGenreResultsRetry((count) => count + 1)} disabled={genreResultsBusy} />}
                  {genreResultsBusy ? <p className="discovery-status" role="status"><span className="discovery-status-mark" aria-hidden="true">◌</span> CROSS-REFERENCING THE INDEX…</p> : genreResults.length ? (
                    <>
                      <div className="discovery-results-heading">
                        <span>INTERSECTION / {selectedGenreIds.length} GENRE{selectedGenreIds.length === 1 ? '' : 'S'}</span>
                        <span>{String(genreResults.length).padStart(2, '0')} FRAGMENTS</span>
                      </div>
                      <div className="discovery-results" aria-label="Genre discovery results">
                        {genreResults.map((movie, index) => (
                          <button className="discovery-card" key={movie.id} onClick={() => { void openMovie(movie) }} aria-label={`Open ${movie.title}, ${yearOf(movie)}`}>
                            <span className="discovery-card-index" aria-hidden="true">{String(index + 1).padStart(3, '0')} / FILM</span>
                            {movie.poster_path
                              ? <img src={imageUrl(movie.poster_path)} alt="" loading="lazy" decoding="async" />
                              : <span className="discovery-poster-placeholder">NO<br />IMAGE<br />ON FILE</span>}
                            <span className="discovery-card-title">{movie.title}</span>
                            <span className="discovery-card-meta-row">
                              <span className="discovery-card-meta">{yearOf(movie)}</span>
                              <span className="discovery-card-rating">{movie.vote_average && movie.vote_average > 0 ? `${movie.vote_average.toFixed(1)} / 10` : 'UNRATED'}</span>
                            </span>
                          </button>
                        ))}
                      </div>
                    </>
                  ) : genreResultsError ? null : selectedGenreIds.length ? (
                    <p className="discovery-status" role="status">NO RELEASED FILMS MATCH EVERY SELECTED GENRE.</p>
                  ) : (
                    <p className="discovery-status">CHOOSE A GENRE TO START THE CROSS-REFERENCE.</p>
                  )}
                </>
              )}
            </div>
          </div>
        </section>
      )}

      {screen === 'watchlist' && (
        <section className="secondary-screen">
          <p className="eyebrow"><span className="red-mark">✳</span> PERSONAL ARCHIVE / {user ? 'SYNCED ACCOUNT' : 'LOCAL ONLY'}</p>
          <div className="secondary-heading"><h1>Later,<br /><em>maybe.</em></h1><span>{watchlist.length.toString().padStart(2, '0')} FILMS SAVED</span></div>
          {watchlistLoading ? <div className="loading-line">Opening your saved films…</div> : watchlist.length ? (
            <div className="watchlist-grid">
              {watchlist.map((movie, index) => (
                <article className="watch-item" key={movie.id}>
                  <button className="watch-item-open" onClick={() => openMovie(movie)} aria-label={`Open ${movie.title}`}>
                    {movie.poster_path ? <img src={imageUrl(movie.poster_path)} alt="" loading="lazy" decoding="async" /> : <div className="image-placeholder">NO<br />IMAGE</div>}
                    <span className="watch-item-index">{String(index + 1).padStart(2, '0')} / {yearOf(movie)}</span>
                    <h2>{movie.title}</h2>
                  </button>
                  <button className="remove-button" onClick={() => { void toggle(movie) }} disabled={watchlistLoading} aria-label={`Remove ${movie.title} from watchlist`}>REMOVE ×</button>
                </article>
              ))}
            </div>
          ) : <div className="empty-state"><p>Nothing waiting in the wings.</p><span>Save a film from today's pick or a random discovery.</span><button className="text-button" onClick={returnHome}>BACK TO TODAY ↗</button></div>}
          <button className="back-link" onClick={returnHome}>← BACK TO THE DAILY PICK</button>
        </section>
      )}

      {screen === 'watched' && (
        <section className="secondary-screen">
          <p className="eyebrow"><span className="red-mark">✳</span> PERSONAL ARCHIVE / {user ? 'SYNCED ACCOUNT' : 'LOCAL ONLY'}</p>
          <div className="secondary-heading"><h1>Already<br /><em>seen.</em></h1><span>{watchedMovies.length.toString().padStart(2, '0')} FILMS WATCHED</span></div>
          <p className="account-description watched-intro">Saved here so random picks can skip films you’ve already seen.</p>
          {watchedLoading ? <div className="loading-line">Opening your watched films…</div> : watchedMovies.length ? (
            <div className="watchlist-grid">
              {watchedMovies.map((movie, index) => (
                <article className="watch-item" key={movie.id}>
                  <button className="watch-item-open" onClick={() => { void openArchiveMovie(movie) }} aria-label={`Open ${movie.title}`}>
                    {movie.poster_path ? <img src={imageUrl(movie.poster_path)} alt="" loading="lazy" decoding="async" /> : <div className="image-placeholder">NO<br />IMAGE</div>}
                    <span className="watch-item-index">{String(index + 1).padStart(2, '0')} / {yearOf(movie)}</span>
                    <h2>{movie.title}</h2>
                  </button>
                  <RatingStars
                    rating={movie.user_rating}
                    onRate={(rating) => { void setWatchedRating(movie.id, rating) }}
                    label={movie.title}
                    disabled={watchedLoading}
                  />
                  <button
                    className={`watch-item-like${hasLiked(movie.id) ? ' is-liked' : ''}`}
                    type="button"
                    aria-pressed={hasLiked(movie.id)}
                    onClick={() => { void toggleLike(movie) }}
                    disabled={pendingLikeIds.has(movie.id)}
                  >
                    {pendingLikeIds.has(movie.id) ? 'SAVING…' : hasLiked(movie.id) ? '♥ LIKED' : '♡ LIKE'}
                  </button>
                  {movie.user_rating !== null && movie.user_rating !== undefined && (
                    <span className="rating-value">{movie.user_rating} / 5</span>
                  )}
                  {movie.user_review?.trim() && <p className="watch-item-review">{movie.user_review}</p>}
                  <button className="remove-button remove-icon" onClick={() => { void removeWatched(movie) }} disabled={watchedLoading} aria-label={`Remove ${movie.title} from watched`} title="Remove from watched">
                    ×
                  </button>
                </article>
              ))}
            </div>
          ) : <div className="empty-state"><p>No films marked watched yet.</p><span>Mark a film watched to keep it out of future random picks.</span><button className="text-button" onClick={returnHome}>BACK TO TODAY ↗</button></div>}
          <button className="back-link" onClick={returnHome}>← BACK TO THE DAILY PICK</button>
        </section>
      )}

      {screen === 'archive-detail' && currentMovie && (
        <ArchiveFilmView
          movie={currentMovie}
          personalMovie={archivePersonalMovie ?? currentMovie}
          loading={busy}
          onBack={returnFromDetail}
          onOpenOriginal={openOriginalMovieFromArchive}
          onEditReview={() => requestWatched(archivePersonalMovie ?? currentMovie, true, archiveViewingId.current)}
        />
      )}

      {screen === 'detail' && currentMovie && (
        <section className="detail-screen">
          <button className="back-link" onClick={returnFromDetail}>← BACK</button>
          <div className="detail-hero" style={currentMovie.backdrop_path ? { backgroundImage: `linear-gradient(90deg, #171715 0%, rgba(23,23,21,.86) 45%, rgba(23,23,21,.24) 100%), url("${imageUrl(currentMovie.backdrop_path, 'original')}")` } : undefined}>
            <div className="detail-copy">
              <p className="eyebrow">FILM FILE / {String(currentMovie.id).padStart(6, '0')}</p>
              <h1>{currentMovie.title}<sup>{yearOf(currentMovie)}</sup></h1>
              {currentMovie.tagline && <p className="detail-tagline">“{currentMovie.tagline}”</p>}
              <div className="detail-meta">
                <span>{currentMovie.runtime ? `${currentMovie.runtime} MIN` : 'RUNTIME N/A'}</span>
                <span>{currentMovie.vote_average ? `${currentMovie.vote_average.toFixed(1)} / 10` : 'UNRATED'}</span>
                {currentMovie.genres?.map((genre) => <span key={genre.id}>{genre.name.toUpperCase()}</span>)}
              </div>
              <p className="detail-overview">{currentMovie.overview || 'No synopsis available from the archive.'}</p>
              <div className="detail-actions">
                {hasWatched(currentMovie.id) ? (
                  <>
                    <button className="button button-detail-random" onClick={() => requestWatched(currentMovie)} disabled={busy || watchedLoading}>
                      {busy ? 'SAVING…' : 'LOG REWATCH'} <span aria-hidden="true">↻</span>
                    </button>
                    <button className="button button-light" onClick={() => { void removeWatched(currentMovie) }} disabled={watchedLoading}>
                      {watchedLoading ? 'UPDATING…' : 'REMOVE ×'}
                    </button>
                  </>
                ) : (
                  <>
                    <button className="button button-light" onClick={() => { void toggle(currentMovie) }} disabled={watchlistLoading} aria-pressed={contains(currentMovie.id)}>
                      {watchlistLoading ? 'SYNCING…' : contains(currentMovie.id) ? '− REMOVE FROM WATCHLIST' : '+ SAVE FOR LATER'}
                    </button>
                    <button className="button button-detail-random" onClick={() => requestWatched(currentMovie)} disabled={busy || watchedLoading || (featured?.id === currentMovie.id && streakLoading)}>
                      {busy ? 'PICKING…' : 'WATCHED'} <span aria-hidden="true">↗</span>
                    </button>
                  </>
                )}
                <button
                  className={`button ${hasLiked(currentMovie.id) ? 'button-liked' : 'button-secondary'}`}
                  type="button"
                  aria-pressed={hasLiked(currentMovie.id)}
                  disabled={pendingLikeIds.has(currentMovie.id)}
                  onClick={() => { void toggleLike(currentMovie) }}
                >
                  {pendingLikeIds.has(currentMovie.id) ? 'SAVING…' : hasLiked(currentMovie.id) ? '♥ LIKED' : '♡ LIKE'}
                </button>
              </div>
            </div>
            {currentMovie.poster_path && <img className="detail-poster" src={imageUrl(currentMovie.poster_path)} alt={`${currentMovie.title} poster`} decoding="async" />}
          </div>
          {busy && <div className="loading-line">Opening the film file…</div>}
          <div className="detail-columns">
            <section className="detail-fact">
              <span className="micro-label">A NOTE FROM THE ARCHIVE / METADATA</span>
              <p>{metadataNote(currentMovie)}</p>
              {trailer ? (
                <a className="button button-trailer" href={`https://www.youtube.com/watch?v=${trailer.key}`} target="_blank" rel="noreferrer">
                  WATCH TRAILER ↗
                </a>
              ) : (
                <p className="trailer-unavailable">NO TRAILER LISTED</p>
              )}
            </section>
            <section><span className="micro-label">THE PEOPLE</span><h2>In the frame.</h2><p className="cast-list">{currentMovie.credits?.cast?.slice(0, 8).map((person) => `${person.name} as ${person.character}`).join(' · ') || 'Cast details not available.'}</p>
              {currentMovie.credits?.crew?.find((person) => person.job === 'Director') && <p className="crew-line">DIRECTED BY / {currentMovie.credits.crew.find((person) => person.job === 'Director')?.name}</p>}
            </section>
          </div>
          <div className="detail-extras">
            {currentMovie.production_companies?.length ? <p><span className="micro-label">PRODUCTION</span>{currentMovie.production_companies.slice(0, 3).map((company) => company.name).join(' · ')}</p> : null}
            {currentMovie.production_countries?.length ? <p><span className="micro-label">ORIGIN</span>{currentMovie.production_countries.map((country) => country.name).join(' · ')}</p> : null}
            {currentMovie.spoken_languages?.length ? <p><span className="micro-label">LANGUAGES</span>{currentMovie.spoken_languages.map((language) => language.english_name || language.name).join(' · ')}</p> : null}
          </div>
        </section>
      )}

      {(screen === 'auth' || screen === 'settings') && (
        <section className="secondary-screen profile-screen">
          <p className="eyebrow"><span className="red-mark">✳</span> {screen === 'settings' ? 'SETTINGS / ACCOUNT & PREFERENCES' : user ? 'YOUR PROFILE' : screen === 'auth' ? 'GUEST / PERSONAL ARCHIVE' : 'SIGN IN / CREATE ACCOUNT'}</p>
          {screen === 'settings' && !passwordRecovery && !passwordRecoveryError && (
            <div className="secondary-heading settings-page-heading">
              <h1>Settings,<br /><em>in order.</em></h1>
              <span>{user ? 'ACCOUNT CONTROL' : 'GUEST / THIS BROWSER'}</span>
            </div>
          )}
          {screen === 'auth' && !passwordRecovery && !passwordRecoveryError && (
            <div className="secondary-heading profile-page-heading">
              <h1>Your cinema<br /><em>archive.</em></h1>
              <span>{user ? 'PERSONAL ARCHIVE' : 'GUEST / THIS BROWSER'}</span>
            </div>
          )}
          {screen === 'auth' && !passwordRecovery && !passwordRecoveryError && (
            <>
            <p className="profile-section-label">PROFILE / PERSONAL ARCHIVE</p>
            <section className="profile-identity" style={profile.banner ? {
              backgroundImage: `linear-gradient(90deg, rgba(23,23,21,.78), rgba(23,23,21,.38)), url("${profileImageUrl(profile.banner)}")`,
            } : undefined}>
              <div className="profile-identity-user">
                {profile.avatar
                  ? <img className="profile-avatar" src={profileImageUrl(profile.avatar)} alt="Your profile picture" />
                  : <div className="profile-avatar profile-avatar-placeholder" aria-hidden="true">◉</div>}
                <div>
                  <span className="micro-label">YOUR FILM PROFILE</span>
                  <h2>{profile.username || user?.email?.split('@')[0] || 'GUEST CINEPHILE'}</h2>
                  <p>{profile.favorites.length} / 4 FAVOURITE FILMS</p>
                </div>
              </div>
              <span className="profile-identity-index">{user ? 'Button. / PERSONAL ARCHIVE' : 'LOCAL ARCHIVE / THIS BROWSER'}</span>
            </section>
            {profileError && <p className="inline-error" role="alert">{profileError}</p>}
            <CinemaArchive
              watchedMovies={watchedMovies}
              watchlistCount={watchlistError ? '—' : watchlist.length}
              ratedCount={ratedMovies.length}
              averageRating={averageRating}
              likedCount={likedMovies.length}
              likedMovies={likedMovies}
              currentStreak={streakError ? '—' : dailyStreak}
              bestStreak={streakError ? '—' : bestDailyStreak}
              favorites={profile.favorites}
              collections={profile.collections}
              section={archiveSection}
              onSectionChange={setArchiveSection}
              loading={watchedLoading || profileLoading || streakLoading || Boolean(user && profileError)}
              onSaveCollections={saveCollections}
              onOpenMovie={(movie) => { void openMovie(movie) }}
              onOpenWatchedMovie={(movie, viewingId) => { void openArchiveMovie(movie, viewingId) }}
              onOpenWatched={() => setScreen('watched')}
              onToggleLike={(movie) => { void setLiked(movie, false) }}
              likedMovieIdsPending={pendingLikeIds}
            />
            </>
          )}
          {screen === 'settings' && !passwordRecovery && (
            <>
              <section className="settings-appearance" aria-labelledby="appearance-title">
                <div>
                  <span className="micro-label">APPEARANCE / GLOBAL</span>
                  <h2 id="appearance-title">Choose your<br /><em>light.</em></h2>
                </div>
                <label className="settings-theme-field" htmlFor="theme-preference">
                  <span>THEME PREFERENCE</span>
                  <select
                    id="theme-preference"
                    value={themePreference}
                    onChange={(event) => {
                      if (isThemePreference(event.target.value)) setThemePreference(event.target.value)
                    }}
                  >
                    <option value="light">Light theme</option>
                    <option value="dark">Dark theme</option>
                    <option value="system">Follow system</option>
                  </select>
                </label>
              </section>
              <TasteProfileEditor
                tasteProfile={profile.tasteProfile}
                disabled={!tasteProfileReady}
                error={user ? profileError : ''}
                onSave={saveTasteProfile}
              />
              <section className="settings-profile-controls" aria-label="Profile picture, banner, and favourite films">
                <ProfileEditor
                  profile={profile}
                  loading={profileLoading}
                  error={profileError}
                  onSave={saveFavorites}
                  onUpload={updateImage}
                  search={favoriteSearch}
                  setSearch={setFavoriteSearch}
                  results={favoriteResults}
                  searching={favoriteSearchBusy}
                  searchError={favoriteSearchError}
                />
              </section>
            </>
          )}
          {screen === 'settings' && user && !passwordRecovery && !passwordRecoveryError && (
            <section className="settings-account-section" aria-labelledby="account-details-title">
              <div className="settings-section-heading">
                <span className="micro-label">ACCOUNT / SIGN-IN & ACCESS</span>
                <h2 id="account-details-title">Account<br /><em>details.</em></h2>
              </div>
              <div className="account-panel">
              <span className="micro-label">YOUR IDENTITY</span>
              <UsernameEditor
                username={profile.username}
                fallbackUsername={user?.email?.split('@')[0] || 'CINEPHILE'}
                disabled={profileLoading}
                error={profileError}
                onSave={saveUsername}
              />
              {user && <>
              <span className="micro-label">SIGNED IN AS</span>
              <p>{user.email}</p>
              <p className="account-description">Your watchlist is saved to your account and available when you sign in on another device.</p>
              <button className="button button-dark" onClick={() => { void signOut() }}>SIGN OUT</button>
              <div className="danger-zone">
                <span className="micro-label">ACCOUNT CONTROL</span>
                <p className="account-description">Permanently delete your account and its synced watchlists. This cannot be undone.</p>
                {deleteConfirm ? (
                  <div className="delete-confirm-actions">
                    <button className="button button-delete" onClick={() => { void deleteAccount() }} disabled={deleteBusy}>
                      {deleteBusy ? 'DELETING…' : 'CONFIRM DELETE'}
                    </button>
                    <button className="text-button" onClick={() => setDeleteConfirm(false)} disabled={deleteBusy}>CANCEL</button>
                  </div>
                ) : (
                  <button className="text-button delete-trigger" onClick={() => setDeleteConfirm(true)}>DELETE ACCOUNT</button>
                )}
              </div>
              </>}
              </div>
            </section>
          )}
          {(passwordRecovery || passwordRecoveryError || (screen === 'settings' && !user)) && (passwordRecovery ? (
            <>
              <section className="settings-account-section" aria-labelledby="account-details-title">
              <div className="settings-section-heading">
                <span className="micro-label">ACCOUNT / SECURE RESET</span>
                <h2 id="account-details-title">Reset your<br /><em>password.</em></h2>
              </div>
              <div className="account-panel">
                <p className="account-description">Choose a new password for your account.</p>
                <form className="auth-form" onSubmit={(event) => { void submitAuth(event) }}>
                  <label htmlFor="auth-password">NEW PASSWORD</label>
                  <input id="auth-password" type="password" autoComplete="new-password" minLength={6} required value={authPassword} onChange={(event) => setAuthPassword(event.target.value)} />
                  <label htmlFor="auth-password-confirmation">CONFIRM NEW PASSWORD</label>
                  <input id="auth-password-confirmation" type="password" autoComplete="new-password" minLength={6} required value={authPasswordConfirmation} onChange={(event) => setAuthPasswordConfirmation(event.target.value)} />
                  {authMessage && <p className="auth-message" role="status">{authMessage}</p>}
                  <button className="button button-dark" type="submit" disabled={authBusy}>
                    {authBusy ? 'UPDATING…' : 'UPDATE PASSWORD'} <span aria-hidden="true">↗</span>
                  </button>
                </form>
              </div>
              </section>
            </>
          ) : (
            <>
              <section className="settings-account-section" aria-labelledby="account-details-title">
              <div className="settings-section-heading">
                <span className="micro-label">ACCOUNT / SIGN-IN & ACCESS</span>
                <h2 id="account-details-title">{authMode === 'reset-password' ? <>Reset your<br /><em>password.</em></> : <>Sign in or<br /><em>join us.</em></>}</h2>
              </div>
              <div className="account-panel">
                {!passwordRecoveryError && <p className="micro-label">GUEST MODE ALWAYS AVAILABLE</p>}
                {passwordRecoveryError && <p className="inline-error" role="alert">{passwordRecoveryError}</p>}
                <p className="account-description">
                  {authMode === 'reset-password'
                    ? 'Enter your account email and we’ll send a secure password reset link.'
                    : 'Sign in to sync your watchlist across devices, or keep using the site as a guest. Your existing guest lists will be added to your account when you sign in.'}
                </p>
                {!supabase && <div className="inline-error" role="status">{SUPABASE_SETUP_MESSAGE} Guest mode works without an account.</div>}
                {authMode !== 'reset-password' && <div className="auth-tabs" role="group" aria-label="Profile action">
                  <button className={authMode === 'sign-in' ? 'is-selected' : ''} onClick={() => { setAuthMode('sign-in'); setAuthMessage(''); clearSessionError() }}>SIGN IN</button>
                  <button className={authMode === 'sign-up' ? 'is-selected' : ''} onClick={() => { setAuthMode('sign-up'); setAuthMessage(''); clearSessionError() }}>CREATE ACCOUNT</button>
                </div>}
                <form className="auth-form" onSubmit={(event) => { void submitAuth(event) }}>
                  <label htmlFor="auth-email">EMAIL ADDRESS</label>
                  <input id="auth-email" type="email" autoComplete="email" required value={authEmail} onChange={(event) => setAuthEmail(event.target.value)} />
                  {authMode === 'reset-password' && resetPasswordError && <p className="inline-error" role="alert">{resetPasswordError}</p>}
                  {authMode !== 'reset-password' && <>
                    <label htmlFor="auth-password">PASSWORD</label>
                    <input id="auth-password" type="password" autoComplete={authMode === 'sign-up' ? 'new-password' : 'current-password'} minLength={6} required value={authPassword} onChange={(event) => setAuthPassword(event.target.value)} />
                  </>}
                  {authMessage && <p className="auth-message" role="status">{authMessage}</p>}
                  <button className="button button-dark" type="submit" disabled={authBusy || !supabase}>
                    {authBusy ? 'PLEASE WAIT…' : authMode === 'reset-password' ? 'SEND RESET LINK' : authMode === 'sign-up' ? 'CREATE ACCOUNT' : 'SIGN IN'} <span aria-hidden="true">↗</span>
                  </button>
                </form>
                {authMode !== 'reset-password' && <button
                  className="button button-light google-auth-button"
                  type="button"
                  disabled={authBusy || !supabase}
                  onClick={() => { void signInWithGoogle() }}
                >
                  <svg className="google-auth-icon" viewBox="0 0 48 48" aria-hidden="true">
                    <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5Z" />
                    <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.27 5.48-4.79 7.18l7.73 6C44.39 37.89 46.98 31.7 46.98 24.55Z" />
                    <path fill="#FBBC05" d="M10.53 28.59A14.4 14.4 0 0 1 9.75 24c0-1.59.27-3.13.76-4.59l-7.98-6.19A23.9 23.9 0 0 0 0 24c0 3.87.93 7.53 2.56 10.78l7.97-6.19Z" />
                    <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.91-5.8l-7.73-6c-2.15 1.45-4.92 2.3-8.18 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48Z" />
                  </svg>
                  {authBusy ? 'CONNECTING…' : 'CONTINUE WITH GOOGLE'}
                </button>}
                {authMode === 'sign-in' && <button className="text-button forgot-password" onClick={() => { setAuthMode('reset-password'); setAuthMessage(''); setResetPasswordError(''); clearSessionError() }}>FORGOT PASSWORD?</button>}
                {authMode === 'reset-password' && <button className="text-button forgot-password" onClick={() => { setAuthMode('sign-in'); setAuthMessage(''); setResetPasswordError(''); clearPasswordRecoveryError(); clearSessionError() }}>← BACK TO SIGN IN</button>}
                {authMode !== 'reset-password' && (
                  <button className="button button-light continue-as-guest" type="button" onClick={() => {
                    setAuthEmail('')
                    setAuthPassword('')
                    setAuthMessage('')
                    clearSessionError()
                    returnHome()
                  }}>
                    CONTINUE AS GUEST
                  </button>
                )}
              </div>
              </section>
            </>
          ))}
          {screen === 'settings' && !passwordRecovery && !passwordRecoveryError && (
            <section className="diary-import-settings" aria-labelledby="diary-import-title">
              <div className="settings-section-heading">
                <span className="micro-label">WATCHED FILMS / TRANSFER</span>
                <h2 id="diary-import-title">Diary<br /><em>import.</em></h2>
              </div>
              <div className="diary-import">
              <div>
                <span className="micro-label">LETTERBOXD DIARY IMPORT</span>
                <p>Bring your watched films over from a Letterboxd diary CSV. Only unique title-and-year matches are added; imports do not change your daily streak.</p>
              </div>
              <label className={`button button-dark diary-import-button${diaryImportBusy || watchedLoading ? ' is-disabled' : ''}`}>
                {diaryImportBusy ? 'MATCHING DIARY…' : 'IMPORT DIARY CSV'}
                <input
                  type="file"
                  accept=".csv,text/csv"
                  disabled={diaryImportBusy || watchedLoading}
                  onChange={(event) => {
                    const file = event.currentTarget.files?.[0]
                    event.currentTarget.value = ''
                    if (file) void importLetterboxdDiary(file)
                  }}
                />
              </label>
              {diaryImportProgress && <p className="diary-import-status" role="status">{diaryImportProgress}</p>}
              {diaryImportMessage && <p className="diary-import-error" role="alert">{diaryImportMessage}</p>}
              {diaryImportReport && (
                <p className="diary-import-status" role="status">
                  Import complete: {diaryImportReport.imported} added, {diaryImportReport.alreadySaved} already watched, {diaryImportReport.skipped} skipped because no unique exact match was found.
                </p>
              )}
              </div>
            </section>
          )}
          {screen === 'settings'
            ? <button className="back-link" onClick={returnHome}>← BACK TO HOME</button>
            : user && !passwordRecovery && <button className="back-link" onClick={returnHome}>← BACK TO HOME</button>}
        </section>
      )}
      {pendingWatchedMovie && (
        <div
          className="review-modal-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !busy) setPendingWatchedMovie(null)
          }}
          onKeyDown={(event) => {
            if (event.key === 'Escape' && !busy) setPendingWatchedMovie(null)
          }}
        >
          <section
            className="review-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="review-modal-title"
            style={pendingWatchedMovie.backdrop_path ? {
              backgroundImage: `linear-gradient(180deg, rgba(23,23,21,.78), rgba(23,23,21,.92)), url("${imageUrl(pendingWatchedMovie.backdrop_path, 'original')}")`,
            } : undefined}
          >
            <button className="review-modal-close" type="button" onClick={() => setPendingWatchedMovie(null)} disabled={busy} aria-label="Close rating and review" autoFocus>×</button>
            <p className="eyebrow"><span className="red-mark">✳</span> LOG</p>
            <h2 id="review-modal-title">{pendingWatchedMovie.title}</h2>
            <p className="review-modal-film"><span>RELEASED</span> {yearOf(pendingWatchedMovie)}</p>
            <div className="review-modal-rating">
              <div className="review-modal-rating-control">
                <RatingStars
                  rating={pendingRating}
                  onRate={setPendingRating}
                  label={pendingWatchedMovie.title}
                  disabled={busy}
                />
                {pendingRating !== null && <span className="review-modal-rating-value">{pendingRating} / 5</span>}
              </div>
            </div>
            {pendingWatchedEditOnly && watchedError && <p className="inline-error" role="alert">{watchedError}</p>}
            <button
              className={`review-modal-like${pendingLiked ? ' is-liked' : ''}`}
              type="button"
              aria-pressed={pendingLiked}
              aria-label={pendingLiked ? 'Unlike this film' : 'Like this film'}
              title={pendingLiked ? 'Unlike this film' : 'Like this film'}
              onClick={() => setPendingLiked((liked) => !liked)}
              disabled={busy}
            >
              <span aria-hidden="true">{pendingLiked ? '♥' : '♡'}</span>
            </button>
            <label className="review-modal-note">
              <span className="micro-label">YOUR REVIEW</span>
              <textarea
                maxLength={2000}
                value={pendingReview}
                onChange={(event) => setPendingReview(event.target.value)}
                placeholder="What stayed with you?"
                disabled={busy}
              />
            </label>
            <div className="review-modal-actions">
              <button
                className="button button-dark"
                onClick={() => {
                  if (pendingWatchedEditOnly) void saveArchiveReview(pendingWatchedMovie, pendingRating, pendingReview, pendingLiked, pendingWatchedViewingId)
                  else void markWatchedAndDiscover(pendingWatchedMovie, pendingRating, pendingReview, pendingLiked)
                }}
                disabled={busy}
              >
                {busy ? 'SAVING…' : pendingWatchedEditOnly ? 'SAVE YOUR NOTE' : hasWatched(pendingWatchedMovie.id) ? 'LOG REWATCH' : 'LOG VIEWING'} <span aria-hidden="true">↗</span>
              </button>
            </div>
          </section>
        </div>
      )}
      <footer className="tmdb-attribution" aria-label="TMDB attribution">
        <a href="https://www.themoviedb.org" target="_blank" rel="noreferrer" aria-label="The Movie Database (TMDB)">
          <img src="/tmdb-logo.svg" alt="The Movie Database (TMDB)" />
        </a>
        <div className="tmdb-copy">
          <p>This website uses TMDB and the TMDB APIs but is not endorsed, certified, or otherwise approved by TMDB.</p>
          <a href="https://www.themoviedb.org/about/logos-attribution" target="_blank" rel="noreferrer">Official TMDB logo and attribution guidance ↗</a>
        </div>
      </footer>
    </main>
  )
}

export default App
