import { envConfigs } from '@/config';
import { defaultLocale } from '@/config/locale';

import { getPrimaryCategory } from './insights';
import {
  getLocalizedPromptCategory,
  getLocalizedSuggestedSettings,
  getPromptLibraryLocale,
} from './localization';
import { getPreferredPrompt } from './prompts';
import type {
  PromptLibraryItem,
  PromptLibraryListDataset,
  PromptLibraryMedia,
} from './types';

export const promptLibrarySeoConfig = {
  model: 'gpt-image-2',
  path: '/prompts/gpt-image-2',
  label: 'GPT Image 2',
  generatorPath: '/models/gpt-image-2#generator',
  collectionTitle: 'GPT Image 2 Prompt Gallery',
  collectionDescription:
    'Browse copyable GPT Image 2 prompts for product photos, posters, UI mockups, characters, infographics, social images, and reference-based image editing.',
  collectionKeywords: [
    'GPT Image 2 prompts',
    'GPT Image 2 prompt gallery',
    'AI image prompts',
    'copyable image prompts',
    'GPT image generator prompts',
    'image to image prompts',
  ],
} as const;

const promptLibraryZhSeoConfig = {
  ...promptLibrarySeoConfig,
  collectionTitle: 'GPT Image 2 提示词库',
  collectionDescription:
    '浏览适合产品图、海报、界面稿、角色设定、信息图、社媒配图和参考图改图的 GPT Image 2 提示词。保留可复制原文，并补充适合中文创作者的改写思路。',
  collectionKeywords: [
    'GPT Image 2 提示词',
    'GPT Image 2 prompt',
    'AI 图片提示词',
    '图片生成 Prompt',
    '可复制提示词',
    '图生图提示词',
    '产品图提示词',
    '信息图提示词',
  ],
} as const;

export function getPromptLibrarySeoConfig(locale?: string) {
  return getPromptLibraryLocale(locale) === 'zh'
    ? promptLibraryZhSeoConfig
    : promptLibrarySeoConfig;
}

export function getPromptLibraryCollectionTitle(
  total: number,
  locale?: string
) {
  return getPromptLibraryLocale(locale) === 'zh'
    ? `GPT Image 2 提示词库：${total} 个可直接改写的图片 Prompt`
    : `GPT Image 2 Prompt Gallery: ${total} Copyable Image Prompts`;
}

function trimTrailingSlash(value: string) {
  return value.replace(/\/+$/, '');
}

export function getCanonicalAppUrl() {
  return trimTrailingSlash(envConfigs.app_url || 'https://gptimg2.art');
}

export function getCanonicalUrl(path: string, locale = defaultLocale) {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  const localePrefix = locale === defaultLocale ? '' : `/${locale}`;

  return `${getCanonicalAppUrl()}${localePrefix}${normalizedPath}`;
}

export function getAbsoluteUrl(value?: string | null) {
  if (!value) return '';
  if (value.startsWith('http://') || value.startsWith('https://')) return value;

  return `${getCanonicalAppUrl()}${value.startsWith('/') ? '' : '/'}${value}`;
}

export function getPromptMediaImage(media?: PromptLibraryMedia) {
  if (!media) return '';
  return getAbsoluteUrl(media.thumbnail || media.url);
}

export function normalizeSeoText(value: string) {
  return value.replace(/\s+/g, ' ').trim();
}

export function truncateSeoText(value: string, maxLength: number) {
  const normalized = normalizeSeoText(value);
  if (normalized.length <= maxLength) return normalized;

  const clipped = normalized.slice(0, maxLength - 1);
  const lastSpace = clipped.lastIndexOf(' ');

  return `${(lastSpace > 80 ? clipped.slice(0, lastSpace) : clipped).trim()}...`;
}

export function getPromptDetailTitle(item: PromptLibraryItem, locale?: string) {
  if (getPromptLibraryLocale(locale) === 'zh') {
    const category = getLocalizedPromptCategory(
      getPrimaryCategory(item),
      locale
    );

    return truncateSeoText(`${category} GPT Image 2 提示词：${item.title}`, 68);
  }

  return truncateSeoText(
    `${item.title} GPT Image 2 Prompt and Rewrite Tips`,
    68
  );
}

export function getPromptDetailDescription(
  item: PromptLibraryItem,
  locale?: string
) {
  const promptLocale = getPromptLibraryLocale(locale);
  const settings = getLocalizedSuggestedSettings(item, promptLocale);

  if (promptLocale === 'zh') {
    const category = getLocalizedPromptCategory(
      getPrimaryCategory(item),
      promptLocale
    );

    return truncateSeoText(
      `这是一条适合${category}场景的 GPT Image 2 提示词：${item.title}。保留完整原始 Prompt，并整理 ${settings.aspectRatio} 画幅建议和中文改写思路。`,
      158
    );
  }

  return truncateSeoText(
    `${item.description} Copy the prompt, review suggested ${settings.aspectRatio} framing, and adapt it for GPT Image 2 image generation.`,
    158
  );
}

export function getPromptVisualAltText(
  item: PromptLibraryItem,
  mediaIndex = 0,
  locale?: string
) {
  const suffix = mediaIndex > 0 ? ` variation ${mediaIndex + 1}` : '';

  if (getPromptLibraryLocale(locale) === 'zh') {
    const zhSuffix = mediaIndex > 0 ? ` 变化图 ${mediaIndex + 1}` : '';

    return truncateSeoText(
      `${item.title} 的 GPT Image 2 提示词示例图${zhSuffix}：${item.description}`,
      180
    );
  }

  return truncateSeoText(
    `${item.title} GPT Image 2 prompt example${suffix}: ${item.description}`,
    180
  );
}

export function getPromptKeywords(item: PromptLibraryItem, locale?: string) {
  const seoConfig = getPromptLibrarySeoConfig(locale);
  const category = getPrimaryCategory(item);
  const source = [
    ...seoConfig.collectionKeywords,
    item.title,
    getPromptLibraryLocale(locale) === 'zh'
      ? `${getLocalizedPromptCategory(category, locale)}提示词`
      : `${category} prompt`,
    item.language ? `${item.language} image prompt` : '',
    ...(item.tags || []),
  ];

  return Array.from(
    new Set(source.map(normalizeSeoText).filter(Boolean))
  ).slice(0, 14);
}

export function getRelatedPromptItems(
  dataset: PromptLibraryListDataset,
  item: PromptLibraryItem,
  limit = 6
) {
  const category = getPrimaryCategory(item);

  return dataset.items
    .filter((candidate) => candidate.slug !== item.slug)
    .sort((a, b) => {
      const aMatch = a.categories.includes(category) ? 1 : 0;
      const bMatch = b.categories.includes(category) ? 1 : 0;
      return (
        bMatch - aMatch ||
        Number(Boolean(b.featured)) - Number(Boolean(a.featured))
      );
    })
    .slice(0, limit);
}

export function buildPromptLibraryJsonLd({
  dataset,
  url,
  locale,
}: {
  dataset: PromptLibraryListDataset;
  url: string;
  locale?: string;
}) {
  const appName = envConfigs.app_name || 'ChatGPT Image 2 Generator';
  const seoConfig = getPromptLibrarySeoConfig(locale);

  return {
    '@context': 'https://schema.org',
    '@type': 'CollectionPage',
    name: getPromptLibraryCollectionTitle(
      dataset.total || dataset.items.length,
      locale
    ),
    description: seoConfig.collectionDescription,
    url,
    isPartOf: {
      '@type': 'WebSite',
      name: appName,
      url: getCanonicalAppUrl(),
    },
    about: {
      '@type': 'SoftwareApplication',
      name: 'GPT Image 2',
      applicationCategory: 'MultimediaApplication',
    },
    mainEntity: {
      '@type': 'ItemList',
      numberOfItems: dataset.total || dataset.items.length,
      itemListElement: dataset.items.slice(0, 50).map((item, index) => ({
        '@type': 'ListItem',
        position: index + 1,
        url: getCanonicalUrl(
          `/prompts/gpt-image-2/${item.slug}`,
          getPromptLibraryLocale(locale)
        ),
        name: item.title,
      })),
    },
  };
}

export function buildPromptDetailJsonLd({
  item,
  url,
  locale,
}: {
  item: PromptLibraryItem;
  url: string;
  locale?: string;
}) {
  const image = getPromptMediaImage(item.media[0]);

  return {
    '@context': 'https://schema.org',
    '@type': 'CreativeWork',
    name: getPromptDetailTitle(item, locale),
    description: getPromptDetailDescription(item, locale),
    url,
    image: image || undefined,
    datePublished: item.publishedAt || item.syncedAt,
    dateModified: item.syncedAt,
    creator: item.authorName
      ? {
          '@type': 'Person',
          name: item.authorName,
        }
      : undefined,
    keywords: getPromptKeywords(item, locale).join(', '),
    text: getPreferredPrompt(item, locale),
  };
}
