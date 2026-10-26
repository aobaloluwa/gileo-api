import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { PrismaService } from '../prisma/prisma.service';

@ApiTags('Health')
@Controller('health')
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  @ApiOperation({ summary: 'Check API and database health' })
  async checkHealth() {
    let dbStatus = 'connected';
    let dbError: string | null = null;

    try {
      await this.prisma.$queryRaw`SELECT 1`;
    } catch (err: any) {
      dbStatus = 'disconnected';
      dbError = err?.message || 'Database query failed';
    }

    return {
      status: dbStatus === 'connected' ? 'ok' : 'degraded',
      service: 'Gileo API',
      database: dbStatus,
      timestamp: new Date().toISOString(),
      ...(dbError ? { error: dbError } : {}),
    };
  }
}
