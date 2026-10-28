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
    const user = this.configService.get<string>('MAIL_USER');
    const rawPassword = this.configService.get<string>('MAIL_PASSWORD');
    const configuredFrom = this.configService.get<string>('MAIL_FROM');

    if (configuredFrom) {
      this.from = configuredFrom;
    }

    if (user && rawPassword) {
      const password = rawPassword.replace(/\s+/g, '');
      const cleanHost = (host || '').toLowerCase();

      if (cleanHost.includes('gmail') || user.toLowerCase().endsWith('@gmail.com')) {
        this.logger.log('Configuring MailService with Nodemailer Gmail service integration.');
        this.transporter = nodemailer.createTransport({
          service: 'gmail',
          auth: {
            user: user.trim(),
            pass: password,
          },
          tls: {
            rejectUnauthorized: false,
          },
          connectionTimeout: 10000,
          greetingTimeout: 10000,
          socketTimeout: 10000,
        });
      } else {
        const secure = this.configService.get<string>('MAIL_SECURE') === 'true';
        this.transporter = nodemailer.createTransport({
          host,
          port,
          secure,
          auth: {
            user: user.trim(),
            pass: password,
          },
          tls: {
            rejectUnauthorized: false,
          },
          connectionTimeout: 10000,
          greetingTimeout: 10000,
          socketTimeout: 10000,
        });
      }
      this.isConfigured = true;
    } else {
      this.logger.warn(
        'Mail configuration (MAIL_USER / MAIL_PASSWORD) is incomplete. MailService will run in log-only mode.',
      );
    }
  }

  async onModuleInit(): Promise<void> {
    if (this.transporter && this.isConfigured) {
      try {
        await this.transporter.verify();
        this.logger.log('Email SMTP connection verified successfully.');
      } catch (error) {
        this.logger.warn(
          `SMTP startup verification notice (${(error as Error)?.message || 'connection timeout'}). MailService will attempt on-demand delivery and print verification links in logs.`,
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
      }
    } else {
      this.logger.log(`[Log Mode] Verification email logged for ${options.to}`);
    }
  }
}
