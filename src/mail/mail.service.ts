import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';

@Injectable()
export class MailService implements OnModuleInit {
  private readonly logger = new Logger(MailService.name);
  private transporter: Transporter | null = null;
  private from = 'Gileo Medicals <noreply@gileo.com>';
  private isConfigured = false;

  constructor(private readonly configService: ConfigService) {
    const host = this.configService.get<string>('MAIL_HOST');
    const port = Number(this.configService.get<number | string>('MAIL_PORT')) || 587;
    const secure = this.configService.get<string>('MAIL_SECURE') === 'true';
    const user = this.configService.get<string>('MAIL_USER');
    const password = this.configService.get<string>('MAIL_PASSWORD');
    const configuredFrom = this.configService.get<string>('MAIL_FROM');

    if (configuredFrom) {
      this.from = configuredFrom;
    }

    if (host && user && password) {
      this.transporter = nodemailer.createTransport({
        host,
        port,
        secure,
        auth: {
          user,
          pass: password,
        },
        connectionTimeout: 5000,
        greetingTimeout: 5000,
        socketTimeout: 5000,
      });
      this.isConfigured = true;
    } else {
      this.logger.warn(
        'Mail configuration (MAIL_HOST/MAIL_USER/MAIL_PASSWORD) is incomplete. MailService will run in log-only mode.',
      );
    }
  }

  async onModuleInit(): Promise<void> {
    if (this.transporter && this.isConfigured) {
      try {
        await this.transporter.verify();
        this.logger.log('Email SMTP connection verified successfully.');
      } catch (error) {
        this.isConfigured = false;
        this.logger.warn(
          `Email SMTP verification failed (${(error as Error)?.message || 'unreachable'}). MailService falling back to log-only mode. Verification emails will be printed in server logs.`,
        );
      }
    }
  }

  async sendMail(options: {
    to: string;
    subject: string;
    text: string;
    html?: string;
  }): Promise<void> {
    this.logger.log(`[Mail Dispatch] To: ${options.to} | Subject: "${options.subject}"`);
    this.logger.log(`[Mail Content]: ${options.text}`);

    if (this.transporter && this.isConfigured) {
      try {
        await this.transporter.sendMail({
          from: this.from,
          to: options.to,
          subject: options.subject,
          text: options.text,
          ...(options.html ? { html: options.html } : {}),
        });
        this.logger.log(`Email successfully delivered to ${options.to}`);
      } catch (err) {
        this.logger.error(
          `Failed to dispatch SMTP email to ${options.to}: ${(err as Error)?.message}`,
        );
        // Do not throw error so user registration/action flow is not blocked!
      }
    } else {
      this.logger.log(`[Log Mode] Verification email dispatched locally for ${options.to}`);
    }
  }
}
