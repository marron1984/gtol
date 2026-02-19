import axios from 'axios';
import { logger } from '../utils/logger';

const TOKEN_URL = 'https://auth.worksmobile.com/oauth2/v2.0/token';

interface TokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  refresh_token?: string;
}

let cachedToken: { accessToken: string; expiresAt: number } | null = null;

/**
 * Obtain (or refresh) an OAuth2 access token for LINE WORKS API.
 * Caches the token and refreshes it when it is about to expire.
 */
export async function getLineworksAccessToken(refreshToken?: string): Promise<string> {
  const now = Date.now();

  // Return cached token if still valid (with 60s margin)
  if (cachedToken && cachedToken.expiresAt > now + 60_000) {
    return cachedToken.accessToken;
  }

  const clientId = process.env.LW_CLIENT_ID;
  const clientSecret = process.env.LW_CLIENT_SECRET;
  const token = refreshToken ?? process.env.LW_REFRESH_TOKEN;

  if (!clientId || !clientSecret || !token) {
    throw new Error('Missing LINE WORKS OAuth2 credentials in environment variables');
  }

  const params = new URLSearchParams({
    grant_type: 'refresh_token',
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: token,
  });

  const res = await axios.post<TokenResponse>(TOKEN_URL, params.toString(), {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  });

  cachedToken = {
    accessToken: res.data.access_token,
    expiresAt: now + res.data.expires_in * 1000,
  };

  logger.info('lineworks_token_refreshed', {
    details: { expiresIn: res.data.expires_in },
  });

  return cachedToken.accessToken;
}

/** Clear the cached token (useful for testing or forced refresh). */
export function clearTokenCache(): void {
  cachedToken = null;
}
