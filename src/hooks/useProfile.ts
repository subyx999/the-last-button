import { useEffect, useRef, useState } from 'react'
import { EMPTY_TASTE_PROFILE, type Movie, type MovieCollection, type ReleasePeriod, type TasteProfile } from '../types'
import { supabase } from '../services/supabase'

const STORAGE_KEY = 'the-last-button-profile'
const PROFILE_BUCKET = 'profile-media'

export interface ProfileData {
  username: string
  avatar: string
  banner: string
  favorites: Movie[]
  collections: MovieCollection[]
  tasteProfile: TasteProfile
}

const EMPTY_PROFILE: ProfileData = { username: '', avatar: '', banner: '', favorites: [], collections: [], tasteProfile: EMPTY_TASTE_PROFILE }
const RELEASE_PERIODS: ReleasePeriod[] = ['any', 'before-1960', '1960s', '1970s', '1980s', '1990s', '2000s', '2010s', '2020s']
const USERNAME_MIN_LENGTH = 2
const USERNAME_MAX_LENGTH = 32

export function normalizeUsername(value: string): string {
  const username = value.trim()
  if (username.length < USERNAME_MIN_LENGTH) {
    throw new Error(`Username must be at least ${USERNAME_MIN_LENGTH} characters.`)
  }
  if (username.length > USERNAME_MAX_LENGTH) {
    throw new Error(`Username must be ${USERNAME_MAX_LENGTH} characters or fewer.`)
  }
  return username
}

function readUsername(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) return ''
  try {
    return normalizeUsername(value)
  } catch {
    return ''
  }
}

export function isTasteProfileConfigured(profile: TasteProfile) {
  return profile.preferredGenreIds.length > 0
    || profile.dislikedGenreIds.length > 0
    || profile.preferredLanguages.length > 0
    || profile.releasePeriod !== 'any'
}

function mergeTasteProfiles(accountTaste: TasteProfile, guestTaste: TasteProfile): TasteProfile {
  const preferredGenreIds = [...new Set([...accountTaste.preferredGenreIds, ...guestTaste.preferredGenreIds])]
  const preferredGenres = new Set(preferredGenreIds)
  return {
    preferredGenreIds,
    dislikedGenreIds: [...new Set([...accountTaste.dislikedGenreIds, ...guestTaste.dislikedGenreIds])]
      .filter((id) => !preferredGenres.has(id)),
    releasePeriod: accountTaste.releasePeriod === 'any' ? guestTaste.releasePeriod : accountTaste.releasePeriod,
    preferredLanguages: [...new Set([...accountTaste.preferredLanguages, ...guestTaste.preferredLanguages])],
  }
}

function readTasteProfile(value: unknown): TasteProfile {
  if (!value || typeof value !== 'object') return EMPTY_TASTE_PROFILE
  const taste = value as Partial<TasteProfile>
  const preferredGenreIds = Array.isArray(taste.preferredGenreIds)
    ? [...new Set(taste.preferredGenreIds.filter((id): id is number => Number.isInteger(id) && id > 0))]
    : []
  const preferredGenreSet = new Set(preferredGenreIds)
  return {
    preferredGenreIds,
    dislikedGenreIds: Array.isArray(taste.dislikedGenreIds)
      ? [...new Set(taste.dislikedGenreIds.filter((id): id is number => Number.isInteger(id) && id > 0 && !preferredGenreSet.has(id)))]
      : [],
    releasePeriod: RELEASE_PERIODS.includes(taste.releasePeriod as ReleasePeriod) ? taste.releasePeriod as ReleasePeriod : 'any',
    preferredLanguages: Array.isArray(taste.preferredLanguages)
      ? [...new Set(taste.preferredLanguages.filter((language): language is string => typeof language === 'string' && /^[a-z]{2}$/i.test(language)).map((language) => language.toLowerCase()))]
      : [],
  }
}

function normalizeFavorites(value: unknown): Movie[] {
  if (!Array.isArray(value)) return []
  const seen = new Set<number>()
  const favorites: Movie[] = []
  for (const candidate of value) {
    if (!candidate || typeof candidate !== 'object') continue
    const movie = candidate as Movie
    if (!Number.isSafeInteger(movie.id) || movie.id <= 0 || typeof movie.title !== 'string' || !movie.title.trim() || seen.has(movie.id)) continue
    seen.add(movie.id)
    favorites.push(movie)
    if (favorites.length === 4) break
  }
  return favorites
}

function mergeFavorites(guestFavorites: Movie[], accountFavorites: Movie[]): Movie[] {
  return normalizeFavorites([...guestFavorites, ...accountFavorites])
}

function normalizeCollections(value: unknown): MovieCollection[] {
  if (!Array.isArray(value)) return []
  const collections: MovieCollection[] = []
  const ids = new Set<string>()
  for (const candidate of value) {
    if (!candidate || typeof candidate !== 'object') continue
    const collection = candidate as Partial<MovieCollection>
    const id = typeof collection.id === 'string' ? collection.id.trim() : ''
    const name = typeof collection.name === 'string' ? collection.name.trim().slice(0, 60) : ''
    if (!id || !name || ids.has(id)) continue
    ids.add(id)
    collections.push({ id, name, movies: normalizeCollectionMovies(collection.movies) })
  }
  return collections
}

function normalizeCollectionMovies(value: unknown): Movie[] {
  if (!Array.isArray(value)) return []
  const seen = new Set<number>()
  const movies: Movie[] = []
  for (const candidate of value) {
    const [movie] = normalizeFavorites([candidate])
    if (!movie || seen.has(movie.id)) continue
    seen.add(movie.id)
    movies.push(movie)
  }
  return movies
}

function mergeCollections(guestCollections: MovieCollection[], accountCollections: MovieCollection[]): MovieCollection[] {
  const merged = normalizeCollections(guestCollections)
  const byName = new Map(merged.map((collection) => [collection.name.toLocaleLowerCase(), collection]))
  for (const accountCollection of normalizeCollections(accountCollections)) {
    const existing = byName.get(accountCollection.name.toLocaleLowerCase())
    if (existing) {
      existing.movies = normalizeCollectionMovies([...existing.movies, ...accountCollection.movies])
    } else {
      merged.push(accountCollection)
      byName.set(accountCollection.name.toLocaleLowerCase(), accountCollection)
    }
  }
  return merged
}

function readLocalProfile(): ProfileData {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}')
    if (!value || typeof value !== 'object') return EMPTY_PROFILE
    const profile = value as Partial<ProfileData>
    return {
      username: readUsername(profile.username),
      avatar: typeof profile.avatar === 'string' ? profile.avatar : '',
      banner: typeof profile.banner === 'string' ? profile.banner : '',
      favorites: normalizeFavorites(profile.favorites),
      collections: normalizeCollections(profile.collections),
      tasteProfile: readTasteProfile(profile.tasteProfile),
    }
  } catch {
    return EMPTY_PROFILE
  }
}

export function profileImageUrl(path: string) {
  if (!path || path.startsWith('data:') || !supabase) return path
  return supabase.storage.from(PROFILE_BUCKET).getPublicUrl(path).data.publicUrl
}

function errorMessage(cause: unknown): string {
  if (cause instanceof Error) return cause.message
  if (cause && typeof cause === 'object' && 'message' in cause && typeof cause.message === 'string') return cause.message
  return 'An unknown error occurred.'
}

function profileOperationError(operation: string, cause: unknown): string {
  const detail = errorMessage(cause)
  const normalized = detail.toLowerCase()
  if (normalized.includes('bucket not found') || normalized.includes('bucket does not exist')) {
    return `Could not ${operation}: the profile-media Storage bucket is missing. Apply supabase/profile.sql in your Supabase project.`
  }
  if (normalized.includes('row-level security') || normalized.includes('permission denied') || normalized.includes('unauthorized') || normalized.includes('403')) {
    return `Could not ${operation}: Supabase denied access. Confirm the profile-media policies and profiles RLS policies from supabase/profile.sql are applied for this signed-in user. (${detail})`
  }
  if (normalized.includes('public.profiles') || (normalized.includes('relation') && normalized.includes('does not exist'))) {
    return `Could not ${operation}: the profiles table is unavailable. Apply supabase/profile.sql in your Supabase project. (${detail})`
  }
  return `Could not ${operation}: ${detail}`
}

function hasGuestProfileData(profile: ProfileData): boolean {
  return Boolean(profile.username || profile.avatar || profile.banner || profile.favorites.length || profile.collections.length || isTasteProfileConfigured(profile.tasteProfile))
}

function readProfileData(value: unknown): ProfileData {
  if (!value || typeof value !== 'object') return EMPTY_PROFILE
  const profile = value as Partial<ProfileData>
  return {
    username: readUsername(profile.username),
    avatar: typeof profile.avatar === 'string' ? profile.avatar : '',
    banner: typeof profile.banner === 'string' ? profile.banner : '',
    favorites: normalizeFavorites(profile.favorites),
    collections: normalizeCollections(profile.collections),
    tasteProfile: readTasteProfile(profile.tasteProfile),
  }
}

async function compressImage(file: File, kind: 'avatar' | 'banner'): Promise<Blob> {
  if (!file.type.startsWith('image/')) throw new Error('Choose an image file.')
  if (file.size > 10 * 1024 * 1024) throw new Error('Image must be 10 MB or smaller.')

  let bitmap: ImageBitmap
  try {
    bitmap = await createImageBitmap(file)
  } catch {
    throw new Error('This image could not be decoded. Choose a PNG, JPEG, or WebP image and try again.')
  }
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
  const [loadError, setLoadError] = useState('')
  const profileRef = useRef(profile)
  const persistedProfileRef = useRef(profile)
  const saveQueueRef = useRef<Promise<void>>(Promise.resolve())

  function setCurrentProfile(next: ProfileData) {
    profileRef.current = next
    setProfile(next)
  }

  useEffect(() => {
    let active = true
    setError('')
    setLoadError('')
    if (!userId) {
      const localProfile = readLocalProfile()
      persistedProfileRef.current = localProfile
      setCurrentProfile(localProfile)
      setLoading(false)
      return () => { active = false }
    }
    if (!supabase) {
      setLoading(false)
      const message = 'Profile sync is unavailable because Supabase is not configured.'
      setError(message)
      setLoadError(message)
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

      const accountProfile = readProfileData(data?.profile_data)
      const guestProfile = readLocalProfile()
      const hasGuestData = hasGuestProfileData(guestProfile)
      const migratedFiles: string[] = []
      const mergedProfile: ProfileData = {
        username: accountProfile.username || guestProfile.username,
        avatar: guestProfile.avatar || accountProfile.avatar,
        banner: guestProfile.banner || accountProfile.banner,
        favorites: mergeFavorites(guestProfile.favorites, accountProfile.favorites),
        collections: mergeCollections(guestProfile.collections, accountProfile.collections),
        tasteProfile: mergeTasteProfiles(accountProfile.tasteProfile, guestProfile.tasteProfile),
      }

      try {
        for (const kind of ['avatar', 'banner'] as const) {
          const imageToMigrate = guestProfile[kind].startsWith('data:')
            ? guestProfile[kind]
            : accountProfile[kind].startsWith('data:') ? accountProfile[kind] : ''
          if (!imageToMigrate.startsWith('data:')) continue
          const response = await fetch(imageToMigrate)
          if (!response.ok) throw new Error(`Could not read the saved guest ${kind} image for account migration.`)
          const blob = await response.blob()
          const path = `${userId}/${kind}-${crypto.randomUUID()}.webp`
          const { error: uploadError } = await client.storage.from(PROFILE_BUCKET).upload(path, blob, {
            contentType: 'image/webp',
            upsert: false,
          })
          if (uploadError) throw uploadError
          mergedProfile[kind] = path
          migratedFiles.push(path)
        }

        const accountNeedsUpdate = !data?.profile_data || (
          hasGuestData
          && JSON.stringify(mergedProfile) !== JSON.stringify(accountProfile)
        )
        if (accountNeedsUpdate) {
          const { error: saveError } = await client.from('profiles').upsert(
            { user_id: userId, profile_data: mergedProfile },
            { onConflict: 'user_id' },
          )
          if (saveError) throw saveError
        }
      } catch (cause) {
        if (migratedFiles.length) {
          const { error: cleanupError } = await client.storage.from(PROFILE_BUCKET).remove(migratedFiles)
          if (cleanupError) {
            throw new Error(`${errorMessage(cause)} Uploaded image cleanup also failed: ${cleanupError.message}`)
          }
        }
        throw cause
      }

      if (hasGuestData) localStorage.removeItem(STORAGE_KEY)
      if (active) {
        persistedProfileRef.current = mergedProfile
        setCurrentProfile(mergedProfile)
        setLoadError('')
      }
    }

    loadProfile().catch((cause: unknown) => {
      if (active) {
        const message = profileOperationError('load your profile', cause)
        setError(message)
        setLoadError(message)
      }
    }).finally(() => {
      if (active) setLoading(false)
    })
    return () => { active = false }
  }, [userId])

  async function saveProfile(next: ProfileData): Promise<boolean> {
    setError('')
    setCurrentProfile(next)
    const operation = saveQueueRef.current.then(async () => {
      if (!userId) {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
        persistedProfileRef.current = next
        return
      }
      if (!supabase) throw new Error('Profile sync is unavailable because Supabase is not configured.')
      const { error: saveError } = await supabase.from('profiles').upsert(
        { user_id: userId, profile_data: next },
        { onConflict: 'user_id' },
      )
      if (saveError) throw saveError
      persistedProfileRef.current = next
    })
    // Keep later saves runnable while the current caller handles its own failure.
    saveQueueRef.current = operation.catch(() => {})

    try {
      await operation
      setError('')
      return true
    } catch (cause) {
      if (profileRef.current === next) setCurrentProfile(persistedProfileRef.current)
      setError(profileOperationError(userId ? 'save your profile' : 'save your profile in this browser', cause))
      return false
    }
  }

  function saveFavorites(favorites: Movie[]): Promise<boolean> {
    return saveProfile({ ...profileRef.current, favorites: normalizeFavorites(favorites) })
  }

  function saveTasteProfile(tasteProfile: TasteProfile): Promise<boolean> {
    return saveProfile({ ...profileRef.current, tasteProfile: readTasteProfile(tasteProfile) })
  }

  function saveUsername(value: string): Promise<boolean> {
    let username: string
    try {
      username = normalizeUsername(value)
    } catch (cause) {
      setError(errorMessage(cause))
      return Promise.resolve(false)
    }
    return saveProfile({ ...profileRef.current, username })
  }

  function saveCollections(collections: MovieCollection[]): Promise<boolean> {
    return saveProfile({ ...profileRef.current, collections: normalizeCollections(collections) })
  }

  async function updateImage(kind: 'avatar' | 'banner', file: File): Promise<boolean> {
    setError('')
    try {
      const blob = await compressImage(file, kind)
      if (!userId) {
        return saveProfile({ ...profileRef.current, [kind]: await blobDataUrl(blob) })
      }
      if (!supabase) throw new Error('Profile sync is unavailable because Supabase is not configured.')

      const previousPath = profileRef.current[kind]
      const path = `${userId}/${kind}-${crypto.randomUUID()}.webp`
      const { error: uploadError } = await supabase.storage.from(PROFILE_BUCKET).upload(path, blob, {
        contentType: 'image/webp',
        upsert: false,
      })
      if (uploadError) throw uploadError

      const saved = await saveProfile({ ...profileRef.current, [kind]: path })
      if (!saved) {
        const { error: cleanupError } = await supabase.storage.from(PROFILE_BUCKET).remove([path])
        if (cleanupError) setError(`Profile save failed and the uploaded image could not be cleaned up: ${cleanupError.message}`)
        return false
      }
      if (previousPath && !previousPath.startsWith('data:')) {
        const { error: cleanupError } = await supabase.storage.from(PROFILE_BUCKET).remove([previousPath])
        if (cleanupError) setError(`Profile updated, but the previous image could not be removed: ${cleanupError.message}`)
      }
      return true
    } catch (cause) {
      setError(profileOperationError(`upload the ${kind}`, cause))
      return false
    }
  }

  return { profile, loading, error, loadError, saveCollections, saveFavorites, saveTasteProfile, saveUsername, updateImage }
}
