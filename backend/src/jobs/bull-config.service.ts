import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { SharedBullConfigurationFactory } from '@nestjs/bullmq';
import type { QueueOptions } from 'bullmq';

@Injectable()
export class BullConfigService implements SharedBullConfigurationFactory {
  constructor(private readonly configService: ConfigService) {}

  createSharedConfiguration(): QueueOptions {
    const redisUrl =
      this.configService.get<string>('redis.url') ?? 'redis://localhost:6379';
    const url = new URL(redisUrl);

    return {
      connection: {
        host: url.hostname,
        port: parseInt(url.port || '6379', 10),
        password: url.password || undefined,
        connectTimeout:
          this.configService.get<number>('redis.connectTimeoutMs') ?? 10000,
        maxRetriesPerRequest: null,
      },
      prefix: this.configService.get<string>('redis.queuePrefix') ?? 'sermuno',
      defaultJobOptions: {
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 1000,
        },
        removeOnComplete: { count: 1000 },
        removeOnFail: { count: 5000 },
      },
    };
  }
}
