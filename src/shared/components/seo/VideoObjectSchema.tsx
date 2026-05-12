import Script from 'next/script';

interface VideoObjectSchemaProps {
  name: string;
  description: string;
  thumbnailUrl: string;
  uploadDate: string;
  url: string;
  contentUrl?: string;
  embedUrl?: string;
  duration?: string;
  width?: number;
  height?: number;
}

function toAbsoluteUrl(url: string, appUrl: string) {
  return url.startsWith('http') ? url : `${appUrl}${url}`;
}

export function VideoObjectSchema({
  name,
  description,
  thumbnailUrl,
  uploadDate,
  url,
  contentUrl,
  embedUrl,
  duration,
  width,
  height,
}: VideoObjectSchemaProps) {
  const appName = process.env.NEXT_PUBLIC_APP_NAME || 'ChatGPT Image 2 Generator';
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://gptimg2.art';

  const schema = {
    '@context': 'https://schema.org',
    '@type': 'VideoObject',
    name,
    description,
    thumbnailUrl: [toAbsoluteUrl(thumbnailUrl, appUrl)],
    uploadDate,
    ...(contentUrl ? { contentUrl: toAbsoluteUrl(contentUrl, appUrl) } : {}),
    ...(embedUrl ? { embedUrl: toAbsoluteUrl(embedUrl, appUrl) } : {}),
    ...(duration ? { duration } : {}),
    ...(typeof width === 'number' ? { width } : {}),
    ...(typeof height === 'number' ? { height } : {}),
    mainEntityOfPage: {
      '@type': 'WebPage',
      '@id': url,
    },
    publisher: {
      '@type': 'Organization',
      name: appName,
      logo: {
        '@type': 'ImageObject',
        url: `${appUrl}/logo.png`,
      },
    },
  };

  return (
    <Script
      id="video-object-schema"
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(schema) }}
    />
  );
}
