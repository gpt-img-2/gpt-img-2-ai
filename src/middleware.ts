import { NextRequest, NextResponse } from 'next/server';
import { getSessionCookie } from 'better-auth/cookies';
import createIntlMiddleware from 'next-intl/middleware';

import { routing } from '@/core/i18n/config';

const intlMiddleware = createIntlMiddleware(routing);

const siteMigrationTargetOrigin = 'https://gptimg2.art';
const siteMigrationSourceHosts = new Set([
  'gpt-image-2-ai.org',
  'www.gpt-image-2-ai.org',
  'cf-gpt-image-2-ai.org',
  'www.cf-gpt-image-2-ai.org',
]);
const siteMigrationUtmSource = 'gpt-image-2-ai.org';

function getSiteMigrationRedirectUrl(request: NextRequest) {
  const sourceHost = request.nextUrl.hostname.toLowerCase();

  if (!siteMigrationSourceHosts.has(sourceHost)) {
    return null;
  }

  const redirectUrl = new URL(
    request.nextUrl.pathname,
    siteMigrationTargetOrigin
  );
  redirectUrl.search = request.nextUrl.search;

  if (!redirectUrl.searchParams.has('utm_source')) {
    redirectUrl.searchParams.set('utm_source', siteMigrationUtmSource);
  }

  return redirectUrl;
}

function normalizeDuplicatedLocalePath(pathname: string) {
  const segments = pathname.split('/');
  const firstLocale = segments[1];
  const secondLocale = segments[2];

  if (
    firstLocale &&
    secondLocale &&
    firstLocale === secondLocale &&
    routing.locales.includes(firstLocale as any)
  ) {
    return `/${[firstLocale, ...segments.slice(3)].filter(Boolean).join('/')}`;
  }

  return null;
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const siteMigrationRedirectUrl = getSiteMigrationRedirectUrl(request);

  if (siteMigrationRedirectUrl) {
    return NextResponse.redirect(siteMigrationRedirectUrl, 308);
  }

  const normalizedDuplicatedLocalePath =
    normalizeDuplicatedLocalePath(pathname);

  if (
    normalizedDuplicatedLocalePath &&
    normalizedDuplicatedLocalePath !== pathname
  ) {
    const redirectUrl = request.nextUrl.clone();
    redirectUrl.pathname = normalizedDuplicatedLocalePath;
    return NextResponse.redirect(redirectUrl, 308);
  }

  // Handle internationalization first
  const intlResponse = intlMiddleware(request);

  // Extract locale from pathname
  const locale = pathname.split('/')[1];
  const isValidLocale = routing.locales.includes(locale as any);
  const pathWithoutLocale = isValidLocale
    ? pathname.slice(locale.length + 1)
    : pathname;

  // Only check authentication for admin routes
  if (
    pathWithoutLocale.startsWith('/admin') ||
    pathWithoutLocale.startsWith('/settings') ||
    pathWithoutLocale.startsWith('/activity')
  ) {
    // Check if session cookie exists
    const sessionCookie = getSessionCookie(request);

    // If no session token found, redirect to sign-in
    if (!sessionCookie) {
      const signInUrl = new URL(
        isValidLocale ? `/${locale}/sign-in` : '/sign-in',
        request.url
      );
      // Add the current path (including search params) as callback - use relative path for multi-language support
      const callbackPath = pathWithoutLocale + request.nextUrl.search;
      signInUrl.searchParams.set('callbackUrl', callbackPath);
      return NextResponse.redirect(signInUrl);
    }

    // For admin routes, we need to check RBAC permissions
    // Note: Full permission check happens in the page/API route level
    // This is a lightweight session check to prevent unauthorized access
    // The detailed permission check (admin.access and specific permissions)
    // will be done in the layout or individual pages using requirePermission()
  }

  intlResponse.headers.set('x-pathname', request.nextUrl.pathname);
  intlResponse.headers.set('x-url', request.url);

  // Remove Set-Cookie from public pages to allow caching
  // We exclude admin, settings, activity, and auth pages from this behavior
  if (
    !pathWithoutLocale.startsWith('/admin') &&
    !pathWithoutLocale.startsWith('/settings') &&
    !pathWithoutLocale.startsWith('/activity') &&
    !pathWithoutLocale.startsWith('/sign-') &&
    !pathWithoutLocale.startsWith('/auth')
  ) {
    intlResponse.headers.delete('Set-Cookie');

    // Cache-Control header for public pages
    const cacheControl = 'public, s-maxage=3600, stale-while-revalidate=14400';

    intlResponse.headers.set('Cache-Control', cacheControl);
    intlResponse.headers.set('CDN-Cache-Control', cacheControl);
    intlResponse.headers.set('Cloudflare-CDN-Cache-Control', cacheControl);
  }

  // For all other routes (including /, /sign-in, /sign-up, /sign-out), just return the intl response
  return intlResponse;
}

export const config = {
  matcher: '/((?!api|trpc|_next|_vercel|.*\\..*).*)',
};
