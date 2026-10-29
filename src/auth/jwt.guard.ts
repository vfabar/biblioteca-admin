import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createRemoteJWKSet, jwtVerify } from 'jose';

export type Usuario = { sub: string; scope: string; grupos: string[] };

@Injectable()
export class JwtGuard implements CanActivate {
  private readonly issuer: string;
  private readonly clientId: string;
  private readonly jwks: ReturnType<typeof createRemoteJWKSet>;

  constructor(config: ConfigService) {
    this.issuer   = config.getOrThrow<string>('COGNITO_ISSUER');
    this.clientId = config.getOrThrow<string>('COGNITO_CLIENT_ID');
    // Se baja el JWKS una vez y lo cachea. Si aparece un kid nuevo, lo vuelve a pedir solo.
    this.jwks = createRemoteJWKSet(new URL(`${this.issuer}/.well-known/jwks.json`));
  }

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<{ headers: Record<string, string>; usuario?: Usuario }>();
    const cabecera = req.headers.authorization;

    if (!cabecera?.startsWith('Bearer ')) {
      throw new UnauthorizedException('sin token');                    // 401
    }

    // 1 · Firma, iss, exp y nbf: los revisa jwtVerify. Si algo falla, lanza.
    let payload;
    try {
      ({ payload } = await jwtVerify(cabecera.slice(7), this.jwks, { issuer: this.issuer }));
    } catch (e) {
      throw new UnauthorizedException((e as Error).message);            // 401
    }

    // 2 · Un id_token presentado como access token es un ataque, no un descuido.
    if (payload.token_use !== 'access') {
      throw new UnauthorizedException('no es un access token');         // 401
    }

    // 3 · ¿Salio de un app client que reconozco?
    if (payload.client_id !== this.clientId) {
      throw new UnauthorizedException('app client desconocido');        // 401
    }

    // 4 · Y deja al usuario en la peticion, para que el controller y el RolGuard lo usen.
    req.usuario = {
      sub: payload.sub as string,
      scope: (payload.scope as string) ?? '',
      grupos: (payload['cognito:groups'] as string[]) ?? [],
    };
    return true;
  }
}
