import packageJson from '../../package.json';

// Load .env files for scripts (tsx/ts-node) - but NOT in Edge Runtime or browser
// This ensures scripts can read DATABASE_URL and other env vars
// Check for real Node.js environment by looking at global 'process' properties
if (
  typeof process !== 'undefined' &&
  typeof process.cwd === 'function' &&
  !process.env.NEXT_RUNTIME // Skip if in Next.js runtime (already loaded)
) {
  try {
    const dotenv = require('dotenv');
    dotenv.config({ path: '.env.development' });
    dotenv.config({ path: '.env', override: false });
  } catch (e) {
    // Silently fail - dotenv might not be available in some environments
  }
}

export type ConfigMap = Record<string, string>;

export const envConfigs: ConfigMap = {
  app_url: process.env.NEXT_PUBLIC_APP_URL ?? 'https://gptimg2.art',
  app_name: process.env.NEXT_PUBLIC_APP_NAME ?? 'ChatGPT Image 2 Generator',
  site_code:
    process.env.NEXT_PUBLIC_SITE_CODE ?? process.env.SITE_CODE ?? 'happyhorse',
  app_description: process.env.NEXT_PUBLIC_APP_DESCRIPTION ?? '',
  app_logo: process.env.NEXT_PUBLIC_APP_LOGO ?? '/logo.png',
  app_favicon: process.env.NEXT_PUBLIC_APP_FAVICON ?? '/favicon.ico',
  app_preview_image:
    process.env.NEXT_PUBLIC_APP_PREVIEW_IMAGE ?? '/preview.png',
  prompt_library_base_url:
    process.env.NEXT_PUBLIC_PROMPT_LIBRARY_BASE_URL ??
    process.env.PROMPT_LIBRARY_BASE_URL ??
    'https://img.cdance.ai/uploads/prompt-library',
  theme: process.env.NEXT_PUBLIC_THEME ?? 'default',
  appearance: process.env.NEXT_PUBLIC_APPEARANCE ?? 'system',
  locale: process.env.NEXT_PUBLIC_DEFAULT_LOCALE ?? 'en',
  database_url: process.env.DATABASE_URL ?? '',
  database_auth_token: process.env.DATABASE_AUTH_TOKEN ?? '',
  database_provider: process.env.DATABASE_PROVIDER ?? 'postgresql',
  db_schema_file: process.env.DB_SCHEMA_FILE ?? './src/config/db/schema.ts',
  // PostgreSQL schema name (e.g. 'web'). Default: 'public'
  db_schema: process.env.DB_SCHEMA ?? 'public',
  // Drizzle migrations journal table name (avoid conflicts across projects)
  db_migrations_table:
    process.env.DB_MIGRATIONS_TABLE ?? '__drizzle_migrations',
  // Drizzle migrations journal schema (default in drizzle-kit is 'drizzle')
  // We keep 'public' as template default for stability on fresh Supabase DBs.
  db_migrations_schema: process.env.DB_MIGRATIONS_SCHEMA ?? 'drizzle',
  // Output folder for drizzle-kit generated migrations
  db_migrations_out:
    process.env.DB_MIGRATIONS_OUT ?? './src/config/db/migrations',
  db_singleton_enabled: process.env.DB_SINGLETON_ENABLED || 'false',
  db_max_connections: process.env.DB_MAX_CONNECTIONS || '1',
  auth_url: process.env.AUTH_URL || process.env.NEXT_PUBLIC_APP_URL || '',
  auth_secret: process.env.AUTH_SECRET ?? '', // openssl rand -base64 32
  tracking_enabled:
    process.env.NEXT_PUBLIC_TRACKING_ENABLED ??
    process.env.TRACKING_ENABLED ??
    'true',
  google_tag_manager_id:
    process.env.NEXT_PUBLIC_GOOGLE_TAG_MANAGER_ID ??
    process.env.GOOGLE_TAG_MANAGER_ID ??
    process.env.NEXT_PUBLIC_GTM_ID ??
    process.env.GTM_ID ??
    '',
  gtm_id:
    process.env.NEXT_PUBLIC_GTM_ID ??
    process.env.GTM_ID ??
    process.env.NEXT_PUBLIC_GOOGLE_TAG_MANAGER_ID ??
    process.env.GOOGLE_TAG_MANAGER_ID ??
    '',
  google_ads_tag_id:
    process.env.NEXT_PUBLIC_GOOGLE_ADS_TAG_ID ??
    process.env.GOOGLE_ADS_TAG_ID ??
    '',
  google_ads_sign_up_send_to:
    process.env.NEXT_PUBLIC_GOOGLE_ADS_SIGN_UP_SEND_TO ??
    process.env.GOOGLE_ADS_SIGN_UP_SEND_TO ??
    '',
  ga4_api_secret: process.env.GA4_API_SECRET ?? '',
  google_analytics_id:
    process.env.NEXT_PUBLIC_GOOGLE_ANALYTICS_ID ??
    process.env.GOOGLE_ANALYTICS_ID ??
    '',
  clarity_id:
    process.env.NEXT_PUBLIC_CLARITY_ID ?? process.env.CLARITY_ID ?? '',
  plausible_domain:
    process.env.NEXT_PUBLIC_PLAUSIBLE_DOMAIN ??
    process.env.PLAUSIBLE_DOMAIN ??
    '',
  plausible_src:
    process.env.NEXT_PUBLIC_PLAUSIBLE_SRC ?? process.env.PLAUSIBLE_SRC ?? '',
  openpanel_client_id:
    process.env.NEXT_PUBLIC_OPENPANEL_CLIENT_ID ??
    process.env.OPENPANEL_CLIENT_ID ??
    '',
  adsense_code:
    process.env.NEXT_PUBLIC_ADSENSE_CODE ?? process.env.ADSENSE_CODE ?? '',
  affonso_enabled:
    process.env.NEXT_PUBLIC_AFFONSO_ENABLED ??
    process.env.AFFONSO_ENABLED ??
    '',
  affonso_id:
    process.env.NEXT_PUBLIC_AFFONSO_ID ?? process.env.AFFONSO_ID ?? '',
  affonso_cookie_duration:
    process.env.NEXT_PUBLIC_AFFONSO_COOKIE_DURATION ??
    process.env.AFFONSO_COOKIE_DURATION ??
    '',
  promotekit_enabled:
    process.env.NEXT_PUBLIC_PROMOTEKIT_ENABLED ??
    process.env.PROMOTEKIT_ENABLED ??
    '',
  promotekit_id:
    process.env.NEXT_PUBLIC_PROMOTEKIT_ID ?? process.env.PROMOTEKIT_ID ?? '',
  crisp_enabled:
    process.env.NEXT_PUBLIC_CRISP_ENABLED ?? process.env.CRISP_ENABLED ?? '',
  crisp_website_id:
    process.env.NEXT_PUBLIC_CRISP_WEBSITE_ID ??
    process.env.CRISP_WEBSITE_ID ??
    '',
  tawk_enabled:
    process.env.NEXT_PUBLIC_TAWK_ENABLED ?? process.env.TAWK_ENABLED ?? '',
  tawk_property_id:
    process.env.NEXT_PUBLIC_TAWK_PROPERTY_ID ??
    process.env.TAWK_PROPERTY_ID ??
    '',
  tawk_widget_id:
    process.env.NEXT_PUBLIC_TAWK_WIDGET_ID ?? process.env.TAWK_WIDGET_ID ?? '',
  email_auth_enabled: process.env.EMAIL_AUTH_ENABLED ?? '',
  email_verification_enabled: process.env.EMAIL_VERIFICATION_ENABLED ?? '',
  resend_api_key: process.env.RESEND_API_KEY ?? '',
  google_client_id:
    process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID ??
    process.env.GOOGLE_CLIENT_ID ??
    '',
  google_client_secret: process.env.GOOGLE_CLIENT_SECRET ?? '',
  google_one_tap_enabled:
    process.env.NEXT_PUBLIC_GOOGLE_ONE_TAP_ENABLED ??
    process.env.GOOGLE_ONE_TAP_ENABLED ??
    '',
  github_client_id: process.env.GITHUB_CLIENT_ID ?? '',
  github_client_secret: process.env.GITHUB_CLIENT_SECRET ?? '',
  version: packageJson.version,
  locale_detect_enabled:
    process.env.NEXT_PUBLIC_LOCALE_DETECT_ENABLED ?? 'false',
};
