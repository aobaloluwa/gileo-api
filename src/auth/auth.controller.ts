import {
  Body,
  Controller,
  Get,
  HttpException,
  HttpStatus,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { Request } from 'express';
import { AuthService } from './auth.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { VerifyEmailDto } from './dto/verify-email.dto';
import { ResendVerificationDto } from './dto/resend-verification.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { GoogleSignInDto } from './dto/google-sign-in.dto';
import { JwtAuthGuard } from './guards/jwt-auth/jwt-auth.guard';

interface AuthenticatedRequest extends Request {
  user: { userId: string };
}

@ApiTags('Authentication')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('register')
  @ApiOperation({ summary: 'Register a new Gileo account' })
  async register(@Body() dto: RegisterDto) {
    try {
      return await this.authService.register(dto);
    } catch (err: any) {
      if (err instanceof HttpException) throw err;
      console.error('Registration error:', err);
      throw new HttpException(
        err?.message || 'Registration failed.',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Post('verify-email')
  @ApiOperation({ summary: 'Verify an email using a six-digit code' })
  async verifyEmail(@Body() dto: VerifyEmailDto) {
    try {
      return await this.authService.verifyEmail(dto);
    } catch (err: any) {
      if (err instanceof HttpException) throw err;
      throw new HttpException(
        err?.message || 'Verification failed.',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Post('resend-verification')
  @ApiOperation({ summary: 'Resend the email verification code' })
  async resendVerification(@Body() dto: ResendVerificationDto) {
    try {
      return await this.authService.resendVerificationCode(dto.email);
    } catch (err: any) {
      if (err instanceof HttpException) throw err;
      throw new HttpException(
        err?.message || 'Resend verification failed.',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Post('forgot-password')
  @ApiOperation({ summary: 'Request a password reset code by email' })
  async forgotPassword(@Body() dto: ForgotPasswordDto) {
    try {
      return await this.authService.forgotPassword(dto.email);
    } catch (err: any) {
      if (err instanceof HttpException) throw err;
      throw new HttpException(
        err?.message || 'Forgot password failed.',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Post('reset-password')
  @ApiOperation({ summary: 'Reset a password using the email code' })
  async resetPassword(@Body() dto: ResetPasswordDto) {
    try {
      return await this.authService.resetPassword(dto);
    } catch (err: any) {
      if (err instanceof HttpException) throw err;
      throw new HttpException(
        err?.message || 'Reset password failed.',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Post('login')
  @ApiOperation({ summary: 'Log in with email and password' })
  async login(@Body() dto: LoginDto) {
    try {
      return await this.authService.login(dto.email, dto.password);
    } catch (err: any) {
      if (err instanceof HttpException) throw err;
      console.error('Login error:', err);
      throw new HttpException(
        err?.message || 'Login failed.',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Post('google')
  @ApiOperation({ summary: 'Sign in or register using Google' })
  async googleSignIn(@Body() dto: GoogleSignInDto) {
    try {
      return await this.authService.googleSignIn(dto);
    } catch (err: any) {
      if (err instanceof HttpException) throw err;
      throw new HttpException(
        err?.message || 'Google Sign-In failed.',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Post('refresh')
  @ApiOperation({ summary: 'Refresh access token and rotate refresh token' })
  async refresh(@Body() dto: RefreshTokenDto) {
    try {
      return await this.authService.refresh(dto.refreshToken);
    } catch (err: any) {
      if (err instanceof HttpException) throw err;
      throw new HttpException(
        err?.message || 'Token refresh failed.',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Post('logout')
  @ApiOperation({ summary: 'Revoke a refresh session' })
  async logout(@Body() dto: RefreshTokenDto) {
    try {
      return await this.authService.logout(dto.refreshToken);
    } catch (err: any) {
      if (err instanceof HttpException) throw err;
      throw new HttpException(
        err?.message || 'Logout failed.',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get the authenticated user identity' })
  getMe(@Req() request: AuthenticatedRequest) {
    return { userId: request.user.userId };
  }
}
