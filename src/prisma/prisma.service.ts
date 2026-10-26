import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import { Pool } from 'pg';

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
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

  async onModuleInit() {
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
