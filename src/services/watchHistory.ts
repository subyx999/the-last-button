import type { Movie, MovieViewing } from '../types'

export function getMovieViewings(movie: Movie): MovieViewing[] {
  if (movie.viewings?.length) return movie.viewings
  return [{
    id: `legacy-${movie.id}`,
    watched_at: movie.watched_at,
    user_rating: movie.user_rating,
    user_review: movie.user_review,
    user_liked: movie.user_liked,
    is_rewatch: false,
  }]
}

export function withMovieViewings(movie: Movie): Movie {
  return movie.viewings?.length ? movie : { ...movie, viewings: getMovieViewings(movie) }
}

export function mergeMovieViewings(accountMovie: Movie, guestMovie: Movie): Movie {
  const viewings = new Map(getMovieViewings(accountMovie).map((viewing) => [viewing.id, viewing]))
  for (const viewing of getMovieViewings(guestMovie)) {
    if (!viewings.has(viewing.id) || viewing.id.startsWith('legacy-')) viewings.set(viewing.id, viewing)
  }
  const mergedViewings = [...viewings.values()].sort((left, right) => {
    const leftDate = left.watched_at ? Date.parse(left.watched_at) : NaN
    const rightDate = right.watched_at ? Date.parse(right.watched_at) : NaN
    if (Number.isFinite(leftDate) && Number.isFinite(rightDate)) return leftDate - rightDate
    if (Number.isFinite(leftDate)) return 1
    if (Number.isFinite(rightDate)) return -1
    return 0
  })
  const accountDate = accountMovie.watched_at ? Date.parse(accountMovie.watched_at) : NaN
  const guestDate = guestMovie.watched_at ? Date.parse(guestMovie.watched_at) : NaN
  const latest = Number.isFinite(guestDate) && (!Number.isFinite(accountDate) || guestDate > accountDate)
    ? guestMovie
    : accountMovie

  return {
    ...guestMovie,
    ...accountMovie,
    watched_at: latest.watched_at,
    user_rating: latest.user_rating,
    user_review: latest.user_review,
    user_liked: latest.user_liked,
    viewings: mergedViewings,
  }
}
