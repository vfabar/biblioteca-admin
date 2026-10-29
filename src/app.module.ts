import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AdminController } from './admin/admin.controller.js';
import { RabbitAdminService } from './admin/rabbit-admin.service.js';
import { JwtGuard } from './auth/jwt.guard.js';
import { RolGuard } from './auth/rol.guard.js';

@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true })],
  controllers: [AdminController],
  providers: [RabbitAdminService, JwtGuard, RolGuard],
})
export class AppModule {}