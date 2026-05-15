'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import {
  ChevronDown,
  Clapperboard,
  Download,
  Loader2,
  Music4,
  Plus,
  Sparkles,
  Trash2,
  Upload,
  User,
  Video,
} from 'lucide-react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';

import { useRouter } from '@/core/i18n/navigation';
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
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/shared/components/ui/card';
import { Checkbox } from '@/shared/components/ui/checkbox';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/shared/components/ui/collapsible';
import { Input } from '@/shared/components/ui/input';
import { Label } from '@/shared/components/ui/label';
import { Progress } from '@/shared/components/ui/progress';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/shared/components/ui/select';
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
import {
  calculateKlingCredits,
  KLING_ASPECT_RATIO_OPTIONS,
  KLING_ELEMENT_IMAGE_MAX_BYTES,
  KLING_ELEMENT_IMAGE_MIME_TYPES,
  KLING_ELEMENT_IMAGE_MIN_DIMENSION,
  KLING_GENERATOR_PRESET_EVENT,
  KLING_GENERATOR_PRESET_STORAGE_KEY,
  KLING_IMAGE_ELEMENT_MAX_IMAGES,
  KLING_IMAGE_UPLOAD_INPUT_MIME_TYPES,
  KLING_MAX_DURATION,
  KLING_MAX_ELEMENTS,
  KLING_MAX_REFERENCE_IMAGES,
  KLING_MAX_STORY_REFERENCE_IMAGES,
  KLING_MIN_DURATION,
  KLING_STORY_SHOT_MAX_DURATION,
  KLING_STORY_SHOT_MIN_DURATION,
  KLING_VIDEO_MODEL,
  KLING_VIDEO_UPLOAD_MAX_BYTES,
  KLING_VIDEO_UPLOAD_MIME_TYPES,
  KlingGeneratorPreset,
  KlingVideoOptions,
  KlingVideoQuality,
  normalizeKlingElementToken,
  validateKlingVideoOptions,
} from '@/shared/lib/kling-video';
import { resolvePriorityQueueWaitRangeMs } from '@/shared/lib/membership-priority-queue-config';
import {
  dispatchSeedanceGeneratorPrefill,
  SEEDANCE_15_MODEL,
} from '@/shared/lib/seedance-video';
import { cn } from '@/shared/lib/utils';

type CreateMode = 'single-scene' | 'story-mode';
type UploadKind = 'image' | 'video';
type MediaStatus = 'idle' | 'uploading' | 'uploaded' | 'error';

const DEFAULT_SHOWCASE_PREVIEW_VIDEO =
  'https://cdn.see-dance2.org/uploads/demo-videos/seedance2-demo-13.webm';

type PromptFocus = { type: 'main' } | { type: 'shot'; shotId: string } | null;

interface UploadItem {
  id: string;
  name: string;
  kind: UploadKind;
  status: MediaStatus;
  preview: string;
  url?: string;
  error?: string;
}

interface ShotDraft {
  id: string;
  title: string;
  prompt: string;
  duration: number;
}

interface ElementDraft {
  id: string;
  name: string;
  description: string;
  mediaType: 'images' | 'video';
  images: UploadItem[];
  video: UploadItem | null;
}

interface GeneratedVideo {
  id: string;
  url: string;
  model: string;
  prompt: string;
}

interface BackendTask {
  id: string;
  status: string;
  provider: string;
  model: string;
  prompt: string | null;
  taskId?: string | null;
  taskInfo: string | null;
}

interface KlingDraftState {
  createMode: CreateMode;
  prompt: string;
  duration: number;
  quality: KlingVideoQuality;
  sound: boolean;
  aspectRatio: string;
  referenceImages: Array<{ id: string; name: string; url: string }>;
  shots: ShotDraft[];
  elements: Array<{
    id: string;
    name: string;
    description: string;
    mediaType: 'images' | 'video';
    images: Array<{ id: string; name: string; url: string }>;
    video: { id: string; name: string; url: string } | null;
  }>;
}

interface UseCaseShotPrefill {
  title?: string;
  prompt: string;
  duration: number;
}

interface UseCaseElementPrefill {
  name: string;
  description: string;
}

interface PendingKlingGenerationRequest {
  scene: 'text-to-video' | 'image-to-video';
  provider: string;
  model: string;
  prompt?: string;
  options: KlingVideoOptions;
}

const KLING_DRAFT_KEY = 'kling-3-generator-draft';
const POLL_INTERVAL = 15000;
const GENERATION_TIMEOUT = 900000;
const MAX_PROMPT_LENGTH = 2500;
const KLING_QUEUE_SCOPE = 'kling-video';
const IMAGE_QUEUE_RETURN_HREF = '/ai-image';
const VIDEO_QUEUE_RETURN_HREF = '/ai-video';
const KLING_QUEUE_RETURN_HREF = '/ai-video?model=kling';
const KLING_PREVIEW_SURFACE_CLASS_NAME =
  'flex min-h-[240px] items-center justify-center overflow-hidden rounded-2xl border border-stone-200 bg-black shadow-sm sm:min-h-[280px] lg:min-h-[320px] dark:border-white/10';

function clampShotDuration(value: number) {
  return Math.min(
    KLING_STORY_SHOT_MAX_DURATION,
    Math.max(KLING_STORY_SHOT_MIN_DURATION, value)
  );
}

function createId(prefix: string) {
  return `${prefix}-${Math.random().toString(36).slice(2, 9)}`;
}

function createShotDraft(duration = 3): ShotDraft {
  return {
    id: createId('shot'),
    title: '',
    prompt: '',
    duration: clampShotDuration(duration),
  };
}

function createElementDraft(): ElementDraft {
  return {
    id: createId('element'),
    name: '',
    description: '',
    mediaType: 'images',
    images: [],
    video: null,
  };
}

function hasElementDraftContent(
  element: Pick<ElementDraft, 'name' | 'description' | 'images' | 'video'>
) {
  return Boolean(
    element.name.trim() ||
      element.description.trim() ||
      element.images.length > 0 ||
      element.video
  );
}

function normalizeCreateModeValue(
  value: string | null | undefined
): CreateMode {
  return value === 'story' || value === 'story-mode'
    ? 'story-mode'
    : 'single-scene';
}

function normalizeAspectRatioValue(value: string | null | undefined) {
  const normalized = value?.trim() ?? '';

  if (
    KLING_ASPECT_RATIO_OPTIONS.includes(
      normalized as (typeof KLING_ASPECT_RATIO_OPTIONS)[number]
    )
  ) {
    return normalized;
  }

  return '16:9';
}

function shouldAutoOpenAdvancedControls({
  quality,
  sound,
  aspectRatio,
  elementsCount,
}: {
  quality: KlingVideoQuality;
  sound: boolean;
  aspectRatio?: string | null;
  elementsCount: number;
}) {
  return (
    quality === 'pro' ||
    sound ||
    normalizeAspectRatioValue(aspectRatio) !== '16:9' ||
    elementsCount > 0
  );
}

function toKlingElementInput(element: ElementDraft) {
  return {
    name: element.name,
    description: element.description,
    image_urls: element.images
      .map((item) => item.url)
      .filter((url): url is string => Boolean(url)),
    video_url: element.video?.url,
  };
}

function buildPreview(file: File) {
  return URL.createObjectURL(file);
}

async function loadImageElement(file: File) {
  const objectUrl = URL.createObjectURL(file);

  try {
    return await new Promise<HTMLImageElement>((resolve, reject) => {
      const nextImage = new Image();
      nextImage.onload = () => resolve(nextImage);
      nextImage.onerror = () => reject(new Error('invalid image'));
      nextImage.src = objectUrl;
    });
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

async function getImageDimensions(file: File) {
  const image = await loadImageElement(file);

  return {
    width: image.naturalWidth,
    height: image.naturalHeight,
  };
}

function isKlingImageInputFile(file: File) {
  return KLING_IMAGE_UPLOAD_INPUT_MIME_TYPES.includes(
    file.type as (typeof KLING_IMAGE_UPLOAD_INPUT_MIME_TYPES)[number]
  );
}

async function normalizeKlingImageUpload(file: File) {
  if (file.type !== 'image/webp') {
    return file;
  }

  const image = await loadImageElement(file);
  const canvas = document.createElement('canvas');
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;

  const context = canvas.getContext('2d');
  if (!context) {
    throw new Error('image conversion failed');
  }

  context.drawImage(image, 0, 0);

  const blob = await new Promise<Blob | null>((resolve) => {
    canvas.toBlob(resolve, 'image/png');
  });

  if (!blob) {
    throw new Error('image conversion failed');
  }

  return new File([blob], file.name.replace(/\.webp$/i, '.png'), {
    type: 'image/png',
    lastModified: Date.now(),
  });
}

async function prepareKlingImageUpload(file: File) {
  if (!isKlingImageInputFile(file)) {
    throw new Error('Only JPG, PNG, and WEBP images are supported.');
  }

  return normalizeKlingImageUpload(file);
}

async function prepareKlingElementImageUpload(file: File) {
  const normalizedFile = await prepareKlingImageUpload(file);

  if (
    !KLING_ELEMENT_IMAGE_MIME_TYPES.includes(
      normalizedFile.type as (typeof KLING_ELEMENT_IMAGE_MIME_TYPES)[number]
    )
  ) {
    throw new Error('Only JPG and PNG images are supported.');
  }

  if (normalizedFile.size > KLING_ELEMENT_IMAGE_MAX_BYTES) {
    throw new Error('Image file is too large. Max size is 10MB.');
  }

  const { width, height } = await getImageDimensions(normalizedFile);
  if (
    width < KLING_ELEMENT_IMAGE_MIN_DIMENSION ||
    height < KLING_ELEMENT_IMAGE_MIN_DIMENSION
  ) {
    throw new Error('Element images must be at least 300x300 pixels.');
  }

  return normalizedFile;
}

function isObjectUrl(value: string | undefined | null) {
  return typeof value === 'string' && value.startsWith('blob:');
}

function revokePreviewUrl(value: string | undefined | null) {
  if (typeof value === 'string' && isObjectUrl(value)) {
    URL.revokeObjectURL(value);
  }
}

function revokeUploadItemPreview(item: UploadItem | null | undefined) {
  revokePreviewUrl(item?.preview);
}

function parseJsonParam<T>(value: string | null) {
  if (!value) {
    return null;
  }

  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

function parseTaskInfo(taskInfo: string | null) {
  if (!taskInfo) {
    return null;
  }

  try {
    return JSON.parse(taskInfo);
  } catch {
    return null;
  }
}

function buildPresetShots(shots?: UseCaseShotPrefill[] | null) {
  return Array.isArray(shots) && shots.length > 0
    ? shots.map((shot, index) => ({
        id: createId('shot'),
        title: shot.title || `Shot ${index + 1}`,
        prompt: shot.prompt || '',
        duration: shot.duration,
      }))
    : [createShotDraft(3), createShotDraft(3)];
}

function buildPresetElements(elements?: UseCaseElementPrefill[] | null) {
  return Array.isArray(elements) && elements.length > 0
    ? elements.map((element) => ({
        id: createId('element'),
        name: element.name || '',
        description: element.description || '',
        mediaType: 'images' as const,
        images: [],
        video: null,
      }))
    : [];
}

function extractVideoUrls(taskInfo: any) {
  const videos = Array.isArray(taskInfo?.videos) ? taskInfo.videos : [];
  return videos
    .map((video: any) => {
      if (!video) return null;
      if (typeof video === 'string') return video;
      return video.videoUrl || video.url || video.src || video.video || null;
    })
    .filter((url: unknown): url is string => typeof url === 'string');
}

function sanitizeUploadedItem(item: UploadItem) {
  if (!item.url) {
    return null;
  }

  return {
    id: item.id,
    name: item.name,
    url: item.url,
  };
}

function extractUploadedImageUrls(items: ImageUploaderValue[]) {
  return items
    .filter((item) => item.status === 'uploaded' && item.url)
    .map((item) => item.url as string);
}

async function getVideoDurationSeconds(
  file: File
): Promise<number | undefined> {
  return new Promise((resolve) => {
    const objectUrl = URL.createObjectURL(file);
    const video = document.createElement('video');

    const cleanup = () => {
      video.removeAttribute('src');
      video.load();
      URL.revokeObjectURL(objectUrl);
    };

    video.preload = 'metadata';
    video.onloadedmetadata = () => {
      const duration = video.duration;
      cleanup();
      resolve(Number.isFinite(duration) && duration > 0 ? duration : undefined);
    };
    video.onerror = () => {
      cleanup();
      resolve(undefined);
    };
    video.src = objectUrl;
  });
}

async function uploadFile(file: File, kind: UploadKind) {
  const endpoint =
    kind === 'image'
      ? '/api/storage/upload-image'
      : '/api/storage/upload-video';
  const formData = new FormData();
  formData.append('files', file);
  if (kind === 'video') {
    const durationSeconds = await getVideoDurationSeconds(file);
    if (typeof durationSeconds === 'number') {
      formData.append('duration_seconds', String(durationSeconds));
    }
  }

  const resp = await fetch(endpoint, {
    method: 'POST',
    body: formData,
  });

  if (!resp.ok) {
    throw new Error(`upload failed with status ${resp.status}`);
  }

  const { code, message, data } = await resp.json();
  if (code !== 0 || !Array.isArray(data?.urls) || !data.urls[0]) {
    throw new Error(message || 'upload failed');
  }

  return data.urls[0] as string;
}

function MediaPicker({
  title,
  hint,
  kind,
  items,
  maxItems,
  onAdd,
  onRemove,
  labels,
  accept,
  uploadLabel,
  statusLabels,
}: {
  title: string;
  hint: string;
  kind: UploadKind;
  items: UploadItem[];
  maxItems: number;
  onAdd: (files: FileList | null) => void;
  onRemove: (id: string) => void;
  labels?: string[];
  accept: string;
  uploadLabel: string;
  statusLabels: {
    ready: string;
    uploading: string;
    errorFallback: string;
    idle: string;
  };
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-slate-950 dark:text-white">
            {title}
          </p>
          <p className="text-muted-foreground text-xs dark:text-slate-400">
            {hint}
          </p>
        </div>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => inputRef.current?.click()}
          disabled={items.length >= maxItems}
        >
          <Upload className="h-4 w-4" />
          {uploadLabel}
        </Button>
      </div>

      <input
        ref={inputRef}
        type="file"
        accept={accept}
        multiple={maxItems > 1}
        className="hidden"
        onChange={(event) => {
          onAdd(event.target.files);
          event.currentTarget.value = '';
        }}
      />

      <div
        className={cn(
          'grid gap-3',
          kind === 'image' ? 'grid-cols-1 sm:grid-cols-2' : 'grid-cols-1'
        )}
      >
        {items.map((item, index) => (
          <div
            key={item.id}
            className="bg-background overflow-hidden rounded-xl border border-stone-200 dark:border-white/10 dark:bg-white/4"
          >
            <div className="flex items-center justify-between gap-2 border-b border-stone-200 px-3 py-2 dark:border-white/10">
              <div className="flex min-w-0 flex-1 items-center gap-2">
                {labels?.[index] ? (
                  <Badge variant="secondary">{labels[index]}</Badge>
                ) : null}
                <span className="truncate text-xs font-medium text-slate-900 dark:text-slate-100">
                  {item.name}
                </span>
              </div>
              <Button
                type="button"
                size="icon-sm"
                variant="outline"
                className="shrink-0"
                onClick={() => onRemove(item.id)}
                aria-label={`Remove ${item.name}`}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>

            <div className="p-3">
              {kind === 'image' ? (
                <img
                  src={item.url || item.preview}
                  alt={item.name}
                  className="h-40 w-full rounded-lg object-cover"
                />
              ) : (
                <video
                  src={item.url || item.preview}
                  controls
                  className="h-48 w-full rounded-lg object-cover"
                />
              )}

              <div className="mt-3 flex items-center justify-between text-xs">
                <span
                  className={cn(
                    'font-medium',
                    item.status === 'uploaded' && 'text-emerald-600',
                    item.status === 'uploading' && 'text-amber-600',
                    item.status === 'error' && 'text-destructive'
                  )}
                >
                  {item.status === 'uploaded'
                    ? statusLabels.ready
                    : item.status === 'uploading'
                      ? statusLabels.uploading
                      : item.status === 'error'
                        ? item.error || statusLabels.errorFallback
                        : statusLabels.idle}
                </span>
                {item.status === 'uploading' ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : null}
              </div>
            </div>
          </div>
        ))}

        {items.length === 0 ? (
          <div className="text-muted-foreground rounded-xl border border-dashed border-stone-300 px-4 py-8 text-center text-sm dark:border-white/12 dark:text-slate-400">
            {hint}
          </div>
        ) : null}
      </div>
    </div>
  );
}

export function KlingVideoGenerator({
  id,
  srOnlyTitle,
  pricingSectionId = 'pricing',
}: {
  id?: string;
  srOnlyTitle?: string;
  pricingSectionId?: string;
}) {
  const t = useTranslations('pages.models.kling-3.generator');
  const queueT = useTranslations('ai.video.generator');
  const router = useRouter();
  const searchParams = useSearchParams();
  const {
    user,
    setIsShowSignModal,
    fetchUserCredits,
    currentSubscription,
    hasPaidEntitlement,
    hasFetchedCurrentSubscription,
    isFetchingCurrentSubscription,
    fetchCurrentSubscription,
    configs,
  } = useAppContext();

  const [createMode, setCreateMode] = useState<CreateMode>('single-scene');
  const [prompt, setPrompt] = useState('');
  const [duration, setDuration] = useState(3);
  const [quality, setQuality] = useState<KlingVideoQuality>('std');
  const [sound, setSound] = useState(false);
  const [aspectRatio, setAspectRatio] = useState('16:9');
  const [referenceImages, setReferenceImages] = useState<UploadItem[]>([]);
  const [shots, setShots] = useState<ShotDraft[]>([
    createShotDraft(3),
    createShotDraft(3),
  ]);
  const [elements, setElements] = useState<ElementDraft[]>([]);
  const [isAdvancedOpen, setIsAdvancedOpen] = useState(false);
  const [focusedPrompt, setFocusedPrompt] = useState<PromptFocus>(null);
  const [generatedVideos, setGeneratedVideos] = useState<GeneratedVideo[]>([]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [progress, setProgress] = useState(0);
  const [taskId, setTaskId] = useState<string | null>(null);
  const [providerTaskId, setProviderTaskId] = useState<string | null>(null);
  const [taskStatus, setTaskStatus] = useState<AITaskStatus | null>(null);
  const [generationStartTime, setGenerationStartTime] = useState<number | null>(
    null
  );
  const [downloadingVideoId, setDownloadingVideoId] = useState<string | null>(
    null
  );
  const { canDownload, paidDownloadDialogProps } = usePaidDownloadGate();
  const [isHydrated, setIsHydrated] = useState(false);
  const [referenceUploaderResetKey, setReferenceUploaderResetKey] = useState(0);
  const [hasAttemptedSubmit, setHasAttemptedSubmit] = useState(false);
  const pendingGenerateRequestRef =
    useRef<PendingKlingGenerationRequest | null>(null);
  const validationAlertRef = useRef<HTMLDivElement | null>(null);
  const [creditFallback, setCreditFallback] =
    useState<GenerationCreditFallbackPayload | null>(null);
  const latestMediaRef = useRef<{
    referenceImages: UploadItem[];
    elements: ElementDraft[];
  }>({
    referenceImages: [],
    elements: [],
  });
  const applyPresetRef = useRef<(preset: KlingGeneratorPreset) => void>(
    () => {}
  );

  const getCopy = useCallback(
    (
      key: string,
      fallback: string,
      values?: Record<string, string | number>
    ) => {
      if (typeof t.has === 'function' && t.has(key)) {
        return values ? t(key, values) : t(key);
      }

      return fallback;
    },
    [t]
  );

  const localizeGeneratorMessage = useCallback(
    (message?: string | null) => {
      const normalized = message?.trim();
      if (!normalized) {
        return '';
      }

      if (normalized === 'prompt is required') {
        return getCopy(
          'error_prompt_required',
          'Please describe the scene you want to see.'
        );
      }

      if (normalized === 'invalid kling mode') {
        return getCopy('error_invalid_mode', 'Please choose a quality.');
      }

      if (normalized === 'invalid kling duration') {
        return getCopy('error_invalid_duration', 'Please choose a duration.');
      }

      if (normalized === 'single scene supports up to 2 reference images') {
        return getCopy(
          'error_single_scene_reference_limit',
          'Single scene supports up to 2 reference images.'
        );
      }

      if (normalized === 'story mode supports up to 1 reference image') {
        return getCopy(
          'error_story_reference_limit',
          'Story mode supports up to 1 reference image.'
        );
      }

      if (
        normalized ===
        'aspect_ratio is required when no reference image is provided'
      ) {
        return getCopy(
          'error_aspect_ratio_required',
          'Please choose an aspect ratio.'
        );
      }

      if (normalized === 'invalid kling aspect_ratio') {
        return getCopy(
          'error_invalid_aspect_ratio',
          'Please choose a valid aspect ratio.'
        );
      }

      if (normalized === 'story mode requires at least one shot') {
        return getCopy(
          'error_story_shot_required',
          'Please add at least one shot.'
        );
      }

      if (
        normalized ===
        'story mode duration must equal the sum of all shot durations'
      ) {
        return getCopy(
          'error_story_duration_mismatch',
          'Story duration must match the total shot duration.'
        );
      }

      if (normalized === 'element names must be unique') {
        return getCopy(
          'error_element_names_unique',
          'Element names must be unique.'
        );
      }

      if (
        normalized ===
        `kling elements support up to ${KLING_MAX_ELEMENTS} items`
      ) {
        return getCopy(
          'error_elements_limit',
          `You can add up to ${KLING_MAX_ELEMENTS} elements.`
        );
      }

      const shotPromptMatch = normalized.match(
        /^shot (\d+) prompt is required$/
      );
      if (shotPromptMatch) {
        const index = Number.parseInt(shotPromptMatch[1] || '0', 10);
        return getCopy(
          'error_shot_prompt_required',
          `Please describe shot ${index}.`,
          { index }
        );
      }

      const shotDurationMatch = normalized.match(
        /^shot (\d+) duration must be between (\d+) and (\d+) seconds$/
      );
      if (shotDurationMatch) {
        const index = Number.parseInt(shotDurationMatch[1] || '0', 10);
        return getCopy(
          'error_shot_duration_invalid',
          `Shot ${index} must be within ${KLING_STORY_SHOT_MIN_DURATION} to ${KLING_STORY_SHOT_MAX_DURATION} seconds.`,
          { index }
        );
      }

      const elementNameMatch = normalized.match(
        /^element (\d+) name is required$/
      );
      if (elementNameMatch) {
        const index = Number.parseInt(elementNameMatch[1] || '0', 10);
        return getCopy(
          'error_element_name_required',
          `Please name element ${index}.`,
          { index }
        );
      }

      const elementDescriptionMatch = normalized.match(
        /^element (\d+) description is required$/
      );
      if (elementDescriptionMatch) {
        const index = Number.parseInt(elementDescriptionMatch[1] || '0', 10);
        return getCopy(
          'error_element_description_required',
          `Please describe element ${index}.`,
          { index }
        );
      }

      const elementMediaConflictMatch = normalized.match(
        /^element (\d+) cannot contain both images and video$/
      );
      if (elementMediaConflictMatch) {
        const index = Number.parseInt(elementMediaConflictMatch[1] || '0', 10);
        return getCopy(
          'error_element_media_conflict',
          `Element ${index} cannot include both images and video.`,
          { index }
        );
      }

      const elementMediaRequiredMatch = normalized.match(
        /^element (\d+) requires images or a video$/
      );
      if (elementMediaRequiredMatch) {
        const index = Number.parseInt(elementMediaRequiredMatch[1] || '0', 10);
        return getCopy(
          'error_element_media_required',
          `Add images or a video to element ${index}.`,
          { index }
        );
      }

      const elementImageCountMatch = normalized.match(
        /^element (\d+) image elements require 2 to 4 images$/
      );
      if (elementImageCountMatch) {
        const index = Number.parseInt(elementImageCountMatch[1] || '0', 10);
        return getCopy(
          'error_element_image_count_invalid',
          `Element ${index} needs 2 to 4 images.`,
          { index }
        );
      }

      return normalized;
    },
    [getCopy]
  );
  const localizeReferenceUploadMessage = useCallback(
    (message?: string | null) => {
      const normalized = message?.trim();
      if (!normalized) {
        return t('upload_failed');
      }

      if (
        normalized === 'Only JPG, PNG, and WEBP images are supported.' ||
        normalized === 'Only image files are supported'
      ) {
        return getCopy(
          'error_reference_format_invalid',
          'Please upload JPG, PNG, or WEBP images.'
        );
      }

      if (
        normalized === 'image conversion failed' ||
        normalized.startsWith('upload failed with status')
      ) {
        return t('upload_failed');
      }

      return normalized;
    },
    [getCopy, t]
  );

  const storyDuration = shots.reduce((sum, shot) => sum + shot.duration, 0);
  const effectiveDuration =
    createMode === 'story-mode' ? storyDuration : duration;
  const referenceImageMaxItems =
    createMode === 'story-mode'
      ? KLING_MAX_STORY_REFERENCE_IMAGES
      : KLING_MAX_REFERENCE_IMAGES;
  const referenceImageUrls = useMemo(
    () => extractUploadedImageUrls(referenceImages),
    [referenceImages]
  );
  const referenceUploaderCopy = useMemo(
    () => ({
      upload: t('upload'),
      uploading: t('status_uploading'),
      failed: t('upload_failed'),
      dropToUpload: getCopy('uploader_drop_to_upload', 'Drop to upload'),
      replaceAriaLabel: getCopy(
        'uploader_replace_image',
        'Replace reference image'
      ),
      removeAriaLabel: getCopy(
        'uploader_remove_image',
        'Remove reference image'
      ),
      unsupportedFormat: () =>
        getCopy(
          'error_reference_format_invalid',
          'Please upload JPG, PNG, or WEBP images.'
        ),
      partialAdd: () =>
        createMode === 'story-mode'
          ? t('error_story_reference_limit')
          : t('error_single_scene_reference_limit'),
      uploadFailed: (message?: string) =>
        localizeReferenceUploadMessage(message),
    }),
    [createMode, getCopy, localizeReferenceUploadMessage, t]
  );
  const storyDurationRemaining = Math.max(
    0,
    KLING_MAX_DURATION - storyDuration
  );
  const canAddShot =
    createMode === 'story-mode' &&
    shots.length < 10 &&
    storyDurationRemaining > 0;
  const remainingCredits = user?.credits?.remainingCredits ?? 0;
  const hasQueueBypassAccess = Boolean(
    currentSubscription || hasPaidEntitlement
  );
  const showCreditsCost = hasFetchedCurrentSubscription && hasQueueBypassAccess;
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
  const isUploading = useMemo(() => {
    const referenceUploading = referenceImages.some(
      (item) => item.status === 'uploading'
    );
    const elementUploading = elements.some(
      (element) =>
        element.images.some((item) => item.status === 'uploading') ||
        element.video?.status === 'uploading'
    );
    return referenceUploading || elementUploading;
  }, [elements, referenceImages]);
  const activeElements = useMemo(
    () => elements.filter(hasElementDraftContent),
    [elements]
  );

  const rawValidationErrors = useMemo(() => {
    const options: KlingVideoOptions = {
      image_urls: referenceImages
        .map((item) => item.url)
        .filter((url): url is string => Boolean(url)),
      sound,
      duration: effectiveDuration,
      aspect_ratio: referenceImages.length === 0 ? aspectRatio : undefined,
      mode: quality,
      multi_shots: createMode === 'story-mode',
      multi_prompt:
        createMode === 'story-mode'
          ? shots.map((shot) => ({
              title: shot.title,
              prompt: shot.prompt,
              duration: shot.duration,
            }))
          : undefined,
      kling_elements: activeElements.map(toKlingElementInput),
    };

    return validateKlingVideoOptions({
      prompt,
      options,
    });
  }, [
    activeElements,
    aspectRatio,
    createMode,
    effectiveDuration,
    prompt,
    quality,
    referenceImages,
    shots,
    sound,
  ]);
  const validationErrors = useMemo(
    () =>
      rawValidationErrors
        .map(localizeGeneratorMessage)
        .filter((message): message is string => Boolean(message)),
    [localizeGeneratorMessage, rawValidationErrors]
  );
  const hasAdvancedValidationErrors = useMemo(
    () =>
      rawValidationErrors.some(
        (error) =>
          error !== 'prompt is required' &&
          error !== 'story mode requires at least one shot' &&
          error !==
            'story mode duration must equal the sum of all shot durations' &&
          !/^shot \d+ prompt is required$/.test(error) &&
          !/^shot \d+ duration must be between /.test(error)
      ),
    [rawValidationErrors]
  );

  const costCredits = calculateKlingCredits({
    duration: effectiveDuration,
    mode: quality,
    sound,
  });
  const queueCopy = useMemo(
    () => ({
      title: queueT.has('queue.title')
        ? queueT('queue.title')
        : 'Standard Queue',
      description: queueT.has('queue.description')
        ? queueT('queue.description')
        : 'Non-member video tasks are currently in the standard queue. Members can start generating sooner.',
      taskLabel: queueT.has('queue.task_label')
        ? queueT('queue.task_label')
        : 'Video generation',
      remainingLabel: queueT.has('queue.remaining_label')
        ? queueT('queue.remaining_label')
        : 'Time left',
      upgradeLabel: queueT.has('queue.upgrade')
        ? queueT('queue.upgrade')
        : 'Upgrade to Membership',
      cancelLabel: queueT.has('queue.cancel')
        ? queueT('queue.cancel')
        : 'Cancel Queue',
      retryLabel: queueT.has('queue.retry')
        ? queueT('queue.retry')
        : 'Retry Now',
      submittingLabel: queueT.has('queue.submitting')
        ? queueT('queue.submitting')
        : 'Starting your real generation...',
      submitFailedLabel: queueT.has('queue.submit_failed')
        ? queueT('queue.submit_failed')
        : 'We could not start your generation just now. You can retry without losing your place.',
      waitingButtonLabel: queueT.has('queue.button_waiting')
        ? queueT('queue.button_waiting')
        : 'Waiting in Queue...',
      membershipCheckingLabel: queueT.has('queue.membership_checking')
        ? queueT('queue.membership_checking')
        : 'Checking membership status. Please try again in a moment.',
    }),
    [queueT]
  );
  const creditFallbackCopy = useMemo(
    () => ({
      title: queueT.has('credit_fallback.title')
        ? queueT('credit_fallback.title')
        : 'Current mode needs more credits',
      description: queueT.has('credit_fallback.description')
        ? queueT('credit_fallback.description', {
            requested: creditFallback?.requestedCostCredits ?? costCredits,
            remaining: creditFallback?.remainingCredits ?? remainingCredits,
          })
        : `This generation needs ${
            creditFallback?.requestedCostCredits ?? costCredits
          } credits, while your balance is ${
            creditFallback?.remainingCredits ?? remainingCredits
          }. You can switch to a lower-cost mode and keep creating, or add more credits to stay on the current mode.`,
      currentModeLabel: queueT.has('credit_fallback.current_mode')
        ? queueT('credit_fallback.current_mode')
        : 'Current mode',
      remainingCreditsLabel: queueT.has('credit_fallback.remaining_credits')
        ? queueT('credit_fallback.remaining_credits')
        : 'Current balance',
      switchLabel: queueT.has('credit_fallback.switch')
        ? queueT('credit_fallback.switch')
        : 'Switch and Continue',
      upgradeLabel: queueT.has('credit_fallback.buy_credits')
        ? queueT('credit_fallback.buy_credits')
        : t('buy_credits'),
      closeLabel: queueT.has('credit_fallback.close')
        ? queueT('credit_fallback.close')
        : 'Not now',
      standardBadge: queueT.has('credit_fallback.standard_badge')
        ? queueT('credit_fallback.standard_badge')
        : 'Standard',
      videoClassicTitle: queueT.has('credit_fallback.video_classic_title')
        ? queueT('credit_fallback.video_classic_title')
        : 'ChatGPT Image 2 Classic · 4s · 480p',
      videoClassicDescription: queueT.has(
        'credit_fallback.video_classic_description'
      )
        ? queueT('credit_fallback.video_classic_description')
        : 'Switch to the lower-cost classic video workflow with your current prompt.',
      imageStandardTitle: queueT.has('credit_fallback.image_standard_title')
        ? queueT('credit_fallback.image_standard_title')
        : 'GPT Image 2 · 1K',
      imageStandardDescription: queueT.has(
        'credit_fallback.image_standard_description'
      )
        ? queueT('credit_fallback.image_standard_description')
        : 'Switch to a lighter image mode if you want a faster, lower-cost try.',
    }),
    [costCredits, creditFallback, queueT, remainingCredits, t]
  );
  const { checkinCredits, referralCredits, referralSubscriptionBonusPercent } =
    useMemo(() => getGenerationCreditRewardAmounts(configs), [configs]);
  const creditEarnCopy = useMemo(
    () => ({
      checkInTitle: queueT.has('credit_fallback.checkin_title')
        ? queueT('credit_fallback.checkin_title')
        : 'Daily check-in',
      checkInDescription: queueT.has('credit_fallback.checkin_description')
        ? queueT('credit_fallback.checkin_description', {
            credits: checkinCredits,
          })
        : `Claim ${checkinCredits} free credits today.`,
      checkInAction: queueT.has('credit_fallback.checkin')
        ? queueT('credit_fallback.checkin')
        : 'Check in',
      checkedInAction: queueT.has('credit_fallback.checked_in')
        ? queueT('credit_fallback.checked_in')
        : 'Checked in today',
      checkingInAction: queueT.has('credit_fallback.checking_in')
        ? queueT('credit_fallback.checking_in')
        : 'Checking in',
      checkInSuccess: queueT.has('credit_fallback.checkin_success')
        ? queueT('credit_fallback.checkin_success')
        : 'Daily credits added',
      checkInFailed: queueT.has('credit_fallback.checkin_failed')
        ? queueT('credit_fallback.checkin_failed')
        : 'Check-in failed',
      inviteTitle: queueT.has('credit_fallback.invite_title')
        ? queueT('credit_fallback.invite_title')
        : 'Invite friends',
      inviteDescription: queueT.has('credit_fallback.invite_description')
        ? queueT('credit_fallback.invite_description', {
            credits: referralCredits,
            percent: referralSubscriptionBonusPercent,
          })
        : `Earn ${referralCredits} credits when a friend signs up. When they first buy a subscription, both of you get ${referralSubscriptionBonusPercent}% extra subscription credits.`,
      copyInviteAction: queueT.has('credit_fallback.copy_invite')
        ? queueT('credit_fallback.copy_invite')
        : 'Copy invite link',
      inviteCopied: queueT.has('credit_fallback.invite_copied')
        ? queueT('credit_fallback.invite_copied')
        : 'Invite link copied',
      openRewardsAction: queueT.has('credit_fallback.open_rewards')
        ? queueT('credit_fallback.open_rewards')
        : 'Open rewards',
      copyFailed: queueT.has('credit_fallback.copy_failed')
        ? queueT('credit_fallback.copy_failed')
        : 'Copy failed',
    }),
    [checkinCredits, queueT, referralCredits, referralSubscriptionBonusPercent]
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
  const generationRequest = useMemo<PendingKlingGenerationRequest>(() => {
    const imageUrls = referenceImages
      .map((item) => item.url)
      .filter((url): url is string => Boolean(url));
    const scene = imageUrls.length > 0 ? 'image-to-video' : 'text-to-video';

    return {
      scene,
      provider: 'kie',
      model: KLING_VIDEO_MODEL,
      prompt:
        createMode === 'single-scene' ? prompt.trim() || undefined : undefined,
      options: {
        image_urls: imageUrls,
        sound,
        duration: effectiveDuration,
        aspect_ratio: imageUrls.length === 0 ? aspectRatio : undefined,
        mode: quality,
        multi_shots: createMode === 'story-mode',
        multi_prompt:
          createMode === 'story-mode'
            ? shots.map((shot) => ({
                title: shot.title,
                prompt: shot.prompt,
                duration: shot.duration,
              }))
            : undefined,
        kling_elements: activeElements.map(toKlingElementInput),
      },
    };
  }, [
    activeElements,
    aspectRatio,
    createMode,
    effectiveDuration,
    prompt,
    quality,
    referenceImages,
    shots,
    sound,
  ]);
  const queuePayload = useMemo(
    () => JSON.stringify(generationRequest),
    [generationRequest]
  );
  const queueSnapshotDigest = useMemo(() => md5(queuePayload), [queuePayload]);

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

  applyPresetRef.current = (preset: KlingGeneratorPreset) => {
    latestMediaRef.current.referenceImages.forEach(revokeUploadItemPreview);
    latestMediaRef.current.elements.forEach((element) => {
      element.images.forEach(revokeUploadItemPreview);
      revokeUploadItemPreview(element.video);
    });

    const nextCreateMode = normalizeCreateModeValue(preset.createMode);
    const nextAspectRatio = '16:9';
    const nextElements = buildPresetElements(preset.elements);

    setCreateMode(nextCreateMode);
    setPrompt((preset.prompt || '').slice(0, MAX_PROMPT_LENGTH));
    setDuration(
      preset.duration >= KLING_MIN_DURATION &&
        preset.duration <= KLING_MAX_DURATION
        ? preset.duration
        : 3
    );
    setQuality(preset.quality === 'pro' ? 'pro' : 'std');
    setSound(Boolean(preset.sound));
    setAspectRatio(nextAspectRatio);
    setReferenceImages([]);
    setReferenceUploaderResetKey((current) => current + 1);
    setShots(buildPresetShots(preset.shots));
    setElements(nextElements);
    setIsAdvancedOpen(
      shouldAutoOpenAdvancedControls({
        quality: preset.quality === 'pro' ? 'pro' : 'std',
        sound: Boolean(preset.sound),
        aspectRatio: nextAspectRatio,
        elementsCount: nextElements.length,
      })
    );
    setFocusedPrompt(null);
    setGeneratedVideos([]);
    setTaskId(null);
    setProviderTaskId(null);
    setTaskStatus(null);
    setIsGenerating(false);
    setProgress(0);
    setHasAttemptedSubmit(false);
    window.sessionStorage.removeItem(KLING_DRAFT_KEY);
    window.sessionStorage.removeItem(KLING_GENERATOR_PRESET_STORAGE_KEY);
  };

  useEffect(() => {
    setIsHydrated(true);
  }, []);

  useEffect(() => {
    latestMediaRef.current = {
      referenceImages,
      elements,
    };
  }, [elements, referenceImages]);

  useEffect(() => {
    return () => {
      latestMediaRef.current.referenceImages.forEach(revokeUploadItemPreview);
      latestMediaRef.current.elements.forEach((element) => {
        element.images.forEach(revokeUploadItemPreview);
        revokeUploadItemPreview(element.video);
      });
    };
  }, []);

  useEffect(() => {
    if (!isHydrated) {
      return;
    }

    const hasPrefill =
      searchParams?.has('prompt') ||
      searchParams?.has('duration') ||
      searchParams?.has('quality') ||
      searchParams?.has('sound') ||
      searchParams?.has('mode') ||
      searchParams?.has('aspectRatio') ||
      searchParams?.has('aspect_ratio') ||
      searchParams?.has('shots') ||
      searchParams?.has('elements');
    const prefillPrompt = searchParams?.get('prompt');
    const prefillDuration = Number.parseInt(
      searchParams?.get('duration') || '',
      10
    );
    const prefillQuality = searchParams?.get('quality');
    const prefillSound = searchParams?.get('sound');
    const prefillMode = searchParams?.get('mode');
    const prefillAspectRatio =
      searchParams?.get('aspectRatio') || searchParams?.get('aspect_ratio');
    const prefillShots = parseJsonParam<UseCaseShotPrefill[]>(
      searchParams?.get('shots') || null
    );
    const prefillElements = parseJsonParam<UseCaseElementPrefill[]>(
      searchParams?.get('elements') || null
    );
    const rawDraft = window.sessionStorage.getItem(KLING_DRAFT_KEY);

    if (hasPrefill) {
      latestMediaRef.current.referenceImages.forEach(revokeUploadItemPreview);
      latestMediaRef.current.elements.forEach((element) => {
        element.images.forEach(revokeUploadItemPreview);
        revokeUploadItemPreview(element.video);
      });

      const nextCreateMode = normalizeCreateModeValue(prefillMode);
      const nextQuality = prefillQuality === 'pro' ? 'pro' : 'std';
      const nextSound = prefillSound === '1' || prefillSound === 'true';
      const nextAspectRatio = normalizeAspectRatioValue(prefillAspectRatio);
      const nextElements = buildPresetElements(prefillElements);

      setCreateMode(nextCreateMode);
      setPrompt(prefillPrompt ? prefillPrompt.slice(0, MAX_PROMPT_LENGTH) : '');
      setDuration(
        prefillDuration >= KLING_MIN_DURATION &&
          prefillDuration <= KLING_MAX_DURATION
          ? prefillDuration
          : 3
      );
      setQuality(nextQuality);
      setSound(nextSound);
      setAspectRatio(nextAspectRatio);
      setReferenceImages([]);
      setReferenceUploaderResetKey((current) => current + 1);
      setShots(buildPresetShots(prefillShots));
      setElements(nextElements);
      setIsAdvancedOpen(
        shouldAutoOpenAdvancedControls({
          quality: nextQuality,
          sound: nextSound,
          aspectRatio: nextAspectRatio,
          elementsCount: nextElements.length,
        })
      );
      setFocusedPrompt(null);
      setGeneratedVideos([]);
      setTaskId(null);
      setProviderTaskId(null);
      setTaskStatus(null);
      setIsGenerating(false);
      setProgress(0);
      setHasAttemptedSubmit(false);
      return;
    }

    const rawPreset = window.sessionStorage.getItem(
      KLING_GENERATOR_PRESET_STORAGE_KEY
    );

    if (rawPreset) {
      try {
        applyPresetRef.current(JSON.parse(rawPreset) as KlingGeneratorPreset);
        return;
      } catch {
        window.sessionStorage.removeItem(KLING_GENERATOR_PRESET_STORAGE_KEY);
      }
    }

    if (rawDraft) {
      try {
        const draft = JSON.parse(rawDraft) as KlingDraftState;
        setCreateMode(draft.createMode);
        setPrompt(draft.prompt);
        setDuration(draft.duration);
        setQuality(draft.quality);
        setSound(draft.sound);
        setAspectRatio(draft.aspectRatio);
        setReferenceImages(
          draft.referenceImages.map((item) => ({
            ...item,
            kind: 'image',
            status: 'uploaded',
            preview: item.url,
          }))
        );
        setShots(
          draft.shots.length > 0
            ? draft.shots
            : [createShotDraft(3), createShotDraft(3)]
        );
        setElements(
          draft.elements
            .map((element) => ({
              ...element,
              images: element.images.map((item) => ({
                ...item,
                kind: 'image' as const,
                status: 'uploaded' as const,
                preview: item.url,
              })),
              video: element.video
                ? {
                    ...element.video,
                    kind: 'video' as const,
                    status: 'uploaded' as const,
                    preview: element.video.url,
                  }
                : null,
            }))
            .filter(hasElementDraftContent)
        );
        return;
      } catch {
        window.sessionStorage.removeItem(KLING_DRAFT_KEY);
      }
    }
  }, [isHydrated, searchParams]);

  useEffect(() => {
    if (!isHydrated) {
      return;
    }

    const draft: KlingDraftState = {
      createMode,
      prompt,
      duration,
      quality,
      sound,
      aspectRatio,
      referenceImages: referenceImages
        .map(sanitizeUploadedItem)
        .filter((item): item is NonNullable<typeof item> => Boolean(item)),
      shots,
      elements: elements.filter(hasElementDraftContent).map((element) => ({
        id: element.id,
        name: element.name,
        description: element.description,
        mediaType: element.mediaType,
        images: element.images
          .map(sanitizeUploadedItem)
          .filter((item): item is NonNullable<typeof item> => Boolean(item)),
        video: element.video ? sanitizeUploadedItem(element.video) : null,
      })),
    };

    window.sessionStorage.setItem(KLING_DRAFT_KEY, JSON.stringify(draft));
  }, [
    aspectRatio,
    createMode,
    duration,
    elements,
    isHydrated,
    prompt,
    quality,
    referenceImages,
    shots,
    sound,
  ]);

  useEffect(() => {
    if (createMode !== 'story-mode' || referenceImages.length <= 1) {
      return;
    }

    setReferenceImages((current) => {
      current.slice(1).forEach(revokeUploadItemPreview);
      return current.slice(0, 1);
    });
  }, [createMode, referenceImages.length]);

  useEffect(() => {
    if (!isHydrated) {
      return;
    }

    const handlePresetEvent = (event: Event) => {
      const preset = (event as CustomEvent<KlingGeneratorPreset>).detail;
      if (!preset) {
        return;
      }

      applyPresetRef.current(preset);
    };

    window.addEventListener(
      KLING_GENERATOR_PRESET_EVENT,
      handlePresetEvent as EventListener
    );

    return () => {
      window.removeEventListener(
        KLING_GENERATOR_PRESET_EVENT,
        handlePresetEvent as EventListener
      );
    };
  }, [isHydrated]);

  const handleReferenceImagesChange = useCallback(
    (items: ImageUploaderValue[]) => {
      setReferenceImages(
        items.slice(0, referenceImageMaxItems).map((item, index) => ({
          id: item.id,
          name: `reference-${index + 1}`,
          kind: 'image',
          status: item.status as MediaStatus,
          preview: item.preview,
          url: item.url,
        }))
      );
    },
    [referenceImageMaxItems]
  );

  const handleElementImageUpload = async (
    elementId: string,
    files: FileList | null
  ) => {
    if (!user) {
      setIsShowSignModal(true);
      return;
    }

    if (!files?.length) {
      return;
    }

    const element = elements.find((item) => item.id === elementId);
    if (!element) {
      return;
    }

    const availableSlots =
      KLING_IMAGE_ELEMENT_MAX_IMAGES - element.images.length;
    const acceptedFiles = Array.from(files).slice(0, availableSlots);

    for (const file of acceptedFiles) {
      let uploadFilePayload: File;

      try {
        uploadFilePayload = await prepareKlingElementImageUpload(file);
      } catch (error: any) {
        toast.error(error.message || t('upload_failed'));
        continue;
      }

      const id = createId('element-image');
      const preview = buildPreview(file);
      const pendingItem: UploadItem = {
        id,
        kind: 'image',
        name: file.name,
        preview,
        status: 'uploading',
      };

      setElements((current) =>
        current.map((item) =>
          item.id === elementId
            ? {
                ...item,
                images: [...item.images, pendingItem],
              }
            : item
        )
      );

      try {
        const url = await uploadFile(uploadFilePayload, 'image');
        revokePreviewUrl(preview);
        setElements((current) =>
          current.map((item) =>
            item.id === elementId
              ? {
                  ...item,
                  images: item.images.map((image) =>
                    image.id === id
                      ? {
                          ...image,
                          url,
                          preview: url,
                          status: 'uploaded',
                        }
                      : image
                  ),
                }
              : item
          )
        );
      } catch (error: any) {
        setElements((current) =>
          current.map((item) =>
            item.id === elementId
              ? {
                  ...item,
                  images: item.images.map((image) =>
                    image.id === id
                      ? {
                          ...image,
                          status: 'error',
                          error: error.message || t('upload_failed'),
                        }
                      : image
                  ),
                }
              : item
          )
        );
      }
    }
  };

  const handleElementVideoUpload = async (
    elementId: string,
    files: FileList | null
  ) => {
    if (!user) {
      setIsShowSignModal(true);
      return;
    }

    const file = files?.[0];
    if (!file) {
      return;
    }

    if (
      !KLING_VIDEO_UPLOAD_MIME_TYPES.includes(
        file.type as (typeof KLING_VIDEO_UPLOAD_MIME_TYPES)[number]
      )
    ) {
      toast.error('Only MP4 and MOV videos are supported.');
      return;
    }

    if (file.size > KLING_VIDEO_UPLOAD_MAX_BYTES) {
      toast.error('Video file is too large. Max size is 50MB.');
      return;
    }

    const id = createId('element-video');
    const preview = buildPreview(file);
    const pendingItem: UploadItem = {
      id,
      kind: 'video',
      name: file.name,
      preview,
      status: 'uploading',
    };

    setElements((current) =>
      current.map((item) =>
        item.id === elementId
          ? {
              ...item,
              video: pendingItem,
            }
          : item
      )
    );

    try {
      const url = await uploadFile(file, 'video');
      revokePreviewUrl(preview);
      setElements((current) =>
        current.map((item) =>
          item.id === elementId
            ? {
                ...item,
                video: {
                  ...pendingItem,
                  url,
                  preview: url,
                  status: 'uploaded',
                },
              }
            : item
        )
      );
    } catch (error: any) {
      setElements((current) =>
        current.map((item) =>
          item.id === elementId
            ? {
                ...item,
                video: {
                  ...pendingItem,
                  status: 'error',
                  error: error.message || t('upload_failed'),
                },
              }
            : item
        )
      );
    }
  };

  const insertElementToken = (token: string) => {
    const value = `@${normalizeKlingElementToken(token)}`;
    if (createMode === 'story-mode') {
      const targetShotId =
        focusedPrompt?.type === 'shot' &&
        shots.some((shot) => shot.id === focusedPrompt.shotId)
          ? focusedPrompt.shotId
          : shots[0]?.id;

      if (!targetShotId) {
        return;
      }

      setShots((current) =>
        current.map((shot) =>
          shot.id === targetShotId
            ? {
                ...shot,
                prompt: shot.prompt.trim() ? `${shot.prompt} ${value}` : value,
              }
            : shot
        )
      );

      setFocusedPrompt({ type: 'shot', shotId: targetShotId });
      return;
    }

    setPrompt((current) => (current.trim() ? `${current} ${value}` : value));
  };

  useEffect(() => {
    if (createMode === 'single-scene') {
      if (focusedPrompt?.type === 'shot') {
        setFocusedPrompt(null);
      }
      return;
    }

    if (!shots.length) {
      if (focusedPrompt !== null) {
        setFocusedPrompt(null);
      }
      return;
    }

    const focusedShotExists =
      focusedPrompt?.type === 'shot' &&
      shots.some((shot) => shot.id === focusedPrompt.shotId);

    if (!focusedShotExists) {
      setFocusedPrompt({ type: 'shot', shotId: shots[0].id });
    }
  }, [createMode, focusedPrompt, shots]);

  const pollTaskStatus = async (
    id: string,
    providerTaskIdForQuery?: string | null
  ) => {
    if (
      generationStartTime &&
      Date.now() - generationStartTime > GENERATION_TIMEOUT
    ) {
      toast.error(t('timeout'));
      setIsGenerating(false);
      setTaskId(null);
      setProviderTaskId(null);
      setTaskStatus(null);
      setProgress(0);
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
      throw new Error(`request failed with status ${resp.status}`);
    }

    const { code, message, data } = await resp.json();
    if (code !== 0) {
      throw new Error(message || 'Query failed');
    }

    const task = data as BackendTask;
    if (task.taskId) {
      setProviderTaskId(task.taskId);
    }
    const status = task.status as AITaskStatus;
    const taskInfo = parseTaskInfo(task.taskInfo);
    const videoUrls = extractVideoUrls(taskInfo);

    setTaskStatus(status);

    if (status === AITaskStatus.PENDING) {
      setProgress((current) => Math.max(current, 20));
      return false;
    }

    if (status === AITaskStatus.PROCESSING) {
      setProgress((current) => Math.min(current + 8, 85));
      return false;
    }

    if (status === AITaskStatus.SUCCESS) {
      if (videoUrls.length > 0) {
        setGeneratedVideos(
          videoUrls.map((url: string, index: number) => ({
            id: `${task.id}-${index}`,
            url,
            model: task.model,
            prompt: task.prompt || '',
          }))
        );
        toast.success(t('success'));
        window.sessionStorage.removeItem(KLING_DRAFT_KEY);
      } else {
        toast.error(t('no_videos_returned'));
      }

      setProgress(100);
      setIsGenerating(false);
      setTaskId(null);
      setProviderTaskId(null);
      setTaskStatus(null);
      await fetchUserCredits();
      return true;
    }

    if (status === AITaskStatus.FAILED) {
      toast.error(
        localizeGeneratorMessage(taskInfo?.errorMessage) || t('failed')
      );
      setIsGenerating(false);
      setTaskId(null);
      setProviderTaskId(null);
      setTaskStatus(null);
      setProgress(0);
      await fetchUserCredits();
      return true;
    }

    return false;
  };

  useEffect(() => {
    if (!taskId || !isGenerating) {
      return;
    }

    let cancelled = false;

    const tick = async () => {
      if (!taskId || cancelled) {
        return;
      }

      try {
        const completed = await pollTaskStatus(taskId, providerTaskId);
        if (completed) {
          cancelled = true;
        }
      } catch (error: any) {
        console.error('kling query failed:', error);
        toast.error(localizeGeneratorMessage(error.message) || t('failed'));
        setIsGenerating(false);
        setTaskId(null);
        setProviderTaskId(null);
        setTaskStatus(null);
        setProgress(0);
      }
    };

    tick();

    const interval = window.setInterval(tick, POLL_INTERVAL);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [
    generationStartTime,
    isGenerating,
    localizeGeneratorMessage,
    providerTaskId,
    taskId,
    t,
  ]);

  const submitKlingGeneration = useCallback(
    async (request: PendingKlingGenerationRequest) => {
      setIsGenerating(true);
      setProgress(15);
      setTaskStatus(AITaskStatus.PENDING);
      setGeneratedVideos([]);
      setGenerationStartTime(Date.now());

      try {
        const resp = await fetch('/api/ai/generate', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            mediaType: AIMediaType.VIDEO,
            scene: request.scene,
            provider: request.provider,
            model: request.model,
            prompt: request.prompt,
            options: request.options,
          }),
        });

        if (!resp.ok) {
          throw new Error(`request failed with status ${resp.status}`);
        }

        const { code, message, data } = await resp.json();
        if (code !== 0) {
          const fallbackPayload = isGenerationCreditFallbackPayload(data)
            ? data
            : null;
          if (fallbackPayload) {
            setCreditFallback(fallbackPayload);
            setIsGenerating(false);
            setTaskId(null);
            setProviderTaskId(null);
            setTaskStatus(null);
            setProgress(0);
            void fetchUserCredits();
            return false;
          }

          throw new Error(message || 'Generate failed');
        }

        if (!data?.id) {
          throw new Error('Task id missing');
        }

        setTaskId(data.id);
        setProviderTaskId(data.taskId ?? null);
        setProgress(25);
        setHasAttemptedSubmit(false);
        await fetchUserCredits();
        return true;
      } catch (error: any) {
        console.error('kling generate failed:', error);
        toast.error(localizeGeneratorMessage(error.message) || t('failed'));
        setIsGenerating(false);
        setTaskId(null);
        setProviderTaskId(null);
        setTaskStatus(null);
        setProgress(0);
        return false;
      }
    },
    [fetchUserCredits, localizeGeneratorMessage, t]
  );

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
    scope: KLING_QUEUE_SCOPE,
    userId: user?.id ?? null,
    enabled: hasFetchedCurrentSubscription && !hasQueueBypassAccess,
    waitRangeMs: videoQueueWaitRangeMs,
    snapshotDigest: queueSnapshotDigest,
    serializedPayload: queuePayload,
    onSubmit: async (serializedPayload) => {
      const request = JSON.parse(
        serializedPayload
      ) as PendingKlingGenerationRequest;
      pendingGenerateRequestRef.current = request;
      return submitKlingGeneration(request);
    },
  });
  const isCurrentRequestQueued =
    queueState?.status === 'queued' &&
    queueState.snapshotDigest === queueSnapshotDigest;
  const isCurrentRequestRetryable =
    queueState?.status === 'submit_failed' &&
    queueState.snapshotDigest === queueSnapshotDigest;
  const scrollToValidationAlert = useCallback(() => {
    if (typeof window === 'undefined') {
      return;
    }

    window.requestAnimationFrame(() => {
      validationAlertRef.current?.scrollIntoView({
        behavior: 'smooth',
        block: 'center',
      });
    });
  }, []);

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

  const handleSwitchToClassicVideoFallback = useCallback(() => {
    const trimmedPrompt = prompt.trim();
    if (!trimmedPrompt) {
      return;
    }

    setCreditFallback(null);
    handleCancelQueue();
    dispatchSeedanceGeneratorPrefill({
      prompt: trimmedPrompt,
      model: SEEDANCE_15_MODEL,
      mode: 'text-to-video',
      resolution: '480p',
      duration: 4,
      audio: false,
    });
    router.push(VIDEO_QUEUE_RETURN_HREF);
  }, [handleCancelQueue, prompt, router]);

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
      )
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
        onSelect: handleSwitchToClassicVideoFallback,
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
    handleSwitchToClassicVideoFallback,
    handleSwitchToImageFallback,
    t,
  ]);

  const handleGenerate = async () => {
    if (!user) {
      setIsShowSignModal(true);
      return;
    }

    setHasAttemptedSubmit(true);

    if (validationErrors.length > 0) {
      if (hasAdvancedValidationErrors) {
        setIsAdvancedOpen(true);
      }
      scrollToValidationAlert();
      return;
    }

    let hasQueueBypassAccessForAttempt = hasQueueBypassAccess;

    if (!hasFetchedCurrentSubscription || !hasQueueBypassAccessForAttempt) {
      const subscriptionResult = await fetchCurrentSubscription({
        force: !hasQueueBypassAccessForAttempt,
      });
      if (!subscriptionResult.ok) {
        toast.error(queueCopy.membershipCheckingLabel);
        return;
      }
      hasQueueBypassAccessForAttempt = Boolean(
        subscriptionResult.subscription || subscriptionResult.hasPaidEntitlement
      );
    } else if (isFetchingCurrentSubscription) {
      toast.error(queueCopy.membershipCheckingLabel);
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

    pendingGenerateRequestRef.current = generationRequest;

    if (isCurrentRequestRetryable) {
      await retryQueue();
      return;
    }

    if (hasQueueBypassAccessForAttempt) {
      await submitKlingGeneration(generationRequest);
      return;
    }

    const queueStartResult = await startQueue({
      forceQueue: true,
    });
    if (
      queueStartResult.status === 'queued' ||
      queueStartResult.status === 'restored_current_queue' ||
      queueStartResult.status === 'submitted'
    ) {
      setHasAttemptedSubmit(false);
    }
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

  const handleDownload = async (video: GeneratedVideo) => {
    if (!(await canDownload('video'))) {
      return;
    }

    try {
      setDownloadingVideoId(video.id);
      const resp = await fetch(
        `/api/proxy/file?url=${encodeURIComponent(video.url)}`
      );
      if (!resp.ok) {
        throw new Error('download failed');
      }

      const blob = await resp.blob();
      const blobUrl = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = blobUrl;
      link.download = `${video.id}.mp4`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.setTimeout(() => URL.revokeObjectURL(blobUrl), 200);
    } catch (error) {
      console.error('download failed:', error);
      toast.error(t('download_failed'));
    } finally {
      setDownloadingVideoId(null);
    }
  };

  const resetAll = () => {
    referenceImages.forEach(revokeUploadItemPreview);
    elements.forEach((element) => {
      element.images.forEach(revokeUploadItemPreview);
      revokeUploadItemPreview(element.video);
    });
    setCreateMode('single-scene');
    setPrompt('');
    setDuration(3);
    setQuality('std');
    setSound(false);
    setAspectRatio('16:9');
    setReferenceImages([]);
    setReferenceUploaderResetKey((current) => current + 1);
    setShots([createShotDraft(3), createShotDraft(3)]);
    setElements([]);
    setIsAdvancedOpen(false);
    setFocusedPrompt(null);
    setGeneratedVideos([]);
    setTaskId(null);
    setProviderTaskId(null);
    setTaskStatus(null);
    setIsGenerating(false);
    setProgress(0);
    setHasAttemptedSubmit(false);
    window.sessionStorage.removeItem(KLING_DRAFT_KEY);
    window.sessionStorage.removeItem(KLING_GENERATOR_PRESET_STORAGE_KEY);
  };

  return (
    <section
      id={id}
      className="bg-[linear-gradient(180deg,#f8fafc_0%,#ffffff_20%,#f8fafc_100%)] py-16 md:py-24 dark:bg-[linear-gradient(180deg,#020617_0%,#0b1120_100%)]"
    >
      <div className="container">
        <div className="mx-auto max-w-7xl">
          <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
            <Card className="overflow-hidden border-stone-200 dark:border-white/10 dark:bg-slate-950/90 dark:shadow-[0_28px_90px_rgba(2,6,23,0.4)]">
              <CardHeader className="border-b border-stone-200 bg-stone-50/60 dark:border-white/10 dark:bg-white/4">
                {srOnlyTitle ? (
                  <h2 className="sr-only">{srOnlyTitle}</h2>
                ) : null}
                <CardTitle className="flex items-center gap-2 text-2xl">
                  <Sparkles className="h-5 w-5" />
                  {t('title')}
                </CardTitle>
                <CardDescription>{t('description')}</CardDescription>
              </CardHeader>

              <CardContent className="space-y-8 py-6">
                <div className="space-y-4 rounded-2xl border border-stone-200 p-5 dark:border-white/10 dark:bg-white/4">
                  <div className="space-y-3">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <Label className="text-base dark:text-white">
                          {t('create_mode')}
                        </Label>
                      </div>
                    </div>
                    <Tabs
                      value={createMode}
                      onValueChange={(value) =>
                        setCreateMode(value as CreateMode)
                      }
                    >
                      <TabsList className="grid h-auto w-full grid-cols-2">
                        <TabsTrigger value="single-scene">
                          {t('single_scene')}
                        </TabsTrigger>
                        <TabsTrigger value="story-mode">
                          {t('story_mode')}
                        </TabsTrigger>
                      </TabsList>
                    </Tabs>
                  </div>
                </div>

                {createMode === 'single-scene' ? (
                  <div className="space-y-4 rounded-2xl border border-stone-200 p-5 dark:border-white/10 dark:bg-white/4">
                    <div className="flex items-center justify-between gap-3">
                      <Label
                        htmlFor="kling-main-prompt"
                        className="text-base font-medium"
                      >
                        {t('prompt')}
                      </Label>
                      <span className="text-muted-foreground text-xs">
                        {prompt.trim().length} / {MAX_PROMPT_LENGTH}
                      </span>
                    </div>
                    <Textarea
                      id="kling-main-prompt"
                      value={prompt}
                      onFocus={() => setFocusedPrompt({ type: 'main' })}
                      onChange={(event) => setPrompt(event.target.value)}
                      placeholder={t('prompt_placeholder')}
                      className="min-h-40"
                    />
                  </div>
                ) : null}

                <div className="space-y-4 rounded-2xl border border-stone-200 p-5 dark:border-white/10 dark:bg-white/4">
                  <div className="space-y-1">
                    <Label className="text-base">
                      {getCopy(
                        'reference_frames_optional',
                        t('reference_frames')
                      )}
                    </Label>
                    <p className="text-muted-foreground text-sm dark:text-slate-300">
                      {t(
                        createMode === 'story-mode'
                          ? 'reference_frames_story_hint'
                          : 'reference_frames_hint'
                      )}
                    </p>
                  </div>

                  <ImageUploader
                    key={`kling-reference-images-${createMode}-${referenceUploaderResetKey}`}
                    allowMultiple={referenceImageMaxItems > 1}
                    maxImages={referenceImageMaxItems}
                    maxSizeMB={0}
                    acceptedMimeTypes={[...KLING_IMAGE_UPLOAD_INPUT_MIME_TYPES]}
                    defaultPreviews={referenceImageUrls}
                    onChange={handleReferenceImagesChange}
                    disabled={!user}
                    onDisabledClick={() => setIsShowSignModal(true)}
                    prepareFile={prepareKlingImageUpload}
                    uploadHandler={(file) => uploadFile(file, 'image')}
                    compressBeforeUpload={false}
                    copy={referenceUploaderCopy}
                  />
                  {referenceImages.length === 0 ? (
                    <p className="text-muted-foreground text-xs">
                      {t('aspect_ratio')}: {aspectRatio}
                    </p>
                  ) : null}
                </div>

                {createMode === 'story-mode' ? (
                  <div className="space-y-4 rounded-2xl border border-stone-200 bg-stone-50/60 p-5 dark:border-white/10 dark:bg-white/4">
                    <div className="flex items-start justify-between gap-4">
                      <div className="space-y-1">
                        <Label className="text-base text-slate-950 dark:text-white">
                          {t('shots')}
                        </Label>
                        <p className="text-muted-foreground text-sm dark:text-slate-300">
                          {t('shots_hint')}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge variant="outline">
                          {t('story_total_duration')}
                        </Badge>
                        <Badge>{effectiveDuration}s</Badge>
                      </div>
                    </div>

                    <div className="space-y-3">
                      {shots.map((shot, index) => (
                        <div
                          key={shot.id}
                          className="space-y-3 rounded-2xl border border-stone-200 bg-white p-4 shadow-sm dark:border-white/10 dark:bg-slate-950/70"
                        >
                          <div className="flex items-center justify-between gap-3">
                            <div className="flex items-center gap-2">
                              <Badge variant="secondary">
                                {shot.title ||
                                  t('shot_label', { index: index + 1 })}
                              </Badge>
                              <Badge variant="outline">{shot.duration}s</Badge>
                            </div>
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon-sm"
                              onClick={() =>
                                setShots((current) =>
                                  current.filter((item) => item.id !== shot.id)
                                )
                              }
                              disabled={shots.length === 1}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>

                          <div className="grid gap-4 md:grid-cols-[1fr_120px]">
                            <div className="space-y-2">
                              <Label>{t('shot_prompt')}</Label>
                              <Textarea
                                value={shot.prompt}
                                onFocus={() =>
                                  setFocusedPrompt({
                                    type: 'shot',
                                    shotId: shot.id,
                                  })
                                }
                                onChange={(event) =>
                                  setShots((current) =>
                                    current.map((item) =>
                                      item.id === shot.id
                                        ? {
                                            ...item,
                                            prompt: event.target.value,
                                            title:
                                              item.title ||
                                              t('shot_label', {
                                                index: index + 1,
                                              }),
                                          }
                                        : item
                                    )
                                  )
                                }
                                placeholder={t('shot_prompt_placeholder')}
                                className="min-h-28"
                              />
                            </div>

                            <div className="space-y-2">
                              <Label>{t('duration_seconds')}</Label>
                              <Input
                                type="number"
                                min={KLING_STORY_SHOT_MIN_DURATION}
                                max={KLING_STORY_SHOT_MAX_DURATION}
                                value={shot.duration}
                                onChange={(event) =>
                                  setShots((current) =>
                                    current.map((item) =>
                                      item.id === shot.id
                                        ? {
                                            ...item,
                                            title:
                                              item.title ||
                                              t('shot_label', {
                                                index: index + 1,
                                              }),
                                            duration: clampShotDuration(
                                              Number.parseInt(
                                                event.target.value || '1',
                                                10
                                              ) || 1
                                            ),
                                          }
                                        : item
                                    )
                                  )
                                }
                              />
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>

                    <div className="flex justify-end">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() =>
                          setShots((current) => [
                            ...current,
                            createShotDraft(
                              Math.min(
                                KLING_STORY_SHOT_MAX_DURATION,
                                storyDurationRemaining
                              )
                            ),
                          ])
                        }
                        disabled={!canAddShot}
                      >
                        <Plus className="h-4 w-4" />
                        {t('add_shot')}
                      </Button>
                    </div>
                  </div>
                ) : null}

                <Collapsible
                  open={isAdvancedOpen}
                  onOpenChange={setIsAdvancedOpen}
                  className="rounded-2xl border border-stone-200 dark:border-white/10 dark:bg-white/4"
                >
                  <CollapsibleTrigger asChild>
                    <button
                      type="button"
                      className="flex w-full items-center justify-between gap-3 px-5 py-4 text-left"
                    >
                      <div>
                        <p className="text-base font-medium text-slate-950 dark:text-white">
                          {t('advanced_controls')}
                        </p>
                        <p className="text-muted-foreground mt-1 text-sm dark:text-slate-300">
                          {t('advanced_controls_hint')}
                        </p>
                      </div>
                      <ChevronDown
                        className={cn(
                          'h-5 w-5 shrink-0 transition-transform',
                          isAdvancedOpen && 'rotate-180'
                        )}
                      />
                    </button>
                  </CollapsibleTrigger>

                  <CollapsibleContent className="border-t border-stone-200 px-5 py-5 dark:border-white/10">
                    <div className="space-y-6">
                      <div className="space-y-4">
                        <div className="flex items-center justify-between gap-3">
                          <div>
                            <p className="text-base font-medium text-slate-950 dark:text-white">
                              {t('settings')}
                            </p>
                            {t('settings_hint') ? (
                              <p className="text-muted-foreground mt-1 text-sm dark:text-slate-300">
                                {t('settings_hint')}
                              </p>
                            ) : null}
                          </div>
                          <Badge className="bg-slate-950 text-white hover:bg-slate-950 dark:bg-amber-400 dark:text-slate-950 dark:hover:bg-amber-400">
                            {t('credits_cost', { credits: costCredits })}
                          </Badge>
                        </div>

                        <div className="grid gap-4 md:grid-cols-2">
                          <div className="space-y-2">
                            <Label>{t('quality')}</Label>
                            <Tabs
                              value={quality}
                              onValueChange={(value) =>
                                setQuality(value as KlingVideoQuality)
                              }
                            >
                              <TabsList className="grid w-full grid-cols-2">
                                <TabsTrigger value="std">
                                  {t('quality_std')}
                                </TabsTrigger>
                                <TabsTrigger value="pro">
                                  {t('quality_pro')}
                                </TabsTrigger>
                              </TabsList>
                            </Tabs>
                          </div>

                          <div className="rounded-xl border bg-white px-4 py-3 dark:border-white/10 dark:bg-slate-950/80">
                            <div className="flex items-start gap-3">
                              <Checkbox
                                id="kling-sound"
                                checked={sound}
                                onCheckedChange={(checked) =>
                                  setSound(checked === true)
                                }
                              />
                              <div className="space-y-1">
                                <Label
                                  htmlFor="kling-sound"
                                  className="flex cursor-pointer items-center gap-2"
                                >
                                  <Music4 className="h-4 w-4" />
                                  {t('sound')}
                                </Label>
                                {t('sound_hint') ? (
                                  <p className="text-muted-foreground text-sm dark:text-slate-300">
                                    {t('sound_hint')}
                                  </p>
                                ) : null}
                              </div>
                            </div>
                          </div>
                        </div>

                        {createMode === 'single-scene' ? (
                          <div className="space-y-3">
                            <div className="flex items-center justify-end gap-3">
                              <Badge>{duration}s</Badge>
                            </div>
                            <input
                              type="range"
                              min={KLING_MIN_DURATION}
                              max={KLING_MAX_DURATION}
                              step={1}
                              value={duration}
                              onChange={(event) =>
                                setDuration(
                                  Number.parseInt(event.target.value, 10)
                                )
                              }
                              className="accent-primary h-2 w-full cursor-pointer rounded-lg"
                            />
                          </div>
                        ) : (
                          <div className="rounded-xl border bg-white px-4 py-3 text-sm dark:border-white/10 dark:bg-slate-950/80 dark:text-slate-200">
                            <div className="flex items-center justify-between gap-3">
                              <span className="font-medium">
                                {t('story_total_duration')}
                              </span>
                              <Badge>{effectiveDuration}s</Badge>
                            </div>
                          </div>
                        )}
                      </div>

                      {referenceImages.length === 0 ? (
                        <div className="space-y-2">
                          <Label>{t('aspect_ratio')}</Label>
                          <Select
                            value={aspectRatio}
                            onValueChange={setAspectRatio}
                          >
                            <SelectTrigger>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {KLING_ASPECT_RATIO_OPTIONS.map((option) => (
                                <SelectItem key={option} value={option}>
                                  {option}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      ) : null}

                      <div className="space-y-4">
                        <div className="flex items-center justify-between gap-3">
                          <div>
                            <Label className="text-base">{t('elements')}</Label>
                            <p className="text-muted-foreground mt-1 text-sm">
                              {t('elements_hint')}
                            </p>
                          </div>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => {
                              setIsAdvancedOpen(true);
                              setElements((current) => [
                                ...current.filter(hasElementDraftContent),
                                createElementDraft(),
                              ]);
                            }}
                            disabled={
                              activeElements.length >= KLING_MAX_ELEMENTS
                            }
                          >
                            <Plus className="h-4 w-4" />
                            {t('add_element')}
                          </Button>
                        </div>

                        <div className="space-y-4">
                          {elements.map((element, index) => (
                            <div
                              key={element.id}
                              className="rounded-2xl border border-stone-200 bg-white p-4 dark:border-white/10 dark:bg-slate-950/70"
                            >
                              <div className="flex items-center justify-between gap-3">
                                <div className="flex items-center gap-2">
                                  <Badge variant="secondary">
                                    {t('element_label', { index: index + 1 })}
                                  </Badge>
                                  <Badge variant="outline">
                                    @{normalizeKlingElementToken(element.name)}
                                  </Badge>
                                </div>
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="icon-sm"
                                  onClick={() =>
                                    setElements((current) => {
                                      const removedElement = current.find(
                                        (item) => item.id === element.id
                                      );
                                      if (removedElement) {
                                        removedElement.images.forEach(
                                          revokeUploadItemPreview
                                        );
                                        revokeUploadItemPreview(
                                          removedElement.video
                                        );
                                      }

                                      return current.filter(
                                        (item) => item.id !== element.id
                                      );
                                    })
                                  }
                                >
                                  <Trash2 className="h-4 w-4" />
                                </Button>
                              </div>

                              <div className="mt-4 grid gap-4 md:grid-cols-2">
                                <div className="space-y-2">
                                  <Label>{t('element_name')}</Label>
                                  <Input
                                    value={element.name}
                                    onChange={(event) =>
                                      setElements((current) =>
                                        current.map((item) =>
                                          item.id === element.id
                                            ? {
                                                ...item,
                                                name: event.target.value,
                                              }
                                            : item
                                        )
                                      )
                                    }
                                    placeholder={t('element_name_placeholder')}
                                  />
                                </div>

                                <div className="space-y-2">
                                  <Label>{t('element_media_type')}</Label>
                                  <Tabs
                                    value={element.mediaType}
                                    onValueChange={(value) =>
                                      setElements((current) =>
                                        current.map((item) => {
                                          if (item.id !== element.id) {
                                            return item;
                                          }

                                          if (value === 'images') {
                                            revokeUploadItemPreview(item.video);
                                            return {
                                              ...item,
                                              mediaType: 'images',
                                              video: null,
                                            };
                                          }

                                          item.images.forEach(
                                            revokeUploadItemPreview
                                          );
                                          return {
                                            ...item,
                                            mediaType: 'video',
                                            images: [],
                                          };
                                        })
                                      )
                                    }
                                  >
                                    <TabsList className="grid w-full grid-cols-2">
                                      <TabsTrigger value="images">
                                        {t('element_images')}
                                      </TabsTrigger>
                                      <TabsTrigger value="video">
                                        {t('element_video')}
                                      </TabsTrigger>
                                    </TabsList>
                                  </Tabs>
                                </div>
                              </div>

                              <div className="mt-4 space-y-2">
                                <Label>{t('element_description')}</Label>
                                <Textarea
                                  value={element.description}
                                  onChange={(event) =>
                                    setElements((current) =>
                                      current.map((item) =>
                                        item.id === element.id
                                          ? {
                                              ...item,
                                              description: event.target.value,
                                            }
                                          : item
                                      )
                                    )
                                  }
                                  placeholder={t(
                                    'element_description_placeholder'
                                  )}
                                  className="min-h-24"
                                />
                              </div>

                              <div className="mt-4">
                                {element.mediaType === 'images' ? (
                                  <MediaPicker
                                    title={t('element_images')}
                                    hint={t('element_images_hint')}
                                    kind="image"
                                    items={element.images}
                                    maxItems={KLING_IMAGE_ELEMENT_MAX_IMAGES}
                                    accept={KLING_IMAGE_UPLOAD_INPUT_MIME_TYPES.join(
                                      ','
                                    )}
                                    uploadLabel={t('upload')}
                                    statusLabels={{
                                      ready: t('status_ready'),
                                      uploading: t('status_uploading'),
                                      errorFallback: t('upload_failed'),
                                      idle: t('status_idle'),
                                    }}
                                    onAdd={(files) =>
                                      handleElementImageUpload(
                                        element.id,
                                        files
                                      )
                                    }
                                    onRemove={(id) =>
                                      setElements((current) =>
                                        current.map((item) => {
                                          if (item.id !== element.id) {
                                            return item;
                                          }

                                          const removedItem = item.images.find(
                                            (image) => image.id === id
                                          );
                                          revokeUploadItemPreview(removedItem);

                                          return {
                                            ...item,
                                            images: item.images.filter(
                                              (image) => image.id !== id
                                            ),
                                          };
                                        })
                                      )
                                    }
                                  />
                                ) : (
                                  <MediaPicker
                                    title={t('element_video')}
                                    hint={t('element_video_hint')}
                                    kind="video"
                                    items={element.video ? [element.video] : []}
                                    maxItems={1}
                                    accept={KLING_VIDEO_UPLOAD_MIME_TYPES.join(
                                      ','
                                    )}
                                    uploadLabel={t('upload')}
                                    statusLabels={{
                                      ready: t('status_ready'),
                                      uploading: t('status_uploading'),
                                      errorFallback: t('upload_failed'),
                                      idle: t('status_idle'),
                                    }}
                                    onAdd={(files) =>
                                      handleElementVideoUpload(
                                        element.id,
                                        files
                                      )
                                    }
                                    onRemove={() =>
                                      setElements((current) =>
                                        current.map((item) => {
                                          if (item.id !== element.id) {
                                            return item;
                                          }

                                          revokeUploadItemPreview(item.video);
                                          return { ...item, video: null };
                                        })
                                      )
                                    }
                                  />
                                )}
                              </div>

                              <div className="mt-4 flex items-center justify-between gap-3 rounded-xl border border-stone-200 bg-stone-50/80 px-4 py-3 dark:border-white/10 dark:bg-slate-950/80">
                                <div>
                                  <p className="text-sm font-medium dark:text-white">
                                    @{normalizeKlingElementToken(element.name)}
                                  </p>
                                  <p className="text-muted-foreground text-xs dark:text-slate-300">
                                    {t('insert_token_hint')}
                                  </p>
                                </div>
                                <Button
                                  type="button"
                                  variant="outline"
                                  size="sm"
                                  onClick={() =>
                                    insertElementToken(
                                      element.name || 'element'
                                    )
                                  }
                                >
                                  {t('insert_token')}
                                </Button>
                              </div>
                            </div>
                          ))}

                          {elements.length === 0 ? (
                            <div className="text-muted-foreground rounded-xl border border-dashed border-stone-300 px-4 py-8 text-center text-sm dark:border-white/12 dark:bg-slate-950/50 dark:text-slate-400">
                              {t('elements_empty')}
                            </div>
                          ) : null}
                        </div>
                      </div>
                    </div>
                  </CollapsibleContent>
                </Collapsible>

                {hasAttemptedSubmit && validationErrors.length > 0 ? (
                  <div
                    ref={validationAlertRef}
                    className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-200"
                  >
                    <p className="font-medium">{t('validation_title')}</p>
                    <ul className="mt-2 space-y-1">
                      {validationErrors.slice(0, 3).map((error) => (
                        <li key={error}>{error}</li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </CardContent>

              <CardFooter className="bg-background sticky bottom-0 z-10 border-t py-4 dark:border-white/10 dark:bg-slate-950/95">
                <div className="flex w-full flex-col gap-3 md:flex-row md:items-center md:justify-between">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2 text-sm">
                      <Badge variant="outline">
                        {effectiveDuration}s ·{' '}
                        {quality === 'std'
                          ? t('quality_std')
                          : t('quality_pro')}
                        {sound ? ` · ${t('sound')}` : ''}
                      </Badge>
                      {showCreditsCost ? (
                        <span className="text-primary font-medium dark:text-amber-300">
                          {t('credits_cost', { credits: costCredits })}
                        </span>
                      ) : null}
                    </div>
                    <p className="text-muted-foreground text-sm">
                      {t('credits_remaining', { credits: remainingCredits })}
                    </p>
                  </div>

                  <div className="flex w-full flex-col gap-2 md:w-auto md:flex-row">
                    <Button type="button" variant="outline" onClick={resetAll}>
                      {t('reset')}
                    </Button>

                    {!user ? (
                      <Button
                        type="button"
                        onClick={() => setIsShowSignModal(true)}
                      >
                        <User className="h-4 w-4" />
                        {t('sign_in')}
                      </Button>
                    ) : (
                      <Button
                        type="button"
                        onClick={handleGenerate}
                        disabled={
                          isQueueSubmitting ||
                          isCurrentRequestQueued ||
                          isGenerating ||
                          isUploading ||
                          isFetchingCurrentSubscription
                        }
                      >
                        {isQueueSubmitting || isCurrentRequestQueued ? (
                          <>
                            <Loader2 className="h-4 w-4 animate-spin" />
                            {queueCopy.waitingButtonLabel}
                          </>
                        ) : isCurrentRequestRetryable ? (
                          <>
                            <Sparkles className="h-4 w-4" />
                            {queueCopy.retryLabel}
                          </>
                        ) : isGenerating ? (
                          <>
                            <Loader2 className="h-4 w-4 animate-spin" />
                            {t('generating')}
                          </>
                        ) : isFetchingCurrentSubscription ? (
                          <>
                            <Loader2 className="h-4 w-4 animate-spin" />
                            {queueT('loading')}
                          </>
                        ) : (
                          <>
                            <Sparkles className="h-4 w-4" />
                            {t('generate')}
                          </>
                        )}
                      </Button>
                    )}
                  </div>
                </div>
              </CardFooter>
            </Card>

            {isQueueActive && queueState ? (
              <div className="lg:col-start-1 lg:row-start-2">
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
                  onRetry={isCurrentRequestRetryable ? retryQueue : undefined}
                  onUpgradeClick={handleUpgradeFromQueue}
                  isSubmitting={isQueueSubmitting}
                  isSubmitFailed={isCurrentRequestRetryable}
                  retryLabel={queueCopy.retryLabel}
                  submitFailedLabel={queueCopy.submitFailedLabel}
                />
              </div>
            ) : null}

            <Card className="h-fit border-stone-200 lg:sticky lg:top-24 lg:col-start-2 lg:row-start-1 lg:self-start dark:border-white/10 dark:bg-slate-950/90 dark:shadow-[0_24px_60px_rgba(2,6,23,0.4)]">
              <CardHeader className="border-b border-stone-200 dark:border-white/10">
                <CardTitle className="flex items-center gap-2">
                  <Video className="h-5 w-5" />
                  {t('preview_title')}
                </CardTitle>
                <CardDescription>{t('preview_description')}</CardDescription>
              </CardHeader>

              <CardContent className="space-y-6 py-6">
                {isGenerating ? (
                  <div className="space-y-3 rounded-2xl border p-4 dark:border-white/10 dark:bg-white/4">
                    <div className="flex items-center justify-between text-sm">
                      <span>{t('progress')}</span>
                      <span>{progress}%</span>
                    </div>
                    <Progress value={progress} />
                    <p className="text-muted-foreground text-sm dark:text-slate-300">
                      {taskStatus === AITaskStatus.PENDING
                        ? t('status_pending')
                        : taskStatus === AITaskStatus.PROCESSING
                          ? t('status_processing')
                          : t('status_preparing')}
                    </p>
                  </div>
                ) : null}

                {generatedVideos.length > 0 ? (
                  <div className="space-y-6">
                    {generatedVideos.map((video) => (
                      <div key={video.id} className="space-y-3">
                        <div className={KLING_PREVIEW_SURFACE_CLASS_NAME}>
                          <video
                            src={video.url}
                            autoPlay
                            controls
                            controlsList="nodownload"
                            loop
                            muted
                            playsInline
                            preload="auto"
                            className="h-full w-full object-contain"
                          />
                        </div>
                        <div className="flex items-center justify-between gap-3">
                          <div className="text-muted-foreground text-sm dark:text-slate-300">
                            {effectiveDuration}s ·{' '}
                            {video.model === KLING_VIDEO_MODEL
                              ? 'ChatGPT Image 2 Pro'
                              : video.model}
                          </div>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => handleDownload(video)}
                            disabled={downloadingVideoId === video.id}
                          >
                            {downloadingVideoId === video.id ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              <Download className="h-4 w-4" />
                            )}
                            {t('download')}
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="rounded-2xl border border-dashed p-4 dark:border-white/12 dark:bg-white/4">
                    {DEFAULT_SHOWCASE_PREVIEW_VIDEO ? (
                      <div className={KLING_PREVIEW_SURFACE_CLASS_NAME}>
                        <video
                          key={DEFAULT_SHOWCASE_PREVIEW_VIDEO}
                          src={DEFAULT_SHOWCASE_PREVIEW_VIDEO}
                          autoPlay
                          muted
                          loop
                          playsInline
                          preload="metadata"
                          className="h-full w-full object-cover"
                        />
                      </div>
                    ) : (
                      <div
                        className={cn(
                          KLING_PREVIEW_SURFACE_CLASS_NAME,
                          'bg-muted dark:bg-white/8'
                        )}
                      >
                        {createMode === 'story-mode' ? (
                          <Clapperboard className="h-8 w-8" />
                        ) : (
                          <Video className="h-8 w-8" />
                        )}
                      </div>
                    )}
                  </div>
                )}
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
          queueT.has('credit_fallback.earn_title')
            ? queueT('credit_fallback.earn_title')
            : 'Free ways to get credits'
        }
        earnActions={creditEarnActions}
      />
      <PaidDownloadDialog {...paidDownloadDialogProps} />
    </section>
  );
}
