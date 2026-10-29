import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ROLES } from './roles.decorator.js';
import type { Usuario } from './jwt.guard.js';

@Injectable()
export class RolGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(ctx: ExecutionContext): boolean {
      const requeridos =
      this.reflector.get<string[]>(ROLES, ctx.getHandler()) ??
      this.reflector.get<string[]>(ROLES, ctx.getClass()) ??
      [];
    if (requeridos.length === 0) return true;

    const req = ctx.switchToHttp().getRequest<{ usuario?: Usuario }>();
    const grupos = req.usuario?.grupos ?? [];

    if (!requeridos.some((g) => grupos.includes(g))) {
      throw new ForbiddenException(`necesitas estar en ${requeridos.join(' o ')}`);
    }
    return true;
  }
}
