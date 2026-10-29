import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { JwtGuard } from '../auth/jwt.guard.js';
import { RolGuard } from '../auth/rol.guard.js';
import { Roles } from '../auth/roles.decorator.js';
import { RabbitAdminService } from './rabbit-admin.service.js';
import { CrearColaDto } from './dto/crear-cola.dto.js';
import { CrearExchangeDto } from './dto/crear-exchange.dto.js';
import { BindingDto } from './dto/binding.dto.js';

@Controller('v1/admin')
@UseGuards(JwtGuard, RolGuard)
@Roles('bibliotecarios')
export class AdminController {
  constructor(private readonly admin: RabbitAdminService) {}

  @Get('colas')
  async listarColas() {
    return this.admin.listarColas();
  }

  @Post('colas')
  async crearCola(@Body() dto: CrearColaDto) {
    return this.admin.crearCola(dto);
  }

  @Delete('colas/:nombre')
  async borrarCola(@Param('nombre') nombre: string) {
    return this.admin.borrarCola(nombre);
  }

  @Post('bindings')
  async crearBinding(@Body() dto: BindingDto) {
    return this.admin.crearBinding(dto);
  }

  // Un DELETE con cuerpo: un binding no tiene un identificador propio en la URL,
  // se identifica por los tres datos juntos. El 200 con @HttpCode es explicito
  // porque Nest responde 200 en DELETE por omision y conviene que se lea.
  @Delete('bindings')
  @HttpCode(200)
  async borrarBinding(@Body() dto: BindingDto) {
    return this.admin.borrarBinding(dto);
  }
}