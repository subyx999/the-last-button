import { useEffect, useRef, useState, type FormEvent } from 'react'
import { getMovie, getMovieOfTheDay, getRandomMovie, imageUrl } from './services/tmdb'
import { useWatchlist } from './hooks/useWatchlist'
import { useWatched } from './hooks/useWatched'
import { useAuth } from './hooks/useAuth'
import { supabase, SUPABASE_SETUP_MESSAGE } from './services/supabase'
import type { Movie } from './types'

type Screen = 'home' | 'watchlist' | 'watched' | 'detail' | 'auth'
type AuthMode = 'sign-in' | 'sign-up' | 'reset-password' | 'update-password'
type RetryTarget = 'daily' | 'random' | { detail: Movie } | null

function utcDateKey(date = new Date()) {
  return date.toISOString().slice(0, 10)
}

function millisecondsUntilNextUtcDay(date = new Date()) {
  const nextUtcDay = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + 1)
  return nextUtcDay - date.getTime() + 50
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

function App() {
  const [screen, setScreen] = useState<Screen>('home')
  const [featured, setFeatured] = useState<Movie | null>(null)
  const [selected, setSelected] = useState<Movie | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [authMode, setAuthMode] = useState<AuthMode>('sign-in')
  const [authEmail, setAuthEmail] = useState('')
  const [authPassword, setAuthPassword] = useState('')
  const [authBusy, setAuthBusy] = useState(false)
  const [authMessage, setAuthMessage] = useState('')
  const [deleteConfirm, setDeleteConfirm] = useState(false)
  const [deleteBusy, setDeleteBusy] = useState(false)
  const [utcDate, setUtcDate] = useState(() => utcDateKey())
  const randomMovieIds = useRef(new Set<number>())
  const retryTarget = useRef<RetryTarget>(null)
  const { user, loading: authLoading, error: sessionError, passwordRecovery, clearPasswordRecovery, clearError: clearSessionError, setError: setSessionError } = useAuth()
  const { movies: watchlist, contains, toggle, loading: watchlistLoading, error: watchlistError, retry: retryWatchlist } = useWatchlist(user?.id)
  const {
    movies: watchedMovies,
    contains: hasWatched,
    loading: watchedLoading,
    error: watchedError,
    markWatched,
    removeWatched,
    retry: retryWatched,
  } = useWatched(user?.id)
  const dateLabel = new Intl.DateTimeFormat('en', {
    weekday: 'long', day: '2-digit', month: 'long', timeZone: 'UTC',
  }).format(new Date(`${utcDate}T00:00:00.000Z`))

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
      setAuthMode('update-password')
      setAuthMessage('')
      setScreen('auth')
    }
  }, [passwordRecovery])

  async function discoverRandom(additionalExcludedIds: ReadonlySet<number> = new Set()) {
    setBusy(true)
    setError('')
    try {
      const excludedIds = new Set(randomMovieIds.current)
      for (const id of additionalExcludedIds) excludedIds.add(id)
      for (const movie of watchedMovies) excludedIds.add(movie.id)
      if (featured) excludedIds.add(featured.id)
      if (selected) excludedIds.add(selected.id)
      const movie = await getRandomMovie(excludedIds)
      randomMovieIds.current.add(movie.id)
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

  async function markWatchedAndDiscover(movie: Movie) {
    setBusy(true)
    setError('')
    const saved = await markWatched(movie)
    if (!saved) {
      setBusy(false)
      return
    }

    randomMovieIds.current.add(movie.id)
    await discoverRandom(new Set([movie.id]))
  }

  async function openMovie(movie: Movie) {
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
      await openMovie(target.detail)
    }
  }

  async function submitAuth(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setAuthBusy(true)
    setAuthMessage('')
    clearSessionError()

    if (!supabase) {
      setSessionError(SUPABASE_SETUP_MESSAGE)
      setAuthBusy(false)
      return
    }

    try {
      if (authMode === 'reset-password') {
        const { error: resetError } = await supabase.auth.resetPasswordForEmail(authEmail, {
          redirectTo: `${window.location.origin}/`,
        })
        if (resetError) throw resetError
        setAuthMessage('If an account exists for that email, a password reset link is on its way.')
        return
      }

      if (authMode === 'update-password') {
        const { error: updateError } = await supabase.auth.updateUser({ password: authPassword })
        if (updateError) throw updateError
        clearPasswordRecovery()
        setAuthPassword('')
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
      setSessionError(cause instanceof Error ? cause.message : 'Could not complete sign in. Please try again.')
    } finally {
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
    setScreen('home')
    setSelected(null)
    setError('')
  }

  const currentMovie = screen === 'detail' ? selected : featured

  return (
    <main className="site-shell">
      <header className="topbar">
        <button className="wordmark" onClick={returnHome} aria-label="The Last Button, home">
          <span className="wordmark-icon">◉</span> THE LAST BUTTON
        </button>
        <div className="topbar-status">TASTE PROFILE: NOT CONSULTED</div>
        <div className="topbar-actions">
          <button className={`watchlist-link ${screen === 'watchlist' ? 'is-current' : ''}`} onClick={() => setScreen('watchlist')}>
            WATCHLIST <span className="watchlist-count">{watchlist.length.toString().padStart(2, '0')}</span>
          </button>
          <button className={`watchlist-link ${screen === 'watched' ? 'is-current' : ''}`} onClick={() => setScreen('watched')}>
            WATCHED <span className="watchlist-count">{watchedMovies.length.toString().padStart(2, '0')}</span>
          </button>
          <button className={`account-link ${screen === 'auth' ? 'is-current' : ''}`} onClick={() => { setAuthMessage(''); setScreen('auth') }}>
            {authLoading ? 'ACCOUNT…' : user ? 'ACCOUNT' : 'SIGN IN'}
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
                <button className="button button-dark" onClick={() => featured && void markWatchedAndDiscover(featured)} disabled={busy || loading || !featured || watchedLoading}>
                  {busy ? 'PICKING…' : featured && hasWatched(featured.id) ? 'ALREADY WATCHED' : 'WATCHED'} <span aria-hidden="true">↗</span>
                </button>
              </div>
              <div className="hero-footnote"><span>DECISION AUTHORITY: REVOKED</span><span>01 / 01</span></div>
            </div>

            <div className="poster-stage">
              <div className="stage-index">FRAME<br />{featured ? String(featured.id).padStart(6, '0') : '———'}</div>
              <div className="poster-wrap">
                {featured?.poster_path
                  ? <img src={imageUrl(featured.poster_path)} alt={`${featured.title} theatrical poster`} className="poster-image" />
                  : <div className="image-placeholder"><span>{loading ? 'FETCHING<br />A FEELING' : 'IMAGE<br />MISSING'}</span></div>}
                <span className="poster-stamp">TODAY<br />ONLY</span>
              </div>
              <p className="poster-caption">THE DAILY PICK <span>— DO NOT OVERTHINK IT</span></p>
              <span className="orbit-mark" aria-hidden="true">✳</span>
            </div>
          </section>

          <footer className="site-footer"><span>THE LAST BUTTON © 2026</span><span>YOUR NEXT TWO HOURS HAVE BEEN CLAIMED.</span><span>DATA: TMDB ↗</span></footer>
        </>
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
                    {movie.poster_path ? <img src={imageUrl(movie.poster_path)} alt="" /> : <div className="image-placeholder">NO<br />IMAGE</div>}
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
                  <button className="watch-item-open" onClick={() => openMovie(movie)} aria-label={`Open ${movie.title}`}>
                    {movie.poster_path ? <img src={imageUrl(movie.poster_path)} alt="" /> : <div className="image-placeholder">NO<br />IMAGE</div>}
                    <span className="watch-item-index">{String(index + 1).padStart(2, '0')} / {yearOf(movie)}</span>
                    <h2>{movie.title}</h2>
                  </button>
                  <button className="remove-button" onClick={() => { void removeWatched(movie) }} disabled={watchedLoading} aria-label={`Remove ${movie.title} from watched`}>
                    REMOVE FROM WATCHED ×
                  </button>
                </article>
              ))}
            </div>
          ) : <div className="empty-state"><p>No films marked watched yet.</p><span>Mark a film watched to keep it out of future random picks.</span><button className="text-button" onClick={returnHome}>BACK TO TODAY ↗</button></div>}
          <button className="back-link" onClick={returnHome}>← BACK TO THE DAILY PICK</button>
        </section>
      )}

      {screen === 'detail' && currentMovie && (
        <section className="detail-screen">
          <button className="back-link" onClick={returnHome}>← BACK TO THE DAILY PICK</button>
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
                <button className="button button-light" onClick={() => { void toggle(currentMovie) }} disabled={watchlistLoading} aria-pressed={contains(currentMovie.id)}>
                  {watchlistLoading ? 'SYNCING…' : contains(currentMovie.id) ? '− REMOVE FROM WATCHLIST' : '+ SAVE FOR LATER'}
                </button>
                <button className="button button-detail-random" onClick={() => void markWatchedAndDiscover(currentMovie)} disabled={busy || watchedLoading}>
                  {busy ? 'PICKING…' : hasWatched(currentMovie.id) ? 'PICK ANOTHER' : 'WATCHED'} <span aria-hidden="true">↗</span>
                </button>
              </div>
            </div>
            {currentMovie.poster_path && <img className="detail-poster" src={imageUrl(currentMovie.poster_path)} alt={`${currentMovie.title} poster`} />}
          </div>
          {busy && <div className="loading-line">Opening the film file…</div>}
          <div className="detail-columns">
            <section className="detail-fact"><span className="micro-label">A NOTE FROM THE ARCHIVE / METADATA</span><p>{metadataNote(currentMovie)}</p></section>
            <section><span className="micro-label">THE PEOPLE</span><h2>In the frame.</h2><p className="cast-list">{currentMovie.credits?.cast?.slice(0, 8).map((person) => `${person.name} as ${person.character}`).join(' · ') || 'Cast details not available.'}</p>
              {currentMovie.credits?.crew?.find((person) => person.job === 'Director') && <p className="crew-line">DIRECTED BY / {currentMovie.credits.crew.find((person) => person.job === 'Director')?.name}</p>}
            </section>
          </div>
          <div className="detail-extras">
            {currentMovie.production_companies?.length ? <p><span className="micro-label">PRODUCTION</span>{currentMovie.production_companies.slice(0, 3).map((company) => company.name).join(' · ')}</p> : null}
            {currentMovie.production_countries?.length ? <p><span className="micro-label">ORIGIN</span>{currentMovie.production_countries.map((country) => country.name).join(' · ')}</p> : null}
            {currentMovie.spoken_languages?.length ? <p><span className="micro-label">LANGUAGES</span>{currentMovie.spoken_languages.map((language) => language.english_name || language.name).join(' · ')}</p> : null}
          </div>
          {currentMovie.videos?.results?.find((video) => video.site === 'YouTube' && video.type === 'Trailer') && (
            <a className="trailer-link" href={`https://www.youtube.com/watch?v=${currentMovie.videos.results.find((video) => video.site === 'YouTube' && video.type === 'Trailer')?.key}`} target="_blank" rel="noreferrer">
              WATCH THE TRAILER ↗
            </a>
          )}
        </section>
      )}

      {screen === 'auth' && (
        <section className="secondary-screen account-screen">
          <p className="eyebrow"><span className="red-mark">✳</span> OPTIONAL ACCOUNT / YOUR CHOICE</p>
          {passwordRecovery ? (
            <>
              <div className="secondary-heading"><h1>New password,<br /><em>fresh start.</em></h1><span>SECURE RESET</span></div>
              <div className="account-panel">
                <p className="account-description">Choose a new password for your account.</p>
                <form className="auth-form" onSubmit={(event) => { void submitAuth(event) }}>
                  <label htmlFor="auth-password">NEW PASSWORD</label>
                  <input id="auth-password" type="password" autoComplete="new-password" minLength={6} required value={authPassword} onChange={(event) => setAuthPassword(event.target.value)} />
                  {authMessage && <p className="auth-message" role="status">{authMessage}</p>}
                  <button className="button button-dark" type="submit" disabled={authBusy}>
                    {authBusy ? 'UPDATING…' : 'UPDATE PASSWORD'} <span aria-hidden="true">↗</span>
                  </button>
                </form>
              </div>
            </>
          ) : user ? (
            <>
              <div className="secondary-heading"><h1>Your films,<br /><em>in sync.</em></h1><span>ACCOUNT ACTIVE</span></div>
              <div className="account-panel">
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
              </div>
            </>
          ) : (
            <>
              <div className="secondary-heading"><h1>{authMode === 'reset-password' ? <>Reset your<br /><em>password.</em></> : <>Keep your<br /><em>films close.</em></>}</h1><span>GUEST MODE ALWAYS AVAILABLE</span></div>
              <div className="account-panel">
                <p className="account-description">
                  {authMode === 'reset-password'
                    ? 'Enter your account email and we’ll send a secure password reset link.'
                    : 'Sign in to sync your watchlist across devices, or keep using the site as a guest. Your existing guest lists will be added to your account when you sign in.'}
                </p>
                {!supabase && <div className="inline-error" role="status">{SUPABASE_SETUP_MESSAGE} Guest mode works without an account.</div>}
                {authMode !== 'reset-password' && <div className="auth-tabs" role="group" aria-label="Account action">
                  <button className={authMode === 'sign-in' ? 'is-selected' : ''} onClick={() => { setAuthMode('sign-in'); setAuthMessage(''); clearSessionError() }}>SIGN IN</button>
                  <button className={authMode === 'sign-up' ? 'is-selected' : ''} onClick={() => { setAuthMode('sign-up'); setAuthMessage(''); clearSessionError() }}>CREATE ACCOUNT</button>
                </div>}
                <form className="auth-form" onSubmit={(event) => { void submitAuth(event) }}>
                  <label htmlFor="auth-email">EMAIL ADDRESS</label>
                  <input id="auth-email" type="email" autoComplete="email" required value={authEmail} onChange={(event) => setAuthEmail(event.target.value)} />
                  {authMode !== 'reset-password' && <>
                    <label htmlFor="auth-password">PASSWORD</label>
                    <input id="auth-password" type="password" autoComplete={authMode === 'sign-up' ? 'new-password' : 'current-password'} minLength={6} required value={authPassword} onChange={(event) => setAuthPassword(event.target.value)} />
                  </>}
                  {authMessage && <p className="auth-message" role="status">{authMessage}</p>}
                  <button className="button button-dark" type="submit" disabled={authBusy || !supabase}>
                    {authBusy ? 'PLEASE WAIT…' : authMode === 'reset-password' ? 'SEND RESET LINK' : authMode === 'sign-up' ? 'CREATE ACCOUNT' : 'SIGN IN'} <span aria-hidden="true">↗</span>
                  </button>
                </form>
                {authMode === 'sign-in' && <button className="text-button forgot-password" onClick={() => { setAuthMode('reset-password'); setAuthMessage(''); clearSessionError() }}>FORGOT PASSWORD?</button>}
                {authMode === 'reset-password' && <button className="text-button forgot-password" onClick={() => { setAuthMode('sign-in'); setAuthMessage(''); clearSessionError() }}>← BACK TO SIGN IN</button>}
              </div>
            </>
          )}
          <button className="back-link" onClick={returnHome}>← CONTINUE AS {user ? 'SIGNED-IN USER' : 'GUEST'}</button>
        </section>
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
