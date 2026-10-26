import { useEffect, useState } from 'react'
import type { Movie } from '../types'
import { supabase } from '../services/supabase'

const STORAGE_KEY = 'the-last-button-profile'
const PROFILE_BUCKET = 'profile-media'

export interface ProfileData {
  avatar: string
  banner: string
  favorites: Movie[]
}

const EMPTY_PROFILE: ProfileData = { avatar: '', banner: '', favorites: [] }

function readLocalProfile(): ProfileData {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}')
    if (!value || typeof value !== 'object') return EMPTY_PROFILE
    const profile = value as Partial<ProfileData>
    return {
      avatar: typeof profile.avatar === 'string' ? profile.avatar : '',
      banner: typeof profile.banner === 'string' ? profile.banner : '',
      favorites: Array.isArray(profile.favorites)
        ? profile.favorites.filter((movie): movie is Movie => Boolean(movie?.id && movie?.title)).slice(0, 4)
        : [],
    }
  } catch {
    return EMPTY_PROFILE
  }
}

export function profileImageUrl(path: string) {
  if (!path || path.startsWith('data:') || !supabase) return path
  return supabase.storage.from(PROFILE_BUCKET).getPublicUrl(path).data.publicUrl
}

async function compressImage(file: File, kind: 'avatar' | 'banner'): Promise<Blob> {
  if (!file.type.startsWith('image/')) throw new Error('Choose an image file.')
  if (file.size > 10 * 1024 * 1024) throw new Error('Image must be 10 MB or smaller.')

  const bitmap = await createImageBitmap(file)
  try {
    const maxDimension = kind === 'avatar' ? 640 : 1800
    const scale = Math.min(1, maxDimension / Math.max(bitmap.width, bitmap.height))
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(bitmap.width * scale))
    canvas.height = Math.max(1, Math.round(bitmap.height * scale))
    const context = canvas.getContext('2d')
    if (!context) throw new Error('Could not prepare this image. Try another file.')
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/webp', 0.82))
    if (!blob) throw new Error('Could not prepare this image. Try another file.')
    if (blob.size > 2 * 1024 * 1024) throw new Error('Compressed image is still larger than 2 MB. Choose a smaller image.')
    return blob
  } finally {
    bitmap.close()
  }
}

function blobDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => typeof reader.result === 'string' ? resolve(reader.result) : reject(new Error('Could not read image data.'))
    reader.onerror = () => reject(new Error('Could not read image data.'))
    reader.readAsDataURL(blob)
  })
}

export function useProfile(userId: string | undefined) {
  const [profile, setProfile] = useState<ProfileData>(readLocalProfile)
  const [loading, setLoading] = useState(Boolean(userId))
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true
    setError('')
    if (!userId) {
      setProfile(readLocalProfile())
      setLoading(false)
      return () => { active = false }
    }
    if (!supabase) {
      setLoading(false)
      setError('Profile sync is unavailable because Supabase is not configured.')
      return () => { active = false }
    }

    setLoading(true)
    const client = supabase
    async function loadProfile() {
      const { data, error: queryError } = await client
        .from('profiles')
        .select('profile_data')
        .eq('user_id', userId)
        .maybeSingle()
      if (queryError) throw queryError

      if (data?.profile_data) {
        const value = data.profile_data as Partial<ProfileData>
        const loaded: ProfileData = {
          avatar: typeof value.avatar === 'string' ? value.avatar : '',
          banner: typeof value.banner === 'string' ? value.banner : '',
          favorites: Array.isArray(value.favorites)
            ? value.favorites.filter((movie): movie is Movie => Boolean(movie?.id && movie?.title)).slice(0, 4)
            : [],
        }
        if (active) setProfile(loaded)
      } else {
        const localProfile = readLocalProfile()
        const accountProfile = { ...localProfile }
        for (const kind of ['avatar', 'banner'] as const) {
          const image = localProfile[kind]
          if (image.startsWith('data:')) {
            const response = await fetch(image)
            const blob = await response.blob()
            const path = `${userId}/${kind}-${Date.now()}.webp`
            const { error: uploadError } = await client.storage.from(PROFILE_BUCKET).upload(path, blob, {
              contentType: 'image/webp',
              upsert: true,
            })
            if (uploadError) throw uploadError
            accountProfile[kind] = path
          }
        }
        const { error: saveError } = await client.from('profiles').upsert(
          { user_id: userId, profile_data: accountProfile },
          { onConflict: 'user_id' },
        )
        if (saveError) throw saveError
        if (active) {
          setProfile(accountProfile)
          localStorage.removeItem(STORAGE_KEY)
        }
      }
    }

    loadProfile().catch((cause: unknown) => {
      if (active) setError(cause instanceof Error ? cause.message : 'Could not load your profile.')
    }).finally(() => {
      if (active) setLoading(false)
    })
    return () => { active = false }
  }, [userId])

  async function saveProfile(next: ProfileData): Promise<boolean> {
    setError('')
    const previous = profile
    setProfile(next)
    if (!userId) {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
        return true
      } catch (cause) {
        setProfile(previous)
        setError(cause instanceof Error ? cause.message : 'Could not save your profile in this browser.')
        return false
      }
    }
    if (!supabase) {
      setProfile(previous)
      setError('Profile sync is unavailable because Supabase is not configured.')
      return false
    }
    try {
      const { error: saveError } = await supabase.from('profiles').upsert(
        { user_id: userId, profile_data: next },
        { onConflict: 'user_id' },
      )
      if (saveError) throw saveError
      return true
    } catch (cause) {
      setProfile(previous)
      setError(cause instanceof Error ? cause.message : 'Could not sync your profile.')
      return false
    }
  }

  async function updateImage(kind: 'avatar' | 'banner', file: File): Promise<boolean> {
    setError('')
    try {
      const blob = await compressImage(file, kind)
      if (!userId) {
        return saveProfile({ ...profile, [kind]: await blobDataUrl(blob) })
      }
      if (!supabase) throw new Error('Profile sync is unavailable because Supabase is not configured.')

      const oldPath = profile[kind]
      const path = `${userId}/${kind}-${crypto.randomUUID()}.webp`
      const { error: uploadError } = await supabase.storage.from(PROFILE_BUCKET).upload(path, blob, {
        contentType: 'image/webp',
        upsert: true,
      })
      if (uploadError) throw uploadError

      const saved = await saveProfile({ ...profile, [kind]: path })
      if (!saved) {
        const { error: cleanupError } = await supabase.storage.from(PROFILE_BUCKET).remove([path])
        if (cleanupError) setError(`Profile save failed and the uploaded image could not be cleaned up: ${cleanupError.message}`)
        return false
      }
      if (oldPath && !oldPath.startsWith('data:')) {
        const { error: cleanupError } = await supabase.storage.from(PROFILE_BUCKET).remove([oldPath])
        if (cleanupError) setError(`Profile updated, but the previous image could not be removed: ${cleanupError.message}`)
      }
      return true
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not update this profile image.')
      return false
    }
  }

  return { profile, loading, error, saveProfile, updateImage }
}
