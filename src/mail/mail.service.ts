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
    const user =
      this.configService.get<string>('MAIL_USER') ||
      this.configService.get<string>('SMTP_USER') ||
      this.configService.get<string>('SMTP_USERNAME') ||
      this.configService.get<string>('EMAIL_USER');

    const rawPassword =
      this.configService.get<string>('MAIL_PASSWORD') ||
      this.configService.get<string>('SMTP_PASSWORD') ||
      this.configService.get<string>('SMTP_PASS') ||
      this.configService.get<string>('EMAIL_PASSWORD');

    const host =
      this.configService.get<string>('MAIL_HOST') ||
      this.configService.get<string>('SMTP_HOST') ||
      this.configService.get<string>('EMAIL_HOST');

    const rawPort =
      this.configService.get<number | string>('MAIL_PORT') ||
      this.configService.get<number | string>('SMTP_PORT');
    const port = Number(rawPort) || 587;

    const configuredFrom =
      this.configService.get<string>('MAIL_FROM') ||
      this.configService.get<string>('SMTP_FROM') ||
      this.configService.get<string>('EMAIL_FROM');

    if (configuredFrom) {
      this.from = configuredFrom;
    } else if (user) {
      const cleanUser = user.trim();
      this.from = cleanUser.includes('<') ? cleanUser : `Gileo Medicals <${cleanUser}>`;
    }

    if (user && rawPassword) {
      const password = rawPassword.replace(/\s+/g, '');
      const cleanHost = (host || '').toLowerCase();

      if (cleanHost.includes('gmail') || user.toLowerCase().endsWith('@gmail.com')) {
        this.logger.log(`Configuring MailService with Gmail service integration for ${user.trim()}.`);
        this.transporter = nodemailer.createTransport({
          service: 'gmail',
          auth: {
            user: user.trim(),
            pass: password,
          },
          tls: {
            rejectUnauthorized: false,
          },
          connectionTimeout: 15000,
          greetingTimeout: 15000,
          socketTimeout: 15000,
        });
      } else {
        const secure =
          this.configService.get<string>('MAIL_SECURE') === 'true' ||
          this.configService.get<string>('SMTP_SECURE') === 'true' ||
          port === 465;

        this.logger.log(`Configuring MailService with SMTP host: ${host || 'smtp.gmail.com'}:${port} (secure=${secure}).`);
        this.transporter = nodemailer.createTransport({
          host: host || 'smtp.gmail.com',
          port,
          secure,
          auth: {
            user: user.trim(),
            pass: password,
          },
          tls: {
            rejectUnauthorized: false,
          },
          connectionTimeout: 15000,
          greetingTimeout: 15000,
          socketTimeout: 15000,
        });
      }
      this.isConfigured = true;
    } else {
      this.logger.warn(
        'Mail configuration (MAIL_USER/SMTP_USER or MAIL_PASSWORD/SMTP_PASSWORD) is incomplete. MailService will run in log-only mode.',
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

    if (this.transporter && this.isConfigured) {
      try {
        const info = await this.transporter.sendMail({
          from: this.from,
          to: options.to,
          subject: options.subject,
          text: options.text,
          ...(options.html ? { html: options.html } : {}),
        });
        this.logger.log(`Email successfully delivered to ${options.to} (MessageId: ${info.messageId})`);
      } catch (err) {
        this.logger.error(
          `Failed to dispatch SMTP email to ${options.to}: ${(err as Error)?.message}`,
        );
      }
    } else {
      this.logger.log(`[Log Mode] Verification email logged for ${options.to} | Text: ${options.text}`);
    }
  }
}
