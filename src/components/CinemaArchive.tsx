import { useEffect, useMemo, useState, type FormEvent } from 'react'
import type { Movie, MovieCollection, MovieViewing } from '../types'
import { imageUrl, searchMovies } from '../services/tmdb'
import { getMovieViewings } from '../services/watchHistory'

export type ArchiveSection = 'overview' | 'watched' | 'diary' | 'reviews' | 'collections' | 'favourites'
type WatchedSort = 'recent' | 'oldest' | 'highest' | 'lowest'

interface CinemaArchiveProps {
  watchedMovies: Movie[]
  watchlistCount: number | string
  ratedCount: number
  averageRating: string
  likedCount: number
  currentStreak: number | string
  bestStreak: number | string
  favorites: Movie[]
  collections: MovieCollection[]
  section: ArchiveSection
  onSectionChange: (section: ArchiveSection) => void
  loading: boolean
  onSaveCollections: (collections: MovieCollection[]) => Promise<boolean>
  onOpenMovie: (movie: Movie) => void
  onOpenWatchedMovie: (movie: Movie, viewingId?: string) => void
  onOpenWatched: () => void
}

function parsedDate(value?: string) {
  if (!value) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

const SECTIONS: Array<{ id: ArchiveSection; label: string }> = [
  { id: 'overview', label: 'OVERVIEW' },
  { id: 'watched', label: 'WATCHED FILMS' },
  { id: 'diary', label: 'DIARY' },
  { id: 'reviews', label: 'REVIEWS' },
  { id: 'collections', label: 'COLLECTIONS' },
  { id: 'favourites', label: 'FAVOURITES' },
]

function yearOf(movie: Movie) {
  return movie.release_date?.slice(0, 4) || 'YEAR UNKNOWN'
}

function watchedDate(movie: Movie) {
  const date = parsedDate(movie.watched_at)
  return date ? new Intl.DateTimeFormat('en', { day: '2-digit', month: 'short', year: 'numeric' }).format(date) : ''
}

function watchedDateLabel(value?: string) {
  const date = parsedDate(value)
  return date ? new Intl.DateTimeFormat('en', { day: '2-digit', month: 'short', year: 'numeric' }).format(date) : 'DATE NOT RECORDED'
}

function poster(movie: Movie, onOpen: (movie: Movie) => void, className = '') {
  return (
    <button className={`archive-poster ${className}`} type="button" onClick={() => onOpen(movie)} aria-label={`Open ${movie.title}`}>
      {movie.poster_path
        ? <img src={imageUrl(movie.poster_path)} alt="" loading="lazy" decoding="async" />
        : <span className="archive-poster-empty">NO<br />IMAGE</span>}
    </button>
  )
}

export default function CinemaArchive({
  watchedMovies,
  watchlistCount,
  ratedCount,
  averageRating,
  likedCount,
  currentStreak,
  bestStreak,
  favorites,
  collections,
  section,
  onSectionChange,
  loading,
  onSaveCollections,
  onOpenMovie,
  onOpenWatchedMovie,
  onOpenWatched,
}: CinemaArchiveProps) {
  const [sort, setSort] = useState<WatchedSort>('recent')
  const [diarySearch, setDiarySearch] = useState('')
  const [diaryYear, setDiaryYear] = useState('all')
  const [collectionName, setCollectionName] = useState('')
  const [renameDrafts, setRenameDrafts] = useState<Record<string, string>>({})
  const [targetCollectionId, setTargetCollectionId] = useState('')
  const [movieSearch, setMovieSearch] = useState('')
  const [movieResults, setMovieResults] = useState<Movie[]>([])
  const [searching, setSearching] = useState(false)
  const [searchError, setSearchError] = useState('')
  const [saving, setSaving] = useState(false)
  const [collectionFeedback, setCollectionFeedback] = useState<{ message: string; isError: boolean } | null>(null)
  const activeCollectionId = collections.some((collection) => collection.id === targetCollectionId)
    ? targetCollectionId
    : collections[0]?.id ?? ''

  const sortedWatched = useMemo(() => {
    const indexed = watchedMovies.map((movie, index) => ({ movie, index }))
    indexed.sort((left, right) => {
      if (sort === 'highest' || sort === 'lowest') {
        if (left.movie.user_rating == null) return right.movie.user_rating == null ? left.index - right.index : 1
        if (right.movie.user_rating == null) return -1
        const leftRating = left.movie.user_rating
        const rightRating = right.movie.user_rating
        const difference = sort === 'highest' ? rightRating - leftRating : leftRating - rightRating
        return difference || left.index - right.index
      }
      const leftDate = left.movie.watched_at ? Date.parse(left.movie.watched_at) : NaN
      const rightDate = right.movie.watched_at ? Date.parse(right.movie.watched_at) : NaN
      if (Number.isFinite(leftDate) && Number.isFinite(rightDate)) {
        const difference = sort === 'recent' ? rightDate - leftDate : leftDate - rightDate
        return difference || left.index - right.index
      }
      if (Number.isFinite(leftDate)) return -1
      if (Number.isFinite(rightDate)) return 1
      return sort === 'recent' ? left.index - right.index : right.index - left.index
    })
    return indexed.map(({ movie }) => movie)
  }, [sort, watchedMovies])

  const reviews = useMemo(
    () => watchedMovies.flatMap((movie) => getMovieViewings(movie)
      .filter((viewing) => Boolean(viewing.user_review?.trim()))
      .map((viewing) => ({ movie, viewing }))),
    [watchedMovies],
  )

  const diary = useMemo(() => {
    const entries = watchedMovies.flatMap((movie) => getMovieViewings(movie).map((viewing) => ({
      movie,
      viewing,
      date: parsedDate(viewing.watched_at),
    })))
    const datedEntries = entries.filter((entry): entry is typeof entry & { date: Date } => entry.date !== null)
    const years = [...new Set(datedEntries.map(({ date }) => date.getFullYear()))]
      .sort((left, right) => right - left)
    const query = diarySearch.trim().toLocaleLowerCase()
    const matchesSearch = (movie: Movie, viewing: MovieViewing, date?: Date) => !query || [
      movie.title,
      viewing.user_review ?? '',
      yearOf(movie),
      date ? new Intl.DateTimeFormat('en', { month: 'long', year: 'numeric' }).format(date) : '',
    ].some((value) => value.toLocaleLowerCase().includes(query))

    const groups = new Map<string, { label: string; entries: Array<{ movie: Movie; viewing: MovieViewing; date: Date }> }>()
    for (const entry of datedEntries) {
      if (diaryYear !== 'all' && String(entry.date.getFullYear()) !== diaryYear) continue
      if (!matchesSearch(entry.movie, entry.viewing, entry.date)) continue
      const key = `${entry.date.getFullYear()}-${entry.date.getMonth()}`
      const group = groups.get(key) ?? {
        label: new Intl.DateTimeFormat('en', { month: 'long', year: 'numeric' }).format(entry.date),
        entries: [],
      }
      group.entries.push(entry)
      groups.set(key, group)
    }

    const undated = diaryYear === 'all'
      ? entries.filter((entry) => !entry.date && matchesSearch(entry.movie, entry.viewing))
      : []

    return {
      years,
      groups: [...groups.values()]
        .map((group) => ({
          ...group,
          entries: group.entries.sort((left, right) => right.date.getTime() - left.date.getTime()),
        }))
        .sort((left, right) => right.entries[0].date.getTime() - left.entries[0].date.getTime()),
      undated,
      count: [...groups.values()].reduce((total, group) => total + group.entries.length, 0) + undated.length,
    }
  }, [diarySearch, diaryYear, watchedMovies])

  const topRatedMovies = useMemo(
    () => watchedMovies
      .filter((movie): movie is Movie & { user_rating: number } => movie.user_rating !== null && movie.user_rating !== undefined)
      .sort((a, b) => b.user_rating - a.user_rating)
      .slice(0, 3),
    [watchedMovies],
  )

  const favoriteGenres = useMemo(() => {
    const counts = new Map<string, number>()
    for (const movie of watchedMovies) {
      for (const genre of movie.genres ?? []) counts.set(genre.name, (counts.get(genre.name) ?? 0) + 1)
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4)
  }, [watchedMovies])

  useEffect(() => {
    const query = movieSearch.trim()
    if (section !== 'collections' || query.length < 2) {
      setMovieResults([])
      setSearching(false)
      setSearchError('')
      return
    }
    let active = true
    setSearching(true)
    setSearchError('')
    const timer = window.setTimeout(() => {
      searchMovies(query).then((results) => {
        if (active) setMovieResults(results)
      }).catch((cause: unknown) => {
        if (active) setSearchError(cause instanceof Error ? cause.message : 'Could not search movie records.')
      }).finally(() => {
        if (active) setSearching(false)
      })
    }, 280)
    return () => {
      active = false
      window.clearTimeout(timer)
    }
  }, [movieSearch, section])

  async function updateCollections(next: MovieCollection[], successMessage: string) {
    if (saving) return
    setSaving(true)
    setCollectionFeedback(null)
    try {
      const saved = await onSaveCollections(next)
      setCollectionFeedback(saved
        ? { message: successMessage, isError: false }
        : { message: 'Collection change could not be saved. Check the profile error above.', isError: true })
    } catch (cause) {
      setCollectionFeedback({
        message: cause instanceof Error ? cause.message : 'Collection change could not be saved.',
        isError: true,
      })
    } finally {
      setSaving(false)
    }
  }

  function createCollection(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const name = collectionName.trim()
    if (!name) {
      setCollectionFeedback({ message: 'Give this collection a name before creating it.', isError: true })
      return
    }
    const newCollection: MovieCollection = { id: crypto.randomUUID(), name, movies: [] }
    void updateCollections([...collections, newCollection], 'COLLECTION CREATED.')
    setCollectionName('')
    setTargetCollectionId(newCollection.id)
  }

  function addMovie(collection: MovieCollection, movie: Movie) {
    if (collection.movies.some((saved) => saved.id === movie.id)) return
    const next = collections.map((item) => item.id === collection.id
      ? { ...item, movies: [...item.movies, movie] }
      : item)
    void updateCollections(next, `ADDED TO ${collection.name.toUpperCase()}.`)
  }

  return (
    <section className="cinema-archive" aria-label="Personal cinema archive">
      <nav className="archive-navigation" aria-label="Archive sections">
        {SECTIONS.map((item, index) => (
          <button
            type="button"
            className={section === item.id ? 'is-current' : ''}
            key={item.id}
            aria-pressed={section === item.id}
            onClick={() => onSectionChange(item.id)}
          >
            <span>{String(index + 1).padStart(2, '0')}</span>{item.label}
          </button>
        ))}
      </nav>

      {section === 'overview' && (
        <div className="archive-overview">
          <header className="archive-section-heading">
            <span className="micro-label">A RECORD OF YOUR TASTE</span>
            <h2>Your film<br /><em>print.</em></h2>
          </header>
          {loading ? <p className="profile-film-print-loading" role="status">DEVELOPING YOUR ARCHIVE…</p> : (
            <>
              <div className="profile-stat-grid archive-stat-grid">
                <div className="profile-stat"><strong>{watchedMovies.length}</strong><span>FILMS SEEN</span></div>
                <div className="profile-stat"><strong>{watchlistCount}</strong><span>WAITING IN THE WINGS</span></div>
                <div className="profile-stat"><strong>{averageRating}</strong><span>AVG. RATING / 5</span></div>
                <div className="profile-stat"><strong>{ratedCount}</strong><span>FILMS RATED</span></div>
                <div className="profile-stat"><strong>{likedCount}</strong><span>IN YOUR HEART</span></div>
                <div className="profile-stat"><strong>{currentStreak} / {bestStreak}</strong><span>STREAK / BEST</span></div>
              </div>
              <div className="archive-overview-lower">
                <section className="archive-genre-note" aria-labelledby="archive-genres-title">
                  <span className="micro-label">GENRES IN YOUR WATCHED FILE</span>
                  <h3 id="archive-genres-title">Frequent<br /><em>company.</em></h3>
                  {favoriteGenres.length
                    ? <ol>{favoriteGenres.map(([name, count], index) => <li key={name}><span>0{index + 1}</span><strong>{name}</strong><small>{count} {count === 1 ? 'FILM' : 'FILMS'}</small></li>)}</ol>
                    : <p>Genre notes appear when watched film details include them.</p>}
                </section>
                <section className="archive-top-films" aria-labelledby="archive-top-films-title">
                  <span className="micro-label">YOUR HIGHEST-RATED</span>
                  <h3 id="archive-top-films-title">The top<br /><em>three.</em></h3>
                  {topRatedMovies.length ? (
                    <div className="profile-top-films-list">
                      {topRatedMovies.map((movie, index) => (
                          <button className="profile-top-film" type="button" key={movie.id} onClick={() => onOpenMovie(movie)}>
                            {movie.poster_path ? <img src={imageUrl(movie.poster_path)} alt="" loading="lazy" decoding="async" /> : <span className="profile-top-film-placeholder">NO<br />IMAGE</span>}
                            <span className="profile-top-film-copy"><span className="profile-top-film-rank">0{index + 1} / {movie.user_rating} ★</span><strong>{movie.title}</strong><span>{yearOf(movie)}</span></span>
                          </button>
                        ))}
                    </div>
                  ) : <p className="profile-top-films-empty">{watchedMovies.length ? 'Rate a watched film to start your personal top three.' : 'Mark films watched to build your film print.'}</p>}
                </section>
              </div>
              <div className="archive-overview-favourites">
                <div className="profile-favorites-heading">
                  <div><span className="micro-label">FOUR FILMS THAT STAY</span><h2>The favourites.</h2></div>
                  <button className="text-button" type="button" onClick={() => onSectionChange('favourites')}>OPEN CANON ↗</button>
                </div>
                <div className="profile-favorites-grid">
                  {favorites.length ? favorites.map((movie) => (
                    <button className="profile-favorite-film" type="button" key={movie.id} onClick={() => onOpenMovie(movie)}>
                      {movie.poster_path ? <img src={imageUrl(movie.poster_path)} alt="" loading="lazy" decoding="async" /> : <span className="profile-favorite-placeholder">NO<br />IMAGE</span>}
                      <span className="profile-favorite-title">{movie.title}</span><span className="profile-favorite-year">{yearOf(movie)}</span>
                    </button>
                  )) : <p className="profile-top-films-empty">Choose up to four favourite films in Settings → Make it yours.</p>}
                </div>
              </div>
              <section className="profile-favorites profile-recent-films" aria-labelledby="profile-recent-title">
                <div className="profile-favorites-heading">
                  <div>
                    <span className="micro-label">FRESH FROM THE ARCHIVE</span>
                    <h2 id="profile-recent-title">Recently watched.</h2>
                  </div>
                  <button className="text-button" type="button" onClick={onOpenWatched} disabled={!watchedMovies.length}>OPEN WATCHED ↗</button>
                </div>
                {watchedMovies.length ? (
                  <div className="profile-favorites-grid">
                    {watchedMovies.slice(0, 4).map((movie) => (
                      <button className="profile-favorite-film" type="button" key={movie.id} onClick={() => onOpenWatchedMovie(movie)}>
                        {movie.poster_path
                          ? <img src={imageUrl(movie.poster_path)} alt="" loading="lazy" decoding="async" />
                          : <span className="profile-favorite-placeholder">NO<br />IMAGE</span>}
                        <span className="profile-favorite-title">{movie.title}</span>
                        <span className="profile-favorite-year">{yearOf(movie)}</span>
                        {movie.user_rating !== null && movie.user_rating !== undefined && (
                          <span className="profile-favorite-year">{movie.user_rating} / 5 ★</span>
                        )}
                        {getMovieViewings(movie).length > 1 && <span className="profile-favorite-rewatch">↻ REWATCH</span>}
                      </button>
                    ))}
                  </div>
                ) : (
                  <p className="profile-top-films-empty">Films you mark as watched will appear here.</p>
                )}
              </section>
            </>
          )}
        </div>
      )}

      {section === 'watched' && (
        <section className="archive-film-section" aria-labelledby="archive-watched-title">
          <header className="archive-section-heading archive-list-heading">
            <div><span className="micro-label">THE VIEWING RECORD / {watchedMovies.length} FILMS</span><h2 id="archive-watched-title">Watched<br /><em>films.</em></h2></div>
            <label className="archive-sort-field" htmlFor="archive-watched-sort"><span>SORT THE FILE</span><select id="archive-watched-sort" value={sort} onChange={(event) => setSort(event.target.value as WatchedSort)}>
              <option value="recent">Recently watched</option><option value="oldest">Oldest watched</option><option value="highest">Highest rated</option><option value="lowest">Lowest rated</option>
            </select></label>
          </header>
          {loading ? <p className="profile-film-print-loading" role="status">OPENING THE WATCHED FILE…</p> : sortedWatched.length ? (
            <div className="archive-film-grid">
              {sortedWatched.map((movie, index) => (
                <article className="archive-film-card" key={movie.id}>
                  {poster(movie, onOpenWatchedMovie)}
                  <span className="archive-film-index">{String(index + 1).padStart(3, '0')} / {yearOf(movie)}</span>
                  <h3><button className="archive-film-title" type="button" onClick={() => onOpenWatchedMovie(movie)}>{movie.title}</button></h3>
                  <p className="archive-film-meta">{movie.user_rating == null ? 'NOT RATED' : `${movie.user_rating} / 5 ★`}{watchedDate(movie) && ` · ${watchedDate(movie)}`}</p>
                  {movie.user_review?.trim() && <p className="archive-film-review">{movie.user_review}</p>}
                </article>
              ))}
            </div>
          ) : <p className="archive-empty">No films filed as watched yet.</p>}
        </section>
      )}

      {section === 'diary' && (
        <section className="archive-film-section archive-diary" aria-labelledby="archive-diary-title">
          <header className="archive-section-heading archive-list-heading archive-diary-heading">
            <div>
              <span className="micro-label">A CHRONOLOGY OF YOUR VIEWINGS / {diary.count} ENTRIES</span>
              <h2 id="archive-diary-title">Film<br /><em>diary.</em></h2>
            </div>
            <div className="archive-diary-filters">
              <label className="archive-diary-search">
                <span>SEARCH THE DIARY</span>
                <input
                  type="search"
                  value={diarySearch}
                  onChange={(event) => setDiarySearch(event.target.value)}
                  placeholder="Title, note, or year…"
                />
              </label>
              <label className="archive-sort-field" htmlFor="archive-diary-year">
                <span>WATCHED IN</span>
                <select id="archive-diary-year" value={diaryYear} onChange={(event) => setDiaryYear(event.target.value)}>
                  <option value="all">All years</option>
                  {diary.years.map((year) => <option key={year} value={year}>{year}</option>)}
                </select>
              </label>
            </div>
          </header>
          {loading ? <p className="profile-film-print-loading" role="status">TURNING THE PAGES…</p> : diary.count ? (
            <div className="archive-diary-timeline">
              {diary.groups.map((group) => (
                <section className="archive-diary-month" key={group.label} aria-label={group.label}>
                  <header className="archive-diary-month-heading">
                    <h3>{group.label}</h3>
                    <span>{String(group.entries.length).padStart(2, '0')} {group.entries.length === 1 ? 'FILM' : 'FILMS'}</span>
                  </header>
                  <div className="archive-diary-entries">
                    {group.entries.map(({ movie, viewing, date }, index) => (
                      <button
                        className="archive-diary-entry"
                        type="button"
                        key={viewing.id}
                        onClick={() => onOpenWatchedMovie(movie, viewing.id)}
                        aria-label={`Open ${movie.title} in your archive`}
                      >
                        <span className="archive-diary-poster" aria-hidden="true">
                          {movie.poster_path
                            ? <img src={imageUrl(movie.poster_path)} alt="" loading="lazy" decoding="async" />
                            : <span>NO<br />IMAGE</span>}
                        </span>
                        <span className="archive-diary-copy">
                          <span className="archive-diary-index">FILE / {String(index + 1).padStart(3, '0')} · {yearOf(movie)}</span>
                          <strong className="archive-diary-title">{movie.title}</strong>
                          <span className="archive-diary-meta">
                            {new Intl.DateTimeFormat('en', { day: '2-digit', month: 'long', year: 'numeric' }).format(date)}
                            <span aria-hidden="true"> / </span>
                            {viewing.user_rating == null ? 'NOT RATED' : `${viewing.user_rating} / 5 ★`}
                            {viewing.is_rewatch && <span className="archive-diary-rewatch"> · ↻ REWATCH</span>}
                          </span>
                          <span className={`archive-diary-note${viewing.user_review?.trim() ? '' : ' is-empty'}`}>
                            {viewing.user_review?.trim() || 'NO PERSONAL NOTE FILED'}
                          </span>
                        </span>
                        <span className="archive-diary-open" aria-hidden="true">↗</span>
                      </button>
                    ))}
                  </div>
                </section>
              ))}
              {diary.undated.length > 0 && (
                <section className="archive-diary-month archive-diary-undated" aria-label="Undated films">
                  <header className="archive-diary-month-heading">
                    <h3>Undated</h3>
                    <span>{String(diary.undated.length).padStart(2, '0')} {diary.undated.length === 1 ? 'FILM' : 'FILMS'}</span>
                  </header>
                  <div className="archive-diary-entries">
                    {diary.undated.map(({ movie, viewing }, index) => (
                      <button
                        className="archive-diary-entry"
                        type="button"
                        key={viewing.id}
                        onClick={() => onOpenWatchedMovie(movie, viewing.id)}
                        aria-label={`Open ${movie.title} in your archive`}
                      >
                        <span className="archive-diary-poster" aria-hidden="true">
                          {movie.poster_path
                            ? <img src={imageUrl(movie.poster_path)} alt="" loading="lazy" decoding="async" />
                            : <span>NO<br />IMAGE</span>}
                        </span>
                        <span className="archive-diary-copy">
                          <span className="archive-diary-index">FILE / {String(index + 1).padStart(3, '0')} · {yearOf(movie)}</span>
                          <strong className="archive-diary-title">{movie.title}</strong>
                          <span className="archive-diary-meta">
                            WATCH DATE NOT RECORDED
                            <span aria-hidden="true"> / </span>
                            {viewing.user_rating == null ? 'NOT RATED' : `${viewing.user_rating} / 5 ★`}
                            {viewing.is_rewatch && <span className="archive-diary-rewatch"> · ↻ REWATCH</span>}
                          </span>
                          <span className={`archive-diary-note${viewing.user_review?.trim() ? '' : ' is-empty'}`}>
                            {viewing.user_review?.trim() || 'NO PERSONAL NOTE FILED'}
                          </span>
                        </span>
                        <span className="archive-diary-open" aria-hidden="true">↗</span>
                      </button>
                    ))}
                  </div>
                </section>
              )}
            </div>
          ) : <p className="archive-empty">No watched films match these diary filters.</p>}
        </section>
      )}

      {section === 'reviews' && (
        <section className="archive-film-section" aria-labelledby="archive-reviews-title">
          <header className="archive-section-heading"><span className="micro-label">NOTES LEFT AFTER THE CREDITS / {reviews.length}</span><h2 id="archive-reviews-title">Personal<br /><em>reviews.</em></h2></header>
          {loading ? <p className="profile-film-print-loading" role="status">GATHERING YOUR NOTES…</p> : reviews.length ? (
            <div className="archive-reviews-list">
              {reviews.map(({ movie, viewing }, index) => (
                <article className="archive-review-card" key={viewing.id}>
                  {poster(movie, () => onOpenWatchedMovie(movie, viewing.id))}
                  <div className="archive-review-copy">
                    <span className="archive-film-index">NOTE / {String(index + 1).padStart(3, '0')}</span>
                    <button className="archive-review-title" type="button" onClick={() => onOpenWatchedMovie(movie, viewing.id)}>{movie.title} <span>{yearOf(movie)}</span></button>
                    <p className="archive-review-meta">{viewing.user_rating == null ? 'NOT RATED' : `${viewing.user_rating} / 5 ★`} · {parsedDate(viewing.watched_at) ? 'WATCHED ' : ''}{watchedDateLabel(viewing.watched_at)}{viewing.is_rewatch ? ' · REWATCH' : ''}</p>
                    <p className="archive-review-text">{viewing.user_review}</p>
                  </div>
                </article>
              ))}
            </div>
          ) : <p className="archive-empty">Your film notes will appear here after you write a review from a viewing log.</p>}
        </section>
      )}

      {section === 'collections' && (
        <section className="archive-collections" aria-labelledby="archive-collections-title">
          <header className="archive-section-heading"><span className="micro-label">CURATED BY YOU / NO RULES BUT YOURS</span><h2 id="archive-collections-title">Personal<br /><em>collections.</em></h2></header>
          <form className="archive-create-collection" onSubmit={createCollection}>
            <label htmlFor="new-collection-name">START A NEW FILE</label>
            <div><input id="new-collection-name" value={collectionName} onChange={(event) => setCollectionName(event.target.value)} maxLength={60} placeholder="Rainy day cinema…" disabled={loading || saving} required /><button className="button button-dark" type="submit" disabled={loading || saving}>CREATE COLLECTION</button></div>
          </form>
          {collections.length > 0 && (
            <label className="archive-collection-target" htmlFor="collection-target"><span>ADD SEARCHED FILMS TO</span><select id="collection-target" value={activeCollectionId} onChange={(event) => setTargetCollectionId(event.target.value)}>{collections.map((collection) => <option key={collection.id} value={collection.id}>{collection.name}</option>)}</select></label>
          )}
          <label className="archive-collection-search-label" htmlFor="collection-movie-search">FIND A FILM TO FILE</label>
          <input className="archive-collection-search" id="collection-movie-search" type="search" value={movieSearch} onChange={(event) => setMovieSearch(event.target.value)} placeholder="Search the movie archive…" disabled={!collections.length || loading || saving} />
          {searching && <p className="settings-inline-status" role="status">SEARCHING TMDB…</p>}
          {searchError && <p className="settings-inline-error" role="alert">{searchError}</p>}
          {!searching && movieResults.length > 0 && activeCollectionId && (
            <div className="archive-collection-search-results">
              {movieResults.map((movie) => {
                const target = collections.find((collection) => collection.id === activeCollectionId)
                const alreadyAdded = target?.movies.some((saved) => saved.id === movie.id) ?? false
                return <button type="button" className="archive-collection-search-result" key={movie.id} disabled={loading || saving || alreadyAdded} onClick={() => target && addMovie(target, movie)}>
                  {movie.poster_path ? <img src={imageUrl(movie.poster_path)} alt="" loading="lazy" /> : <span className="archive-poster-empty">NO<br />IMAGE</span>}
                  <span><strong>{movie.title}</strong><small>{yearOf(movie)}</small></span><span>{alreadyAdded ? 'FILED' : 'ADD +'}</span>
                </button>
              })}
            </div>
          )}
          {collectionFeedback && <p className={collectionFeedback.isError ? 'settings-inline-error' : 'settings-inline-status'} role={collectionFeedback.isError ? 'alert' : 'status'}>{collectionFeedback.message}</p>}
          {collections.length ? (
            <div className="archive-collection-list">
              {collections.map((collection, index) => (
                <article className="archive-collection" key={collection.id}>
                  <header className="archive-collection-heading">
                    <span className="micro-label">COLLECTION / {String(index + 1).padStart(2, '0')} / {collection.movies.length} FILMS</span>
                    <div className="archive-collection-rename">
                      <label className="sr-only" htmlFor={`collection-name-${collection.id}`}>Collection name</label>
                      <input id={`collection-name-${collection.id}`} value={renameDrafts[collection.id] ?? collection.name} maxLength={60} disabled={loading || saving} onChange={(event) => setRenameDrafts((drafts) => ({ ...drafts, [collection.id]: event.target.value }))} />
                      <button type="button" className="text-button" disabled={loading || saving || !(renameDrafts[collection.id] ?? collection.name).trim() || (renameDrafts[collection.id] ?? collection.name).trim() === collection.name} onClick={() => {
                        const name = (renameDrafts[collection.id] ?? collection.name).trim()
                        if (!name) return
                        void updateCollections(collections.map((item) => item.id === collection.id ? { ...item, name } : item), 'COLLECTION RENAMED.')
                      }}>SAVE NAME</button>
                      <button type="button" className="text-button archive-collection-delete" disabled={loading || saving} onClick={() => {
                        if (window.confirm(`Delete “${collection.name}” and its collection only?`)) {
                          void updateCollections(collections.filter((item) => item.id !== collection.id), 'COLLECTION DELETED.')
                        }
                      }}>DELETE ×</button>
                    </div>
                  </header>
                  {collection.movies.length ? (
                    <div className="profile-favorites-grid">
                      {collection.movies.map((movie) => (
                        <article className="archive-collection-film" key={movie.id}>
                          {poster(movie, onOpenMovie)}
                          <span className="profile-favorite-title">{movie.title}</span><span className="profile-favorite-year">{yearOf(movie)}</span>
                          <button type="button" className="text-button" disabled={loading || saving} onClick={() => void updateCollections(collections.map((item) => item.id === collection.id ? { ...item, movies: item.movies.filter((saved) => saved.id !== movie.id) } : item), 'FILM REMOVED FROM COLLECTION.')}>REMOVE ×</button>
                        </article>
                      ))}
                    </div>
                  ) : <p className="archive-empty archive-collection-empty">No films in this collection yet. Search above to add one.</p>}
                </article>
              ))}
            </div>
          ) : <p className="archive-empty">Your collections begin here. Create a file, then search for films to add.</p>}
        </section>
      )}

      {section === 'favourites' && (
        <section className="archive-film-section" aria-labelledby="archive-favourites-title">
          <header className="archive-section-heading"><span className="micro-label">FOUR FILMS THAT STAY / {favorites.length} OF 4</span><h2 id="archive-favourites-title">The<br /><em>canon.</em></h2></header>
          {favorites.length ? (
            <div className="profile-favorites-grid archive-canon-grid">
              {favorites.map((movie, index) => (
                <button className="profile-favorite-film" type="button" key={movie.id} onClick={() => onOpenMovie(movie)}>
                  <span className="archive-film-index">0{index + 1} / CANON</span>
                  {movie.poster_path ? <img src={imageUrl(movie.poster_path)} alt="" loading="lazy" decoding="async" /> : <span className="profile-favorite-placeholder">NO<br />IMAGE</span>}
                  <span className="profile-favorite-title">{movie.title}</span><span className="profile-favorite-year">{yearOf(movie)}</span>
                </button>
              ))}
            </div>
          ) : <p className="archive-empty">Choose up to four favourites in Settings → Make it yours.</p>}
        </section>
      )}
    </section>
  )
}
