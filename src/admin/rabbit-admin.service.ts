import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import amqp, { type ChannelModel, type Channel } from 'amqplib';
import type { CrearColaDto } from './dto/crear-cola.dto.js';
import type { CrearExchangeDto } from './dto/crear-exchange.dto.js';
import type { BindingDto } from './dto/binding.dto.js';

@Injectable()
export class RabbitAdminService implements OnModuleDestroy {
  private readonly log = new Logger(RabbitAdminService.name);
  private readonly url: string;
  private readonly urlAdmin: string;
  private readonly autorizacion: string;
  private conexion: ChannelModel | null = null;

  constructor(config: ConfigService) {
    this.url = config.getOrThrow<string>('RABBIT_URL');
    this.urlAdmin = config.getOrThrow<string>('RABBIT_ADMIN_URL');
    const usuario = config.getOrThrow<string>('RABBIT_USUARIO');
    const clave = config.getOrThrow<string>('RABBIT_CLAVE');
    this.autorizacion = 'Basic ' + Buffer.from(`${usuario}:${clave}`).toString('base64');
  }

  async onModuleDestroy(): Promise<void> {
    await this.conexion?.close();
    this.conexion = null;
  }

  // --- Colas -----------------------------------------------------------------

  async crearCola(dto: CrearColaDto): Promise<{ cola: string; mensajes: number; consumidores: number }> {
    // x-queue-type manda si la cola es clasica (vive en un nodo) o quorum (se replica
    // por Raft en todo el cluster). No se puede cambiar despues: para convertir una cola
    // clasica en quorum hay que borrarla y volverla a declarar.
    const argumentos: Record<string, unknown> = {
      'x-queue-type': dto.tipo === 'clasica' ? 'classic' : 'quorum',
    };
    if (dto.dlx) {
      argumentos['x-dead-letter-exchange'] = dto.dlx;
      argumentos['x-dead-letter-routing-key'] = dto.dlxRoutingKey ?? dto.nombre;
    }
    if (dto.maxLargo) {
      argumentos['x-max-length'] = dto.maxLargo;
      argumentos['x-overflow'] = 'reject-publish';
    }

    return this.enUnCanal(async (canal) => {
      const r = await canal.assertQueue(dto.nombre, {
        durable: dto.durable ?? true,
        arguments: argumentos,
      });
      this.log.log(`cola declarada: ${r.queue}`);
      return { cola: r.queue, mensajes: r.messageCount, consumidores: r.consumerCount };
    });
  }

  async borrarCola(nombre: string): Promise<{ cola: string; mensajesBorrados: number }> {
    return this.enUnCanal(async (canal) => {
      // ifUnused y ifEmpty en false: el administrador borra aunque quede algo adentro.
      // Es una decision, no un descuido, y por eso la respuesta devuelve cuantos se llevo por delante.
      const r = await canal.deleteQueue(nombre, { ifUnused: false, ifEmpty: false });
      this.log.warn(`cola borrada: ${nombre}, se perdieron ${r.messageCount} mensajes`);
      return { cola: nombre, mensajesBorrados: r.messageCount };
    });
  }

  async listarColas(): Promise<unknown[]> {
    const columnas = 'name,type,state,messages_ready,messages_unacknowledged,consumers,node';
    return this.pedirALaApi(`/api/queues/%2F?columns=${columnas}`);
  }

  // --- Exchanges -------------------------------------------------------------

  async crearExchange(dto: CrearExchangeDto): Promise<{ exchange: string; tipo: string }> {
    return this.enUnCanal(async (canal) => {
      const r = await canal.assertExchange(dto.nombre, dto.tipo, { durable: dto.durable ?? true });
      this.log.log(`exchange declarado: ${r.exchange} (${dto.tipo})`);
      return { exchange: r.exchange, tipo: dto.tipo };
    });
  }

  async borrarExchange(nombre: string): Promise<{ exchange: string }> {
    return this.enUnCanal(async (canal) => {
      await canal.deleteExchange(nombre, { ifUnused: false });
      this.log.warn(`exchange borrado: ${nombre}`);
      return { exchange: nombre };
    });
  }

  async listarExchanges(): Promise<unknown[]> {
    return this.pedirALaApi('/api/exchanges/%2F?columns=name,type,durable');
  }

  // --- Bindings --------------------------------------------------------------

  async crearBinding(dto: BindingDto): Promise<BindingDto> {
    return this.enUnCanal(async (canal) => {
      await canal.bindQueue(dto.cola, dto.exchange, dto.routingKey);
      this.log.log(`binding: ${dto.exchange} --${dto.routingKey || '(vacia)'}--> ${dto.cola}`);
      return dto;
    });
  }

  async borrarBinding(dto: BindingDto): Promise<BindingDto> {
    return this.enUnCanal(async (canal) => {
      await canal.unbindQueue(dto.cola, dto.exchange, dto.routingKey);
      this.log.warn(`binding eliminado: ${dto.exchange} -/-> ${dto.cola}`);
      return dto;
    });
  }

  // --- La plomeria, en un solo sitio ----------------------------------------

  /**
   * Abre un canal, corre la operacion y cierra el canal, siempre.
   *
   * Un canal de AMQP muere cuando el broker rechaza una operacion: si pides un binding contra
   * una cola que no existe, RabbitMQ contesta NOT_FOUND y cierra el canal entero. Reutilizar un
   * canal entre peticiones significa que el primer 404 deja inservible al servicio para todos
   * los demas. La conexion TCP si se reutiliza, que es lo caro; el canal es barato.
   */
  private async enUnCanal<T>(operacion: (canal: Channel) => Promise<T>): Promise<T> {
    const conexion = await this.conectar();
    let canal: Channel | null = null;
    try {
      canal = await conexion.createChannel();
      // Sin este manejador, el cierre del canal por error del broker sube como
      // "unhandled error event" y tumba el proceso de Node entero.
      canal.on('error', () => undefined);
      return await operacion(canal);
    } catch (e) {
      throw this.traducir(e);
    } finally {
      try {
        await canal?.close();
      } catch {
        // El canal ya venia cerrado por el error del broker. No hay nada que cerrar.
      }
    }
  }

  private async conectar(): Promise<ChannelModel> {
    if (this.conexion) return this.conexion;
    try {
      this.conexion = await amqp.connect(this.url);
      this.conexion.on('error', (e) => this.log.error(`conexion caida: ${e.message}`));
      this.conexion.on('close', () => {
        this.conexion = null;
      });
      return this.conexion;
    } catch (e) {
      // Un ECONNREFUSED llega como AggregateError con message vacio: si no se mira
      // tambien el code, el alumno recibe un 503 que no dice nada.
      let causa = e instanceof Error ? e.message : String(e);
      if (!causa && e && typeof e === 'object' && 'code' in e) {
        causa = String(e.code);
      }
      throw new ServiceUnavailableException(`no hay conexion con RabbitMQ: ${causa}`);
    }
  }

  /** Traduce el error de AMQP al codigo HTTP que le corresponde. */
  private traducir(e: unknown): Error {
    const mensaje = e instanceof Error ? e.message : String(e);
    if (mensaje.includes('NOT_FOUND')) {
      return new NotFoundException(mensaje);
    }
    // PRECONDITION_FAILED es redeclarar algo que ya existe con otros parametros.
    if (mensaje.includes('PRECONDITION_FAILED') || mensaje.includes('inequivalent')) {
      return new ConflictException(mensaje);
    }
    return new ServiceUnavailableException(mensaje);
  }

  private async pedirALaApi(ruta: string): Promise<unknown[]> {
    let respuesta: Response;
    try {
      respuesta = await fetch(`${this.urlAdmin}${ruta}`, {
        headers: { authorization: this.autorizacion },
        signal: AbortSignal.timeout(5000),
      });
    } catch (e) {
      const causa = e instanceof Error ? e.message : String(e);
      throw new ServiceUnavailableException(`la API de management no responde: ${causa}`);
    }
    if (!respuesta.ok) {
      throw new ServiceUnavailableException(`la API de management respondio ${respuesta.status}`);
    }
    return (await respuesta.json()) as unknown[];
  }
}