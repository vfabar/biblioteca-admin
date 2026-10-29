import { SetMetadata } from '@nestjs/common';

export const ROLES = 'roles';
export const Roles = (...grupos: string[]) => SetMetadata(ROLES, grupos);
