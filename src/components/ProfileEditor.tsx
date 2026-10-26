import type { Dispatch, SetStateAction } from 'react'
import { imageUrl } from '../services/tmdb'
import type { ProfileData } from '../hooks/useProfile'
import type { Movie } from '../types'

interface ProfileEditorProps {
  profile: ProfileData
  loading: boolean
  error: string
  onSave: (profile: ProfileData) => Promise<boolean>
  onUpload: (kind: 'avatar' | 'banner', file: File) => Promise<boolean>
  search: string
  setSearch: Dispatch<SetStateAction<string>>
  results: Movie[]
  searching: boolean
  searchError: string
}

function yearOf(movie: Movie) {
  return movie.release_date?.slice(0, 4) || 'YEAR UNKNOWN'
}

export default function ProfileEditor({
  profile,
  loading,
  error,
  onSave,
  onUpload,
  search,
  setSearch,
  results,
  searching,
  searchError,
}: ProfileEditorProps) {
  return (
    <section className="profile-editor">
      <div className="profile-editor-heading">
        <span className="micro-label">MAKE IT YOURS</span>
        <h2>Profile picture<br /><em>&amp; banner.</em></h2>
      </div>
      <p className="account-description">Images are resized to WebP before upload. Maximum source size: 10 MB.</p>
      {error && <p className="diary-import-error" role="alert">{error}</p>}
      <div className="profile-image-controls">
        <label className="button button-dark profile-upload-button">
          {loading ? 'LOADING PROFILE…' : 'UPLOAD PROFILE PICTURE'}
          <input type="file" accept="image/*" disabled={loading} onChange={(event) => {
            const file = event.currentTarget.files?.[0]
            event.currentTarget.value = ''
            if (file) void onUpload('avatar', file)
          }} />
        </label>
        <label className="button button-dark profile-upload-button">
          {loading ? 'LOADING PROFILE…' : 'UPLOAD BANNER'}
          <input type="file" accept="image/*" disabled={loading} onChange={(event) => {
            const file = event.currentTarget.files?.[0]
            event.currentTarget.value = ''
            if (file) void onUpload('banner', file)
          }} />
        </label>
      </div>
      <div className="profile-editor-heading profile-favorite-editor-heading">
        <span className="micro-label">CURATE FOUR FAVOURITES</span>
        <h2>Pick your<br /><em>canon.</em></h2>
      </div>
      <label className="profile-search-label" htmlFor="favorite-movie-search">SEARCH TMDB</label>
      <input
        className="profile-movie-search"
        id="favorite-movie-search"
        type="search"
        value={search}
        onChange={(event) => setSearch(event.target.value)}
        placeholder="Film title…"
        disabled={loading}
      />
      {searching && <p className="diary-import-status" role="status">SEARCHING THE ARCHIVE…</p>}
      {searchError && <p className="diary-import-error" role="alert">{searchError}</p>}
      {search.trim().length >= 2 && !searching && !results.length && !searchError && (
        <p className="diary-import-status">No matching films found.</p>
      )}
      {results.length > 0 && (
        <div className="profile-search-results">
          {results.map((movie) => {
            const isFavorite = profile.favorites.some((favorite) => favorite.id === movie.id)
            return (
              <button
                className="profile-search-result"
                key={movie.id}
                type="button"
                disabled={isFavorite || (!isFavorite && profile.favorites.length >= 4)}
                onClick={() => {
                  if (!isFavorite && profile.favorites.length < 4) {
                    void onSave({ ...profile, favorites: [...profile.favorites, movie] })
                    setSearch('')
                  }
                }}
              >
                {movie.poster_path ? <img src={imageUrl(movie.poster_path)} alt="" loading="lazy" /> : <span className="profile-favorite-placeholder">NO<br />IMAGE</span>}
                <span><strong>{movie.title}</strong><small>{yearOf(movie)}</small></span>
                <span className="profile-search-result-action">{isFavorite ? 'ADDED' : 'ADD +'}</span>
              </button>
            )
          })}
        </div>
      )}
      <div className="profile-favorite-edit-list">
        {profile.favorites.map((movie, index) => (
          <div className="profile-favorite-edit" key={movie.id}>
            <span>0{index + 1}</span><strong>{movie.title}</strong><span>{yearOf(movie)}</span>
            <button type="button" onClick={() => { void onSave({ ...profile, favorites: profile.favorites.filter((favorite) => favorite.id !== movie.id) }) }} aria-label={`Remove ${movie.title} from favourites`}>×</button>
          </div>
        ))}
      </div>
    </section>
  )
}
