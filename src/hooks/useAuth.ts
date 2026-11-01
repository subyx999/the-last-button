import { useEffect, useRef, useState } from 'react'
import type { Session, User } from '@supabase/supabase-js'
import { supabase } from '../services/supabase'

const INVALID_RECOVERY_LINK_MESSAGE =
  'This password reset link is invalid, expired, or has already been used. Request a new email to continue.'

export function useAuth() {
  const [user, setUser] = useState<User | null>(null)
  const [passwordRecovery, setPasswordRecovery] = useState(false)
  const [passwordRecoveryError, setPasswordRecoveryError] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const authStateReceived = useRef(false)

  useEffect(() => {
    if (!supabase) {
      setLoading(false)
      return
    }

    let active = true
    const recoveryUrl = new URL(window.location.href)
    const isRecoveryCallback = recoveryUrl.searchParams.get('flow') === 'recovery'
    const recoveryErrorCode = recoveryUrl.searchParams.get('error_code')
    const hasRecoveryError = Boolean(recoveryErrorCode && (isRecoveryCallback || recoveryErrorCode === 'otp_expired'))
    const clearRecoveryMarker = () => {
      const callbackUrl = new URL(window.location.href)
      if (callbackUrl.searchParams.has('flow')) {
        callbackUrl.searchParams.delete('flow')
        window.history.replaceState(window.history.state, '', `${callbackUrl.pathname}${callbackUrl.search}${callbackUrl.hash}`)
      }
    }
    if (
      recoveryErrorCode
      && (isRecoveryCallback || recoveryErrorCode === 'otp_expired')
    ) {
      setPasswordRecoveryError(INVALID_RECOVERY_LINK_MESSAGE)
      recoveryUrl.searchParams.delete('error')
      recoveryUrl.searchParams.delete('error_code')
      recoveryUrl.searchParams.delete('error_description')
      recoveryUrl.searchParams.delete('flow')
      window.history.replaceState(window.history.state, '', `${recoveryUrl.pathname}${recoveryUrl.search}${recoveryUrl.hash}`)
    }

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session: Session | null) => {
      if (active) {
        authStateReceived.current = true
        setUser(session?.user ?? null)
        if (event === 'PASSWORD_RECOVERY' || (event === 'INITIAL_SESSION' && isRecoveryCallback && !hasRecoveryError)) {
          if (session?.user) {
            setPasswordRecovery(true)
            setPasswordRecoveryError('')
            clearRecoveryMarker()
          } else {
            setPasswordRecoveryError(INVALID_RECOVERY_LINK_MESSAGE)
            clearRecoveryMarker()
          }
        }
        setLoading(false)
      }
    })

    supabase.auth.getSession().then(({ data, error: sessionError }) => {
      if (!active || authStateReceived.current) return
      if (sessionError) setError(sessionError.message)
      setUser(data.session?.user ?? null)
      setLoading(false)
    }).catch((cause: unknown) => {
      if (!active) return
      setError(cause instanceof Error ? cause.message : 'Could not check your sign-in status.')
      setLoading(false)
    })

    return () => {
      active = false
      subscription.unsubscribe()
    }
  }, [])

  return {
    user,
    loading,
    error,
    passwordRecovery,
    passwordRecoveryError,
    clearPasswordRecovery: () => setPasswordRecovery(false),
    clearPasswordRecoveryError: () => setPasswordRecoveryError(''),
    clearError: () => setError(''),
    setError,
  }
}
