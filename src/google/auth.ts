import { google } from 'googleapis';
import { logger } from '../utils/logger';

/**
 * Build an authenticated OAuth2 client for Google Calendar API.
 * Uses the refresh token flow – the access token is obtained/refreshed automatically.
 */
export function getGoogleOAuth2Client(refreshToken?: string) {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const token = refreshToken ?? process.env.GOOGLE_REFRESH_TOKEN;

  if (!clientId || !clientSecret || !token) {
    throw new Error('Missing Google OAuth2 credentials in environment variables');
  }

  const oauth2Client = new google.auth.OAuth2(clientId, clientSecret);
  oauth2Client.setCredentials({ refresh_token: token });

  oauth2Client.on('tokens', (tokens) => {
    if (tokens.access_token) {
      logger.info('google_token_refreshed', {
        details: { expiryDate: tokens.expiry_date },
      });
    }
  });

  return oauth2Client;
}
