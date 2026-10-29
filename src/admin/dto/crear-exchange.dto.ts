import { IsBoolean, IsIn, IsOptional, IsString, Matches, MaxLength } from 'class-validator';

const NOMBRE_VALIDO = /^[a-zA-Z0-9._-]+$/;

export const TIPOS_DE_EXCHANGE = ['direct', 'topic', 'fanout', 'headers'] as const;
export type TipoDeExchange = (typeof TIPOS_DE_EXCHANGE)[number];

export class CrearExchangeDto {
  @IsString({ message: 'nombre tiene que ser texto' })
  @MaxLength(255)
  @Matches(NOMBRE_VALIDO, {
    message: 'nombre solo admite letras, numeros, punto, guion y guion bajo',
  })
  nombre!: string;

  // Esta es la validacion que mas se agradece: RabbitMQ cierra el canal con un error
  // feo si el tipo no existe. Aca se corta antes, con un 400 que dice los cuatro validos.
  @IsIn(TIPOS_DE_EXCHANGE, {
    message: `tipo tiene que ser uno de: ${TIPOS_DE_EXCHANGE.join(', ')}`,
  })
  tipo!: TipoDeExchange;

  @IsOptional()
  @IsBoolean({ message: 'durable es true o false' })
  durable?: boolean;
}