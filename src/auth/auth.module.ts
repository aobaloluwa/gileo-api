import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { PassportModule } from '@nestjs/passport';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { GoogleAuthService } from './google-auth.service';
import { JwtStrategy } from './strategies/jwt.strategy/jwt.strategy';
import { MailModule } from '../mail/mail.module';

@Module({
  imports: [
    PassportModule,
    MailModule,
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        secret:
          configService.get<string>('JWT_ACCESS_SECRET') ||
          '43410e6a2c25783c29666ecf4c7a0b33c0e04ae95b5628730750686d635786e734633015f34d3a48211186f68cf08505',
        signOptions: {
          expiresIn: '15m',
        },
      }),
    }),
  ],
  providers: [AuthService, GoogleAuthService, JwtStrategy],
  exports: [AuthService, GoogleAuthService],
  controllers: [AuthController],
})
export class AuthModule {}
