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
