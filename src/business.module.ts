import { Module } from '@nestjs/common';
import { BusinessController } from './business.controller';
import { BusinessService } from './business.service';
import { PrismaModule } from './prisma/prisma.module';

@Module({ imports: [PrismaModule], controllers: [BusinessController], providers: [BusinessService] })
export class BusinessModule {}
