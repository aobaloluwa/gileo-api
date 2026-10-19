
import {
  Injectable,
  UnauthorizedException,
  InternalServerErrorException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OAuth2Client, TokenPayload } from 'google-auth-library';

@Injectable()
export class GoogleAuthService {
  private readonly client: OAuth2Client | null;

  constructor(private readonly configService: ConfigService) {
    const clientId = this.configService.get<string>('GOOGLE_CLIENT_ID');

    // Keep the API bootable when optional Google sign-in is not configured.
    // Email/password authentication remains available in that case.
    this.client = clientId ? new OAuth2Client(clientId) : null;
  }

  async verifyIdToken(idToken: string): Promise<TokenPayload> {
    if (!this.client) {
      throw new InternalServerErrorException(
        'Google sign-in is not configured on the server.',
      );
    }
    try {
      const ticket = await this.client.verifyIdToken({
        idToken,
        audience: this.configService.get<string>('GOOGLE_CLIENT_ID'),
      });

      const payload = ticket.getPayload();

      if (!payload?.sub || !payload.email) {
        throw new UnauthorizedException(
          'Google account information is incomplete.',
        );
      }

      if (payload.email_verified !== true) {
        throw new UnauthorizedException(
          'Your Google email address must be verified.',
        );
      }

      return payload;
    } catch (error: unknown) {
      if (error instanceof UnauthorizedException) {
        throw error;
      }

      throw new UnauthorizedException(
        'Invalid or expired Google ID token.',
      );
    }
  }
}
