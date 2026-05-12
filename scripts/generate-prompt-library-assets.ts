import fs from 'fs';
import path from 'path';

import {
  getLatestPromptLibrarySyncTime,
  getPromptLibraryImportIndexItems,
  getPromptLibraryImportItems,
  mergePromptLibraryIndexItems,
} from '@/shared/prompt-library/imports';
import { getPromptCategories } from '@/shared/prompt-library/insights';
import {
  sanitizePromptLibraryDataset,
  sanitizePromptLibraryItem,
} from '@/shared/prompt-library/sanitize';
import type {
  PromptLibraryDataset,
  PromptLibraryIndexDataset,
  PromptLibraryIndexItem,
} from '@/shared/prompt-library/types';

const generateLocalAssets =
  process.env.GENERATE_LOCAL_PROMPT_LIBRARY === 'true' ||
  process.argv.includes('--local-assets');
const promptLibraryBaseUrl = (
  process.env.NEXT_PUBLIC_PROMPT_LIBRARY_BASE_URL ||
  process.env.PROMPT_LIBRARY_BASE_URL ||
  'https://img.cdance.ai/uploads/prompt-library'
).replace(/\/+$/, '');
const promptLibraryAssetBaseUrl = (
  process.env.NEXT_PUBLIC_PROMPT_LIBRARY_ASSET_BASE_URL ||
  (generateLocalAssets ? '/prompt-library' : '/api/prompt-library')
).replace(/\/+$/, '');
const siteUrl = (
  process.env.NEXT_PUBLIC_APP_URL ||
  process.env.APP_URL ||
  'https://gptimg2.art'
).replace(/\/+$/, '');
const defaultLocale = process.env.NEXT_PUBLIC_DEFAULT_LOCALE || 'en';
const promptLibraryLocales = ['en', 'zh'];
const promptSitemapLimit = Number.parseInt(
  process.env.PROMPT_SITEMAP_LIMIT || '5',
  10
);
const fetchTimeoutMs = Number.parseInt(
  process.env.PROMPT_LIBRARY_FETCH_TIMEOUT_MS || '20000',
  10
);

function getPromptPreview(prompt: string) {
  return prompt.replace(/\s+/g, ' ').trim().slice(0, 360);
}

function writeJsonFile(filePath: string, value: unknown) {
  fs.writeFileSync(filePath, `${JSON.stringify(value)}\n`);
}

function getLocalizedPath(pathname: string, locale: string) {
  return locale === defaultLocale ? pathname : `/${locale}${pathname}`;
}

type PromptLibrarySourceDataset =
  | PromptLibraryDataset
  | PromptLibraryIndexDataset;
type PromptLibrarySourceItem = PromptLibrarySourceDataset['items'][number];

function getSourcePromptPreview(item: PromptLibrarySourceItem) {
  if ('promptPreview' in item && item.promptPreview) return item.promptPreview;
  if ('prompt' in item && item.prompt) return getPromptPreview(item.prompt);

  return item.description;
}

function toIndexItem(item: PromptLibrarySourceItem): PromptLibraryIndexItem {
  return {
    id: item.id,
    slug: item.slug,
    model: item.model,
    title: item.title,
    description: item.description,
    promptPreview: getSourcePromptPreview(item),
    language: item.language,
    featured: item.featured,
    authorName: item.authorName,
    authorUrl: item.authorUrl,
    sourceUrl: item.sourceUrl,
    publishedAt: item.publishedAt,
    media: item.media.slice(0, 1),
    syncedAt: item.syncedAt,
    categories:
      'categories' in item && item.categories?.length
        ? item.categories
        : getPromptCategories(item),
  };
}

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url, {
    headers: { accept: 'application/json' },
    signal: AbortSignal.timeout(fetchTimeoutMs),
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: ${response.status}`);
  }

  return (await response.json()) as T;
}

async function getPromptLibraryDataset(): Promise<PromptLibrarySourceDataset> {
  return fetchJson<PromptLibrarySourceDataset>(
    `${promptLibraryBaseUrl}/gpt-image-2/index.json`
  );
}

function readExistingPromptLibraryDataset(
  filePath: string
): PromptLibrarySourceDataset | undefined {
  if (!fs.existsSync(filePath)) return undefined;

  const dataset = JSON.parse(
    fs.readFileSync(filePath, 'utf8')
  ) as PromptLibrarySourceDataset;

  return dataset.items.length > 0 ? dataset : undefined;
}

async function main() {
  let dataset: PromptLibrarySourceDataset;
  const outputDir = path.join(
    process.cwd(),
    'public/prompt-library/gpt-image-2'
  );
  const itemsDir = path.join(outputDir, 'items');

  try {
    dataset = await getPromptLibraryDataset();
  } catch (error) {
    if (generateLocalAssets) {
      throw error;
    }

    const existingIndex = path.join(outputDir, 'index.json');
    const existingDataset = readExistingPromptLibraryDataset(existingIndex);
    if (existingDataset) {
      console.warn(
        `Keeping existing prompt library assets because CDN data could not be fetched: ${error instanceof Error ? error.message : String(error)}`
      );
      dataset = existingDataset;
    } else {
      throw new Error(
        `Prompt library CDN data could not be fetched and no existing non-empty index is available: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  const importedItems = getPromptLibraryImportItems('gpt-image-2');
  const importedIndexItems = getPromptLibraryImportIndexItems('gpt-image-2');
  const mergedIndexItems = mergePromptLibraryIndexItems(
    dataset.items.map(toIndexItem),
    importedIndexItems
  );
  const mergedSyncedAt = getLatestPromptLibrarySyncTime([
    dataset.syncedAt,
    ...importedIndexItems.map((item) => item.syncedAt),
  ]);

  const indexDataset: PromptLibraryIndexDataset = {
    model: dataset.model,
    source: dataset.source,
    sourceUrl: dataset.sourceUrl,
    total: mergedIndexItems.length,
    syncedAt: mergedSyncedAt,
    items: mergedIndexItems,
    assetBaseUrl: promptLibraryAssetBaseUrl,
  };
  const publicIndexDataset = sanitizePromptLibraryDataset(indexDataset, {
    model: indexDataset.model,
    assetBaseUrl: promptLibraryAssetBaseUrl,
  });

  fs.rmSync(outputDir, { recursive: true, force: true });
  fs.mkdirSync(outputDir, { recursive: true });
  writeJsonFile(path.join(outputDir, 'index.json'), publicIndexDataset);

  if (generateLocalAssets) {
    fs.mkdirSync(itemsDir, { recursive: true });

    for (const item of dataset.items) {
      const fullItem = await fetchJson<PromptLibraryDataset['items'][number]>(
        `${promptLibraryBaseUrl}/gpt-image-2/items/${item.slug}.json`
      );
      writeJsonFile(
        path.join(
          itemsDir,
          `${sanitizePromptLibraryItem(fullItem, { model: fullItem.model }).slug}.json`
        ),
        sanitizePromptLibraryItem(fullItem, { model: fullItem.model })
      );
    }

    for (const item of importedItems) {
      writeJsonFile(
        path.join(
          itemsDir,
          `${sanitizePromptLibraryItem(item, { model: item.model }).slug}.json`
        ),
        sanitizePromptLibraryItem(item, { model: item.model })
      );
    }
  } else {
    fs.rmSync(itemsDir, { recursive: true, force: true });
  }

  const sitemapItems = mergedIndexItems
    .slice()
    .slice(0, Math.max(0, promptSitemapLimit));

  const sitemapUrls = promptLibraryLocales.flatMap((locale) => [
    {
      loc: `${siteUrl}${getLocalizedPath('/prompts/gpt-image-2', locale)}`,
      lastmod: mergedSyncedAt,
      changefreq: 'daily',
      priority: '0.92',
    },
    ...sitemapItems.map((item) => ({
      loc: `${siteUrl}${getLocalizedPath(
        `/prompts/gpt-image-2/${item.slug}`,
        locale
      )}`,
      lastmod: item.syncedAt || dataset.syncedAt,
      changefreq: 'monthly',
      priority: item.featured ? '0.78' : '0.70',
    })),
  ]);

  const sitemapXml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${sitemapUrls
  .map(
    (url) => `  <url>
    <loc>${url.loc}</loc>
    <lastmod>${url.lastmod}</lastmod>
    <changefreq>${url.changefreq}</changefreq>
    <priority>${url.priority}</priority>
  </url>`
  )
  .join('\n')}
</urlset>
`;

  fs.writeFileSync(
    path.join(process.cwd(), 'public/prompt-sitemap.xml'),
    sitemapXml
  );

  console.log(
    generateLocalAssets
      ? `Generated ${dataset.items.length + importedItems.length} local GPT Image 2 prompt assets and ${sitemapUrls.length} sitemap URLs.`
      : `Generated merged GPT Image 2 prompt index with ${mergedIndexItems.length} items and ${sitemapUrls.length} sitemap URLs. Full prompt JSON is expected from the API or local imports.`
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
