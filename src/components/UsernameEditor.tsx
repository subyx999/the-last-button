import { useEffect, useState, type FormEvent } from 'react'
import { normalizeUsername } from '../hooks/useProfile'

interface UsernameEditorProps {
  username: string
  fallbackUsername: string
  disabled: boolean
  error: string
  onSave: (username: string) => Promise<boolean>
}

export default function UsernameEditor({ username, fallbackUsername, disabled, error, onSave }: UsernameEditorProps) {
  const [draft, setDraft] = useState(username || fallbackUsername)
  const [saving, setSaving] = useState(false)
  const [feedback, setFeedback] = useState<{ message: string; isError: boolean } | null>(null)

  useEffect(() => {
    setDraft(username || fallbackUsername)
  }, [username, fallbackUsername])

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setFeedback(null)
    let normalized: string
    try {
      normalized = normalizeUsername(draft)
    } catch (cause) {
      setFeedback({ message: cause instanceof Error ? cause.message : 'Enter a valid username.', isError: true })
      return
    }

    setSaving(true)
    try {
      const saved = await onSave(normalized)
      setFeedback(saved
        ? { message: 'USERNAME SAVED.', isError: false }
        : { message: 'Username could not be saved. Check the profile error above and try again.', isError: true })
    } catch (cause) {
      setFeedback({ message: cause instanceof Error ? cause.message : 'Username could not be saved.', isError: true })
    } finally {
      setSaving(false)
    }
  }

  return (
    <form className="username-editor" onSubmit={(event) => { void submit(event) }}>
      <label htmlFor="account-username">USERNAME</label>
      <div className="username-editor-controls">
        <input
          id="account-username"
          type="text"
          value={draft}
          required
          maxLength={32}
          minLength={2}
          autoComplete="nickname"
          disabled={disabled || saving}
          onChange={(event) => {
            setDraft(event.target.value)
            setFeedback(null)
          }}
          aria-describedby="account-username-help"
        />
        <button className="button button-dark" type="submit" disabled={disabled || saving}>
          {saving ? 'SAVING…' : 'SAVE USERNAME'}
        </button>
      </div>
      <span className="username-editor-help" id="account-username-help">2–32 characters. Your username does not change your sign-in email.</span>
      {error && <p className="settings-inline-error" role="alert">{error}</p>}
      {feedback && (
        <p className={feedback.isError ? 'settings-inline-error' : 'settings-inline-status'} role={feedback.isError ? 'alert' : 'status'}>
          {feedback.message}
        </p>
      )}
    </form>
  )
}
