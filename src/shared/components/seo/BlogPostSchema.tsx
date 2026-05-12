import Script from 'next/script';

interface BlogPostSchemaProps {
  title: string;
  description: string;
  author: {
    name: string;
    image?: string;
    type?: 'Person' | 'Organization';
    jobTitle?: string;
  };
  datePublished: string;
  dateModified?: string;
  image?: string;
  url: string;
  articleBody?: string;
  keywords?: string[];
  articleSection?: string[];
}

export function BlogPostSchema({
  title,
  description,
  author,
  datePublished,
  dateModified,
  image,
  url,
  articleBody,
  keywords,
  articleSection,
}: BlogPostSchemaProps) {
  const appName = process.env.NEXT_PUBLIC_APP_NAME || 'ChatGPT Image 2 Generator';
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://gptimg2.art';

  const schema = {
    '@context': 'https://schema.org',
    '@type': 'BlogPosting',
    headline: title,
    description: description,
    image: image || `${appUrl}/og-image.jpg`,
    datePublished: datePublished,
    dateModified: dateModified || datePublished,
    author: {
      '@type': author.type || 'Person',
      name: author.name,
      image: author.image,
      ...(author.type !== 'Organization' && author.jobTitle
        ? { jobTitle: author.jobTitle }
        : {}),
    },
    publisher: {
      '@type': 'Organization',
      name: appName,
      logo: {
        '@type': 'ImageObject',
        url: `${appUrl}/logo.png`,
      },
    },
    mainEntityOfPage: {
      '@type': 'WebPage',
      '@id': url,
    },
    ...(keywords && keywords.length > 0 ? { keywords: keywords.join(', ') } : {}),
    ...(articleSection && articleSection.length > 0
      ? { articleSection }
      : {}),
    ...(articleBody && { articleBody }),
  };

  return (
    <Script
      id="blog-post-schema"
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(schema) }}
    />
  );
}
