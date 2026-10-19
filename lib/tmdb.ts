// ==============================================================================
// MovieSeat TMDB Service - Server-Side Only
// Resilient fetching with automatic fallback poster protection
// ==============================================================================

export interface TmdbMovieMetadata {
  tmdbId: number;
  posterUrl: string;
  backdropUrl?: string | null;
  runtime?: number;
  overview?: string;
  voteAverage?: number;
}

export const FALLBACK_POSTER_URL = '/fallback-poster.svg';
const TMDB_IMAGE_BASE = 'https://image.tmdb.org/t/p/w500';

/**
 * Fetches movie metadata from TMDB API on the server.
 * Never throws — returns fallback metadata if TMDB fails or is unavailable.
 */
export async function getTmdbMovieDetails(
  tmdbId: number | null,
  fallbackData?: {
    posterPath?: string | null;
    title?: string;
    runtime?: number;
    overview?: string | null;
  }
): Promise<TmdbMovieMetadata> {
  const defaultPoster = fallbackData?.posterPath
    ? `${TMDB_IMAGE_BASE}${fallbackData.posterPath}`
    : FALLBACK_POSTER_URL;

  if (!tmdbId) {
    return {
      tmdbId: 0,
      posterUrl: defaultPoster,
      runtime: fallbackData?.runtime,
      overview: fallbackData?.overview || '',
    };
  }

  const apiKey = process.env.TMDB_API_KEY;
  if (!apiKey) {
    console.warn('[TMDB] Warning: TMDB_API_KEY not configured in environment. Using fallback poster.');
    return {
      tmdbId,
      posterUrl: defaultPoster,
      runtime: fallbackData?.runtime,
      overview: fallbackData?.overview || '',
    };
  }

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 4000); // 4 second safety timeout

    const res = await fetch(`https://api.themoviedb.org/3/movie/${tmdbId}?api_key=${apiKey}`, {
      signal: controller.signal,
      next: { revalidate: 3600 }, // Cache on server for 1 hour
    });
    clearTimeout(timeoutId);

    if (!res.ok) {
      console.warn(`[TMDB] Non-200 response (${res.status}) for movie ${tmdbId}. Using fallback.`);
      return {
        tmdbId,
        posterUrl: defaultPoster,
        runtime: fallbackData?.runtime,
        overview: fallbackData?.overview || '',
      };
    }

    const data = await res.json();
    const posterUrl = data.poster_path ? `${TMDB_IMAGE_BASE}${data.poster_path}` : defaultPoster;
    const backdropUrl = data.backdrop_path ? `https://image.tmdb.org/t/p/w1280${data.backdrop_path}` : null;

    return {
      tmdbId,
      posterUrl,
      backdropUrl,
      runtime: data.runtime || fallbackData?.runtime,
      overview: data.overview || fallbackData?.overview || '',
      voteAverage: data.vote_average,
    };
  } catch (err: unknown) {
    console.warn(`[TMDB] Fetch failed for movie ${tmdbId}:`, (err as Error)?.message || err);
    return {
      tmdbId,
      posterUrl: defaultPoster,
      runtime: fallbackData?.runtime,
      overview: fallbackData?.overview || '',
    };
  }
}
