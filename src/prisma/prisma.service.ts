import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import { Pool } from 'pg';

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  private isSyncing = false;

  constructor() {
    let connectionString = process.env.DATABASE_URL || '';
    const isLocal =
      !connectionString ||
      connectionString.includes('localhost') ||
      connectionString.includes('127.0.0.1');

    if (!isLocal) {
      process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
      if (connectionString.includes('sslmode=require')) {
        connectionString = connectionString.replace('sslmode=require', 'sslmode=no-verify');
      } else if (!connectionString.includes('sslmode=')) {
        connectionString += connectionString.includes('?')
          ? '&sslmode=no-verify'
          : '?sslmode=no-verify';
      }
      process.env.DATABASE_URL = connectionString;
    }

    const pool = new Pool({
      connectionString,
      ssl: isLocal ? false : { rejectUnauthorized: false },
    });

    const adapter = new PrismaPg(pool);
    super({ adapter });
  }

  async ensureTablesExist(): Promise<void> {
    if (this.isSyncing) return;
    try {
      await this.$queryRaw`SELECT 1 FROM community_post_reposts LIMIT 1`;
      await this.$queryRaw`SELECT 1 FROM saved_posts LIMIT 1`;
    } catch {
      this.isSyncing = true;
      console.log('Database tables or relations missing in PostgreSQL. Running prisma db push...');
      try {
        const { execSync } = await import('node:child_process');
        execSync('npx prisma db push --accept-data-loss', { stdio: 'inherit' });
        console.log('Database schema synchronized successfully!');
      } catch (pushErr) {
        console.error('Failed to auto-push Prisma schema:', pushErr);
      } finally {
        this.isSyncing = false;
      }
    }
  }

  async onModuleInit() {
    await this.$connect();
    await this.ensureTablesExist();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
