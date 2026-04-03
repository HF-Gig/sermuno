export default () => ({
  port: parseInt(process.env.PORT ?? '3000', 10),
  database: {
    url: process.env.DATABASE_URL,
  },
  redis: {
    url: process.env.REDIS_URL ?? 'redis://localhost:6379',
    connectTimeoutMs: parseInt(
      process.env.REDIS_CONNECT_TIMEOUT_MS ?? '10000',
      10,
    ),
    maxReconnectAttempts: parseInt(
      process.env.REDIS_MAX_RECONNECT_ATTEMPTS ?? '10',
      10,
    ),
    retryDelayMs: parseInt(process.env.REDIS_RETRY_DELAY_MS ?? '250', 10),
  },
  jwt: {
    secret: process.env.JWT_SECRET ?? '',
    expiresIn: process.env.JWT_EXPIRES_IN ?? '7d',
    refreshSecret: process.env.JWT_REFRESH_SECRET ?? '',
    refreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN ?? '30d',
  },
  encryption: {
    key: process.env.ENCRYPTION_KEY ?? '',
  },
  bcrypt: {
    rounds: parseInt(process.env.BCRYPT_ROUNDS ?? '12', 10),
  },
  rateLimit: {
    ttl: parseInt(process.env.RATE_LIMIT_TTL ?? '60', 10),
    max: parseInt(process.env.RATE_LIMIT_MAX ?? '100', 10),
  },
  emailSync: {
    providers: {
      gmail: {
        batchSize: parseInt(
          process.env.EMAIL_SYNC_GMAIL_BATCH_SIZE ?? '5000',
          10,
        ),
        delayMs: parseInt(process.env.EMAIL_SYNC_GMAIL_DELAY_MS ?? '100', 10),
        rateLimit: {
          capacity: parseInt(
            process.env.EMAIL_SYNC_GMAIL_RATE_LIMIT_CAPACITY ?? '300',
            10,
          ),
          refillPerSecond: parseFloat(
            process.env.EMAIL_SYNC_GMAIL_REFILL_PER_SECOND ?? '3.33',
          ),
        },
      },
      outlook: {
        batchSize: parseInt(
          process.env.EMAIL_SYNC_OUTLOOK_BATCH_SIZE ?? '2000',
          10,
        ),
        delayMs: parseInt(process.env.EMAIL_SYNC_OUTLOOK_DELAY_MS ?? '500', 10),
        rateLimit: {
          capacity: parseInt(
            process.env.EMAIL_SYNC_OUTLOOK_RATE_LIMIT_CAPACITY ?? '150',
            10,
          ),
          refillPerSecond: parseFloat(
            process.env.EMAIL_SYNC_OUTLOOK_REFILL_PER_SECOND ?? '1.67',
          ),
        },
      },
      stratoIonos: {
        batchSize: parseInt(
          process.env.EMAIL_SYNC_STRATO_IONOS_BATCH_SIZE ?? '500',
          10,
        ),
        delayMs: parseInt(
          process.env.EMAIL_SYNC_STRATO_IONOS_DELAY_MS ?? '1000',
          10,
        ),
        rateLimit: {
          capacity: parseInt(
            process.env.EMAIL_SYNC_STRATO_IONOS_RATE_LIMIT_CAPACITY ?? '60',
            10,
          ),
          refillPerSecond: parseFloat(
            process.env.EMAIL_SYNC_STRATO_IONOS_REFILL_PER_SECOND ?? '0.5',
          ),
        },
      },
      yahoo: {
        batchSize: parseInt(
          process.env.EMAIL_SYNC_YAHOO_BATCH_SIZE ?? '1500',
          10,
        ),
        delayMs: parseInt(process.env.EMAIL_SYNC_YAHOO_DELAY_MS ?? '400', 10),
        rateLimit: {
          capacity: process.env.EMAIL_SYNC_YAHOO_RATE_LIMIT_CAPACITY
            ? parseInt(process.env.EMAIL_SYNC_YAHOO_RATE_LIMIT_CAPACITY, 10)
            : undefined,
          refillPerSecond: process.env.EMAIL_SYNC_YAHOO_REFILL_PER_SECOND
            ? parseFloat(process.env.EMAIL_SYNC_YAHOO_REFILL_PER_SECOND)
            : undefined,
        },
      },
      default: {
        batchSize: parseInt(
          process.env.EMAIL_SYNC_DEFAULT_BATCH_SIZE ?? '1000',
          10,
        ),
        delayMs: parseInt(process.env.EMAIL_SYNC_DEFAULT_DELAY_MS ?? '250', 10),
        rateLimit: {
          capacity: parseInt(
            process.env.EMAIL_SYNC_DEFAULT_RATE_LIMIT_CAPACITY ?? '100',
            10,
          ),
          refillPerSecond: parseFloat(
            process.env.EMAIL_SYNC_DEFAULT_REFILL_PER_SECOND ?? '1',
          ),
        },
      },
    },
  },
  smtp: {
    host: process.env.SMTP_HOST ?? '',
    port: parseInt(process.env.SMTP_PORT ?? '587', 10),
    user: process.env.SMTP_USER ?? '',
    pass: process.env.SMTP_PASS ?? '',
    from: process.env.SMTP_FROM ?? '',
  },
  frontend: {
    url: process.env.FRONTEND_URL ?? 'http://localhost:5173',
  },
  webPush: {
    publicKey: process.env.WEB_PUSH_PUBLIC_KEY ?? '',
    privateKey: process.env.WEB_PUSH_PRIVATE_KEY ?? '',
    subject: process.env.WEB_PUSH_SUBJECT ?? '',
  },
  cors: {
    origins: process.env.CORS_ORIGINS ?? 'http://localhost:5173',
  },
  logging: {
    level: process.env.LOG_LEVEL ?? 'log',
    format: process.env.LOG_FORMAT ?? 'pretty',
  },
  stripe: {
    secretKey: process.env.STRIPE_SECRET_KEY ?? '',
    webhookSecret: process.env.STRIPE_WEBHOOK_SECRET ?? '',
    proPriceId: process.env.STRIPE_PRO_PRICE_ID ?? '',
    starterPriceId: process.env.STRIPE_STARTER_PRICE_ID ?? '',
    proYearlyPriceId: process.env.STRIPE_PRO_YEARLY_PRICE_ID ?? '',
    starterYearlyPriceId: process.env.STRIPE_STARTER_YEARLY_PRICE_ID ?? '',
  },
  google: {
    clientId: process.env.GOOGLE_CLIENT_ID ?? '',
    clientSecret: process.env.GOOGLE_CLIENT_SECRET ?? '',
    redirectUri: process.env.GOOGLE_REDIRECT_URI ?? '',
  },
  microsoft: {
    clientId: process.env.MICROSOFT_CLIENT_ID ?? '',
    clientSecret: process.env.MICROSOFT_CLIENT_SECRET ?? '',
    redirectUri: process.env.MICROSOFT_REDIRECT_URI ?? '',
    tenantId: process.env.MICROSOFT_TENANT_ID ?? 'common',
  },
  zoom: {
    clientId: process.env.ZOOM_CLIENT_ID ?? '',
    clientSecret: process.env.ZOOM_CLIENT_SECRET ?? '',
    redirectUri: process.env.ZOOM_REDIRECT_URI ?? '',
  },
  attachment: {
    storageType: process.env.ATTACHMENT_STORAGE_TYPE ?? 'local',
    s3Bucket: process.env.ATTACHMENT_S3_BUCKET ?? '',
    s3Region: process.env.ATTACHMENT_S3_REGION ?? '',
    s3Endpoint: process.env.ATTACHMENT_S3_ENDPOINT ?? '',
    s3AccessKey: process.env.ATTACHMENT_S3_ACCESS_KEY ?? '',
    s3SecretKey: process.env.ATTACHMENT_S3_SECRET_KEY ?? '',
    maxDirectBytes: parseInt(
      process.env.ATTACHMENT_MAX_DIRECT_BYTES ?? '10485760',
      10,
    ),
    scan: {
      enabled: process.env.ATTACHMENT_SCAN_ENABLED === 'true',
      provider: process.env.ATTACHMENT_SCAN_PROVIDER ?? 'clamav',
      clamavHost: process.env.ATTACHMENT_SCAN_CLAMAV_HOST ?? '127.0.0.1',
      clamavPort: parseInt(
        process.env.ATTACHMENT_SCAN_CLAMAV_PORT ?? '3310',
        10,
      ),
      timeoutMs: parseInt(
        process.env.ATTACHMENT_SCAN_TIMEOUT_MS ?? '15000',
        10,
      ),
      onDownload: process.env.ATTACHMENT_SCAN_ON_DOWNLOAD === 'true',
    },
  },
  featureFlags: {
    enableImapSync: process.env.ENABLE_IMAP_SYNC !== 'false',
    enableCalendar: process.env.ENABLE_CALENDAR !== 'false',
    enableWebhooks: process.env.ENABLE_WEBHOOKS !== 'false',
    enableStreamingSync: process.env.ENABLE_STREAMING_SYNC === 'true',
    enablePushNotifications: process.env.ENABLE_PUSH_NOTIFICATIONS === 'true',
    enableSlackNotifications: process.env.ENABLE_SLACK_NOTIFICATIONS === 'true',
    enableCrmAutoCreate: process.env.ENABLE_CRM_AUTO_CREATE !== 'false',
  },
});
