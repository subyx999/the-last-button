import type { Movie } from '../types'
import { imageUrl } from '../services/tmdb'

interface ArchiveFilmViewProps {
  movie: Movie
  personalMovie: Movie
  loading: boolean
  onBack: () => void
  onOpenOriginal: (movie: Movie) => void
  onEditReview: () => void
}

function yearOf(movie: Movie) {
  return movie.release_date?.slice(0, 4) || 'YEAR UNKNOWN'
}

function watchedDate(movie: Movie) {
  if (!movie.watched_at) return ''
  const date = new Date(movie.watched_at)
  return Number.isNaN(date.getTime())
    ? ''
    : new Intl.DateTimeFormat('en', { day: '2-digit', month: 'long', year: 'numeric' }).format(date)
}

export default function ArchiveFilmView({ movie, personalMovie, loading, onBack, onOpenOriginal, onEditReview }: ArchiveFilmViewProps) {
  const date = watchedDate(personalMovie)
  const trailer = movie.videos?.results?.find((video) => video.site === 'YouTube' && video.type === 'Trailer')
    ?? movie.videos?.results?.find((video) => video.site === 'YouTube' && video.type === 'Teaser')

  return (
    <section className="archive-film-view" aria-labelledby="archive-film-title">
      <header className="archive-film-masthead">
        <button className="back-link archive-film-back" type="button" onClick={onBack}>← BACK TO YOUR ARCHIVE</button>
        <div className="archive-film-masthead-mark">
          <p className="eyebrow"><span className="red-mark">✳</span> PERSONAL ARCHIVE / VIEWING NOTE</p>
          <span className="archive-film-number">TMDB RECORD / {String(movie.id).padStart(6, '0')}</span>
        </div>
        <span className="archive-film-issue">Button.<br />A PERSONAL VIEWING RECORD</span>
      </header>
      <div className="archive-film-titleband">
        <span className="archive-film-side-index" aria-hidden="true">VIEWING NOTE / {String(movie.id).padStart(6, '0')}</span>
        <div className="archive-film-title-copy">
          <span className="micro-label">A FILM YOU HAVE SEEN</span>
          <h1 id="archive-film-title">{movie.title}</h1>
          <div className="archive-film-specs" aria-label="Release year, runtime, and genres">
            <span>{yearOf(movie)}</span>
            <span>{movie.runtime ? `${movie.runtime} MIN` : 'RUNTIME UNKNOWN'}</span>
            {movie.genres?.map((genre) => <span key={genre.id}>{genre.name.toUpperCase()}</span>)}
          </div>
        </div>
        <span className="archive-film-title-mark" aria-hidden="true">✳</span>
      </div>

      <div className="archive-film-layout">
        <div className="archive-film-artwork">
          <span className="archive-film-artwork-label" aria-hidden="true">PLATE / {String(movie.id).padStart(6, '0')}</span>
          <button
            className="archive-film-poster"
            type="button"
            onClick={() => onOpenOriginal(movie)}
            disabled={loading}
            aria-label={`Open original movie details for ${movie.title}`}
          >
            {movie.poster_path
              ? <img src={imageUrl(movie.poster_path)} alt={`${movie.title} poster`} />
              : <span className="archive-film-poster-missing">NO<br />POSTER<br />AVAILABLE</span>}
            <span className="archive-film-poster-caption">OPEN ORIGINAL FILM FILE ↗</span>
          </button>
          <span className="archive-film-artwork-note" aria-hidden="true">POSTER / TMDB</span>
        </div>

        <div className="archive-film-editorial">
          <div className="archive-personal-record">
            <div className="archive-personal-record-heading">
              <span className="micro-label">YOUR VIEWING RECORD</span>
              <span className="archive-watched-status">WATCHED ✓</span>
            </div>
            <div className="archive-personal-rating">
              <span>PERSONAL RATING</span>
              <strong>{personalMovie.user_rating == null ? 'NOT RATED' : `${personalMovie.user_rating} / 5 ★`}</strong>
            </div>
            {date && <p className="archive-personal-date"><span>WATCHED ON</span>{date}</p>}
            <div className="archive-personal-review">
              <span className="micro-label">A NOTE TO YOURSELF</span>
              {personalMovie.user_review?.trim()
                ? <blockquote>{personalMovie.user_review}</blockquote>
                : <p>No note written for this viewing.</p>}
            </div>
            <button className="button button-dark archive-edit-note" type="button" onClick={onEditReview} disabled={loading}>
              {loading ? 'SAVING…' : personalMovie.user_review?.trim() || personalMovie.user_rating != null ? 'EDIT RATING & REVIEW' : 'ADD RATING & REVIEW'}
            </button>
            <span className="archive-record-reference" aria-hidden="true">PERSONAL FILE / {String(movie.id).padStart(6, '0')}</span>
          </div>
        </div>
      </div>
      {loading && <p className="archive-film-loading" role="status">OPENING THE FILM FILE…</p>}
      <section className="archive-film-notes" aria-labelledby="archive-film-about">
        <div>
          <span className="micro-label">01 / THE FILM</span>
          <h2 id="archive-film-about">The story,<br /><em>on record.</em></h2>
        </div>
        <p>{movie.overview || 'No synopsis available from the archive.'}</p>
      </section>
      {(movie.tagline || movie.vote_average || movie.production_companies?.length || movie.production_countries?.length || movie.spoken_languages?.length || movie.credits?.cast?.length || trailer) && (
        <section className="archive-film-details" aria-label="Available movie details">
          <span className="micro-label archive-film-facts-label">02 / AVAILABLE DETAILS</span>
          {movie.tagline && <p className="archive-film-tagline">“{movie.tagline}”</p>}
          <div className="archive-film-facts">
            <p><span className="micro-label">TMDB RATING</span>{movie.vote_average ? `${movie.vote_average.toFixed(1)} / 10` : 'UNRATED'}</p>
            {movie.production_companies?.length ? <p><span className="micro-label">PRODUCTION</span>{movie.production_companies.slice(0, 4).map((company) => company.name).join(' · ')}</p> : null}
            {movie.production_countries?.length ? <p><span className="micro-label">ORIGIN</span>{movie.production_countries.map((country) => country.name).join(' · ')}</p> : null}
            {movie.spoken_languages?.length ? <p><span className="micro-label">LANGUAGES</span>{movie.spoken_languages.map((language) => language.english_name || language.name).join(' · ')}</p> : null}
            {movie.credits?.cast?.length ? <p><span className="micro-label">CAST</span>{movie.credits.cast.slice(0, 8).map((person) => person.name).join(' · ')}</p> : null}
            {movie.credits?.crew?.find((person) => person.job === 'Director') ? <p><span className="micro-label">DIRECTOR</span>{movie.credits.crew.find((person) => person.job === 'Director')?.name}</p> : null}
          </div>
          {trailer && <a className="button button-trailer archive-film-trailer" href={`https://www.youtube.com/watch?v=${trailer.key}`} target="_blank" rel="noreferrer">WATCH TRAILER ↗</a>}
        </section>
      )}
    </section>
  )
}
