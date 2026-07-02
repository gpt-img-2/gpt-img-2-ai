import { setRequestLocale } from 'next-intl/server';

import { getThemePage } from '@/core/theme';
import { envConfigs } from '@/config';
import { defaultLocale } from '@/config/locale';
import { PartnerListing, partnerListings } from '@/config/partners';
import { getLocalPage } from '@/shared/models/post';
import { Post as PostType } from '@/shared/types/blocks/blog';

const PARTNERS_SLUG = 'partners';
const FALLBACK_PARTNERS_DESCRIPTION =
  'A manually reviewed resource page for AI video creators.';
const FALLBACK_PARTNERS_CONTENT = `
## About This Page

This page is reserved for a small number of manually reviewed resources that may be useful to people working with AI video, motion content, prompts, and creator workflows.

We don't run an open directory. Listings are selective, editorially reviewed, and may be updated or removed at any time.

## Submission Process

1. Add ChatGPT Image 2 Generator to your site before submitting your request. Suggested HTML:

\`\`\`html
<a href="https://image3.org" title="ChatGPT Image 2 Generator">ChatGPT Image 2 Generator</a>
\`\`\`

2. Email [support@image3.org](mailto:support@image3.org) with all required information for review.

3. Every submission is manually reviewed. We only approve sites that meet all of the requirements below.

## Listing Guidelines

- AI-related products, tools, educational resources, or creator workflows with clear relevance to AI video
- Original content or a real product with clear value for creators
- Clean user experience, working HTTPS, and no obvious spam patterns
- Stable branding and a site we would feel comfortable referencing publicly
- No malware, deceptive redirects, auto-generated spam, or thin affiliate pages

## Important Notes

- Placement on this page is not guaranteed.
- We may decline or remove a listing if the site's quality, ownership, or topical relevance changes.

## Publication Policy

Partner resources are not published as outbound links on this page. We keep them off blog posts, core landing pages, and the project footer.

## Contact

If you'd like us to review your site for a possible partnership, email [support@image3.org](mailto:support@image3.org) with:

- Your site URL
- A short description of your audience or product
- Why it is relevant to AI video creators
- The page where you already mention ChatGPT Image 2 Generator

We review requests manually and only reply when there is a fit.
`.trim();

function buildFallbackPartnersPage(locale: string): PostType {
  return {
    id: PARTNERS_SLUG,
    slug: PARTNERS_SLUG,
    title: 'Partners',
    description: FALLBACK_PARTNERS_DESCRIPTION,
    content: FALLBACK_PARTNERS_CONTENT,
    url: locale === defaultLocale ? '/partners' : `/${locale}/partners`,
    created_at: '2026-04-09',
  };
}

async function getPartnersPage(locale: string) {
  const localizedPage = await getLocalPage({
    slug: PARTNERS_SLUG,
    locale,
  });

  if (localizedPage) {
    return localizedPage;
  }

  if (locale !== defaultLocale) {
    const defaultPage = await getLocalPage({
      slug: PARTNERS_SLUG,
      locale: defaultLocale,
    });

    if (defaultPage) {
      return defaultPage;
    }
  }

  return buildFallbackPartnersPage(locale);
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const page = await getPartnersPage(locale);
  const canonicalUrl = `${envConfigs.app_url}/${PARTNERS_SLUG}`;

  return {
    title: page?.title || 'Partners',
    description:
      page?.description ||
      'Editorially reviewed resource page for AI video creators.',
    alternates: {
      canonical: canonicalUrl,
    },
    robots: {
      index: false,
      follow: true,
    },
  };
}

export default async function PartnersPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const post = await getPartnersPage(locale);
  const Page = await getThemePage('static-page');

  return (
    <>
      <Page locale={locale} post={post} />
      <PartnerListingsSection listings={partnerListings} />
    </>
  );
}

function PartnerListingsSection({ listings }: { listings: PartnerListing[] }) {
  const visibleListings = listings.filter(
    (listing) => listing.showInPartners !== false
  );

  return (
    <section aria-labelledby="partner-resources" className="pb-24 md:pb-32">
      <div className="mx-auto w-full max-w-6xl px-6 md:px-8">
        <div className="ring-foreground/5 rounded-3xl border border-transparent px-4 shadow ring-1 md:px-8">
          <div className="my-8 space-y-6">
            <div className="space-y-2">
              <h2
                id="partner-resources"
                className="text-foreground text-2xl font-semibold md:text-3xl"
              >
                Partner Resources
              </h2>
              <p className="text-muted-foreground text-sm leading-7 md:text-base">
                Partner resources are not linked out from this project. We keep
                them off blog posts, core landing pages, and the footer.
              </p>
            </div>

            {visibleListings.length > 0 ? (
              <div className="space-y-4">
                <div className="flex flex-wrap gap-3">
                  {visibleListings.map((listing) => {
                    if (listing.exactBadgeEmbed && listing.badgeImageUrl) {
                      return (
                        <div
                          key={listing.url}
                          className="bg-background inline-flex min-h-[64px] max-w-full min-w-[150px] items-center justify-center rounded-2xl border px-4 py-3 shadow-sm"
                        >
                          <img
                            src={listing.badgeImageUrl}
                            alt={listing.badgeAlt || `${listing.name} Badge`}
                            width={listing.badgeWidth}
                            height={listing.badgeHeight}
                            style={listing.badgeStyle}
                          />
                        </div>
                      );
                    }

                    return (
                      <div
                        key={listing.url}
                        className="bg-background inline-flex min-h-[64px] max-w-full min-w-[150px] items-center justify-center rounded-2xl border px-4 py-3 shadow-sm"
                      >
                        {listing.badgeImageUrl ? (
                          <img
                            src={listing.badgeImageUrl}
                            width={listing.badgeWidth || 150}
                            height={listing.badgeHeight}
                            alt={listing.badgeAlt || `${listing.name} Badge`}
                            className="block h-auto max-h-10 w-auto max-w-full sm:max-w-[170px]"
                            loading="lazy"
                            decoding="async"
                          />
                        ) : (
                          <span className="flex flex-col items-center gap-1 text-center">
                            {listing.category ? (
                              <span className="text-muted-foreground text-[10px] font-medium tracking-[0.18em] uppercase">
                                {listing.category}
                              </span>
                            ) : null}
                            <span className="text-foreground text-sm leading-none font-semibold">
                              {listing.name}
                            </span>
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>

                <p className="text-muted-foreground text-xs leading-6">
                  These resources are shown here as a reference list and are not
                  linked out from this page.
                </p>
              </div>
            ) : (
              <div className="bg-muted/40 rounded-2xl border px-5 py-5">
                <p className="text-foreground text-sm font-medium md:text-base">
                  No partner resources have been published yet.
                </p>
                <p className="text-muted-foreground mt-2 text-sm leading-7">
                  Once a site passes manual review, it may be added here without
                  an outbound link.
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
