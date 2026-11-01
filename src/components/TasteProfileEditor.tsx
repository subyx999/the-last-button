import { useEffect, useState, type FormEvent } from 'react'
import { getMovieGenres, type MovieGenre } from '../services/tmdb'
import { EMPTY_TASTE_PROFILE, type ReleasePeriod, type TasteProfile } from '../types'

const RELEASE_PERIODS: Array<{ value: ReleasePeriod; label: string }> = [
  { value: 'any', label: 'Any release period' },
  { value: 'before-1960', label: 'Before 1960' },
  { value: '1960s', label: '1960–1969' },
  { value: '1970s', label: '1970–1979' },
  { value: '1980s', label: '1980–1989' },
  { value: '1990s', label: '1990–1999' },
  { value: '2000s', label: '2000–2009' },
  { value: '2010s', label: '2010–2019' },
  { value: '2020s', label: '2020 onward' },
]

const LANGUAGES = [
  { id: 'en', name: 'English' },
  { id: 'es', name: 'Spanish' },
  { id: 'fr', name: 'French' },
  { id: 'de', name: 'German' },
  { id: 'it', name: 'Italian' },
  { id: 'ja', name: 'Japanese' },
  { id: 'ko', name: 'Korean' },
  { id: 'hi', name: 'Hindi' },
  { id: 'zh', name: 'Chinese' },
]

interface TasteProfileEditorProps {
  tasteProfile: TasteProfile
  disabled: boolean
  error: string
  onSave: (tasteProfile: TasteProfile) => Promise<boolean>
}

export default function TasteProfileEditor({ tasteProfile, disabled, error, onSave }: TasteProfileEditorProps) {
  const [genres, setGenres] = useState<MovieGenre[]>([])
  const [genresLoading, setGenresLoading] = useState(true)
  const [genresError, setGenresError] = useState('')
  const [draft, setDraft] = useState(tasteProfile)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')

  useEffect(() => {
    let active = true
    getMovieGenres().then((items) => {
      if (active) setGenres(items)
    }).catch((cause: unknown) => {
      if (active) setGenresError(cause instanceof Error ? cause.message : 'Could not load movie genres.')
    }).finally(() => {
      if (active) setGenresLoading(false)
    })
    return () => { active = false }
  }, [])

  useEffect(() => {
    setDraft(tasteProfile)
  }, [tasteProfile])

  function toggleGenre(genreId: number, kind: 'preferredGenreIds' | 'dislikedGenreIds') {
    setMessage('')
    setDraft((current) => {
      const selected = current[kind].includes(genreId)
      const otherKind = kind === 'preferredGenreIds' ? 'dislikedGenreIds' : 'preferredGenreIds'
      return {
        ...current,
        [kind]: selected ? current[kind].filter((id) => id !== genreId) : [...current[kind], genreId],
        [otherKind]: selected ? current[otherKind] : current[otherKind].filter((id) => id !== genreId),
      }
    })
  }

  function toggleLanguage(languageId: string) {
    setMessage('')
    setDraft((current) => ({
      ...current,
      preferredLanguages: current.preferredLanguages.includes(languageId)
        ? current.preferredLanguages.filter((id) => id !== languageId)
        : [...current.preferredLanguages, languageId],
    }))
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSaving(true)
    setMessage('')
    const saved = await onSave(draft)
    setMessage(saved ? 'TASTE FILE SAVED.' : 'THE TASTE FILE COULD NOT BE SAVED.')
    setSaving(false)
  }

  return (
    <section className="taste-editor" aria-labelledby="taste-profile-title">
      <header className="taste-editor-heading">
        <div>
          <span className="micro-label">SETTINGS / PERSONAL CATALOGUE</span>
          <h2 id="taste-profile-title">Taste<br /><em>profile.</em></h2>
        </div>
        <p>These preferences shape random picks. They never alter the daily transmission or your Discover searches.</p>
      </header>
      <form className="taste-form" onSubmit={(event) => { void submit(event) }}>
        <fieldset className="taste-fieldset" disabled={disabled || genresLoading || saving}>
          <legend>PREFERRED GENRES <span>— ANY SELECTED GENRE</span></legend>
          {genresLoading ? (
            <p className="settings-inline-status" role="status">OPENING THE GENRE INDEX…</p>
          ) : genresError ? (
            <p className="settings-inline-error" role="alert">{genresError}</p>
          ) : (
            <div className="taste-genre-list">
              {genres.map((genre) => (
                <label className="taste-genre-option" key={genre.id}>
                  <input
                    type="checkbox"
                    checked={draft.preferredGenreIds.includes(genre.id)}
                    onChange={() => toggleGenre(genre.id, 'preferredGenreIds')}
                  />
                  <span>{genre.name}</span>
                </label>
              ))}
            </div>
          )}
        </fieldset>

        <fieldset className="taste-fieldset" disabled={disabled || genresLoading || saving}>
          <legend>GENRES TO AVOID <span>— ALWAYS EXCLUDED</span></legend>
          {genresLoading ? (
            <p className="settings-inline-status" role="status">OPENING THE GENRE INDEX…</p>
          ) : genresError ? (
            <p className="settings-inline-error" role="alert">{genresError}</p>
          ) : (
            <div className="taste-genre-list taste-genre-list-disliked">
              {genres.map((genre) => (
                <label className="taste-genre-option" key={genre.id}>
                  <input
                    type="checkbox"
                    checked={draft.dislikedGenreIds.includes(genre.id)}
                    onChange={() => toggleGenre(genre.id, 'dislikedGenreIds')}
                  />
                  <span>{genre.name}</span>
                </label>
              ))}
            </div>
          )}
        </fieldset>

        <div className="taste-preference-row">
          <label className="taste-select-field" htmlFor="taste-release-period">
            <span>PREFERRED RELEASE PERIOD</span>
            <select
              id="taste-release-period"
              value={draft.releasePeriod}
              disabled={disabled || saving}
              onChange={(event) => {
                setMessage('')
                setDraft((current) => ({ ...current, releasePeriod: event.target.value as ReleasePeriod }))
              }}
            >
              {RELEASE_PERIODS.map((period) => <option key={period.value} value={period.value}>{period.label}</option>)}
            </select>
          </label>
        </div>

        <fieldset className="taste-fieldset taste-language-fieldset" disabled={disabled || saving}>
          <legend>PREFERRED LANGUAGES <span>— OPTIONAL</span></legend>
          <div className="taste-language-list">
            {LANGUAGES.map((language) => (
              <label className="taste-language-option" key={language.id}>
                <input
                  type="checkbox"
                  checked={draft.preferredLanguages.includes(language.id)}
                  onChange={() => toggleLanguage(language.id)}
                />
                <span>{language.name}</span>
              </label>
            ))}
          </div>
        </fieldset>

        {error && <p className="settings-inline-error" role="alert">{error}</p>}
        {message && <p className={`settings-inline-status${message.startsWith('THE TASTE FILE') ? ' is-error' : ''}`} role="status">{message}</p>}
        <div className="taste-form-actions">
          <button className="button button-dark" type="submit" disabled={disabled || genresLoading || saving}>
            {saving ? 'SAVING…' : 'SAVE TASTE PROFILE'} <span aria-hidden="true">↗</span>
          </button>
          <button
            className="text-button"
            type="button"
            disabled={disabled || saving}
            onClick={() => {
              setDraft(EMPTY_TASTE_PROFILE)
              setMessage('')
            }}
          >
            CLEAR PREFERENCES
          </button>
        </div>
        <p className="taste-storage-note">
          {disabled ? 'WAITING FOR YOUR PROFILE TO LOAD…' : 'GUEST PREFERENCES STAY IN THIS BROWSER. SIGNED-IN PREFERENCES SYNC TO YOUR ACCOUNT.'}
        </p>
      </form>
    </section>
  )
}
