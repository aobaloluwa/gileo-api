import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';

@Injectable()
export class MailService implements OnModuleInit {
  private readonly logger = new Logger(MailService.name);
  private transporter: Transporter | null = null;
  private from = 'Gileo Medicals <noreply@gileo.com>';
  private senderEmail = 'noreply@gileo.com';
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
      this.from = configuredFrom.trim().replace(/^["']+|["']+$|^\&quot\;|\&quot\;$/g, '');
    } else if (user) {
      const cleanUser = user.trim();
      this.from = cleanUser.includes('<') ? cleanUser : `Gileo Medicals <${cleanUser}>`;
    }

    const emailMatch = /<([^>]+)>/.exec(this.from);
    if (emailMatch) {
      this.senderEmail = emailMatch[1].trim();
    } else if (user) {
      this.senderEmail = user.trim();
    }

    if (user && rawPassword) {
      const password = rawPassword.replace(/\s+/g, '');
      const cleanHost = (host || '').toLowerCase();

      if (cleanHost.includes('gmail') || user.toLowerCase().endsWith('@gmail.com')) {
        this.logger.log(`Configuring MailService with Gmail STARTTLS transport (port 587) for ${user.trim()}.`);
        this.transporter = nodemailer.createTransport({
          host: 'smtp.gmail.com',
          port: 587,
          secure: false,
          requireTLS: true,
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
        'SMTP user or password not set. MailService will check HTTP email APIs (Resend/Brevo) or run in log mode.',
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
          `SMTP startup verification notice (${(error as Error)?.message || 'connection timeout'}). MailService will attempt on-demand delivery or HTTP email APIs.`,
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

    // 1. Check for Resend API Key (HTTP API - Port 443 HTTPS, bypasses all cloud SMTP port blocks)
    const resendKey =
      this.configService.get<string>('RESEND_API_KEY') ||
      this.configService.get<string>('RESEND_KEY');

    if (resendKey) {
      try {
        const res = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${resendKey.trim()}`,
          },
          body: JSON.stringify({
            from: this.from,
            to: [options.to],
            subject: options.subject,
            text: options.text,
            html: options.html || options.text,
          }),
        });
        const json = (await res.json().catch(() => null)) as any;
        if (res.ok) {
          this.logger.log(`Email successfully delivered to ${options.to} via Resend API (id: ${json?.id})`);
          return;
        } else {
          this.logger.warn(`Resend API response: ${JSON.stringify(json)}`);
        }
      } catch (err: any) {
        this.logger.warn(`Resend API dispatch notice: ${err?.message}`);
      }
    }

    // 2. Check for Brevo / Sendinblue API Key (HTTP API - Port 443 HTTPS)
    const brevoKey =
      this.configService.get<string>('BREVO_API_KEY') ||
      this.configService.get<string>('SENDINBLUE_API_KEY') ||
      this.configService.get<string>('BREVO_KEY');

    if (brevoKey) {
      try {
        const res = await fetch('https://api.brevo.com/v3/smtp/email', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'api-key': brevoKey.trim(),
          },
          body: JSON.stringify({
            sender: {
              name: 'Gileo Medicals',
              email: this.senderEmail,
            },
            to: [{ email: options.to }],
            subject: options.subject,
            textContent: options.text,
            htmlContent: options.html || options.text,
          }),
        });
        const json = (await res.json().catch(() => null)) as any;
        if (res.ok) {
          this.logger.log(`Email successfully delivered to ${options.to} via Brevo API (messageId: ${json?.messageId})`);
          return;
        } else {
          this.logger.warn(`Brevo API response: ${JSON.stringify(json)}`);
        }
      } catch (err: any) {
        this.logger.warn(`Brevo API dispatch notice: ${err?.message}`);
      }
    }

    // 3. Fallback to Nodemailer SMTP Transport
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
        return;
      } catch (err) {
        this.logger.error(
          `Failed to dispatch SMTP email to ${options.to}: ${(err as Error)?.message}`,
        );
      }
    }

    this.logger.log(`[Log Output] Verification email for ${options.to} | Details: ${options.text}`);
  }
}
