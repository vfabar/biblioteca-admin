import { IsString, Matches, MaxLength } from 'class-validator';

const NOMBRE_VALIDO = /^[a-zA-Z0-9._-]+$/;

// La routing key si admite el comodin # y el *, asi que su regla es distinta
// de la del nombre de una cola. Por eso son dos expresiones y no una sola.
const ROUTING_KEY_VALIDA = /^[a-zA-Z0-9._*#-]*$/;

export class BindingDto {
  @IsString({ message: 'cola tiene que ser texto' })
  @MaxLength(255)
  @Matches(NOMBRE_VALIDO, { message: 'cola no es un nombre valido' })
  cola!: string;

  @IsString({ message: 'exchange tiene que ser texto' })
  @MaxLength(255)
  @Matches(NOMBRE_VALIDO, { message: 'exchange no es un nombre valido' })
  exchange!: string;

  // Va vacia a proposito cuando el exchange es fanout: ahi la routing key no se mira.
  @IsString({ message: 'routingKey tiene que ser texto, aunque sea vacio' })
  @MaxLength(255)
  @Matches(ROUTING_KEY_VALIDA, {
    message: 'routingKey solo admite letras, numeros, punto, guion, * y #',
  })
  routingKey!: string;
}