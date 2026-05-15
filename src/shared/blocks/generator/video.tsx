'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { homeVideoManifest } from '@/generated/home-video-manifest';
import {
  AlertCircle,
  ChevronDown,
  CreditCard,
  Download,
  ImageIcon,
  Loader2,
  Music4,
  Sparkles,
  Trash2,
  Upload,
  User,
  Video,
} from 'lucide-react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';

import { Link, useRouter } from '@/core/i18n/navigation';
import { AIMediaType, AITaskStatus } from '@/extensions/ai/types';
import { ImageUploader, ImageUploaderValue } from '@/shared/blocks/common';
import {
  getGenerationCreditRewardAmounts,
  useGenerationCreditEarnActions,
} from '@/shared/blocks/generator/credit-earning-actions';
import { GenerationCreditFallbackDialog } from '@/shared/blocks/generator/generation-credit-fallback-dialog';
import { MembershipPriorityQueueCard } from '@/shared/blocks/generator/membership-priority-queue-card';
import {
  PaidDownloadDialog,
  usePaidDownloadGate,
} from '@/shared/blocks/generator/paid-download-dialog';
import { Badge } from '@/shared/components/ui/badge';
import { Button } from '@/shared/components/ui/button';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/shared/components/ui/card';
import { Checkbox } from '@/shared/components/ui/checkbox';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/shared/components/ui/collapsible';
import { Label } from '@/shared/components/ui/label';
import { Progress } from '@/shared/components/ui/progress';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/shared/components/ui/select';
import { Switch } from '@/shared/components/ui/switch';
import { Tabs, TabsList, TabsTrigger } from '@/shared/components/ui/tabs';
import { Textarea } from '@/shared/components/ui/textarea';
import { useAppContext } from '@/shared/contexts/app';
import { useMembershipPriorityQueue } from '@/shared/hooks/use-membership-priority-queue';
import {
  buildGeneratorPromptHref,
  createGenerationCreditFallbackPayload,
  GenerationCreditFallbackPayload,
  IMAGE_STANDARD_FALLBACK_CREDITS,
  isGenerationCreditFallbackPayload,
  VIDEO_CLASSIC_FALLBACK_CREDITS,
} from '@/shared/lib/generation-credit-fallback';
import { md5 } from '@/shared/lib/hash';
import { resolvePriorityQueueWaitRangeMs } from '@/shared/lib/membership-priority-queue-config';
import { calculateSeedanceCredits } from '@/shared/lib/seedance-pricing';
import { shouldUseApimartForSeedance2 } from '@/shared/lib/seedance-provider';
import {
  createSeedancePromptReferenceToken,
  extractSeedancePromptReferenceTokens,
  resolveSeedancePromptReferenceSelection,
} from '@/shared/lib/seedance-reference-prompt';
import {
  exceedsSeedanceReferenceVideoPixelCount,
  getSeedance2BaseGenerationModel,
  getSeedance2CanonicalScene,
  getSeedanceReferenceVideoPixelLimitMessage,
  isSeedance2AssetModel,
  isSeedance2GenerationModel,
  isSeedance15Model,
  normalizeSeedance2Duration,
  normalizeSeedance15Duration,
  normalizeSeedanceAspectRatio,
  parseSeedanceGeneratorPrefill,
  SEEDANCE_2_ALLOWED_ASPECT_RATIOS,
  SEEDANCE_2_APIMART_REFERENCE_VIDEO_MAX_RESOLUTION,
  SEEDANCE_2_APIMART_REFERENCE_VIDEO_MIN_RESOLUTION,
  SEEDANCE_2_FAST_MODEL,
  SEEDANCE_2_MAX_DURATION,
  SEEDANCE_2_MIN_DURATION,
  SEEDANCE_2_MODEL,
  SEEDANCE_2_REFERENCE_AUDIO_MAX_DURATION,
  SEEDANCE_2_REFERENCE_AUDIO_MAX_ITEMS,
  SEEDANCE_2_REFERENCE_AUDIO_MAX_TOTAL_DURATION,
  SEEDANCE_2_REFERENCE_AUDIO_MIN_DURATION,
  SEEDANCE_2_REFERENCE_AUDIO_UPLOAD_MAX_BYTES,
  SEEDANCE_2_REFERENCE_AUDIO_UPLOAD_MIME_TYPES,
  SEEDANCE_2_REFERENCE_IMAGE_MAX_ITEMS,
  SEEDANCE_2_REFERENCE_MAX_TOTAL_ITEMS,
  SEEDANCE_2_REFERENCE_VIDEO_MAX_DURATION,
  SEEDANCE_2_REFERENCE_VIDEO_MAX_ITEMS,
  SEEDANCE_2_REFERENCE_VIDEO_MAX_TOTAL_DURATION,
  SEEDANCE_2_REFERENCE_VIDEO_MIN_DURATION,
  SEEDANCE_2_REFERENCE_VIDEO_UPLOAD_MAX_BYTES,
  SEEDANCE_2_REFERENCE_VIDEO_UPLOAD_MIME_TYPES,
  SEEDANCE_15_ALLOWED_ASPECT_RATIOS,
  SEEDANCE_15_ALLOWED_DURATIONS,
  SEEDANCE_15_MODEL,
  SEEDANCE_GENERATOR_PREFILL_EVENT,
  SEEDANCE_PREFILL_PROMPT_KEY,
  Seedance2Mode,
  Seedance2VideoOptions,
  Seedance15Scene,
  Seedance15VideoOptions,
  SeedanceAssetKind,
  SeedanceAssetStatus,
  SeedanceGeneratorPrefillDetail,
  SeedanceModel,
  SeedancePromptReferenceBinding,
  SeedanceReferenceImageAsset,
  SeedanceTimedReferenceAsset,
  toSeedance2FaceModel,
} from '@/shared/lib/seedance-video';
import { cn } from '@/shared/lib/utils';

interface VideoGeneratorProps {
  id?: string;
  maxSizeMB?: number;
  srOnlyTitle?: string;
  pricingSectionId?: string;
  showDemoPreview?: boolean;
  defaultSeedanceMode?: Seedance2Mode;
}

interface GeneratedVideo {
  id: string;
  url: string;
  provider?: string;
  model?: string;
  prompt?: string;
}

interface GeneratedImage {
  id: string;
  url: string;
  provider?: string;
  model?: string;
  prompt?: string;
}

interface BackendTask {
  id: string;
  status: string;
  provider: string;
  model: string;
  prompt: string | null;
  taskId?: string | null;
  taskInfo: string | null;
  taskResult: string | null;
}

interface PendingVideoGenerationRequest {
  scene: string;
  provider: string;
  model: SeedanceModel;
  prompt: string;
  options: Seedance15VideoOptions | Seedance2VideoOptions;
}

type TimedReferenceKind = 'video' | 'audio';
type TimedReferenceStatus = 'uploading' | 'uploaded' | 'error';
type SeedanceCreatorMode =
  | 'text-to-video'
  | 'image-to-video'
  | 'advanced-reference';

interface TimedReferenceUploadItem {
  id: string;
  name: string;
  kind: TimedReferenceKind;
  status: TimedReferenceStatus;
  size: number;
  promptAlias: string;
  url?: string;
  durationSeconds?: number;
  width?: number;
  height?: number;
  metadataToken?: string;
  assetId?: string;
  assetStatus?: SeedanceAssetStatus;
  assetError?: string;
  error?: string;
}

interface UploadedReferenceResult {
  url: string;
  durationSeconds?: number;
  width?: number;
  height?: number;
  metadataToken?: string;
}

interface TimedReferenceMediaMetadata {
  durationSeconds: number;
  width?: number;
  height?: number;
}

interface ReferenceImageAssetItem extends SeedanceReferenceImageAsset {
  id: string;
  promptAlias: string;
  status: SeedanceAssetStatus;
  error?: string;
}

interface SeedanceAssetResult {
  assetId: string;
  status: string;
  url?: string;
  errorMessage?: string;
}

interface PromptReferenceSuggestion extends SeedancePromptReferenceBinding {
  alias: string;
}

type ModelOptionBadgeTone = 'default' | 'new';

interface ModelOptionBadge {
  label: string;
  tone?: ModelOptionBadgeTone;
}

interface ModelOption {
  value: SeedanceModel;
  label: string;
  description: string;
  tech: string;
  badges?: ModelOptionBadge[];
}

type DemoVideoSource = {
  webm: string;
  mp4?: string;
};

const POLL_INTERVAL = 15000;
const GENERATION_TIMEOUT = 30 * 60 * 1000;
const ASSET_POLL_INTERVAL = 5000;
const ASSET_TIMEOUT = 300000;
const MAX_PROMPT_LENGTH = 2500;
const PROVIDER = 'kie';
const IMAGE_QUEUE_RETURN_HREF = '/models/gpt-image-2#nano-banana-generator';
const VIDEO_QUEUE_RETURN_HREF =
  '/seedance-2-0-video-generator#seedance-generator';
const KLING_QUEUE_RETURN_HREF = '/models/kling-3#kling-3-generator';
const TIMED_REFERENCE_UPLOAD_CONCURRENCY = 2;
const SHOW_VIRTUAL_CHARACTER_MODE_TOGGLE = false;
const DEFAULT_KLING_PREVIEW_VIDEO = homeVideoManifest[0]?.url;
const DEFAULT_DEMO_VIDEOS: readonly DemoVideoSource[] = [
  {
    webm:
      DEFAULT_KLING_PREVIEW_VIDEO ??
      'https://cdn.see-dance2.org/uploads/demo-videos/seedance2-demo-13.webm',
  },
  {
    webm: 'https://cdn.see-dance2.org/uploads/demo-videos/seedance2-demo-7.webm',
    mp4: 'https://cdn.see-dance2.org/uploads/demo-videos/seedance2-demo-7.mp4',
  },
  {
    webm: 'https://cdn.see-dance2.org/uploads/demo-videos/seedance2-demo-18.webm',
    mp4: 'https://cdn.see-dance2.org/uploads/demo-videos/seedance2-demo-18.mp4',
  },
] as const;

function renderModelBadges(badges: ModelOptionBadge[] = []) {
  return badges.map((badge) => (
    <Badge
      key={`${badge.tone ?? 'default'}-${badge.label}`}
      variant="outline"
      className={cn(
        'rounded-full px-2 py-0 text-[10px] leading-5',
        badge.tone === 'new'
          ? 'border-transparent bg-orange-500 font-semibold tracking-[0.04em] text-white'
          : 'border-border/70 bg-background/80 text-muted-foreground font-medium'
      )}
    >
      {badge.label}
    </Badge>
  ));
}

function renderModelOptionLabel(option: Pick<ModelOption, 'label' | 'badges'>) {
  return (
    <div className="flex min-w-0 items-center gap-2">
      <span className="truncate">{option.label}</span>
      {renderModelBadges(option.badges)}
    </div>
  );
}

function LazyDemoVideo({ video }: { video: DemoVideoSource }) {
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const [shouldLoad, setShouldLoad] = useState(false);

  useEffect(() => {
    if (shouldLoad) {
      return;
    }

    const node = wrapperRef.current;
    if (!node) {
      return;
    }

    if (typeof IntersectionObserver === 'undefined') {
      setShouldLoad(true);
      return;
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) {
          return;
        }

        setShouldLoad(true);
        observer.disconnect();
      },
      {
        rootMargin: '200px 0px',
        threshold: 0.2,
      }
    );

    observer.observe(node);

    return () => observer.disconnect();
  }, [shouldLoad]);

  return (
    <div
      ref={wrapperRef}
      className="relative overflow-hidden rounded-lg border bg-black"
    >
      {shouldLoad ? (
        <video
          key={video.webm}
          autoPlay
          controls
          loop
          muted
          playsInline
          preload="none"
          className="h-auto w-full"
        >
          <source src={video.webm} type="video/webm" />
          {video.mp4 ? <source src={video.mp4} type="video/mp4" /> : null}
        </video>
      ) : (
        <div className="flex aspect-video items-center justify-center bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950">
          <div className="flex items-center gap-3 text-white/55">
            <Video className="h-6 w-6" />
            <div className="flex gap-1.5">
              <span className="h-2 w-2 rounded-full bg-white/25" />
              <span className="h-2 w-2 rounded-full bg-white/20" />
              <span className="h-2 w-2 rounded-full bg-white/15" />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function parseTaskPayload(payload: string | null) {
  if (!payload) {
    return null;
  }

  try {
    return JSON.parse(payload);
  } catch (error) {
    console.warn('Failed to parse task payload:', error);
    return null;
  }
}

function getRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }

  return value as Record<string, unknown>;
}

function pushUniqueUrl(target: string[], value: unknown) {
  if (typeof value !== 'string') {
    return;
  }

  const normalized = value.trim();
  if (!normalized || target.includes(normalized)) {
    return;
  }

  target.push(normalized);
}

function extractExplicitUrlValues(
  value: unknown,
  nestedKeys: string[]
): string[] {
  const urls: string[] = [];

  const visit = (item: unknown) => {
    if (!item) {
      return;
    }

    if (typeof item === 'string') {
      pushUniqueUrl(urls, item);
      return;
    }

    if (Array.isArray(item)) {
      item.forEach(visit);
      return;
    }

    const record = getRecord(item);
    if (!record) {
      return;
    }

    nestedKeys.forEach((key) => {
      if (key in record) {
        visit(record[key]);
      }
    });
  };

  visit(value);

  return urls;
}

function getTaskResultContainers(source: unknown) {
  const containers: Record<string, unknown>[] = [];
  const visited = new WeakSet<object>();

  const visit = (value: unknown) => {
    const record = getRecord(value);
    if (!record || visited.has(record)) {
      return;
    }

    visited.add(record);
    containers.push(record);

    ['output', 'data', 'result', 'response'].forEach((key) => {
      visit(record[key]);
    });

    if (Array.isArray(record.outputs)) {
      record.outputs.forEach(visit);
    }
  };

  visit(source);

  const root = getRecord(source);
  const parsedResultJson =
    root && typeof root.resultJson === 'string'
      ? parseTaskPayload(root.resultJson)
      : root?.resultJson;
  visit(parsedResultJson);

  return containers;
}

function collectUrlsFromContainers(
  containers: Record<string, unknown>[],
  keys: string[],
  nestedKeys: string[]
) {
  const urls: string[] = [];

  containers.forEach((container) => {
    keys.forEach((key) => {
      if (!(key in container)) {
        return;
      }

      extractExplicitUrlValues(container[key], nestedKeys).forEach((url) => {
        pushUniqueUrl(urls, url);
      });
    });
  });

  return urls;
}

function extractVideoUrls(source: unknown) {
  if (!source) {
    return [];
  }

  const containers = getTaskResultContainers(source);
  const direct = collectUrlsFromContainers(
    containers,
    ['videos'],
    ['videoUrl', 'video_url', 'url', 'uri', 'src']
  );
  if (direct.length > 0) {
    return direct;
  }

  return collectUrlsFromContainers(
    containers,
    ['video', 'videoUrl', 'video_url', 'videoUrls', 'video_urls', 'resultUrls'],
    ['videoUrl', 'video_url', 'url', 'uri', 'src']
  );
}

function extractImageUrls(source: unknown) {
  if (!source) {
    return [];
  }

  const containers = getTaskResultContainers(source);
  const direct = collectUrlsFromContainers(
    containers,
    ['images'],
    ['imageUrl', 'image_url', 'url', 'uri', 'src']
  );
  if (direct.length > 0) {
    return direct;
  }

  return collectUrlsFromContainers(
    containers,
    [
      'image',
      'imageUrl',
      'image_url',
      'imageUrls',
      'image_urls',
      'lastFrameUrl',
      'last_frame_url',
      'lastFrameUrls',
      'last_frame_urls',
    ],
    ['imageUrl', 'image_url', 'url', 'uri', 'src']
  );
}

function extractPreferredMediaUrls(
  taskInfo: unknown,
  taskResult: unknown,
  extractor: (source: unknown) => string[]
) {
  const preferredUrls = extractor(taskInfo);
  if (preferredUrls.length > 0) {
    return preferredUrls;
  }

  return extractor(taskResult);
}

function extractUploadedImageUrls(items: ImageUploaderValue[]) {
  return items
    .filter((item) => item.status === 'uploaded' && item.url)
    .map((item) => item.url as string);
}

function createId(prefix: string) {
  return `${prefix}-${Math.random().toString(36).slice(2, 9)}`;
}

function formatSeconds(seconds?: number) {
  if (!seconds || !Number.isFinite(seconds)) {
    return '';
  }

  const normalized = seconds >= 10 ? seconds.toFixed(1) : seconds.toFixed(2);
  return `${normalized.replace(/\.0+$/, '')}s`;
}

function getTimedReferenceResolution({
  width,
  height,
}: {
  width?: number;
  height?: number;
}) {
  if (
    typeof width !== 'number' ||
    !Number.isFinite(width) ||
    width <= 0 ||
    typeof height !== 'number' ||
    !Number.isFinite(height) ||
    height <= 0
  ) {
    return null;
  }

  return Math.min(Math.round(width), Math.round(height));
}

function getApimartReferenceVideoLimitMessage({
  name,
  width,
  height,
}: {
  name?: string;
  width?: number;
  height?: number;
}) {
  const resolution = getTimedReferenceResolution({ width, height });
  if (!resolution || !width || !height) {
    return `Please upload a ${SEEDANCE_2_APIMART_REFERENCE_VIDEO_MIN_RESOLUTION}P-${SEEDANCE_2_APIMART_REFERENCE_VIDEO_MAX_RESOLUTION}P reference video.`;
  }

  const label = name?.trim() || 'Reference video';
  return `${label} is ${Math.round(width)}x${Math.round(height)}. Please upload a ${SEEDANCE_2_APIMART_REFERENCE_VIDEO_MIN_RESOLUTION}P-${SEEDANCE_2_APIMART_REFERENCE_VIDEO_MAX_RESOLUTION}P reference video.`;
}

function getApimartReferenceVideoMetadataMessage({ name }: { name?: string }) {
  const label = name?.trim() || 'Reference video';
  return `${label} is missing width or height metadata. Please remove and re-upload the reference video.`;
}

function summarizeTimedReferenceMetadata(
  metadata?: Partial<TimedReferenceMediaMetadata> | null
) {
  return {
    durationSeconds:
      typeof metadata?.durationSeconds === 'number' &&
      Number.isFinite(metadata.durationSeconds)
        ? metadata.durationSeconds
        : undefined,
    width:
      typeof metadata?.width === 'number' && Number.isFinite(metadata.width)
        ? metadata.width
        : undefined,
    height:
      typeof metadata?.height === 'number' && Number.isFinite(metadata.height)
        ? metadata.height
        : undefined,
  };
}

function summarizeUploadedReferenceResult(
  uploaded?: UploadedReferenceResult | null
) {
  return {
    url: uploaded?.url,
    ...summarizeTimedReferenceMetadata(uploaded),
    hasMetadataToken: Boolean(uploaded?.metadataToken),
    metadataTokenLength: uploaded?.metadataToken?.length,
  };
}

function summarizeTimedReferenceAssets(
  items?: SeedanceTimedReferenceAsset[] | null
) {
  if (!Array.isArray(items)) {
    return [];
  }

  return items.map((item) => ({
    name: item.name,
    url: item.url,
    assetId: item.assetId,
    ...summarizeTimedReferenceMetadata(item),
    hasMetadataToken: Boolean(item.metadataToken),
    metadataTokenLength: item.metadataToken?.length,
  }));
}

function getFileNameFromUrl(url: string, fallback: string) {
  try {
    const pathname = new URL(url).pathname;
    const name = pathname.split('/').filter(Boolean).pop();
    return name || fallback;
  } catch {
    return url.split('/').filter(Boolean).pop() || fallback;
  }
}

function getFileExtension(url: string, fallback: string) {
  try {
    const pathname = new URL(url).pathname;
    const match = pathname.match(/\.([a-zA-Z0-9]+)$/);
    return match?.[1] || fallback;
  } catch {
    const match = url.match(/\.([a-zA-Z0-9]+)(\?|#|$)/);
    return match?.[1] || fallback;
  }
}

function normalizeReferenceUploadMimeType(
  file: File,
  kind: TimedReferenceKind
) {
  const normalizedType = file.type.trim().toLowerCase();
  const acceptedMimeTypes =
    kind === 'video'
      ? SEEDANCE_2_REFERENCE_VIDEO_UPLOAD_MIME_TYPES
      : SEEDANCE_2_REFERENCE_AUDIO_UPLOAD_MIME_TYPES;

  if ((acceptedMimeTypes as readonly string[]).includes(normalizedType)) {
    return normalizedType;
  }

  const ext = file.name.split('.').pop()?.trim().toLowerCase();
  if (kind === 'video') {
    if (ext === 'mp4') {
      return 'video/mp4';
    }
    if (ext === 'mov') {
      return 'video/quicktime';
    }
    return '';
  }

  if (ext === 'mp3') {
    return 'audio/mpeg';
  }
  if (ext === 'wav') {
    return 'audio/wav';
  }

  return '';
}

async function uploadFileToEndpoint(
  file: File,
  endpoint: string,
  metadata?: TimedReferenceMediaMetadata
): Promise<UploadedReferenceResult> {
  const formData = new FormData();
  formData.append('files', file);
  if (
    typeof metadata?.durationSeconds === 'number' &&
    Number.isFinite(metadata.durationSeconds)
  ) {
    formData.append('duration_seconds', String(metadata.durationSeconds));
  }
  if (typeof metadata?.width === 'number' && Number.isFinite(metadata.width)) {
    formData.append('width', String(Math.round(metadata.width)));
  }
  if (
    typeof metadata?.height === 'number' &&
    Number.isFinite(metadata.height)
  ) {
    formData.append('height', String(Math.round(metadata.height)));
  }

  const response = await fetch(endpoint, {
    method: 'POST',
    body: formData,
  });

  if (!response.ok) {
    let errorMessage = `Upload failed with status ${response.status}`;
    try {
      const errorText = await response.text();
      if (errorText) {
        const parsed = JSON.parse(errorText);
        if (typeof parsed?.message === 'string' && parsed.message.trim()) {
          errorMessage = parsed.message.trim();
        }
      }
    } catch {
      // keep the status-based message when the response body isn't JSON.
    }

    throw new Error(errorMessage);
  }

  const result = await response.json();
  if (result.code !== 0 || !result.data?.urls?.length) {
    throw new Error(result.message || 'Upload failed');
  }

  const uploadedResult = result.data?.results?.[0];
  if (uploadedResult && typeof uploadedResult.url === 'string') {
    return {
      url: uploadedResult.url,
      durationSeconds:
        typeof uploadedResult.durationSeconds === 'number'
          ? uploadedResult.durationSeconds
          : undefined,
      width:
        typeof uploadedResult.width === 'number'
          ? uploadedResult.width
          : undefined,
      height:
        typeof uploadedResult.height === 'number'
          ? uploadedResult.height
          : undefined,
      metadataToken:
        typeof uploadedResult.metadataToken === 'string'
          ? uploadedResult.metadataToken
          : undefined,
    };
  }

  return {
    url: result.data.urls[0] as string,
  };
}

async function uploadTimedReferenceFile(
  file: File,
  kind: TimedReferenceKind,
  metadata?: TimedReferenceMediaMetadata
): Promise<UploadedReferenceResult> {
  const fallbackEndpoint =
    kind === 'video'
      ? '/api/storage/upload-video'
      : '/api/storage/upload-audio';
  console.info('[seedance.reference-upload] start', {
    kind,
    fileName: file.name,
    size: file.size,
    durationSeconds: metadata?.durationSeconds,
    width: metadata?.width,
    height: metadata?.height,
  });

  console.info('[seedance.reference-upload] api-relay-start', {
    kind,
    fileName: file.name,
    endpoint: fallbackEndpoint,
    durationSeconds: metadata?.durationSeconds,
    width: metadata?.width,
    height: metadata?.height,
  });
  const relayResult = await uploadFileToEndpoint(
    file,
    fallbackEndpoint,
    metadata
  );
  console.info('[seedance.reference-upload] api-relay-success', {
    kind,
    fileName: file.name,
    url: relayResult.url,
    durationSeconds: relayResult.durationSeconds,
    width: relayResult.width,
    height: relayResult.height,
    hasMetadataToken: Boolean(relayResult.metadataToken),
  });
  return relayResult;
}

async function getTimedReferenceMetadata(
  file: File,
  kind: TimedReferenceKind
): Promise<TimedReferenceMediaMetadata> {
  return new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file);
    const media = document.createElement(kind === 'video' ? 'video' : 'audio');

    const cleanup = () => {
      media.onloadedmetadata = null;
      media.onerror = null;
      media.removeAttribute('src');
      media.load();
      URL.revokeObjectURL(objectUrl);
    };

    media.preload = 'metadata';
    media.onloadedmetadata = () => {
      const duration = media.duration;
      if (kind === 'video') {
        const video = media as HTMLVideoElement;
        const width =
          Number.isFinite(video.videoWidth) && video.videoWidth > 0
            ? video.videoWidth
            : undefined;
        const height =
          Number.isFinite(video.videoHeight) && video.videoHeight > 0
            ? video.videoHeight
            : undefined;

        console.info('[seedance.reference-metadata] parsed', {
          kind,
          fileName: file.name,
          size: file.size,
          ...summarizeTimedReferenceMetadata({
            durationSeconds: duration,
            width,
            height,
          }),
          readyState: media.readyState,
          networkState: media.networkState,
        });

        cleanup();

        if (!Number.isFinite(duration) || duration <= 0) {
          console.warn('[seedance.reference-metadata] invalid-duration', {
            kind,
            fileName: file.name,
            size: file.size,
            ...summarizeTimedReferenceMetadata({
              durationSeconds: duration,
              width,
              height,
            }),
          });
          reject(new Error('failed to parse media duration'));
          return;
        }

        resolve({
          durationSeconds: duration,
          width,
          height,
        });
        return;
      }

      console.info('[seedance.reference-metadata] parsed', {
        kind,
        fileName: file.name,
        size: file.size,
        ...summarizeTimedReferenceMetadata({
          durationSeconds: duration,
        }),
        readyState: media.readyState,
        networkState: media.networkState,
      });

      cleanup();

      if (!Number.isFinite(duration) || duration <= 0) {
        console.warn('[seedance.reference-metadata] invalid-duration', {
          kind,
          fileName: file.name,
          size: file.size,
          ...summarizeTimedReferenceMetadata({
            durationSeconds: duration,
          }),
        });
        reject(new Error('failed to parse media duration'));
        return;
      }

      resolve({
        durationSeconds: duration,
      });
    };
    media.onerror = () => {
      console.warn('[seedance.reference-metadata] error', {
        kind,
        fileName: file.name,
        size: file.size,
        currentSrc: media.currentSrc || undefined,
        readyState: media.readyState,
        networkState: media.networkState,
      });
      cleanup();
      reject(new Error('failed to parse media duration'));
    };
    media.src = objectUrl;
  });
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  if (items.length === 0) {
    return [];
  }

  const results = new Array<R>(items.length);
  let nextIndex = 0;
  const workerCount = Math.min(Math.max(concurrency, 1), items.length);

  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (true) {
        const currentIndex = nextIndex;
        nextIndex += 1;

        if (currentIndex >= items.length) {
          return;
        }

        results[currentIndex] = await worker(items[currentIndex], currentIndex);
      }
    })
  );

  return results;
}

async function createSeedanceAssetRequest({
  kind,
  url,
}: {
  kind: SeedanceAssetKind;
  url: string;
}): Promise<SeedanceAssetResult> {
  const response = await fetch('/api/ai/seedance/assets', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      kind,
      url,
    }),
  });

  if (!response.ok) {
    throw new Error(`Asset request failed with status ${response.status}`);
  }

  const result = await response.json();
  if (result.code !== 0 || !result.data?.assetId) {
    throw new Error(result.message || 'Asset request failed');
  }

  return result.data as SeedanceAssetResult;
}

async function querySeedanceAssetRequest(
  assetId: string
): Promise<SeedanceAssetResult> {
  const response = await fetch(
    `/api/ai/seedance/assets/${encodeURIComponent(assetId)}`
  );

  if (!response.ok) {
    throw new Error(`Asset query failed with status ${response.status}`);
  }

  const result = await response.json();
  if (result.code !== 0 || !result.data?.assetId) {
    throw new Error(result.message || 'Asset query failed');
  }

  return result.data as SeedanceAssetResult;
}

async function waitForSeedanceAssetReady(assetId: string) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < ASSET_TIMEOUT) {
    const result = await querySeedanceAssetRequest(assetId);

    if (result.status === 'Active') {
      return result;
    }

    if (result.status === 'Failed') {
      throw new Error(result.errorMessage || 'Asset processing failed');
    }

    await new Promise((resolve) =>
      window.setTimeout(resolve, ASSET_POLL_INTERVAL)
    );
  }

  throw new Error('Asset processing timed out');
}

export function VideoGenerator({
  id,
  maxSizeMB = 30,
  srOnlyTitle,
  pricingSectionId = 'pricing',
  showDemoPreview = true,
  defaultSeedanceMode = 'text',
}: VideoGeneratorProps) {
  const t = useTranslations('ai.video.generator');
  const router = useRouter();
  const searchParams = useSearchParams();
  const hasPrefilledRef = useRef(false);
  const activeImageAssetRequestsRef = useRef<Set<string>>(new Set());
  const activeTimedAssetRequestsRef = useRef<Set<string>>(new Set());
  const nextPromptReferenceIndexRef = useRef<Record<SeedanceAssetKind, number>>(
    {
      image: 1,
      video: 1,
      audio: 1,
    }
  );
  const promptTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const pendingGenerateRequestRef =
    useRef<PendingVideoGenerationRequest | null>(null);
  const generateAudioPreferenceRef = useRef({
    legacy: false,
    seedance2: true,
  });
  const previousIsLegacyModelRef = useRef(false);

  const [model, setModel] = useState<SeedanceModel>(SEEDANCE_2_MODEL);
  const [legacyScene, setLegacyScene] =
    useState<Seedance15Scene>('text-to-video');
  const [seedanceMode, setSeedanceMode] =
    useState<Seedance2Mode>(defaultSeedanceMode);
  const [prompt, setPrompt] = useState('');
  const [promptSelectionStart, setPromptSelectionStart] = useState(0);

  const [legacyImageItems, setLegacyImageItems] = useState<
    ImageUploaderValue[]
  >([]);
  const [legacyImageUrls, setLegacyImageUrls] = useState<string[]>([]);

  const [firstFrameItems, setFirstFrameItems] = useState<ImageUploaderValue[]>(
    []
  );
  const [firstFrameUrls, setFirstFrameUrls] = useState<string[]>([]);

  const [useEndFrameControl, setUseEndFrameControl] = useState(false);
  const [lastFrameItems, setLastFrameItems] = useState<ImageUploaderValue[]>(
    []
  );
  const [lastFrameUrls, setLastFrameUrls] = useState<string[]>([]);

  const [referenceImageItems, setReferenceImageItems] = useState<
    ImageUploaderValue[]
  >([]);
  const [referenceImageUrls, setReferenceImageUrls] = useState<string[]>([]);
  const [referenceImageAssets, setReferenceImageAssets] = useState<
    ReferenceImageAssetItem[]
  >([]);

  const [referenceVideoItems, setReferenceVideoItems] = useState<
    TimedReferenceUploadItem[]
  >([]);
  const [referenceAudioItems, setReferenceAudioItems] = useState<
    TimedReferenceUploadItem[]
  >([]);
  const [hasApimartProvider, setHasApimartProvider] = useState(false);
  const [realPersonMode, setRealPersonMode] = useState(false);
  const [useVirtualCharacterMode, setUseVirtualCharacterMode] = useState(false);

  const [aspectRatio, setAspectRatio] = useState('16:9');
  const [resolution, setResolution] = useState('480p');
  const [duration, setDuration] = useState('4');
  const [fixedLens, setFixedLens] = useState(false);
  const [generateAudio, setGenerateAudio] = useState(
    generateAudioPreferenceRef.current.seedance2
  );
  const [webSearch, setWebSearch] = useState(false);
  const [selectedDemoVideoIndex, setSelectedDemoVideoIndex] = useState(0);

  const [generatedVideos, setGeneratedVideos] = useState<GeneratedVideo[]>([]);
  const [generatedImages, setGeneratedImages] = useState<GeneratedImage[]>([]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [progress, setProgress] = useState(0);
  const [taskId, setTaskId] = useState<string | null>(null);
  const [providerTaskId, setProviderTaskId] = useState<string | null>(null);
  const [generationStartTime, setGenerationStartTime] = useState<number | null>(
    null
  );
  const [taskStatus, setTaskStatus] = useState<AITaskStatus | null>(null);
  const [generationError, setGenerationError] = useState<string | null>(null);
  const [downloadingAssetId, setDownloadingAssetId] = useState<string | null>(
    null
  );
  const { canDownload, paidDownloadDialogProps } = usePaidDownloadGate();
  const [isMounted, setIsMounted] = useState(false);
  const pollAttemptRef = useRef(0);
  const [creditFallback, setCreditFallback] =
    useState<GenerationCreditFallbackPayload | null>(null);

  const {
    user,
    isCheckSign,
    setIsShowSignModal,
    fetchUserCredits,
    configs,
    hasFetchedConfigs,
    currentSubscription,
    hasPaidEntitlement,
    hasFetchedCurrentSubscription,
    isFetchingCurrentSubscription,
    fetchCurrentSubscription,
  } = useAppContext();

  const allocatePromptAlias = useCallback((kind: SeedanceAssetKind) => {
    const nextIndex = nextPromptReferenceIndexRef.current[kind];
    nextPromptReferenceIndexRef.current[kind] += 1;

    return createSeedancePromptReferenceToken({
      kind,
      index: nextIndex,
    }).slice(1);
  }, []);

  const isLegacyModel = isSeedance15Model(model);
  const isSeedance2xModel = isSeedance2GenerationModel(model);
  const canUseRealPersonMode = isSeedance2xModel && hasApimartProvider;
  const isModelSelectorVisible =
    configs.seedance_model_selector_enabled === 'true';
  const selectedDemoVideo =
    DEFAULT_DEMO_VIDEOS[selectedDemoVideoIndex] ?? DEFAULT_DEMO_VIDEOS[0];
  const promptLength = prompt.trim().length;
  const remainingCredits = user?.credits?.remainingCredits ?? 0;
  const isPromptTooLong = promptLength > MAX_PROMPT_LENGTH;
  const videoQueueWaitRangeMs = useMemo(
    () =>
      resolvePriorityQueueWaitRangeMs({
        configs,
        mediaType: 'video',
      }),
    [
      configs.video_generation_queue_wait_max_minutes,
      configs.video_generation_queue_wait_min_minutes,
    ]
  );
  const firstFrameUrl = firstFrameUrls[0] || '';
  const lastFrameUrl = lastFrameUrls[0] || '';
  const currentCreatorMode = useMemo<SeedanceCreatorMode>(() => {
    if (isLegacyModel) {
      return legacyScene;
    }

    if (seedanceMode === 'text') {
      return 'text-to-video';
    }

    if (seedanceMode === 'multimodal-reference') {
      return 'advanced-reference';
    }

    return 'image-to-video';
  }, [isLegacyModel, legacyScene, seedanceMode]);
  const canUseWebSearch = isSeedance2xModel && seedanceMode === 'text';
  const effectiveModel = useMemo<SeedanceModel>(() => {
    if (!canUseRealPersonMode || !realPersonMode) {
      return model;
    }

    return toSeedance2FaceModel(model) ?? model;
  }, [canUseRealPersonMode, model, realPersonMode]);
  const usesApimartSeedanceRuntime = shouldUseApimartForSeedance2({
    model: effectiveModel,
    configs,
  });
  const shouldUseAssetReferences =
    isSeedance2xModel &&
    currentCreatorMode === 'advanced-reference' &&
    useVirtualCharacterMode;
  const apimartReferenceVideoNotice = useMemo(() => {
    if (!usesApimartSeedanceRuntime) {
      return null;
    }

    if (realPersonMode) {
      return t.has('form.apimart_real_person_reference_video_notice')
        ? t('form.apimart_real_person_reference_video_notice')
        : "Supports real-person references. Make sure you have permission to use the uploaded person's likeness.";
    }

    return t.has('form.apimart_reference_video_notice')
      ? t('form.apimart_reference_video_notice')
      : 'Use a 480P ~ 720P reference video. Enable Real Person Mode when your reference includes a real person.';
  }, [realPersonMode, t, usesApimartSeedanceRuntime]);

  useEffect(() => {
    if (!hasFetchedConfigs) {
      return;
    }

    let cancelled = false;

    const fetchAvailableProviders = async () => {
      try {
        const resp = await fetch('/api/ai/providers');
        if (!resp.ok) {
          throw new Error(`fetch failed with status: ${resp.status}`);
        }

        const { code, data } = await resp.json();
        if (code !== 0) {
          throw new Error('Failed to fetch AI providers');
        }

        if (!cancelled) {
          setHasApimartProvider(
            Array.isArray(data?.providers) && data.providers.includes('apimart')
          );
        }
      } catch (error) {
        if (!cancelled) {
          setHasApimartProvider(false);
        }

        if (process.env.NODE_ENV !== 'production') {
          console.warn('fetch ai providers failed:', error);
        }
      }
    };

    void fetchAvailableProviders();

    return () => {
      cancelled = true;
    };
  }, [hasFetchedConfigs]);

  useEffect(() => {
    if (previousIsLegacyModelRef.current === isLegacyModel) {
      return;
    }

    previousIsLegacyModelRef.current = isLegacyModel;
    setGenerateAudio(
      isLegacyModel
        ? generateAudioPreferenceRef.current.legacy
        : generateAudioPreferenceRef.current.seedance2
    );
  }, [isLegacyModel]);

  const handleGenerateAudioChange = useCallback(
    (checked: boolean) => {
      if (isLegacyModel) {
        generateAudioPreferenceRef.current.legacy = checked;
      } else {
        generateAudioPreferenceRef.current.seedance2 = checked;
      }

      setGenerateAudio(checked);
    },
    [isLegacyModel]
  );

  const referenceVideos = useMemo(
    () =>
      referenceVideoItems
        .filter(
          (item) =>
            item.status === 'uploaded' &&
            item.url &&
            typeof item.durationSeconds === 'number' &&
            typeof item.metadataToken === 'string'
        )
        .map(
          (item) =>
            ({
              url: item.url as string,
              durationSeconds: item.durationSeconds as number,
              width: item.width,
              height: item.height,
              name: item.name,
              metadataToken: item.metadataToken,
              assetId: item.assetId,
              promptAlias: item.promptAlias,
            }) satisfies SeedanceTimedReferenceAsset
        ),
    [referenceVideoItems]
  );

  const referenceAudios = useMemo(
    () =>
      referenceAudioItems
        .filter(
          (item) =>
            item.status === 'uploaded' &&
            item.url &&
            typeof item.durationSeconds === 'number' &&
            typeof item.metadataToken === 'string'
        )
        .map(
          (item) =>
            ({
              url: item.url as string,
              durationSeconds: item.durationSeconds as number,
              name: item.name,
              metadataToken: item.metadataToken,
              assetId: item.assetId,
              promptAlias: item.promptAlias,
            }) satisfies SeedanceTimedReferenceAsset
        ),
    [referenceAudioItems]
  );

  const availablePromptReferences = useMemo<PromptReferenceSuggestion[]>(() => {
    if (!isSeedance2xModel || seedanceMode !== 'multimodal-reference') {
      return [];
    }

    const suggestions: PromptReferenceSuggestion[] = [];

    referenceImageAssets.forEach((item) => {
      const target =
        shouldUseAssetReferences && item.assetId ? item.assetId : item.url;
      const isReady = shouldUseAssetReferences
        ? item.status === 'active' && Boolean(item.assetId)
        : Boolean(item.url);

      if (!isReady || !target) {
        return;
      }

      suggestions.push({
        token: `@${item.promptAlias}`,
        alias: item.promptAlias,
        kind: 'image',
        target,
        label: getFileNameFromUrl(item.url, item.promptAlias),
      });
    });

    referenceVideoItems.forEach((item) => {
      const target =
        shouldUseAssetReferences && item.assetId ? item.assetId : item.url;
      const isReady =
        item.status === 'uploaded' &&
        Boolean(item.metadataToken) &&
        (shouldUseAssetReferences
          ? item.assetStatus === 'active' && Boolean(item.assetId)
          : Boolean(item.url));

      if (!isReady || !target) {
        return;
      }

      suggestions.push({
        token: `@${item.promptAlias}`,
        alias: item.promptAlias,
        kind: 'video',
        target,
        label: item.name,
      });
    });

    referenceAudioItems.forEach((item) => {
      const target =
        shouldUseAssetReferences && item.assetId ? item.assetId : item.url;
      const isReady =
        item.status === 'uploaded' &&
        Boolean(item.metadataToken) &&
        (shouldUseAssetReferences
          ? item.assetStatus === 'active' && Boolean(item.assetId)
          : Boolean(item.url));

      if (!isReady || !target) {
        return;
      }

      suggestions.push({
        token: `@${item.promptAlias}`,
        alias: item.promptAlias,
        kind: 'audio',
        target,
        label: item.name,
      });
    });

    return suggestions;
  }, [
    isSeedance2xModel,
    referenceAudioItems,
    referenceImageAssets,
    referenceVideoItems,
    seedanceMode,
    shouldUseAssetReferences,
  ]);

  const referenceImageAssetIds = useMemo(
    () =>
      referenceImageAssets
        .filter((item) => item.status === 'active' && item.assetId)
        .map((item) => item.assetId as string),
    [referenceImageAssets]
  );

  const activeImageUploadItems = useMemo(() => {
    if (isLegacyModel) {
      return legacyImageItems;
    }

    if (currentCreatorMode === 'image-to-video') {
      return [...firstFrameItems, ...lastFrameItems];
    }

    if (currentCreatorMode === 'advanced-reference') {
      return referenceImageItems;
    }

    return [];
  }, [
    currentCreatorMode,
    firstFrameItems,
    isLegacyModel,
    lastFrameItems,
    legacyImageItems,
    referenceImageItems,
  ]);

  const activeTimedUploadItems = useMemo(() => {
    if (!isSeedance2xModel || currentCreatorMode !== 'advanced-reference') {
      return [];
    }

    return [...referenceVideoItems, ...referenceAudioItems];
  }, [
    currentCreatorMode,
    isSeedance2xModel,
    referenceAudioItems,
    referenceVideoItems,
  ]);

  const hasImageUploadError = useMemo(
    () => activeImageUploadItems.some((item) => item.status === 'error'),
    [activeImageUploadItems]
  );

  const isImageUploading = useMemo(
    () => activeImageUploadItems.some((item) => item.status === 'uploading'),
    [activeImageUploadItems]
  );

  const hasTimedUploadError = useMemo(
    () => activeTimedUploadItems.some((item) => item.status === 'error'),
    [activeTimedUploadItems]
  );

  const isTimedUploading = useMemo(
    () => activeTimedUploadItems.some((item) => item.status === 'uploading'),
    [activeTimedUploadItems]
  );

  const isReferenceUploading = isImageUploading || isTimedUploading;
  const hasReferenceUploadError = hasImageUploadError || hasTimedUploadError;
  const hasReferenceAssetsProcessing = useMemo(
    () =>
      shouldUseAssetReferences && seedanceMode === 'multimodal-reference'
        ? referenceImageAssets.some(
            (item) => item.status === 'idle' || item.status === 'processing'
          ) ||
          referenceVideoItems.some(
            (item) =>
              item.status === 'uploaded' &&
              !item.assetId &&
              item.assetStatus !== 'failed'
          ) ||
          referenceAudioItems.some(
            (item) =>
              item.status === 'uploaded' &&
              !item.assetId &&
              item.assetStatus !== 'failed'
          )
        : false,
    [
      shouldUseAssetReferences,
      referenceAudioItems,
      referenceImageAssets,
      referenceVideoItems,
      seedanceMode,
    ]
  );
  const hasReferenceAssetError = useMemo(
    () =>
      shouldUseAssetReferences &&
      (referenceImageAssets.some((item) => item.status === 'failed') ||
        referenceVideoItems.some((item) => item.assetStatus === 'failed') ||
        referenceAudioItems.some((item) => item.assetStatus === 'failed')),
    [
      shouldUseAssetReferences,
      referenceAudioItems,
      referenceImageAssets,
      referenceVideoItems,
    ]
  );

  const currentPromptReferenceBindings = useMemo<
    SeedancePromptReferenceBinding[]
  >(
    () =>
      availablePromptReferences.map((item) => ({
        token: item.token,
        kind: item.kind,
        target: item.target,
        label: item.label,
      })),
    [availablePromptReferences]
  );

  const activePromptReferenceQuery = useMemo(() => {
    if (
      !isSeedance2xModel ||
      seedanceMode !== 'multimodal-reference' ||
      availablePromptReferences.length === 0
    ) {
      return null;
    }

    const cursor = Math.min(promptSelectionStart, prompt.length);
    const beforeCursor = prompt.slice(0, cursor);
    const match = beforeCursor.match(/(^|\s)@([A-Za-z0-9]*)$/);

    if (!match) {
      return null;
    }

    const query = match[2] || '';
    return {
      query,
      start: cursor - query.length - 1,
      end: cursor,
    };
  }, [
    availablePromptReferences.length,
    isSeedance2xModel,
    prompt,
    promptSelectionStart,
    seedanceMode,
  ]);

  const filteredPromptReferenceSuggestions = useMemo(() => {
    if (!activePromptReferenceQuery) {
      return [];
    }

    const query = activePromptReferenceQuery.query.trim().toLowerCase();
    return availablePromptReferences.filter((item) =>
      item.alias.toLowerCase().startsWith(query)
    );
  }, [activePromptReferenceQuery, availablePromptReferences]);

  const promptReferenceTokens = useMemo(
    () => extractSeedancePromptReferenceTokens(prompt),
    [prompt]
  );

  const maxReferenceImagesAllowed = useMemo(
    () =>
      Math.max(
        0,
        Math.min(
          SEEDANCE_2_REFERENCE_IMAGE_MAX_ITEMS,
          SEEDANCE_2_REFERENCE_MAX_TOTAL_ITEMS -
            referenceVideoItems.length -
            referenceAudioItems.length
        )
      ),
    [referenceAudioItems.length, referenceVideoItems.length]
  );

  const resolvedPromptReferenceSelection = useMemo(
    () =>
      resolveSeedancePromptReferenceSelection({
        prompt,
        bindings: currentPromptReferenceBindings,
        referenceImageUrls: shouldUseAssetReferences
          ? referenceImageAssetIds
          : referenceImageUrls,
        referenceVideos,
        referenceAudios,
      }),
    [
      currentPromptReferenceBindings,
      prompt,
      referenceAudios,
      referenceImageAssetIds,
      referenceImageUrls,
      referenceVideos,
      shouldUseAssetReferences,
    ]
  );

  const selectedReferenceVideoDuration = useMemo(
    () =>
      resolvedPromptReferenceSelection.referenceVideos.reduce((sum, item) => {
        return Number.isFinite(item.durationSeconds)
          ? sum + item.durationSeconds
          : sum;
      }, 0),
    [resolvedPromptReferenceSelection.referenceVideos]
  );

  const selectedReferenceAudioDuration = useMemo(
    () =>
      resolvedPromptReferenceSelection.referenceAudios.reduce((sum, item) => {
        return Number.isFinite(item.durationSeconds)
          ? sum + item.durationSeconds
          : sum;
      }, 0),
    [resolvedPromptReferenceSelection.referenceAudios]
  );

  const currentScene = useMemo(() => {
    if (isLegacyModel) {
      return legacyScene;
    }

    return getSeedance2CanonicalScene({
      mode: seedanceMode,
      hasReferenceImages:
        resolvedPromptReferenceSelection.referenceImageUrls.length > 0,
    });
  }, [
    isLegacyModel,
    legacyScene,
    resolvedPromptReferenceSelection.referenceImageUrls.length,
    seedanceMode,
  ]);

  const currentOptions = useMemo<
    Seedance15VideoOptions | Seedance2VideoOptions
  >(() => {
    if (isLegacyModel) {
      const options: Seedance15VideoOptions = {
        aspect_ratio: aspectRatio,
        resolution,
        duration,
        fixed_lens: fixedLens,
        generate_audio: generateAudio,
      };

      if (legacyScene === 'image-to-video') {
        options.image_input = legacyImageUrls;
      }

      return options;
    }

    const options: Seedance2VideoOptions = {
      seedance_mode: seedanceMode,
      resolution,
      duration: Number(duration),
      aspect_ratio: aspectRatio,
      generate_audio: generateAudio,
      web_search: canUseWebSearch ? webSearch : false,
    };

    if (seedanceMode === 'first-frame' || seedanceMode === 'first-last-frame') {
      options.first_frame_url = firstFrameUrl;
    }
    if (seedanceMode === 'first-last-frame') {
      options.last_frame_url = lastFrameUrl;
    }
    if (seedanceMode === 'multimodal-reference') {
      options.reference_image_urls =
        resolvedPromptReferenceSelection.referenceImageUrls;
      options.reference_videos =
        resolvedPromptReferenceSelection.referenceVideos;
      options.reference_audios =
        resolvedPromptReferenceSelection.referenceAudios;
      options.prompt_reference_bindings =
        resolvedPromptReferenceSelection.activeBindings;
    }

    return options;
  }, [
    aspectRatio,
    duration,
    firstFrameUrl,
    fixedLens,
    generateAudio,
    isLegacyModel,
    lastFrameUrl,
    legacyImageUrls,
    legacyScene,
    resolvedPromptReferenceSelection,
    resolution,
    seedanceMode,
    canUseWebSearch,
    webSearch,
  ]);

  const generationErrorResetSignature = useMemo(
    () =>
      JSON.stringify({
        prompt,
        model: effectiveModel,
        currentScene,
        currentOptions,
        legacyImageItems: legacyImageItems.map((item) => ({
          id: item.id,
          status: item.status,
          url: item.url,
        })),
        firstFrameItems: firstFrameItems.map((item) => ({
          id: item.id,
          status: item.status,
          url: item.url,
        })),
        lastFrameItems: lastFrameItems.map((item) => ({
          id: item.id,
          status: item.status,
          url: item.url,
        })),
        referenceImageItems: referenceImageItems.map((item) => ({
          id: item.id,
          status: item.status,
          url: item.url,
        })),
        referenceVideoItems: referenceVideoItems.map((item) => ({
          id: item.id,
          status: item.status,
          url: item.url,
          error: item.error,
          assetId: item.assetId,
          assetStatus: item.assetStatus,
          assetError: item.assetError,
        })),
        referenceAudioItems: referenceAudioItems.map((item) => ({
          id: item.id,
          status: item.status,
          url: item.url,
          error: item.error,
          assetId: item.assetId,
          assetStatus: item.assetStatus,
          assetError: item.assetError,
        })),
      }),
    [
      currentOptions,
      currentScene,
      effectiveModel,
      firstFrameItems,
      lastFrameItems,
      legacyImageItems,
      prompt,
      referenceAudioItems,
      referenceImageItems,
      referenceVideoItems,
    ]
  );

  const promptPlaceholder = useMemo(() => {
    if (
      isSeedance2xModel &&
      seedanceMode === 'multimodal-reference' &&
      t.has('form.prompt_placeholder_multimodal')
    ) {
      return t('form.prompt_placeholder_multimodal');
    }

    return t('form.prompt_placeholder');
  }, [isSeedance2xModel, seedanceMode, t]);

  const costCredits = useMemo(() => {
    return calculateSeedanceCredits({
      model: effectiveModel,
      scene: currentScene,
      options: currentOptions,
    });
  }, [currentOptions, currentScene, effectiveModel]);
  const hasQueueBypassAccess = Boolean(
    currentSubscription || hasPaidEntitlement
  );
  const showCreditsCost = hasFetchedCurrentSubscription && hasQueueBypassAccess;
  const queueCopy = useMemo(
    () => ({
      title: t.has('queue.title') ? t('queue.title') : 'Standard Queue',
      description: t.has('queue.description')
        ? t('queue.description')
        : 'Non-member video tasks are currently in the standard queue. Members can start generating sooner.',
      taskLabel: t.has('queue.task_label')
        ? t('queue.task_label')
        : 'Video generation',
      remainingLabel: t.has('queue.remaining_label')
        ? t('queue.remaining_label')
        : 'Time left',
      upgradeLabel: t.has('queue.upgrade')
        ? t('queue.upgrade')
        : 'Upgrade to Membership',
      cancelLabel: t.has('queue.cancel') ? t('queue.cancel') : 'Cancel Queue',
      retryLabel: t.has('queue.retry') ? t('queue.retry') : 'Retry Now',
      submittingLabel: t.has('queue.submitting')
        ? t('queue.submitting')
        : 'Starting your real generation...',
      submitFailedLabel: t.has('queue.submit_failed')
        ? t('queue.submit_failed')
        : 'We could not start your generation just now. You can retry without losing your place.',
      waitingButtonLabel: t.has('queue.button_waiting')
        ? t('queue.button_waiting')
        : 'Waiting in Queue...',
      membershipCheckingLabel: t.has('queue.membership_checking')
        ? t('queue.membership_checking')
        : 'Checking membership status. Please try again in a moment.',
    }),
    [t]
  );
  const creditFallbackCopy = useMemo(
    () => ({
      title: t.has('credit_fallback.title')
        ? t('credit_fallback.title')
        : 'Current mode needs more credits',
      description: t.has('credit_fallback.description')
        ? t('credit_fallback.description', {
            requested: creditFallback?.requestedCostCredits ?? costCredits,
            remaining: creditFallback?.remainingCredits ?? remainingCredits,
          })
        : `This generation needs ${
            creditFallback?.requestedCostCredits ?? costCredits
          } credits, while your balance is ${
            creditFallback?.remainingCredits ?? remainingCredits
          }. You can switch to a lower-cost mode and keep creating, or add more credits to stay on the current mode.`,
      currentModeLabel: t.has('credit_fallback.current_mode')
        ? t('credit_fallback.current_mode')
        : 'Current mode',
      remainingCreditsLabel: t.has('credit_fallback.remaining_credits')
        ? t('credit_fallback.remaining_credits')
        : 'Current balance',
      switchLabel: t.has('credit_fallback.switch')
        ? t('credit_fallback.switch')
        : 'Switch and Continue',
      upgradeLabel: t.has('credit_fallback.buy_credits')
        ? t('credit_fallback.buy_credits')
        : t('buy_credits'),
      closeLabel: t.has('credit_fallback.close')
        ? t('credit_fallback.close')
        : 'Not now',
      standardBadge: t.has('credit_fallback.standard_badge')
        ? t('credit_fallback.standard_badge')
        : 'Standard',
      videoClassicTitle: t.has('credit_fallback.video_classic_title')
        ? t('credit_fallback.video_classic_title')
        : 'ChatGPT Image 2 Classic · 4s · 480p',
      videoClassicDescription: t.has(
        'credit_fallback.video_classic_description'
      )
        ? t('credit_fallback.video_classic_description')
        : 'Lower-cost text-to-video mode with audio turned off.',
      imageStandardTitle: t.has('credit_fallback.image_standard_title')
        ? t('credit_fallback.image_standard_title')
        : 'GPT Image 2 · 1K',
      imageStandardDescription: t.has(
        'credit_fallback.image_standard_description'
      )
        ? t('credit_fallback.image_standard_description')
        : 'Switch to a lighter image mode if you want a faster, lower-cost try.',
    }),
    [creditFallback, costCredits, remainingCredits, t]
  );
  const { checkinCredits, referralCredits, referralSubscriptionBonusPercent } =
    useMemo(() => getGenerationCreditRewardAmounts(configs), [configs]);
  const creditEarnCopy = useMemo(
    () => ({
      checkInTitle: t.has('credit_fallback.checkin_title')
        ? t('credit_fallback.checkin_title')
        : 'Daily check-in',
      checkInDescription: t.has('credit_fallback.checkin_description')
        ? t('credit_fallback.checkin_description', {
            credits: checkinCredits,
          })
        : `Claim ${checkinCredits} free credits today.`,
      checkInAction: t.has('credit_fallback.checkin')
        ? t('credit_fallback.checkin')
        : 'Check in',
      checkedInAction: t.has('credit_fallback.checked_in')
        ? t('credit_fallback.checked_in')
        : 'Checked in today',
      checkingInAction: t.has('credit_fallback.checking_in')
        ? t('credit_fallback.checking_in')
        : 'Checking in',
      checkInSuccess: t.has('credit_fallback.checkin_success')
        ? t('credit_fallback.checkin_success')
        : 'Daily credits added',
      checkInFailed: t.has('credit_fallback.checkin_failed')
        ? t('credit_fallback.checkin_failed')
        : 'Check-in failed',
      inviteTitle: t.has('credit_fallback.invite_title')
        ? t('credit_fallback.invite_title')
        : 'Invite friends',
      inviteDescription: t.has('credit_fallback.invite_description')
        ? t('credit_fallback.invite_description', {
            credits: referralCredits,
            percent: referralSubscriptionBonusPercent,
          })
        : `Earn ${referralCredits} credits when a friend signs up. When they first buy a subscription, both of you get ${referralSubscriptionBonusPercent}% extra subscription credits.`,
      copyInviteAction: t.has('credit_fallback.copy_invite')
        ? t('credit_fallback.copy_invite')
        : 'Copy invite link',
      inviteCopied: t.has('credit_fallback.invite_copied')
        ? t('credit_fallback.invite_copied')
        : 'Invite link copied',
      openRewardsAction: t.has('credit_fallback.open_rewards')
        ? t('credit_fallback.open_rewards')
        : 'Open rewards',
      copyFailed: t.has('credit_fallback.copy_failed')
        ? t('credit_fallback.copy_failed')
        : 'Copy failed',
    }),
    [checkinCredits, referralCredits, referralSubscriptionBonusPercent, t]
  );
  const handleCreditBalanceChanged = useCallback((nextRemaining: number) => {
    setCreditFallback((prev) =>
      prev ? { ...prev, remainingCredits: nextRemaining } : prev
    );
  }, []);
  const creditEarnActions = useGenerationCreditEarnActions({
    copy: creditEarnCopy,
    onCreditsChanged: handleCreditBalanceChanged,
  });
  const queuePayload = useMemo(
    () =>
      JSON.stringify({
        scene: currentScene,
        provider: PROVIDER,
        model: effectiveModel,
        prompt: prompt.trim(),
        options: currentOptions,
      } satisfies PendingVideoGenerationRequest),
    [currentOptions, currentScene, effectiveModel, prompt]
  );
  const queueSnapshotDigest = useMemo(() => md5(queuePayload), [queuePayload]);

  const modelOptions = useMemo<ModelOption[]>(() => {
    const modelMessages = t.raw('models') as Record<string, string>;

    return [
      {
        value: SEEDANCE_2_MODEL,
        label: modelMessages['seedance-2'] ?? 'Professional',
        description:
          modelMessages['seedance-2_desc'] ??
          'Recommended mode with more stable visuals for polished results',
        tech:
          modelMessages['seedance-2_tech'] ??
          'Supports 480p/720p, 4-15s duration',
        badges: [{ label: modelMessages.high_quality ?? 'Recommended' }],
      },
      {
        value: SEEDANCE_2_FAST_MODEL,
        label: modelMessages['seedance-2-fast'] ?? 'Fast',
        description:
          modelMessages['seedance-2-fast_desc'] ??
          'Fast mode for quick testing, social clips, and everyday creation',
        tech:
          modelMessages['seedance-2-fast_tech'] ??
          'Supports 480p/720p, 4-15s duration',
        badges: [{ label: modelMessages.default ?? 'Speed' }],
      },
      {
        value: SEEDANCE_15_MODEL,
        label: modelMessages['seedance-1-5-pro'] ?? 'Classic',
        description:
          modelMessages['seedance-1-5-pro_desc'] ??
          'Stable classic workflow for familiar results',
        tech:
          modelMessages['seedance-1-5-pro_tech'] ??
          'Supports 480p/720p/1080p, 4/6/8s duration',
        badges: [{ label: modelMessages.legacy ?? 'Stable' }],
      },
    ];
  }, [t]);
  const selectedModelOption = useMemo(
    () => modelOptions.find((option) => option.value === model),
    [model, modelOptions]
  );

  useEffect(() => {
    setIsMounted(true);
  }, []);

  const syncGeneratedResults = useCallback((task: BackendTask) => {
    const parsedTaskInfo = parseTaskPayload(task.taskInfo);
    const parsedTaskResult = parseTaskPayload(task.taskResult);

    const videoUrls = extractPreferredMediaUrls(
      parsedTaskInfo,
      parsedTaskResult,
      extractVideoUrls
    );
    const imageUrls = extractPreferredMediaUrls(
      parsedTaskInfo,
      parsedTaskResult,
      extractImageUrls
    );

    setGeneratedVideos(
      videoUrls.map((url, index) => ({
        id: `${task.id}-video-${index}`,
        url,
        provider: task.provider,
        model: task.model,
        prompt: task.prompt ?? undefined,
      }))
    );

    setGeneratedImages(
      imageUrls.map((url, index) => ({
        id: `${task.id}-image-${index}`,
        url,
        provider: task.provider,
        model: task.model,
        prompt: task.prompt ?? undefined,
      }))
    );

    return {
      videoCount: videoUrls.length,
      imageCount: imageUrls.length,
    };
  }, []);

  const applySeedancePrefill = useCallback(
    (detail: SeedanceGeneratorPrefillDetail) => {
      const incomingPrompt = detail.prompt?.trim();
      if (!incomingPrompt) {
        return;
      }

      setPrompt(incomingPrompt.slice(0, MAX_PROMPT_LENGTH));

      let nextModel: SeedanceModel = isModelSelectorVisible
        ? SEEDANCE_2_MODEL
        : SEEDANCE_15_MODEL;
      if (isModelSelectorVisible && detail.model) {
        nextModel = isSeedance2AssetModel(detail.model)
          ? SEEDANCE_2_MODEL
          : (getSeedance2BaseGenerationModel(detail.model) ?? detail.model);
      }

      setModel(nextModel);
      setRealPersonMode(false);

      if (isSeedance15Model(nextModel)) {
        setUseEndFrameControl(false);

        const nextLegacyScene: Seedance15Scene =
          detail.mode === 'image-to-video' ||
          detail.mode === 'first-frame' ||
          detail.mode === 'first-last-frame'
            ? 'image-to-video'
            : 'text-to-video';
        setLegacyScene(nextLegacyScene);
      } else if (
        detail.mode === 'text' ||
        detail.mode === 'first-frame' ||
        detail.mode === 'first-last-frame' ||
        detail.mode === 'multimodal-reference'
      ) {
        setSeedanceMode(detail.mode);
        setUseEndFrameControl(detail.mode === 'first-last-frame');
      }

      const normalizedDuration = isSeedance2GenerationModel(nextModel)
        ? normalizeSeedance2Duration(detail.duration)
        : normalizeSeedance15Duration(detail.duration);
      if (normalizedDuration !== undefined) {
        setDuration(String(normalizedDuration));
      }

      const normalizedAspectRatio = normalizeSeedanceAspectRatio(
        detail.aspectRatio,
        nextModel
      );
      if (normalizedAspectRatio) {
        setAspectRatio(normalizedAspectRatio);
      }

      hasPrefilledRef.current = true;
    },
    [isModelSelectorVisible]
  );

  useEffect(() => {
    if (hasPrefilledRef.current) return;
    if (prompt.trim().length > 0) {
      hasPrefilledRef.current = true;
      return;
    }

    const getParam = (keys: string[]) => {
      for (const key of keys) {
        const value = searchParams?.get(key)?.trim();
        if (value) {
          return value;
        }
      }

      return '';
    };

    const promptParam = getParam(['prompt']);
    const firstFrameUrlParam = getParam([
      'first_frame_url',
      'firstFrameUrl',
      'image_url',
      'imageUrl',
    ]);
    const modeParam = getParam(['mode', 'seedance_mode']);
    const prefillPrompt =
      promptParam ||
      (firstFrameUrlParam
        ? 'Animate this image with natural motion, cinematic camera movement, and consistent subject details.'
        : '');
    const prefillMode: SeedanceGeneratorPrefillDetail['mode'] | undefined =
      firstFrameUrlParam ||
      modeParam === 'image-to-video' ||
      modeParam === 'first-frame'
        ? 'first-frame'
        : modeParam === 'text-to-video' || modeParam === 'text'
          ? 'text'
          : modeParam === 'advanced-reference' ||
              modeParam === 'multimodal-reference'
            ? 'multimodal-reference'
            : undefined;
    let prefillDetail: SeedanceGeneratorPrefillDetail | null = prefillPrompt
      ? {
          prompt: prefillPrompt,
          ...(prefillMode ? { mode: prefillMode } : {}),
        }
      : null;

    if (firstFrameUrlParam) {
      const firstFrameItem: ImageUploaderValue = {
        id: `prefill-first-frame-${firstFrameUrlParam}`,
        preview: firstFrameUrlParam,
        url: firstFrameUrlParam,
        status: 'uploaded',
      };
      setFirstFrameItems([firstFrameItem]);
      setFirstFrameUrls([firstFrameUrlParam]);
      setLegacyImageItems([firstFrameItem]);
      setLegacyImageUrls([firstFrameUrlParam]);
    }

    if (!prefillDetail && typeof window !== 'undefined') {
      prefillDetail = parseSeedanceGeneratorPrefill(
        window.sessionStorage.getItem(SEEDANCE_PREFILL_PROMPT_KEY)
      );
      if (prefillDetail) {
        window.sessionStorage.removeItem(SEEDANCE_PREFILL_PROMPT_KEY);
      }
    }

    if (prefillDetail) {
      applySeedancePrefill(prefillDetail);
    }
  }, [applySeedancePrefill, prompt, searchParams]);

  useEffect(() => {
    const handlePrefill = (
      event: Event & {
        detail?: SeedanceGeneratorPrefillDetail;
      }
    ) => {
      const incomingPrompt = event.detail?.prompt?.trim();
      if (!incomingPrompt) {
        return;
      }

      applySeedancePrefill(event.detail as SeedanceGeneratorPrefillDetail);
    };

    window.addEventListener(
      SEEDANCE_GENERATOR_PREFILL_EVENT,
      handlePrefill as EventListener
    );

    return () => {
      window.removeEventListener(
        SEEDANCE_GENERATOR_PREFILL_EVENT,
        handlePrefill as EventListener
      );
    };
  }, [applySeedancePrefill]);

  const handleLegacyImagesChange = useCallback(
    (items: ImageUploaderValue[]) => {
      setLegacyImageItems(items);
      setLegacyImageUrls(extractUploadedImageUrls(items));
    },
    []
  );

  const handleFirstFrameChange = useCallback(
    (items: ImageUploaderValue[]) => {
      const nextFirstFrameUrls = extractUploadedImageUrls(items).slice(0, 1);
      setFirstFrameItems(items);
      setFirstFrameUrls(nextFirstFrameUrls);
      setSeedanceMode((currentMode) => {
        if (currentMode === 'text' || currentMode === 'multimodal-reference') {
          return currentMode;
        }

        return nextFirstFrameUrls[0] && lastFrameUrls[0]
          ? 'first-last-frame'
          : 'first-frame';
      });
    },
    [lastFrameUrls]
  );

  const handleLastFrameChange = useCallback((items: ImageUploaderValue[]) => {
    const nextLastFrameUrls = extractUploadedImageUrls(items).slice(0, 1);
    setUseEndFrameControl(true);
    setLastFrameItems(items);
    setLastFrameUrls(nextLastFrameUrls);
    setSeedanceMode((currentMode) => {
      if (currentMode === 'text' || currentMode === 'multimodal-reference') {
        return currentMode;
      }

      return nextLastFrameUrls[0] ? 'first-last-frame' : 'first-frame';
    });
  }, []);

  const handleReferenceImagesChange = useCallback(
    (items: ImageUploaderValue[]) => {
      setReferenceImageItems(items);
      setReferenceImageUrls(
        extractUploadedImageUrls(items).slice(
          0,
          SEEDANCE_2_REFERENCE_IMAGE_MAX_ITEMS
        )
      );
    },
    []
  );

  const handleCreatorModeChange = useCallback(
    (value: string) => {
      const nextMode = value as SeedanceCreatorMode;

      if (isLegacyModel) {
        setLegacyScene(nextMode as Seedance15Scene);
        return;
      }

      if (nextMode === 'text-to-video') {
        setSeedanceMode('text');
        return;
      }

      if (nextMode === 'image-to-video') {
        setSeedanceMode(lastFrameUrl ? 'first-last-frame' : 'first-frame');
        return;
      }

      setSeedanceMode('multimodal-reference');
    },
    [isLegacyModel, lastFrameUrl]
  );

  const handleEndFrameControlChange = useCallback((checked: boolean) => {
    setUseEndFrameControl(checked);

    if (checked) {
      return;
    }

    setLastFrameItems([]);
    setLastFrameUrls([]);
    setSeedanceMode((currentMode) => {
      if (currentMode === 'first-last-frame') {
        return 'first-frame';
      }

      return currentMode;
    });
  }, []);

  useEffect(() => {
    setReferenceImageAssets((currentItems) => {
      const nextUrls = referenceImageUrls.slice(
        0,
        SEEDANCE_2_REFERENCE_IMAGE_MAX_ITEMS
      );

      return nextUrls.map((url, index) => {
        const existing = currentItems.find((item) => item.url === url);
        if (existing) {
          return existing;
        }

        return {
          id: `reference-image-${index}-${url}`,
          url,
          promptAlias: allocatePromptAlias('image'),
          status: 'idle' as SeedanceAssetStatus,
        };
      });
    });
  }, [allocatePromptAlias, referenceImageUrls]);

  const resetTaskState = useCallback(() => {
    pendingGenerateRequestRef.current = null;
    pollAttemptRef.current = 0;
    setIsGenerating(false);
    setProgress(0);
    setTaskId(null);
    setProviderTaskId(null);
    setGenerationStartTime(null);
    setTaskStatus(null);
  }, []);

  const syncPromptSelection = useCallback(() => {
    const textarea = promptTextareaRef.current;
    if (!textarea) {
      return;
    }

    setPromptSelectionStart(textarea.selectionStart ?? textarea.value.length);
  }, []);

  const insertPromptReferenceToken = useCallback(
    (token: string) => {
      const textarea = promptTextareaRef.current;
      const fallbackNextPrompt = prompt
        ? `${prompt.replace(/\s+$/, '')} ${token} `
        : `${token} `;

      if (!textarea) {
        setPrompt(fallbackNextPrompt);
        setPromptSelectionStart(fallbackNextPrompt.length);
        return;
      }

      const hasFocus = document.activeElement === textarea;
      const selectionStart = hasFocus
        ? (textarea.selectionStart ?? prompt.length)
        : promptSelectionStart || prompt.length;
      const selectionEnd = hasFocus
        ? (textarea.selectionEnd ?? selectionStart)
        : selectionStart;
      let nextPrompt = prompt;
      let nextCursor = selectionStart;

      if (activePromptReferenceQuery) {
        nextPrompt = `${prompt.slice(0, activePromptReferenceQuery.start)}${token} ${prompt.slice(activePromptReferenceQuery.end)}`;
        nextCursor = activePromptReferenceQuery.start + token.length + 1;
      } else {
        nextPrompt = `${prompt.slice(0, selectionStart)}${token} ${prompt.slice(selectionEnd)}`;
        nextCursor = selectionStart + token.length + 1;
      }

      setPrompt(nextPrompt);
      setPromptSelectionStart(nextCursor);

      window.requestAnimationFrame(() => {
        const target = promptTextareaRef.current;
        if (!target) {
          return;
        }

        target.focus();
        target.setSelectionRange(nextCursor, nextCursor);
      });
    },
    [activePromptReferenceQuery, prompt, promptSelectionStart]
  );

  const redirectToPricingSection = useCallback(() => {
    const shouldReduceMotion = window.matchMedia(
      '(prefers-reduced-motion: reduce)'
    ).matches;
    const pricingSection = document.getElementById(pricingSectionId);

    if (!pricingSection) {
      router.push('/pricing');
      return;
    }

    pricingSection.scrollIntoView({
      behavior: shouldReduceMotion ? 'auto' : 'smooth',
      block: 'start',
    });

    if (shouldReduceMotion || typeof pricingSection.animate !== 'function') {
      return;
    }

    window.setTimeout(() => {
      pricingSection.animate(
        [
          {
            boxShadow: '0 0 0 0 hsl(var(--primary) / 0)',
            transform: 'translateY(0)',
          },
          {
            boxShadow: '0 0 0 10px hsl(var(--primary) / 0.2)',
            transform: 'translateY(-2px)',
          },
          {
            boxShadow: '0 0 0 0 hsl(var(--primary) / 0)',
            transform: 'translateY(0)',
          },
        ],
        {
          duration: 1400,
          easing: 'ease-out',
        }
      );
    }, 500);
  }, [pricingSectionId, router]);

  const handleModelChange = useCallback(
    (nextModel: SeedanceModel) => {
      if (nextModel === model) {
        return;
      }

      if (isSeedance2GenerationModel(nextModel)) {
        setDuration(String(normalizeSeedance2Duration(duration) ?? 4));
        setResolution((currentResolution) =>
          currentResolution === '1080p' ? '720p' : currentResolution
        );
        setAspectRatio(
          normalizeSeedanceAspectRatio(aspectRatio, nextModel) ?? '16:9'
        );

        if (isSeedance15Model(model)) {
          if (legacyScene === 'image-to-video') {
            if (legacyImageUrls[0]) {
              setFirstFrameUrls([legacyImageUrls[0]]);
            }
            if (legacyImageUrls[1]) {
              setLastFrameUrls([legacyImageUrls[1]]);
              setUseEndFrameControl(true);
              setSeedanceMode('first-last-frame');
            } else if (legacyImageUrls[0]) {
              setLastFrameUrls([]);
              setUseEndFrameControl(false);
              setSeedanceMode('first-frame');
            } else {
              setUseEndFrameControl(false);
              setSeedanceMode('first-frame');
            }
          } else {
            setUseEndFrameControl(false);
            setSeedanceMode('text');
          }
        }
      } else {
        setDuration(normalizeSeedance15Duration(duration) ?? '4');
        setAspectRatio(
          normalizeSeedanceAspectRatio(aspectRatio, nextModel) ?? '16:9'
        );

        if (isSeedance2GenerationModel(model)) {
          let nextLegacyImageUrls: string[] = [];

          if (
            seedanceMode === 'first-frame' ||
            seedanceMode === 'first-last-frame'
          ) {
            if (firstFrameUrl) {
              nextLegacyImageUrls.push(firstFrameUrl);
            }
            if (lastFrameUrl && nextLegacyImageUrls.length < 2) {
              nextLegacyImageUrls.push(lastFrameUrl);
            }
          } else if (seedanceMode === 'multimodal-reference') {
            nextLegacyImageUrls = referenceImageUrls.slice(0, 2);
          }

          setLegacyImageUrls(nextLegacyImageUrls);
          setLegacyScene(
            nextLegacyImageUrls.length > 0 ? 'image-to-video' : 'text-to-video'
          );
        }
      }

      setModel(nextModel);
    },
    [
      aspectRatio,
      duration,
      firstFrameUrl,
      lastFrameUrl,
      legacyImageUrls,
      legacyScene,
      model,
      referenceImageUrls,
      seedanceMode,
    ]
  );

  useEffect(() => {
    if (
      !hasFetchedConfigs ||
      isModelSelectorVisible ||
      model === SEEDANCE_15_MODEL
    ) {
      return;
    }

    handleModelChange(SEEDANCE_15_MODEL);
  }, [handleModelChange, hasFetchedConfigs, isModelSelectorVisible, model]);

  const taskStatusLabel = useMemo(() => {
    if (!taskStatus) {
      return '';
    }

    switch (taskStatus) {
      case AITaskStatus.PENDING:
        return t('status.pending');
      case AITaskStatus.PROCESSING:
        return t('status.processing');
      case AITaskStatus.SUCCESS:
        return t('status.success');
      case AITaskStatus.FAILED:
        return t('status.failed');
      default:
        return '';
    }
  }, [t, taskStatus]);

  const showGenerationError = useCallback(
    (message?: string | null) => {
      const resolvedMessage =
        typeof message === 'string' && message.trim()
          ? message.trim()
          : t('errors.generate_failed');
      setGenerationError(resolvedMessage);
      toast.error(resolvedMessage);
    },
    [t]
  );

  const generationErrorResetSignatureRef = useRef(
    generationErrorResetSignature
  );

  useEffect(() => {
    if (
      generationErrorResetSignatureRef.current === generationErrorResetSignature
    ) {
      return;
    }

    generationErrorResetSignatureRef.current = generationErrorResetSignature;

    if (generationError && !isGenerating) {
      setGenerationError(null);
    }
  }, [generationError, generationErrorResetSignature, isGenerating]);

  const getAssetBadgeLabel = useCallback(
    (status?: SeedanceAssetStatus) => {
      switch (status) {
        case 'processing':
          return t('badges.asset-processing');
        case 'active':
          return t('badges.asset-ready');
        case 'failed':
          return t('badges.error');
        default:
          return t('badges.uploaded');
      }
    },
    [t]
  );

  const getTimedReferenceBadgeLabel = useCallback(
    (item: TimedReferenceUploadItem) => {
      if (item.status === 'uploading') {
        return t('badges.uploading');
      }

      if (item.status === 'error') {
        return t('badges.error');
      }

      if (shouldUseAssetReferences && seedanceMode === 'multimodal-reference') {
        return getAssetBadgeLabel(item.assetStatus);
      }

      return t('badges.uploaded');
    },
    [getAssetBadgeLabel, seedanceMode, shouldUseAssetReferences, t]
  );

  const updateTimedUploadItem = useCallback(
    (
      kind: TimedReferenceKind,
      id: string,
      updater: (item: TimedReferenceUploadItem) => TimedReferenceUploadItem
    ) => {
      const setter =
        kind === 'video' ? setReferenceVideoItems : setReferenceAudioItems;

      setter((items) =>
        items.map((item) => (item.id === id ? updater(item) : item))
      );
    },
    []
  );

  const updateReferenceImageAsset = useCallback(
    (
      url: string,
      updater: (item: ReferenceImageAssetItem) => ReferenceImageAssetItem
    ) => {
      setReferenceImageAssets((items) =>
        items.map((item) => (item.url === url ? updater(item) : item))
      );
    },
    []
  );

  const processReferenceImageAsset = useCallback(
    async (url: string) => {
      if (!user?.id) {
        return;
      }

      if (activeImageAssetRequestsRef.current.has(url)) {
        return;
      }

      activeImageAssetRequestsRef.current.add(url);
      updateReferenceImageAsset(url, (item) => ({
        ...item,
        status: 'processing',
        error: undefined,
      }));

      try {
        const createdAsset = await createSeedanceAssetRequest({
          kind: 'image',
          url,
        });
        const resolvedAsset = await waitForSeedanceAssetReady(
          createdAsset.assetId
        );

        updateReferenceImageAsset(url, (item) => ({
          ...item,
          status: 'active',
          assetId: resolvedAsset.assetId,
          error: undefined,
        }));
      } catch (error: any) {
        updateReferenceImageAsset(url, (item) => ({
          ...item,
          status: 'failed',
          error: error.message || t('form.asset_failed'),
        }));
        toast.error(error.message || t('form.asset_failed'));
      } finally {
        activeImageAssetRequestsRef.current.delete(url);
      }
    },
    [t, updateReferenceImageAsset, user?.id]
  );

  const processTimedReferenceAsset = useCallback(
    async (kind: TimedReferenceKind, itemId: string, url: string) => {
      if (!user?.id) {
        return;
      }

      const requestKey = `${kind}:${itemId}`;
      if (activeTimedAssetRequestsRef.current.has(requestKey)) {
        return;
      }

      activeTimedAssetRequestsRef.current.add(requestKey);
      updateTimedUploadItem(kind, itemId, (item) => ({
        ...item,
        assetStatus: 'processing',
        assetError: undefined,
      }));

      try {
        const createdAsset = await createSeedanceAssetRequest({
          kind,
          url,
        });
        const resolvedAsset = await waitForSeedanceAssetReady(
          createdAsset.assetId
        );

        updateTimedUploadItem(kind, itemId, (item) => ({
          ...item,
          assetStatus: 'active',
          assetId: resolvedAsset.assetId,
          assetError: undefined,
        }));
      } catch (error: any) {
        updateTimedUploadItem(kind, itemId, (item) => ({
          ...item,
          assetStatus: 'failed',
          assetError: error.message || t('form.asset_failed'),
        }));
        toast.error(error.message || t('form.asset_failed'));
      } finally {
        activeTimedAssetRequestsRef.current.delete(requestKey);
      }
    },
    [t, updateTimedUploadItem, user?.id]
  );

  useEffect(() => {
    if (
      !shouldUseAssetReferences ||
      seedanceMode !== 'multimodal-reference' ||
      !user?.id
    ) {
      return;
    }

    referenceImageAssets.forEach((item) => {
      if (item.status === 'idle') {
        void processReferenceImageAsset(item.url);
      }
    });
  }, [
    processReferenceImageAsset,
    referenceImageAssets,
    seedanceMode,
    shouldUseAssetReferences,
    user?.id,
  ]);

  useEffect(() => {
    if (
      !shouldUseAssetReferences ||
      seedanceMode !== 'multimodal-reference' ||
      !user?.id
    ) {
      return;
    }

    referenceVideoItems.forEach((item) => {
      if (item.status === 'uploaded' && item.url && !item.assetId) {
        void processTimedReferenceAsset('video', item.id, item.url);
      }
    });
  }, [
    processTimedReferenceAsset,
    referenceVideoItems,
    seedanceMode,
    shouldUseAssetReferences,
    user?.id,
  ]);

  useEffect(() => {
    if (
      !shouldUseAssetReferences ||
      seedanceMode !== 'multimodal-reference' ||
      !user?.id
    ) {
      return;
    }

    referenceAudioItems.forEach((item) => {
      if (item.status === 'uploaded' && item.url && !item.assetId) {
        void processTimedReferenceAsset('audio', item.id, item.url);
      }
    });
  }, [
    processTimedReferenceAsset,
    referenceAudioItems,
    seedanceMode,
    shouldUseAssetReferences,
    user?.id,
  ]);

  const handleTimedReferenceUpload = useCallback(
    async (kind: TimedReferenceKind, fileList: FileList | null) => {
      if (!fileList || fileList.length === 0) {
        return;
      }

      const files = Array.from(fileList);
      const currentItems =
        kind === 'video' ? referenceVideoItems : referenceAudioItems;
      const setItems =
        kind === 'video' ? setReferenceVideoItems : setReferenceAudioItems;
      const maxItems =
        kind === 'video'
          ? SEEDANCE_2_REFERENCE_VIDEO_MAX_ITEMS
          : SEEDANCE_2_REFERENCE_AUDIO_MAX_ITEMS;

      if (currentItems.length + files.length > maxItems) {
        toast.error(
          kind === 'video'
            ? t('form.reference_video_limit')
            : t('form.reference_audio_limit')
        );
        return;
      }

      if (
        referenceImageUrls.length +
          referenceVideoItems.length +
          referenceAudioItems.length +
          files.length >
        SEEDANCE_2_REFERENCE_MAX_TOTAL_ITEMS
      ) {
        toast.error(t('form.reference_total_limit'));
        return;
      }

      const maxBytes =
        kind === 'video'
          ? SEEDANCE_2_REFERENCE_VIDEO_UPLOAD_MAX_BYTES
          : SEEDANCE_2_REFERENCE_AUDIO_UPLOAD_MAX_BYTES;
      const minDuration =
        kind === 'video'
          ? SEEDANCE_2_REFERENCE_VIDEO_MIN_DURATION
          : SEEDANCE_2_REFERENCE_AUDIO_MIN_DURATION;
      const maxDuration =
        kind === 'video'
          ? SEEDANCE_2_REFERENCE_VIDEO_MAX_DURATION
          : SEEDANCE_2_REFERENCE_AUDIO_MAX_DURATION;
      const maxTotalDuration =
        kind === 'video'
          ? SEEDANCE_2_REFERENCE_VIDEO_MAX_TOTAL_DURATION
          : SEEDANCE_2_REFERENCE_AUDIO_MAX_TOTAL_DURATION;

      const currentUploadedDuration = currentItems.reduce((sum, item) => {
        if (
          item.status !== 'uploaded' ||
          typeof item.durationSeconds !== 'number' ||
          !Number.isFinite(item.durationSeconds)
        ) {
          return sum;
        }

        return sum + item.durationSeconds;
      }, 0);

      const preflightResults = await mapWithConcurrency(
        files,
        TIMED_REFERENCE_UPLOAD_CONCURRENCY,
        async (file) => {
          try {
            if (!normalizeReferenceUploadMimeType(file, kind)) {
              throw new Error(
                kind === 'video'
                  ? t('form.reference_video_type_error')
                  : t('form.reference_audio_type_error')
              );
            }

            if (file.size > maxBytes) {
              throw new Error(
                kind === 'video'
                  ? t('form.reference_video_size_error')
                  : t('form.reference_audio_size_error')
              );
            }

            const metadata = await getTimedReferenceMetadata(file, kind);
            console.info('[seedance.reference-preflight] metadata-ready', {
              kind,
              fileName: file.name,
              size: file.size,
              usesApimartSeedanceRuntime,
              ...summarizeTimedReferenceMetadata(metadata),
            });
            if (kind === 'video' && usesApimartSeedanceRuntime) {
              const resolution = getTimedReferenceResolution(metadata);
              if (resolution === null) {
                console.warn('[seedance.reference-preflight] rejected', {
                  kind,
                  reason: 'missing-dimensions',
                  fileName: file.name,
                  size: file.size,
                  ...summarizeTimedReferenceMetadata(metadata),
                });
                throw new Error(
                  getApimartReferenceVideoMetadataMessage({
                    name: file.name,
                  })
                );
              }

              if (
                resolution <
                  SEEDANCE_2_APIMART_REFERENCE_VIDEO_MIN_RESOLUTION ||
                resolution > SEEDANCE_2_APIMART_REFERENCE_VIDEO_MAX_RESOLUTION
              ) {
                console.warn('[seedance.reference-preflight] rejected', {
                  kind,
                  reason: 'resolution-range',
                  fileName: file.name,
                  size: file.size,
                  resolution,
                  ...summarizeTimedReferenceMetadata(metadata),
                });
                throw new Error(
                  getApimartReferenceVideoLimitMessage({
                    name: file.name,
                    width: metadata.width,
                    height: metadata.height,
                  })
                );
              }

              if (
                exceedsSeedanceReferenceVideoPixelCount({
                  width: metadata.width,
                  height: metadata.height,
                })
              ) {
                console.warn('[seedance.reference-preflight] rejected', {
                  kind,
                  reason: 'pixel-limit',
                  fileName: file.name,
                  size: file.size,
                  resolution,
                  ...summarizeTimedReferenceMetadata(metadata),
                });
                throw new Error(
                  getSeedanceReferenceVideoPixelLimitMessage({
                    name: file.name,
                    width: metadata.width,
                    height: metadata.height,
                  })
                );
              }
            }

            if (
              metadata.durationSeconds < minDuration ||
              metadata.durationSeconds > maxDuration
            ) {
              console.warn('[seedance.reference-preflight] rejected', {
                kind,
                reason: 'duration-range',
                fileName: file.name,
                size: file.size,
                minDuration,
                maxDuration,
                ...summarizeTimedReferenceMetadata(metadata),
              });
              throw new Error(
                kind === 'video'
                  ? t('form.reference_video_duration_error')
                  : t('form.reference_audio_duration_error')
              );
            }

            return {
              file,
              metadata,
            };
          } catch (error: any) {
            console.warn('[seedance.reference-preflight] failed', {
              kind,
              fileName: file.name,
              size: file.size,
              error: error?.message || t('form.upload_failed'),
            });
            return {
              file,
              error: error?.message || t('form.upload_failed'),
            };
          }
        }
      );

      let nextUploadedDuration = currentUploadedDuration;
      const pendingUploads = preflightResults.flatMap((result) => {
        if (
          result.error ||
          !result.file ||
          typeof result.metadata?.durationSeconds !== 'number'
        ) {
          console.warn('[seedance.reference-preflight] skipped', {
            kind,
            fileName: result.file?.name,
            error: result.error || t('form.upload_failed'),
            metadata: summarizeTimedReferenceMetadata(result.metadata),
          });
          toast.error(
            result.error
              ? `${result.file.name}: ${result.error}`
              : t('form.upload_failed')
          );
          return [];
        }

        if (
          nextUploadedDuration + result.metadata.durationSeconds >
          maxTotalDuration
        ) {
          toast.error(
            kind === 'video'
              ? t('form.reference_video_total_duration_error')
              : t('form.reference_audio_total_duration_error')
          );
          return [];
        }

        nextUploadedDuration += result.metadata.durationSeconds;

        return [
          {
            file: result.file,
            metadata: result.metadata,
            itemId: createId(`${kind}-ref`),
            promptAlias: allocatePromptAlias(kind),
          },
        ];
      });

      console.info('[seedance.reference-preflight] accepted', {
        kind,
        pendingCount: pendingUploads.length,
        files: pendingUploads.map(
          ({ file, metadata, itemId, promptAlias }) => ({
            itemId,
            promptAlias,
            fileName: file.name,
            size: file.size,
            ...summarizeTimedReferenceMetadata(metadata),
          })
        ),
      });

      if (pendingUploads.length === 0) {
        return;
      }

      setItems((items) => [
        ...items,
        ...pendingUploads.map(({ file, itemId, promptAlias }) => ({
          id: itemId,
          name: file.name,
          kind,
          status: 'uploading' as const,
          size: file.size,
          promptAlias,
        })),
      ]);

      const results = await mapWithConcurrency(
        pendingUploads,
        TIMED_REFERENCE_UPLOAD_CONCURRENCY,
        async ({ file, itemId, metadata }) => {
          try {
            const uploaded = await uploadTimedReferenceFile(
              file,
              kind,
              metadata
            );
            return {
              itemId,
              uploaded,
              metadata,
            };
          } catch (error: any) {
            return {
              itemId,
              error: error?.message || t('form.upload_failed'),
            };
          }
        }
      );

      for (const result of results) {
        if (result.error) {
          console.warn('[seedance.reference-upload] failed', {
            kind,
            itemId: result.itemId,
            error: result.error,
          });
          updateTimedUploadItem(kind, result.itemId, (item) => ({
            ...item,
            status: 'error',
            error: result.error,
          }));
          toast.error(result.error);
          continue;
        }

        const uploaded = result.uploaded;
        if (!uploaded) {
          const message = t('form.upload_failed');
          console.warn('[seedance.reference-upload] missing-result', {
            kind,
            itemId: result.itemId,
            metadata: summarizeTimedReferenceMetadata(result.metadata),
          });
          updateTimedUploadItem(kind, result.itemId, (item) => ({
            ...item,
            status: 'error',
            error: message,
          }));
          toast.error(message);
          continue;
        }

        const mediaDuration =
          typeof uploaded.durationSeconds === 'number'
            ? uploaded.durationSeconds
            : result.metadata.durationSeconds;

        if (
          typeof mediaDuration !== 'number' ||
          !Number.isFinite(mediaDuration)
        ) {
          const message = t('form.upload_failed');
          console.warn('[seedance.reference-upload] invalid-duration', {
            kind,
            itemId: result.itemId,
            uploaded: summarizeUploadedReferenceResult(uploaded),
            metadata: summarizeTimedReferenceMetadata(result.metadata),
          });
          updateTimedUploadItem(kind, result.itemId, (item) => ({
            ...item,
            status: 'error',
            error: message,
          }));
          toast.error(message);
          continue;
        }

        if (!uploaded.metadataToken) {
          const message = t('form.upload_failed');
          console.warn('[seedance.reference-upload] missing-metadata-token', {
            kind,
            itemId: result.itemId,
            uploaded: summarizeUploadedReferenceResult(uploaded),
            metadata: summarizeTimedReferenceMetadata(result.metadata),
          });
          updateTimedUploadItem(kind, result.itemId, (item) => ({
            ...item,
            status: 'error',
            error: message,
          }));
          toast.error(message);
          continue;
        }

        if (mediaDuration < minDuration || mediaDuration > maxDuration) {
          const message =
            kind === 'video'
              ? t('form.reference_video_duration_error')
              : t('form.reference_audio_duration_error');
          console.warn('[seedance.reference-upload] rejected', {
            kind,
            reason: 'duration-range',
            itemId: result.itemId,
            minDuration,
            maxDuration,
            uploaded: summarizeUploadedReferenceResult(uploaded),
            metadata: summarizeTimedReferenceMetadata(result.metadata),
          });
          updateTimedUploadItem(kind, result.itemId, (item) => ({
            ...item,
            status: 'error',
            error: message,
          }));
          toast.error(message);
          continue;
        }

        console.info('[seedance.reference-upload] completed', {
          kind,
          itemId: result.itemId,
          resolved: {
            url: uploaded.url,
            durationSeconds: mediaDuration,
            width:
              typeof uploaded.width === 'number'
                ? uploaded.width
                : result.metadata.width,
            height:
              typeof uploaded.height === 'number'
                ? uploaded.height
                : result.metadata.height,
            hasMetadataToken: Boolean(uploaded.metadataToken),
            metadataTokenLength: uploaded.metadataToken?.length,
          },
          uploaded: summarizeUploadedReferenceResult(uploaded),
          metadata: summarizeTimedReferenceMetadata(result.metadata),
        });

        updateTimedUploadItem(kind, result.itemId, (item) => ({
          ...item,
          status: 'uploaded',
          url: uploaded.url,
          durationSeconds: mediaDuration,
          width:
            typeof uploaded.width === 'number'
              ? uploaded.width
              : result.metadata.width,
          height:
            typeof uploaded.height === 'number'
              ? uploaded.height
              : result.metadata.height,
          metadataToken: uploaded.metadataToken,
          error: undefined,
        }));
      }
    },
    [
      allocatePromptAlias,
      referenceAudioItems,
      referenceImageUrls.length,
      referenceVideoItems,
      t,
      updateTimedUploadItem,
      usesApimartSeedanceRuntime,
    ]
  );

  const removeTimedReferenceItem = useCallback(
    (kind: TimedReferenceKind, id: string) => {
      const setter =
        kind === 'video' ? setReferenceVideoItems : setReferenceAudioItems;
      setter((items) => items.filter((item) => item.id !== id));
    },
    []
  );

  const validateBeforeGenerate = useCallback(() => {
    const trimmedPrompt = prompt.trim();
    if (!trimmedPrompt) {
      return t('form.tip_input_prompt');
    }

    if (trimmedPrompt.length < 3) {
      return t('form.prompt_too_short');
    }

    if (trimmedPrompt.length > MAX_PROMPT_LENGTH) {
      return `${t('form.tip_max_prompt_length')}: ${MAX_PROMPT_LENGTH}`;
    }

    if (isReferenceUploading) {
      return t('form.upload_in_progress');
    }

    if (hasReferenceUploadError) {
      return t('form.upload_failed');
    }

    if (hasReferenceAssetsProcessing) {
      return t('form.asset_processing');
    }

    if (hasReferenceAssetError) {
      return t('form.asset_failed');
    }

    if (isLegacyModel) {
      if (promptReferenceTokens.length > 0) {
        return t('form.prompt_reference_mode_error');
      }

      if (legacyScene === 'image-to-video' && legacyImageUrls.length === 0) {
        return t('form.reference_image_required');
      }

      return null;
    }

    if (
      promptReferenceTokens.length > 0 &&
      seedanceMode !== 'multimodal-reference'
    ) {
      return t('form.prompt_reference_mode_error');
    }

    if (promptReferenceTokens.length > 0) {
      const availableTokens = new Set(
        currentPromptReferenceBindings.map((item) => item.token)
      );

      if (promptReferenceTokens.some((token) => !availableTokens.has(token))) {
        return t('form.prompt_reference_invalid');
      }
    }

    if (currentCreatorMode === 'image-to-video' && !firstFrameUrl) {
      return t('form.first_frame_required');
    }

    if (
      seedanceMode === 'multimodal-reference' &&
      resolvedPromptReferenceSelection.referenceImageUrls.length === 0 &&
      resolvedPromptReferenceSelection.referenceVideos.length === 0 &&
      resolvedPromptReferenceSelection.referenceAudios.length === 0
    ) {
      return t('form.multimodal_reference_required');
    }

    if (
      seedanceMode === 'multimodal-reference' &&
      resolvedPromptReferenceSelection.referenceAudios.length > 0 &&
      resolvedPromptReferenceSelection.referenceImageUrls.length === 0 &&
      resolvedPromptReferenceSelection.referenceVideos.length === 0
    ) {
      return t('form.reference_audio_requires_visual');
    }

    if (
      seedanceMode === 'multimodal-reference' &&
      selectedReferenceVideoDuration >
        SEEDANCE_2_REFERENCE_VIDEO_MAX_TOTAL_DURATION
    ) {
      return t('form.reference_video_total_duration_error');
    }

    if (
      seedanceMode === 'multimodal-reference' &&
      selectedReferenceAudioDuration >
        SEEDANCE_2_REFERENCE_AUDIO_MAX_TOTAL_DURATION
    ) {
      return t('form.reference_audio_total_duration_error');
    }

    if (
      seedanceMode === 'multimodal-reference' &&
      referenceImageUrls.length +
        referenceVideos.length +
        referenceAudios.length >
        SEEDANCE_2_REFERENCE_MAX_TOTAL_ITEMS
    ) {
      return t('form.reference_total_limit');
    }

    if (usesApimartSeedanceRuntime && seedanceMode === 'multimodal-reference') {
      const missingMetadataReferenceVideo =
        resolvedPromptReferenceSelection.referenceVideos.find(
          (item) => getTimedReferenceResolution(item) === null
        );

      if (missingMetadataReferenceVideo) {
        return getApimartReferenceVideoMetadataMessage(
          missingMetadataReferenceVideo
        );
      }

      const oversizedReferenceVideo =
        resolvedPromptReferenceSelection.referenceVideos.find((item) => {
          const resolution = getTimedReferenceResolution(item);
          return (
            resolution !== null &&
            (resolution < SEEDANCE_2_APIMART_REFERENCE_VIDEO_MIN_RESOLUTION ||
              resolution > SEEDANCE_2_APIMART_REFERENCE_VIDEO_MAX_RESOLUTION)
          );
        });

      if (oversizedReferenceVideo) {
        return getApimartReferenceVideoLimitMessage(oversizedReferenceVideo);
      }

      const oversizedPixelReferenceVideo =
        resolvedPromptReferenceSelection.referenceVideos.find((item) =>
          exceedsSeedanceReferenceVideoPixelCount({
            width: item.width,
            height: item.height,
          })
        );

      if (oversizedPixelReferenceVideo) {
        return getSeedanceReferenceVideoPixelLimitMessage(
          oversizedPixelReferenceVideo
        );
      }
    }

    return null;
  }, [
    currentPromptReferenceBindings,
    currentCreatorMode,
    firstFrameUrl,
    hasReferenceAssetError,
    hasReferenceAssetsProcessing,
    hasReferenceUploadError,
    isLegacyModel,
    isReferenceUploading,
    legacyImageUrls.length,
    legacyScene,
    prompt,
    promptReferenceTokens,
    referenceAudios.length,
    referenceVideos.length,
    resolvedPromptReferenceSelection,
    selectedReferenceAudioDuration,
    selectedReferenceVideoDuration,
    seedanceMode,
    t,
    usesApimartSeedanceRuntime,
  ]);

  const pollTaskStatus = useCallback(
    async (id: string, providerTaskIdForQuery?: string | null) => {
      try {
        const attempt = pollAttemptRef.current + 1;
        pollAttemptRef.current = attempt;
        const elapsedMs = generationStartTime
          ? Date.now() - generationStartTime
          : null;

        if (
          generationStartTime &&
          elapsedMs !== null &&
          elapsedMs > GENERATION_TIMEOUT
        ) {
          console.warn('[seedance.poll] timeout', {
            taskId: id,
            attempt,
            elapsedMs,
            timeoutMs: GENERATION_TIMEOUT,
          });
          resetTaskState();
          showGenerationError(t('errors.timeout'));
          return true;
        }

        const resp = await fetch('/api/ai/query', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            taskId: id,
            providerTaskId: providerTaskIdForQuery,
          }),
        });

        if (!resp.ok) {
          throw new Error(`request failed with status: ${resp.status}`);
        }

        const { code, message, data } = await resp.json();
        if (code !== 0) {
          throw new Error(message || 'Query task failed');
        }

        const task = data as BackendTask;
        if (task.taskId) {
          setProviderTaskId(task.taskId);
        }
        const currentStatus = task.status as AITaskStatus;
        setTaskStatus(currentStatus);

        const mediaResult = syncGeneratedResults(task);

        console.info('[seedance.poll] response', {
          taskId: id,
          attempt,
          elapsedMs,
          httpStatus: resp.status,
          backendStatus: currentStatus,
          provider: task.provider,
          model: task.model,
          videoCount: mediaResult.videoCount,
          imageCount: mediaResult.imageCount,
        });

        if (currentStatus === AITaskStatus.PENDING) {
          setProgress((prev) => Math.max(prev, 20));
          return false;
        }

        if (currentStatus === AITaskStatus.PROCESSING) {
          if (mediaResult.videoCount > 0 || mediaResult.imageCount > 0) {
            setProgress((prev) => Math.max(prev, 85));
          } else {
            setProgress((prev) => Math.min(prev + 5, 80));
          }
          return false;
        }

        if (currentStatus === AITaskStatus.SUCCESS) {
          if (mediaResult.videoCount === 0 && mediaResult.imageCount === 0) {
            console.warn('[seedance.poll] success-with-empty-result', {
              taskId: id,
              attempt,
              elapsedMs,
              provider: task.provider,
              model: task.model,
            });
            showGenerationError(t('errors.empty_result'));
          } else {
            console.info('[seedance.poll] success', {
              taskId: id,
              attempt,
              elapsedMs,
              provider: task.provider,
              model: task.model,
              videoCount: mediaResult.videoCount,
              imageCount: mediaResult.imageCount,
            });
            setGenerationError(null);
            toast.success(t('messages.generate_success'));
          }

          setProgress(100);
          resetTaskState();
          return true;
        }

        if (currentStatus === AITaskStatus.FAILED) {
          const parsedTaskInfo = parseTaskPayload(task.taskInfo);
          const errorMessage =
            parsedTaskInfo?.errorMessage || t('errors.generate_failed');
          console.warn('[seedance.poll] failed', {
            taskId: id,
            attempt,
            elapsedMs,
            provider: task.provider,
            model: task.model,
            errorMessage,
          });
          showGenerationError(errorMessage);
          resetTaskState();
          fetchUserCredits();
          return true;
        }

        setProgress((prev) => Math.min(prev + 3, 95));
        return false;
      } catch (error: any) {
        console.error('[seedance.poll] request-error', {
          taskId: id,
          attempt: pollAttemptRef.current,
          elapsedMs: generationStartTime
            ? Date.now() - generationStartTime
            : null,
          message: error?.message || 'unknown error',
        });
        showGenerationError(
          `${t('errors.query_failed')}: ${error.message || t('errors.query_failed')}`
        );
        resetTaskState();
        fetchUserCredits();
        return true;
      }
    },
    [
      fetchUserCredits,
      generationStartTime,
      resetTaskState,
      showGenerationError,
      syncGeneratedResults,
      t,
    ]
  );

  useEffect(() => {
    if (!taskId || !isGenerating) {
      return;
    }

    let cancelled = false;

    const tick = async () => {
      if (!taskId) {
        return;
      }
      const completed = await pollTaskStatus(taskId, providerTaskId);
      if (completed) {
        cancelled = true;
      }
    };

    tick();

    const interval = setInterval(async () => {
      if (cancelled || !taskId) {
        clearInterval(interval);
        return;
      }
      const completed = await pollTaskStatus(taskId, providerTaskId);
      if (completed) {
        clearInterval(interval);
      }
    }, POLL_INTERVAL);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [taskId, providerTaskId, isGenerating, pollTaskStatus]);

  const submitVideoGeneration = useCallback(async () => {
    const request = pendingGenerateRequestRef.current;
    if (!request) {
      return false;
    }

    const {
      scene,
      provider: requestProvider,
      model: requestModel,
      prompt: requestPrompt,
      options,
    } = request;

    setGenerationError(null);
    setIsGenerating(true);
    setProgress(15);
    setTaskStatus(AITaskStatus.PENDING);
    setGeneratedVideos([]);
    setGeneratedImages([]);
    setGenerationStartTime(Date.now());
    pollAttemptRef.current = 0;

    try {
      console.info('[seedance.generate] submit', {
        scene,
        provider: requestProvider,
        model: requestModel,
        promptLength: requestPrompt.length,
        referenceVideos: summarizeTimedReferenceAssets(
          (options as Seedance2VideoOptions | undefined)?.reference_videos
        ),
        referenceAudios: summarizeTimedReferenceAssets(
          (options as Seedance2VideoOptions | undefined)?.reference_audios
        ),
      });
      const resp = await fetch('/api/ai/generate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          mediaType: AIMediaType.VIDEO,
          scene,
          provider: requestProvider,
          model: requestModel,
          prompt: requestPrompt,
          options,
        }),
      });

      if (!resp.ok) {
        console.warn('[seedance.generate] request-not-ok', {
          scene,
          provider: requestProvider,
          model: requestModel,
          status: resp.status,
        });
        throw new Error(`request failed with status: ${resp.status}`);
      }

      const { code, message, data } = await resp.json();
      if (code !== 0) {
        const fallbackPayload = isGenerationCreditFallbackPayload(data)
          ? data
          : null;
        if (fallbackPayload) {
          setCreditFallback(fallbackPayload);
          resetTaskState();
          void fetchUserCredits();
          return false;
        }

        throw new Error(message || 'Failed to create a video task');
      }

      const newTaskId = data?.id;
      if (!newTaskId) {
        throw new Error('Task id missing in response');
      }

      console.info('[seedance.generate] task-created', {
        localTaskId: newTaskId,
        providerTaskId: data?.taskId || '',
        provider: requestProvider,
        model: requestModel,
        initialStatus: data.status || '',
        hasTaskInfo: Boolean(data.taskInfo),
      });

      if (data.status === AITaskStatus.SUCCESS && data.taskInfo) {
        const task = data as BackendTask;
        const mediaResult = syncGeneratedResults(task);

        if (mediaResult.videoCount > 0 || mediaResult.imageCount > 0) {
          setGenerationError(null);
          toast.success(t('messages.generate_success'));
          setProgress(100);
          resetTaskState();
          await fetchUserCredits();
          return true;
        }
      }

      setTaskId(newTaskId);
      setProviderTaskId(data?.taskId ?? null);
      setProgress(25);
      await fetchUserCredits();
      return true;
    } catch (error: any) {
      console.error('Failed to generate video:', error);
      showGenerationError(error?.message);
      resetTaskState();
      return false;
    }
  }, [
    fetchUserCredits,
    resetTaskState,
    showGenerationError,
    syncGeneratedResults,
    t,
  ]);

  const {
    queueState,
    isQueueActive,
    isQueueSubmitting,
    startQueue,
    cancelQueue,
    retryQueue,
    trackUpgradeClick,
  } = useMembershipPriorityQueue({
    mediaType: 'video',
    userId: user?.id ?? null,
    enabled: hasFetchedCurrentSubscription && !hasQueueBypassAccess,
    waitRangeMs: videoQueueWaitRangeMs,
    snapshotDigest: queueSnapshotDigest,
    serializedPayload: queuePayload,
    onSubmit: async (serializedPayload) => {
      pendingGenerateRequestRef.current = JSON.parse(
        serializedPayload
      ) as PendingVideoGenerationRequest;
      return submitVideoGeneration();
    },
    trackingConfigs: configs,
  });
  const isCurrentRequestRetryable =
    queueState?.status === 'submit_failed' &&
    queueState.snapshotDigest === queueSnapshotDigest;

  const handleCancelQueue = useCallback(() => {
    pendingGenerateRequestRef.current = null;
    cancelQueue();
  }, [cancelQueue]);

  const handleUpgradeFromQueue = useCallback(() => {
    trackUpgradeClick();
    redirectToPricingSection();
  }, [redirectToPricingSection, trackUpgradeClick]);

  const handleCloseCreditFallback = useCallback(() => {
    setCreditFallback(null);
  }, []);

  const handleUpgradeFromCreditFallback = useCallback(() => {
    setCreditFallback(null);
    redirectToPricingSection();
  }, [redirectToPricingSection]);

  const handleContinueWithClassicVideoFallback = useCallback(async () => {
    const trimmedPrompt = prompt.trim();
    if (!trimmedPrompt) {
      return;
    }

    const fallbackAspectRatio =
      normalizeSeedanceAspectRatio(aspectRatio, SEEDANCE_15_MODEL) || '16:9';
    const fallbackOptions: Seedance15VideoOptions = {
      aspect_ratio: fallbackAspectRatio,
      resolution: '480p',
      duration: '4',
      fixed_lens: fixedLens,
      generate_audio: false,
    };

    generateAudioPreferenceRef.current.legacy = false;
    setCreditFallback(null);
    handleCancelQueue();
    setModel(SEEDANCE_15_MODEL);
    setLegacyScene('text-to-video');
    setSeedanceMode('text');
    setUseEndFrameControl(false);
    setResolution('480p');
    setDuration('4');
    setGenerateAudio(false);
    setWebSearch(false);
    setGenerationError(null);

    pendingGenerateRequestRef.current = {
      scene: 'text-to-video',
      provider: PROVIDER,
      model: SEEDANCE_15_MODEL,
      prompt: trimmedPrompt,
      options: fallbackOptions,
    };

    setRealPersonMode(false);
    await submitVideoGeneration();
  }, [
    aspectRatio,
    fixedLens,
    handleCancelQueue,
    prompt,
    submitVideoGeneration,
  ]);

  const handleSwitchToImageFallback = useCallback(() => {
    const trimmedPrompt = prompt.trim();
    setCreditFallback(null);
    handleCancelQueue();
    router.push(
      buildGeneratorPromptHref(IMAGE_QUEUE_RETURN_HREF, trimmedPrompt)
    );
  }, [handleCancelQueue, prompt, router]);

  const creditFallbackActions = useMemo(() => {
    if (!creditFallback) {
      return [];
    }

    const actions = [];

    if (
      creditFallback.fallbackOptions.some(
        (option) => option.id === 'video_classic'
      ) &&
      promptReferenceTokens.length === 0
    ) {
      actions.push({
        id: 'video_classic',
        badgeLabel: creditFallbackCopy.standardBadge,
        title: creditFallbackCopy.videoClassicTitle,
        description: creditFallbackCopy.videoClassicDescription,
        creditsLabel: t('credits_cost', {
          credits: VIDEO_CLASSIC_FALLBACK_CREDITS,
        }),
        visualType: 'video' as const,
        onSelect: handleContinueWithClassicVideoFallback,
      });
    }

    if (
      creditFallback.fallbackOptions.some(
        (option) => option.id === 'image_standard'
      )
    ) {
      actions.push({
        id: 'image_standard',
        badgeLabel: creditFallbackCopy.standardBadge,
        title: creditFallbackCopy.imageStandardTitle,
        description: creditFallbackCopy.imageStandardDescription,
        creditsLabel: t('credits_cost', {
          credits: IMAGE_STANDARD_FALLBACK_CREDITS,
        }),
        visualType: 'image' as const,
        onSelect: handleSwitchToImageFallback,
      });
    }

    return actions;
  }, [
    creditFallback,
    creditFallbackCopy,
    handleContinueWithClassicVideoFallback,
    handleSwitchToImageFallback,
    promptReferenceTokens.length,
    t,
  ]);

  useEffect(() => {
    if (!user || (!isQueueActive && !creditFallback)) {
      return;
    }

    let cancelled = false;
    let isRefreshing = false;

    const refreshAccess = async () => {
      if (cancelled || isRefreshing) {
        return;
      }

      isRefreshing = true;

      try {
        const result = await fetchCurrentSubscription({ force: true });

        if (!cancelled && result.ok) {
          await fetchUserCredits();
        }
      } finally {
        isRefreshing = false;
      }
    };

    const handleFocus = () => {
      void refreshAccess();
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        void refreshAccess();
      }
    };

    const intervalId = window.setInterval(() => {
      void refreshAccess();
    }, 15000);

    window.addEventListener('focus', handleFocus);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
      window.removeEventListener('focus', handleFocus);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [
    creditFallback,
    fetchCurrentSubscription,
    fetchUserCredits,
    isQueueActive,
    user,
  ]);

  const handleGenerate = async () => {
    if (!user) {
      setIsShowSignModal(true);
      return;
    }

    let hasQueueBypassAccessForAttempt = hasQueueBypassAccess;

    if (!hasFetchedCurrentSubscription || !hasQueueBypassAccessForAttempt) {
      const subscriptionResult = await fetchCurrentSubscription({
        force: !hasQueueBypassAccessForAttempt,
      });
      if (!subscriptionResult.ok) {
        showGenerationError(queueCopy.membershipCheckingLabel);
        return;
      }
      hasQueueBypassAccessForAttempt = Boolean(
        subscriptionResult.subscription || subscriptionResult.hasPaidEntitlement
      );
    } else if (isFetchingCurrentSubscription) {
      showGenerationError(queueCopy.membershipCheckingLabel);
      return;
    }

    if (hasQueueBypassAccessForAttempt && remainingCredits < costCredits) {
      setCreditFallback(
        createGenerationCreditFallbackPayload({
          mediaType: 'video',
          requestedCostCredits: costCredits,
          remainingCredits,
        })
      );
      return;
    }

    const validationError = validateBeforeGenerate();
    if (validationError) {
      showGenerationError(validationError);
      return;
    }

    setGenerationError(null);
    pendingGenerateRequestRef.current = {
      scene: currentScene,
      provider: PROVIDER,
      model: effectiveModel,
      prompt: prompt.trim(),
      options: currentOptions,
    };

    if (hasQueueBypassAccessForAttempt) {
      await submitVideoGeneration();
      return;
    }

    const queueStartResult = await startQueue({
      forceQueue: true,
    });
    if (queueStartResult.status === 'existing_other_queue') {
      router.push(
        queueStartResult.queue?.scope === 'kling-video'
          ? KLING_QUEUE_RETURN_HREF
          : queueStartResult.queue?.mediaType === 'image'
            ? IMAGE_QUEUE_RETURN_HREF
            : VIDEO_QUEUE_RETURN_HREF
      );
    }
  };

  const handleDownloadAsset = async ({
    id: assetId,
    url,
    fallbackType,
  }: {
    id: string;
    url: string;
    fallbackType: 'mp4' | 'png';
  }) => {
    if (!url) {
      return;
    }

    if (!(await canDownload(fallbackType === 'mp4' ? 'video' : 'image'))) {
      return;
    }

    try {
      setDownloadingAssetId(assetId);
      const resp = await fetch(
        `/api/proxy/file?url=${encodeURIComponent(url)}`
      );
      if (!resp.ok) {
        throw new Error('Failed to fetch asset');
      }

      const blob = await resp.blob();
      const blobUrl = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = blobUrl;
      link.download = `${assetId}.${getFileExtension(url, fallbackType)}`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      setTimeout(() => URL.revokeObjectURL(blobUrl), 200);
      toast.success(t('messages.download_success'));
    } catch (error) {
      console.error('Failed to download asset:', error);
      toast.error(t('errors.download_failed'));
    } finally {
      setDownloadingAssetId(null);
    }
  };

  const getTimedReferenceDetail = useCallback(
    (item: TimedReferenceUploadItem) => {
      const parts: string[] = [];

      if (item.durationSeconds) {
        parts.push(formatSeconds(item.durationSeconds));
      } else {
        parts.push(t('form.pending_metadata'));
      }

      if (
        typeof item.width === 'number' &&
        Number.isFinite(item.width) &&
        typeof item.height === 'number' &&
        Number.isFinite(item.height)
      ) {
        parts.push(`${Math.round(item.width)}x${Math.round(item.height)}`);
      }

      if (shouldUseAssetReferences && seedanceMode === 'multimodal-reference') {
        if (item.assetError) {
          parts.push(item.assetError);
        } else if (item.assetStatus === 'processing') {
          parts.push(t('form.asset_processing'));
        } else if (item.assetStatus === 'active') {
          parts.push(t('badges.asset-ready'));
        }
      }

      if (item.error) {
        parts.push(item.error);
      }

      return parts.join(' · ');
    },
    [seedanceMode, shouldUseAssetReferences, t]
  );

  const isGenerateDisabled =
    isGenerating ||
    !prompt.trim() ||
    isPromptTooLong ||
    isReferenceUploading ||
    hasReferenceUploadError ||
    hasReferenceAssetsProcessing;

  const aspectRatioOptions = isLegacyModel
    ? SEEDANCE_15_ALLOWED_ASPECT_RATIOS
    : SEEDANCE_2_ALLOWED_ASPECT_RATIOS;

  return (
    <section id={id} className="py-16 md:py-24">
      <div className="container">
        <div className="mx-auto max-w-6xl">
          <div className="grid grid-cols-1 gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
            <Card>
              <CardHeader>
                {srOnlyTitle && <h2 className="sr-only">{srOnlyTitle}</h2>}
              </CardHeader>
              <CardContent className="space-y-6 pb-8">
                <div className="space-y-2">
                  <Label>{t('form.creation_mode')}</Label>
                  <Tabs
                    value={currentCreatorMode}
                    onValueChange={handleCreatorModeChange}
                  >
                    <TabsList
                      className={cn(
                        'bg-primary/10 grid w-full gap-2',
                        isLegacyModel ? 'grid-cols-2' : 'grid-cols-3'
                      )}
                    >
                      {!isLegacyModel && (
                        <TabsTrigger
                          value="advanced-reference"
                          className="text-xs sm:text-sm"
                        >
                          {t('form.creator_modes.advanced-reference')}
                        </TabsTrigger>
                      )}
                      <TabsTrigger
                        value="text-to-video"
                        className="text-xs sm:text-sm"
                      >
                        {t('form.creator_modes.text-to-video')}
                      </TabsTrigger>
                      <TabsTrigger
                        value="image-to-video"
                        className="text-xs sm:text-sm"
                      >
                        {t('form.creator_modes.image-to-video')}
                      </TabsTrigger>
                    </TabsList>
                  </Tabs>
                </div>

                {isModelSelectorVisible && (
                  <div className="space-y-2">
                    <Label htmlFor="video-model">{t('form.model')}</Label>
                    <Select value={model} onValueChange={handleModelChange}>
                      <SelectTrigger
                        id="video-model"
                        className="w-full sm:w-[16rem]"
                      >
                        <SelectValue>
                          {selectedModelOption &&
                            renderModelOptionLabel(selectedModelOption)}
                        </SelectValue>
                      </SelectTrigger>
                      <SelectContent>
                        {modelOptions.map((option) => (
                          <SelectItem key={option.value} value={option.value}>
                            {renderModelOptionLabel(option)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}

                {canUseRealPersonMode && (
                  <div className="space-y-3 rounded-lg border p-4">
                    <div className="flex items-start justify-between gap-4">
                      <div className="space-y-1">
                        <div className="flex items-center gap-2 text-sm font-medium">
                          <span>
                            {t.has('form.real_person_mode')
                              ? t('form.real_person_mode')
                              : 'Real Person Mode'}
                          </span>
                          <Badge
                            variant="outline"
                            className="rounded-full border-orange-300/70 bg-orange-200 px-2 py-0 text-[10px] leading-5 font-semibold tracking-[0.04em] text-orange-950"
                          >
                            {t.has('models.new') ? t('models.new') : 'NEW'}
                          </Badge>
                          <span className="text-primary ml-1">(+20%)</span>
                        </div>
                        <p className="text-muted-foreground text-xs leading-5">
                          {t.has('form.real_person_mode_hint')
                            ? t('form.real_person_mode_hint')
                            : 'Use the face-enabled model for real-person references and portrait-driven clips.'}
                        </p>
                      </div>
                      <Switch
                        checked={realPersonMode}
                        onCheckedChange={setRealPersonMode}
                        aria-label={
                          t.has('form.real_person_mode')
                            ? t('form.real_person_mode')
                            : 'Real Person Mode'
                        }
                      />
                    </div>
                  </div>
                )}

                <div className="space-y-2">
                  <Label htmlFor="video-prompt">{t('form.prompt')}</Label>
                  <div className="space-y-3">
                    {isSeedance2xModel &&
                      seedanceMode === 'multimodal-reference' &&
                      availablePromptReferences.length > 0 && (
                        <div className="space-y-2 rounded-lg border border-dashed p-3">
                          <p className="text-muted-foreground text-xs">
                            {t('form.prompt_reference_hint')}
                          </p>
                          <div className="flex flex-wrap gap-2">
                            {availablePromptReferences.map((item) => (
                              <Button
                                key={item.token}
                                type="button"
                                variant="outline"
                                size="sm"
                                className="h-8 rounded-full px-3 text-xs"
                                onMouseDown={(event) => event.preventDefault()}
                                onClick={() =>
                                  insertPromptReferenceToken(item.token)
                                }
                              >
                                {item.token}
                              </Button>
                            ))}
                          </div>
                        </div>
                      )}
                    <div className="relative">
                      <Textarea
                        id="video-prompt"
                        ref={promptTextareaRef}
                        value={prompt}
                        onChange={(e) => {
                          setPrompt(e.target.value);
                          setPromptSelectionStart(
                            e.target.selectionStart ?? e.target.value.length
                          );
                        }}
                        onSelect={syncPromptSelection}
                        onClick={syncPromptSelection}
                        onKeyUp={syncPromptSelection}
                        onFocus={syncPromptSelection}
                        placeholder={promptPlaceholder}
                        className="min-h-32"
                      />
                      {activePromptReferenceQuery &&
                        filteredPromptReferenceSuggestions.length > 0 && (
                          <div className="bg-background absolute top-full right-0 left-0 z-20 mt-2 rounded-lg border shadow-lg">
                            <div className="p-2">
                              {filteredPromptReferenceSuggestions.map(
                                (item) => (
                                  <button
                                    key={item.token}
                                    type="button"
                                    className="hover:bg-muted flex w-full items-center justify-between rounded-md px-3 py-2 text-left transition-colors"
                                    onMouseDown={(event) =>
                                      event.preventDefault()
                                    }
                                    onClick={() =>
                                      insertPromptReferenceToken(item.token)
                                    }
                                  >
                                    <span className="text-sm font-medium">
                                      {item.token}
                                    </span>
                                    <span className="text-muted-foreground ml-3 truncate text-xs">
                                      {item.label}
                                    </span>
                                  </button>
                                )
                              )}
                            </div>
                          </div>
                        )}
                    </div>
                  </div>
                  <div className="text-muted-foreground flex items-center justify-between text-xs">
                    <span>
                      {promptLength} / {MAX_PROMPT_LENGTH}
                    </span>
                    {isPromptTooLong && (
                      <span className="text-destructive">
                        {t('form.prompt_too_long')}
                      </span>
                    )}
                  </div>
                </div>

                {isLegacyModel && legacyScene === 'image-to-video' && (
                  <div className="space-y-4">
                    <ImageUploader
                      title={t('form.reference_image')}
                      allowMultiple={true}
                      maxImages={2}
                      maxSizeMB={maxSizeMB}
                      acceptedMimeTypes={[
                        'image/jpeg',
                        'image/png',
                        'image/webp',
                      ]}
                      defaultPreviews={legacyImageUrls}
                      onChange={handleLegacyImagesChange}
                      emptyHint={t('form.reference_image_placeholder')}
                    />
                  </div>
                )}

                {isSeedance2xModel &&
                  currentCreatorMode === 'image-to-video' && (
                    <div className="space-y-4">
                      <div className="flex items-start justify-between gap-4 rounded-lg border p-4">
                        <div className="space-y-1">
                          <div className="text-sm font-medium">
                            {t('form.add_end_frame_control')}
                          </div>
                          <p className="text-muted-foreground text-xs leading-5">
                            {t('form.add_end_frame_control_hint')}
                          </p>
                        </div>
                        <Switch
                          checked={useEndFrameControl}
                          onCheckedChange={handleEndFrameControlChange}
                          aria-label={t('form.add_end_frame_control')}
                        />
                      </div>

                      <div className="grid items-start gap-4 md:grid-cols-2">
                        <ImageUploader
                          title={t('form.first_frame')}
                          allowMultiple={false}
                          maxImages={1}
                          maxSizeMB={maxSizeMB}
                          acceptedMimeTypes={[
                            'image/jpeg',
                            'image/png',
                            'image/webp',
                          ]}
                          defaultPreviews={firstFrameUrls}
                          onChange={handleFirstFrameChange}
                          emptyHint={t('form.first_frame_placeholder')}
                        />

                        {useEndFrameControl ? (
                          <ImageUploader
                            title={t('form.last_frame')}
                            allowMultiple={false}
                            maxImages={1}
                            maxSizeMB={maxSizeMB}
                            acceptedMimeTypes={[
                              'image/jpeg',
                              'image/png',
                              'image/webp',
                            ]}
                            defaultPreviews={lastFrameUrls}
                            onChange={handleLastFrameChange}
                            emptyHint={t('form.last_frame_placeholder')}
                          />
                        ) : (
                          <div className="hidden md:block" aria-hidden="true" />
                        )}
                      </div>
                    </div>
                  )}

                {isSeedance2xModel &&
                  currentCreatorMode === 'advanced-reference' && (
                    <div className="space-y-4">
                      <ImageUploader
                        title={t('form.reference_images')}
                        allowMultiple={true}
                        maxImages={maxReferenceImagesAllowed}
                        maxSizeMB={maxSizeMB}
                        acceptedMimeTypes={[
                          'image/jpeg',
                          'image/png',
                          'image/webp',
                        ]}
                        defaultPreviews={referenceImageUrls}
                        onChange={handleReferenceImagesChange}
                        emptyHint={t('form.reference_images_placeholder')}
                      />

                      {SHOW_VIRTUAL_CHARACTER_MODE_TOGGLE && (
                        <div className="space-y-3 rounded-lg border p-4">
                          <div className="flex items-start justify-between gap-4">
                            <div className="space-y-1">
                              <div className="text-sm font-medium">
                                {t('form.virtual_character_mode')}
                              </div>
                              <p className="text-muted-foreground text-xs leading-5">
                                {t('form.virtual_character_mode_hint')}
                              </p>
                            </div>
                            <Switch
                              checked={useVirtualCharacterMode}
                              onCheckedChange={setUseVirtualCharacterMode}
                              aria-label={t('form.virtual_character_mode')}
                            />
                          </div>
                        </div>
                      )}

                      {shouldUseAssetReferences &&
                        referenceImageAssets.length > 0 && (
                          <div className="space-y-3 rounded-lg border p-4">
                            <div className="space-y-1">
                              <div className="flex items-center gap-2 text-sm font-medium">
                                <ImageIcon className="h-4 w-4" />
                                {t('form.asset_status')}
                              </div>
                            </div>
                            <div className="space-y-2">
                              {referenceImageAssets.map((item, index) => (
                                <div
                                  key={item.id}
                                  className="flex items-center justify-between rounded-md border px-3 py-2"
                                >
                                  <div className="min-w-0 flex-1">
                                    <p className="truncate text-sm font-medium">
                                      {getFileNameFromUrl(
                                        item.url,
                                        `${t('form.reference_image')} ${index + 1}`
                                      )}
                                    </p>
                                    <p className="text-muted-foreground text-xs">
                                      {item.error
                                        ? item.error
                                        : getAssetBadgeLabel(item.status)}
                                    </p>
                                  </div>
                                  <div className="ml-3 flex items-center gap-2">
                                    <Badge variant="secondary">
                                      @{item.promptAlias}
                                    </Badge>
                                    <Badge variant="outline">
                                      {getAssetBadgeLabel(item.status)}
                                    </Badge>
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}

                      <div className="space-y-3 rounded-lg border p-4">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2 text-sm font-medium">
                            <Video className="h-4 w-4" />
                            {t('form.reference_videos')}
                          </div>
                          <span className="text-muted-foreground text-xs">
                            (
                            {t('form.reference_videos_limit', {
                              max: SEEDANCE_2_REFERENCE_VIDEO_MAX_ITEMS,
                              duration: '15s',
                            })}
                            )
                          </span>
                        </div>
                        <input
                          id="seedance-reference-video-upload"
                          className="sr-only"
                          type="file"
                          accept={SEEDANCE_2_REFERENCE_VIDEO_UPLOAD_MIME_TYPES.join(
                            ','
                          )}
                          multiple
                          disabled={
                            referenceVideoItems.length >=
                            SEEDANCE_2_REFERENCE_VIDEO_MAX_ITEMS
                          }
                          onChange={(event) => {
                            handleTimedReferenceUpload(
                              'video',
                              event.target.files
                            );
                            event.currentTarget.value = '';
                          }}
                        />
                        <label
                          htmlFor={
                            referenceVideoItems.length >=
                            SEEDANCE_2_REFERENCE_VIDEO_MAX_ITEMS
                              ? undefined
                              : 'seedance-reference-video-upload'
                          }
                          className={cn(
                            'flex min-h-28 cursor-pointer flex-col items-center justify-center rounded-xl border border-dashed px-4 py-5 text-center transition-colors',
                            referenceVideoItems.length >=
                              SEEDANCE_2_REFERENCE_VIDEO_MAX_ITEMS
                              ? 'cursor-not-allowed opacity-50'
                              : 'hover:border-primary/40 hover:bg-muted/40'
                          )}
                        >
                          <Upload className="text-primary mb-3 h-5 w-5" />
                          <p className="text-sm font-medium">
                            {t('form.upload_reference_video')}
                          </p>
                          <p className="text-muted-foreground mt-1 text-xs">
                            MP4, MOV
                          </p>
                        </label>
                        {apimartReferenceVideoNotice ? (
                          <p className="text-muted-foreground text-xs leading-5">
                            {apimartReferenceVideoNotice}
                          </p>
                        ) : null}
                        <div className="space-y-2">
                          {referenceVideoItems.map((item) => (
                            <div
                              key={item.id}
                              className="bg-muted/20 flex items-center justify-between rounded-xl border px-3 py-3"
                            >
                              <div className="min-w-0 flex-1">
                                <p className="truncate text-sm font-medium">
                                  {item.name}
                                </p>
                                <p className="text-muted-foreground text-xs">
                                  {getTimedReferenceDetail(item)}
                                </p>
                              </div>
                              <div className="ml-3 flex items-center gap-2">
                                <Badge variant="secondary">
                                  @{item.promptAlias}
                                </Badge>
                                <Badge variant="outline">
                                  {getTimedReferenceBadgeLabel(item)}
                                </Badge>
                                <Button
                                  type="button"
                                  size="icon"
                                  variant="ghost"
                                  onClick={() =>
                                    removeTimedReferenceItem('video', item.id)
                                  }
                                >
                                  <Trash2 className="h-4 w-4" />
                                </Button>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>

                      <div className="space-y-3 rounded-lg border p-4">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2 text-sm font-medium">
                            <Music4 className="h-4 w-4" />
                            {t('form.reference_audios')}
                          </div>
                          <span className="text-muted-foreground text-xs">
                            (
                            {t('form.reference_audios_limit', {
                              max: SEEDANCE_2_REFERENCE_AUDIO_MAX_ITEMS,
                              duration: '15s',
                            })}
                            )
                          </span>
                        </div>
                        <input
                          id="seedance-reference-audio-upload"
                          className="sr-only"
                          type="file"
                          accept={SEEDANCE_2_REFERENCE_AUDIO_UPLOAD_MIME_TYPES.join(
                            ','
                          )}
                          multiple
                          disabled={
                            referenceAudioItems.length >=
                            SEEDANCE_2_REFERENCE_AUDIO_MAX_ITEMS
                          }
                          onChange={(event) => {
                            handleTimedReferenceUpload(
                              'audio',
                              event.target.files
                            );
                            event.currentTarget.value = '';
                          }}
                        />
                        <label
                          htmlFor={
                            referenceAudioItems.length >=
                            SEEDANCE_2_REFERENCE_AUDIO_MAX_ITEMS
                              ? undefined
                              : 'seedance-reference-audio-upload'
                          }
                          className={cn(
                            'flex min-h-28 cursor-pointer flex-col items-center justify-center rounded-xl border border-dashed px-4 py-5 text-center transition-colors',
                            referenceAudioItems.length >=
                              SEEDANCE_2_REFERENCE_AUDIO_MAX_ITEMS
                              ? 'cursor-not-allowed opacity-50'
                              : 'hover:border-primary/40 hover:bg-muted/40'
                          )}
                        >
                          <Upload className="text-primary mb-3 h-5 w-5" />
                          <p className="text-sm font-medium">
                            {t('form.upload_reference_audio')}
                          </p>
                          <p className="text-muted-foreground mt-1 text-xs">
                            MP3, WAV
                          </p>
                        </label>
                        <div className="space-y-2">
                          {referenceAudioItems.map((item) => (
                            <div
                              key={item.id}
                              className="bg-muted/20 flex items-center justify-between rounded-xl border px-3 py-3"
                            >
                              <div className="min-w-0 flex-1">
                                <p className="truncate text-sm font-medium">
                                  {item.name}
                                </p>
                                <p className="text-muted-foreground text-xs">
                                  {getTimedReferenceDetail(item)}
                                </p>
                              </div>
                              <div className="ml-3 flex items-center gap-2">
                                <Badge variant="secondary">
                                  @{item.promptAlias}
                                </Badge>
                                <Badge variant="outline">
                                  {getTimedReferenceBadgeLabel(item)}
                                </Badge>
                                <Button
                                  type="button"
                                  size="icon"
                                  variant="ghost"
                                  onClick={() =>
                                    removeTimedReferenceItem('audio', item.id)
                                  }
                                >
                                  <Trash2 className="h-4 w-4" />
                                </Button>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  )}

                {hasReferenceUploadError && (
                  <p className="text-destructive text-xs">
                    {t('form.upload_failed')}
                  </p>
                )}

                <div className="bg-muted/30 space-y-4 rounded-lg border p-4">
                  <h3 className="text-sm font-semibold">
                    {t('form.video_settings')}
                  </h3>

                  <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                    <div className="space-y-2">
                      <Label htmlFor="aspect-ratio">
                        {t('form.aspect_ratio')}
                      </Label>
                      <Select
                        value={aspectRatio}
                        onValueChange={setAspectRatio}
                      >
                        <SelectTrigger id="aspect-ratio">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {aspectRatioOptions.map((ratio) => (
                            <SelectItem key={ratio} value={ratio}>
                              {ratio === 'adaptive'
                                ? t('form.aspect_ratio_adaptive')
                                : t(
                                    `form.aspect_ratio_${ratio.replace(':', '_')}`
                                  )}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="resolution">{t('form.resolution')}</Label>
                      <Select value={resolution} onValueChange={setResolution}>
                        <SelectTrigger id="resolution">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="480p">
                            {t('form.resolution_480p')}
                          </SelectItem>
                          <SelectItem value="720p">
                            {t('form.resolution_720p')}
                          </SelectItem>
                          {isLegacyModel && (
                            <SelectItem value="1080p">
                              {t('form.resolution_1080p')}
                            </SelectItem>
                          )}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  {isLegacyModel ? (
                    <div className="space-y-2">
                      <Label>{t('form.duration')}</Label>
                      <Tabs value={duration} onValueChange={setDuration}>
                        <TabsList className="grid w-full grid-cols-3">
                          {SEEDANCE_15_ALLOWED_DURATIONS.map((item) => (
                            <TabsTrigger key={item} value={item}>
                              {item}s
                            </TabsTrigger>
                          ))}
                        </TabsList>
                      </Tabs>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      <div className="flex items-center justify-between">
                        <Label htmlFor="duration-range">
                          {t('form.duration')}
                        </Label>
                        <span className="text-sm font-medium">{duration}s</span>
                      </div>
                      <input
                        id="duration-range"
                        type="range"
                        min={SEEDANCE_2_MIN_DURATION}
                        max={SEEDANCE_2_MAX_DURATION}
                        step={1}
                        value={duration}
                        onChange={(event) => setDuration(event.target.value)}
                        className="accent-primary w-full"
                      />
                      <div className="text-muted-foreground flex justify-between text-xs">
                        <span>{SEEDANCE_2_MIN_DURATION}s</span>
                        <span>{SEEDANCE_2_MAX_DURATION}s</span>
                      </div>
                    </div>
                  )}

                  <div className="rounded-md border p-3">
                    <div className="flex items-start space-x-2">
                      <Checkbox
                        id="generate-audio"
                        checked={generateAudio}
                        onCheckedChange={(checked) =>
                          handleGenerateAudioChange(checked === true)
                        }
                        aria-describedby="generate-audio-desc"
                      />
                      <div className="grid gap-1.5 leading-none">
                        <Label
                          htmlFor="generate-audio"
                          className="cursor-pointer text-sm font-medium"
                        >
                          {t('form.generate_audio')}
                          <span className="text-primary ml-1">(+60)</span>
                        </Label>
                      </div>
                    </div>
                  </div>

                  <Collapsible>
                    <CollapsibleTrigger className="flex items-center gap-2 text-sm font-medium hover:underline">
                      {t('form.advanced_options')}
                      <ChevronDown className="h-4 w-4" />
                    </CollapsibleTrigger>
                    <CollapsibleContent className="space-y-3 pt-3">
                      {isLegacyModel ? (
                        <div className="flex items-start space-x-2">
                          <Checkbox
                            id="fixed-lens"
                            checked={fixedLens}
                            onCheckedChange={(checked) =>
                              setFixedLens(checked === true)
                            }
                          />
                          <Label
                            htmlFor="fixed-lens"
                            className="cursor-pointer text-sm font-medium"
                          >
                            {t('form.fixed_lens')}
                          </Label>
                        </div>
                      ) : canUseWebSearch ? (
                        <>
                          <div className="flex items-start space-x-2">
                            <Checkbox
                              id="web-search"
                              checked={webSearch}
                              onCheckedChange={(checked) =>
                                setWebSearch(checked === true)
                              }
                            />
                            <Label
                              htmlFor="web-search"
                              className="cursor-pointer text-sm font-medium"
                            >
                              {t('form.web_search')}
                            </Label>
                          </div>
                        </>
                      ) : null}
                    </CollapsibleContent>
                  </Collapsible>
                </div>

                {!isMounted ? (
                  <Button className="w-full" disabled size="lg">
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    {t('loading')}
                  </Button>
                ) : isCheckSign ? (
                  <Button className="w-full" disabled size="lg">
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    {t('checking_account')}
                  </Button>
                ) : user ? (
                  <Button
                    size="lg"
                    className="w-full"
                    onClick={handleGenerate}
                    disabled={
                      isQueueActive ||
                      isGenerateDisabled ||
                      isFetchingCurrentSubscription
                    }
                  >
                    {isQueueActive ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        {queueCopy.waitingButtonLabel}
                      </>
                    ) : isGenerating ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        {t('generating')}
                      </>
                    ) : isFetchingCurrentSubscription ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        {t('loading')}
                      </>
                    ) : (
                      <>
                        <Sparkles className="mr-2 h-4 w-4" />
                        {t('generate')}
                      </>
                    )}
                  </Button>
                ) : (
                  <Button
                    size="lg"
                    className="w-full"
                    onClick={() => setIsShowSignModal(true)}
                  >
                    <User className="mr-2 h-4 w-4" />
                    {t('sign_in_to_generate')}
                  </Button>
                )}

                {!isMounted ? (
                  <div
                    className={cn(
                      'flex items-center text-sm',
                      showCreditsCost ? 'justify-between' : 'justify-end'
                    )}
                  >
                    {showCreditsCost ? (
                      <span className="text-primary">
                        {t('credits_cost', { credits: costCredits })}
                      </span>
                    ) : null}
                    <span>{t('credits_remaining', { credits: 0 })}</span>
                  </div>
                ) : user && remainingCredits > 0 ? (
                  <div className="space-y-2">
                    <div
                      className={cn(
                        'flex items-center text-sm',
                        showCreditsCost ? 'justify-between' : 'justify-end'
                      )}
                    >
                      {showCreditsCost ? (
                        <span className="text-primary font-medium">
                          {t('credits_cost', { credits: costCredits })}
                        </span>
                      ) : null}
                      <span className="text-muted-foreground">
                        {t('credits_remaining', { credits: remainingCredits })}
                      </span>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-3">
                    <div
                      className={cn(
                        'flex items-center text-sm',
                        showCreditsCost ? 'justify-between' : 'justify-end'
                      )}
                    >
                      {showCreditsCost ? (
                        <span className="text-primary">
                          {t('credits_cost', { credits: costCredits })}
                        </span>
                      ) : null}
                      <span>
                        {t('credits_remaining', { credits: remainingCredits })}
                      </span>
                    </div>
                    <Link href="/pricing">
                      <Button variant="outline" className="w-full" size="lg">
                        <CreditCard className="mr-2 h-4 w-4" />
                        {t('buy_credits')}
                      </Button>
                    </Link>
                  </div>
                )}

                {generationError ? (
                  <div className="border-destructive/30 bg-destructive/5 rounded-lg border p-4">
                    <div className="flex items-start gap-3">
                      <AlertCircle className="text-destructive mt-0.5 h-4 w-4 shrink-0" />
                      <div className="min-w-0">
                        <p className="text-destructive text-sm leading-6 break-words">
                          {generationError}
                        </p>
                      </div>
                    </div>
                  </div>
                ) : null}

                {isQueueActive && queueState ? (
                  <MembershipPriorityQueueCard
                    title={queueCopy.title}
                    description={queueCopy.description}
                    taskLabel={queueCopy.taskLabel}
                    remainingLabel={queueCopy.remainingLabel}
                    remainingMs={queueState.remainingMs}
                    upgradeLabel={queueCopy.upgradeLabel}
                    cancelLabel={queueCopy.cancelLabel}
                    submittingLabel={queueCopy.submittingLabel}
                    onCancel={handleCancelQueue}
                    onUpgradeClick={handleUpgradeFromQueue}
                    onRetry={isCurrentRequestRetryable ? retryQueue : undefined}
                    isSubmitting={isQueueSubmitting}
                    isSubmitFailed={isCurrentRequestRetryable}
                    retryLabel={queueCopy.retryLabel}
                    submitFailedLabel={queueCopy.submitFailedLabel}
                  />
                ) : isGenerating ? (
                  <div className="space-y-2 rounded-lg border p-4">
                    <div className="flex items-center justify-between text-sm">
                      <span>{t('progress')}</span>
                      <span>{progress}%</span>
                    </div>
                    <Progress value={progress} />
                    {taskStatusLabel && (
                      <p className="text-muted-foreground text-center text-xs">
                        {taskStatusLabel}
                      </p>
                    )}
                  </div>
                ) : null}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-xl font-semibold">
                  <Video className="h-5 w-5" />
                  {t('generated_results')}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-6 pb-8">
                {generatedVideos.length > 0 && (
                  <div className="space-y-4">
                    <div className="flex items-center gap-2">
                      <Video className="h-4 w-4" />
                      <h3 className="text-sm font-semibold">
                        {t('generated_videos')}
                      </h3>
                    </div>
                    {generatedVideos.map((video) => (
                      <div key={video.id} className="space-y-3">
                        <div className="relative overflow-hidden rounded-lg border">
                          <video
                            src={video.url}
                            controls
                            controlsList="nodownload"
                            className="h-auto w-full"
                            preload="metadata"
                          />
                          <div className="absolute right-2 bottom-2 flex justify-end text-sm">
                            <Button
                              size="sm"
                              variant="ghost"
                              className="ml-auto"
                              onClick={() =>
                                handleDownloadAsset({
                                  id: video.id,
                                  url: video.url,
                                  fallbackType: 'mp4',
                                })
                              }
                              disabled={downloadingAssetId === video.id}
                            >
                              {downloadingAssetId === video.id ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                              ) : (
                                <Download className="h-4 w-4" />
                              )}
                            </Button>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {generatedImages.length > 0 && (
                  <div className="space-y-4">
                    <div className="flex items-center gap-2">
                      <ImageIcon className="h-4 w-4" />
                      <h3 className="text-sm font-semibold">
                        {t('generated_images')}
                      </h3>
                    </div>
                    <div className="grid gap-4 md:grid-cols-2">
                      {generatedImages.map((image) => (
                        <div key={image.id} className="space-y-3">
                          <div className="overflow-hidden rounded-lg border">
                            <img
                              src={image.url}
                              alt={image.prompt || 'Generated frame'}
                              className="h-auto w-full object-cover"
                            />
                          </div>
                          <Button
                            size="sm"
                            variant="outline"
                            className="w-full"
                            onClick={() =>
                              handleDownloadAsset({
                                id: image.id,
                                url: image.url,
                                fallbackType: 'png',
                              })
                            }
                            disabled={downloadingAssetId === image.id}
                          >
                            {downloadingAssetId === image.id ? (
                              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                            ) : (
                              <Download className="mr-2 h-4 w-4" />
                            )}
                            {t('download_image')}
                          </Button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {generatedVideos.length === 0 &&
                  generatedImages.length === 0 &&
                  (isGenerating ? (
                    <div className="flex flex-col items-center justify-center py-16 text-center">
                      <div className="bg-muted mb-4 flex h-16 w-16 items-center justify-center rounded-full">
                        <Upload className="text-muted-foreground h-10 w-10" />
                      </div>
                      <p className="text-muted-foreground">
                        {t('ready_to_generate')}
                      </p>
                    </div>
                  ) : showDemoPreview ? (
                    <div className="space-y-4">
                      <div className="mx-auto w-full lg:max-w-[67%]">
                        <LazyDemoVideo video={selectedDemoVideo} />
                      </div>

                      <div className="flex justify-center gap-2">
                        {DEFAULT_DEMO_VIDEOS.map((videoUrl, index) => (
                          <Button
                            key={videoUrl.webm}
                            type="button"
                            size="sm"
                            variant={
                              selectedDemoVideoIndex === index
                                ? 'default'
                                : 'outline'
                            }
                            onClick={() => setSelectedDemoVideoIndex(index)}
                          >
                            {index + 1}
                          </Button>
                        ))}
                      </div>

                      <p className="text-muted-foreground text-center text-sm">
                        {t('no_results_generated')}
                      </p>
                    </div>
                  ) : (
                    <div className="flex flex-col items-center justify-center py-16 text-center">
                      <div className="bg-muted mb-4 flex h-16 w-16 items-center justify-center rounded-full">
                        <Video className="text-muted-foreground h-10 w-10" />
                      </div>
                      <p className="text-muted-foreground">
                        {t('no_results_generated')}
                      </p>
                    </div>
                  ))}
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
      <GenerationCreditFallbackDialog
        open={Boolean(creditFallback)}
        onOpenChange={(open) => {
          if (!open) {
            handleCloseCreditFallback();
          }
        }}
        title={creditFallbackCopy.title}
        description={creditFallbackCopy.description}
        currentModeLabel={creditFallbackCopy.currentModeLabel}
        currentModeValue={t('credits_cost', {
          credits: creditFallback?.requestedCostCredits ?? costCredits,
        })}
        remainingCreditsLabel={creditFallbackCopy.remainingCreditsLabel}
        remainingCreditsValue={t('credits_remaining', {
          credits: creditFallback?.remainingCredits ?? remainingCredits,
        })}
        switchLabel={creditFallbackCopy.switchLabel}
        upgradeLabel={creditFallbackCopy.upgradeLabel}
        closeLabel={creditFallbackCopy.closeLabel}
        onUpgrade={handleUpgradeFromCreditFallback}
        actions={creditFallbackActions}
        earnTitle={
          t.has('credit_fallback.earn_title')
            ? t('credit_fallback.earn_title')
            : 'Free ways to get credits'
        }
        earnActions={creditEarnActions}
      />
      <PaidDownloadDialog {...paidDownloadDialogProps} />
    </section>
  );
}
