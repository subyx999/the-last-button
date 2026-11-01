import { useEffect, useRef, useState, type ChangeEvent, type Dispatch, type SetStateAction } from 'react'
import { profileImageUrl, type ProfileData } from '../hooks/useProfile'
import { imageUrl } from '../services/tmdb'
import type { Movie } from '../types'

interface ProfileEditorProps {
  profile: ProfileData
  loading: boolean
  error: string
  onSave: (favorites: Movie[]) => Promise<boolean>
  onUpload: (kind: 'avatar' | 'banner', file: File) => Promise<boolean>
  search: string
  setSearch: Dispatch<SetStateAction<string>>
  results: Movie[]
  searching: boolean
  searchError: string
}

type ImageKind = 'avatar' | 'banner'

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
  const [busy, setBusy] = useState(false)
  const [feedback, setFeedback] = useState<{ message: string; isError: boolean } | null>(null)
  const [previews, setPreviews] = useState<Record<ImageKind, string>>({ avatar: '', banner: '' })
  const [failedImages, setFailedImages] = useState<Record<ImageKind, boolean>>({ avatar: false, banner: false })
  const previewUrls = useRef(new Map<ImageKind, string>())

  useEffect(() => () => {
    previewUrls.current.forEach((url) => URL.revokeObjectURL(url))
    previewUrls.current.clear()
  }, [])

  function clearPreview(kind: ImageKind) {
    const url = previewUrls.current.get(kind)
    if (url) URL.revokeObjectURL(url)
    previewUrls.current.delete(kind)
    setPreviews((current) => ({ ...current, [kind]: '' }))
    setFailedImages((current) => ({ ...current, [kind]: false }))
  }

  async function uploadImage(kind: ImageKind, file: File) {
    setFeedback(null)
    if (!file.type.startsWith('image/')) {
      setFeedback({ message: 'Choose a valid image file.', isError: true })
      return
    }
    if (file.size > 10 * 1024 * 1024) {
      setFeedback({ message: 'Image must be 10 MB or smaller.', isError: true })
      return
    }

    const previousUrl = previewUrls.current.get(kind)
    if (previousUrl) URL.revokeObjectURL(previousUrl)
    const previewUrl = URL.createObjectURL(file)
    previewUrls.current.set(kind, previewUrl)
    setPreviews((current) => ({ ...current, [kind]: previewUrl }))
    setFailedImages((current) => ({ ...current, [kind]: false }))
    setBusy(true)
    try {
      const saved = await onUpload(kind, file)
      if (saved) {
        clearPreview(kind)
        setFeedback({ message: kind === 'avatar' ? 'PROFILE PICTURE SAVED.' : 'PROFILE BANNER SAVED.', isError: false })
      } else {
        clearPreview(kind)
        setFeedback({
          message: `The ${kind === 'avatar' ? 'profile picture' : 'profile banner'} upload failed. Review the profile error above and try again.`,
          isError: true,
        })
      }
    } catch (cause) {
      clearPreview(kind)
      setFeedback({
        message: cause instanceof Error ? cause.message : `The ${kind} upload failed. Please try again.`,
        isError: true,
      })
    } finally {
      setBusy(false)
    }
  }

  function handleImageSelection(kind: ImageKind, event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0]
    event.currentTarget.value = ''
    if (file) void uploadImage(kind, file)
  }

  async function saveFavorites(favorites: Movie[], message: string) {
    if (busy) return
    setBusy(true)
    setFeedback(null)
    try {
      const saved = await onSave(favorites)
      if (!saved) {
        setFeedback({ message: 'Favourite movie could not be saved. Review the profile error above and try again.', isError: true })
        return
      }
      setFeedback({ message, isError: false })
      if (message === 'FAVOURITE ADDED.') setSearch('')
    } catch (cause) {
      setFeedback({
        message: cause instanceof Error ? cause.message : 'Favourite movie could not be saved. Please try again.',
        isError: true,
      })
    } finally {
      setBusy(false)
    }
  }

  const avatarSource = previews.avatar || (profile.avatar ? profileImageUrl(profile.avatar) : '')
  const bannerSource = previews.banner || (profile.banner ? profileImageUrl(profile.banner) : '')

  return (
    <section className="profile-editor">
      <div className="profile-editor-heading">
        <span className="micro-label">MAKE IT YOURS</span>
        <h2>Profile picture<br /><em>&amp; banner.</em></h2>
      </div>
      <p className="account-description">Images are resized to WebP before upload. Maximum source size: 10 MB.</p>
      {error && <p className="diary-import-error" role="alert">{error}</p>}
      <div className="profile-image-previews">
        <div className="profile-image-preview">
          <span className="micro-label">PROFILE PICTURE</span>
          {avatarSource && !failedImages.avatar
            ? <img src={avatarSource} alt="Profile picture preview" onError={() => setFailedImages((current) => ({ ...current, avatar: true }))} />
            : <span className="profile-image-preview-empty" role="status">{failedImages.avatar ? 'IMAGE COULD NOT LOAD' : 'NO PICTURE ON FILE'}</span>}
        </div>
        <div className="profile-image-preview profile-banner-preview">
          <span className="micro-label">BANNER</span>
          {bannerSource && !failedImages.banner
            ? <img src={bannerSource} alt="Profile banner preview" onError={() => setFailedImages((current) => ({ ...current, banner: true }))} />
            : <span className="profile-image-preview-empty" role="status">{failedImages.banner ? 'IMAGE COULD NOT LOAD' : 'NO BANNER ON FILE'}</span>}
        </div>
      </div>
      {(failedImages.avatar || failedImages.banner) && (
        <p className="diary-import-error" role="alert">
          A saved profile image could not be loaded. Check that the profile-media bucket exists and is publicly readable.
        </p>
      )}
      <div className="profile-image-controls">
        <label className="button button-dark profile-upload-button">
          {busy ? 'SAVING PROFILE…' : 'UPLOAD PROFILE PICTURE'}
          <input type="file" accept="image/*" disabled={loading || busy} onChange={(event) => handleImageSelection('avatar', event)} />
        </label>
        <label className="button button-dark profile-upload-button">
          {busy ? 'SAVING PROFILE…' : 'UPLOAD BANNER'}
          <input type="file" accept="image/*" disabled={loading || busy} onChange={(event) => handleImageSelection('banner', event)} />
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
        onChange={(event) => {
          setFeedback(null)
          setSearch(event.target.value)
        }}
        placeholder="Film title…"
        disabled={loading || busy}
      />
      {searching && <p className="diary-import-status" role="status">SEARCHING THE ARCHIVE…</p>}
      {searchError && <p className="diary-import-error" role="alert">{searchError}</p>}
      {search.trim().length >= 2 && !searching && !results.length && !searchError && (
        <p className="diary-import-status" role="status">No matching films found.</p>
      )}
      {results.length > 0 && (
        <div className="profile-search-results" aria-label="Favourite movie search results">
          {results.map((movie) => {
            const isFavorite = profile.favorites.some((favorite) => favorite.id === movie.id)
            const isAtLimit = profile.favorites.length >= 4
            return (
              <button
                className="profile-search-result"
                key={movie.id}
                type="button"
                disabled={loading || busy || isFavorite || isAtLimit}
                onClick={() => {
                  if (!isFavorite && !isAtLimit) {
                    void saveFavorites([...profile.favorites, movie], 'FAVOURITE ADDED.')
                  }
                }}
              >
                {movie.poster_path ? <img src={imageUrl(movie.poster_path)} alt="" loading="lazy" /> : <span className="profile-favorite-placeholder">NO<br />IMAGE</span>}
                <span><strong>{movie.title}</strong><small>{yearOf(movie)}</small></span>
                <span className="profile-search-result-action">{isFavorite ? 'ADDED' : isAtLimit ? 'FOUR FILED' : 'ADD +'}</span>
              </button>
            )
          })}
        </div>
      )}
      {feedback && <p className={feedback.isError ? 'diary-import-error' : 'diary-import-status'} role={feedback.isError ? 'alert' : 'status'}>{feedback.message}</p>}
      <div className="profile-favorite-edit-list" aria-label={`Favourite movies, ${profile.favorites.length} of 4 selected`}>
        {profile.favorites.map((movie, index) => (
          <div className="profile-favorite-edit" key={movie.id}>
            <span>0{index + 1}</span><strong>{movie.title}</strong><span>{yearOf(movie)}</span>
            <button
              type="button"
              disabled={loading || busy}
              onClick={() => { void saveFavorites(profile.favorites.filter((favorite) => favorite.id !== movie.id), 'FAVOURITE REMOVED.') }}
              aria-label={`Remove ${movie.title} from favourites`}
            >×</button>
          </div>
        ))}
      </div>
      <p className="profile-favorite-count" aria-live="polite">{profile.favorites.length} / 4 FAVOURITES FILED</p>
    </section>
  )
}
