import { envConfigs } from '@/config';
import { AIMediaType, AITaskStatus, KieProvider } from '@/extensions/ai';
import { buildGenerationCreditFallbackPayload } from '@/shared/lib/generation-credit-fallback';
import {
  getGptImageMaxReferenceImages,
  getGptImageModelForScene,
  getKieGptImageModelForScene,
  GPT_IMAGE_PROVIDER_APIMART,
  GPT_IMAGE_PROVIDER_KIE,
  isAnyGptImageModel,
  isApimartGptImageModel,
  isKieGptImageModel,
  resolveGptImageProvider,
} from '@/shared/lib/gpt-image';
import { getGptImageCreditsForSubscription } from '@/shared/lib/gpt-image-membership';
import { getUuid } from '@/shared/lib/hash';
import {
  calculateImageCredits,
  getAdvancedImageModel,
  GPT_IMAGE_2_CREDITS,
  normalizeImageResolution,
} from '@/shared/lib/image-pricing';
import {
  calculateKlingCredits,
  isKlingVideoModel,
  KlingVideoOptions,
  validateKlingVideoOptions,
} from '@/shared/lib/kling-video';
import { respData, respErr, respJson } from '@/shared/lib/resp';
import { calculateSeedanceCredits } from '@/shared/lib/seedance-pricing';
import {
  hasSeedanceAssetReferences,
  isSeedanceReferenceAssetId,
  resolveVideoGenerationProvider,
  SEEDANCE_PROVIDER_APIMART,
} from '@/shared/lib/seedance-provider';
import {
  normalizeSeedancePromptReferenceBindings,
  resolveSeedancePromptReferenceSelection,
  validateSeedancePromptReferenceTokens,
} from '@/shared/lib/seedance-reference-prompt';
import { verifySeedanceReferenceToken } from '@/shared/lib/seedance-reference-server';
import {
  exceedsSeedanceReferenceVideoPixelCount,
  getSeedance2CanonicalScene,
  getSeedanceReferenceVideoPixelLimitMessage,
  isSeedance2AssetModel,
  isSeedance2GenerationModel,
  isSeedance2Mode,
  isSeedance15Model,
  normalizeSeedance2Duration,
  normalizeSeedance15Duration,
  normalizeSeedanceAspectRatio,
  SEEDANCE_2_APIMART_REFERENCE_VIDEO_MAX_RESOLUTION,
  SEEDANCE_2_APIMART_REFERENCE_VIDEO_MIN_RESOLUTION,
  SEEDANCE_2_MAX_DURATION,
  SEEDANCE_2_MIN_DURATION,
  SEEDANCE_2_REFERENCE_AUDIO_MAX_DURATION,
  SEEDANCE_2_REFERENCE_AUDIO_MAX_ITEMS,
  SEEDANCE_2_REFERENCE_AUDIO_MAX_TOTAL_DURATION,
  SEEDANCE_2_REFERENCE_AUDIO_MIN_DURATION,
  SEEDANCE_2_REFERENCE_IMAGE_MAX_ITEMS,
  SEEDANCE_2_REFERENCE_MAX_TOTAL_ITEMS,
  SEEDANCE_2_REFERENCE_VIDEO_MAX_DURATION,
  SEEDANCE_2_REFERENCE_VIDEO_MAX_ITEMS,
  SEEDANCE_2_REFERENCE_VIDEO_MAX_TOTAL_DURATION,
  SEEDANCE_2_REFERENCE_VIDEO_MIN_DURATION,
  SEEDANCE_15_MODEL,
  Seedance2VideoOptions,
  Seedance15Scene,
  Seedance15VideoOptions,
  SeedancePromptReferenceBinding,
  SeedanceTimedReferenceAsset,
} from '@/shared/lib/seedance-video';
import { calculateVideoCredits } from '@/shared/lib/video-pricing';
import {
  createAITask,
  NewAITask,
  updateAITaskById,
} from '@/shared/models/ai_task';
import { Configs, getAllConfigs } from '@/shared/models/config';
import { getRemainingCredits } from '@/shared/models/credit';
import { getCurrentSubscription } from '@/shared/models/subscription';
import { getUserInfo } from '@/shared/models/user';
import { getAIService } from '@/shared/services/ai';
import {
  CREEM_PROMPT_MODERATION_REJECTED_MESSAGE,
  CREEM_PROMPT_MODERATION_UNAVAILABLE_MESSAGE,
  ensureCreemPromptAllowed,
  isCreemPromptModerationEnabled,
  isCreemPromptModerationFailClosed,
  PromptModerationDecisionError,
} from '@/shared/services/content-moderation';

type PersistedAITask = Awaited<ReturnType<typeof createAITask>>;

function isStringArray(value: unknown): value is string[] {
  return (
    Array.isArray(value) && value.every((item) => typeof item === 'string')
  );
}

function normalizeTimedReferenceAssets(
  value: unknown,
  kind: 'video' | 'audio'
): {
  items: SeedanceTimedReferenceAsset[];
  invalidCount: number;
} {
  if (!Array.isArray(value)) {
    return {
      items: [],
      invalidCount: 0,
    };
  }

  const normalized: SeedanceTimedReferenceAsset[] = [];
  let invalidCount = 0;

  value.forEach((item) => {
    if (!item || typeof item !== 'object') {
      invalidCount += 1;
      return;
    }

    const record = item as Record<string, unknown>;
    const url = typeof record.url === 'string' ? record.url.trim() : '';
    const assetId =
      typeof record.assetId === 'string' ? record.assetId.trim() : undefined;
    const metadataToken =
      typeof record.metadataToken === 'string' ? record.metadataToken : '';

    if (!url || !metadataToken) {
      invalidCount += 1;
      return;
    }

    const verified = verifySeedanceReferenceToken({
      token: metadataToken,
      kind,
      url,
    });

    if (!verified) {
      invalidCount += 1;
      return;
    }

    normalized.push({
      url,
      durationSeconds: verified.durationSeconds,
      width:
        typeof verified.width === 'number' && Number.isFinite(verified.width)
          ? verified.width
          : typeof record.width === 'number' && Number.isFinite(record.width)
            ? record.width
            : undefined,
      height:
        typeof verified.height === 'number' && Number.isFinite(verified.height)
          ? verified.height
          : typeof record.height === 'number' && Number.isFinite(record.height)
            ? record.height
            : undefined,
      name: typeof record.name === 'string' ? record.name : undefined,
      metadataToken,
      assetId,
    });
  });

  return {
    items: normalized,
    invalidCount,
  };
}

function validatePrompt(prompt?: string | null) {
  const trimmedPrompt = prompt?.trim() ?? '';
  if (!trimmedPrompt) {
    return 'prompt is required';
  }

  if (trimmedPrompt.length < 3 || trimmedPrompt.length > 2500) {
    return 'prompt must be between 3 and 2500 characters';
  }

  return null;
}

function validateTimedReferenceAssets({
  items,
  itemLabel,
  maxItems,
  minDuration,
  maxDuration,
  maxTotalDuration,
}: {
  items: SeedanceTimedReferenceAsset[];
  itemLabel: 'reference videos' | 'reference audios';
  maxItems: number;
  minDuration: number;
  maxDuration: number;
  maxTotalDuration: number;
}) {
  if (items.length > maxItems) {
    return `too many ${itemLabel}`;
  }

  const totalDuration = items.reduce(
    (sum, item) => sum + item.durationSeconds,
    0
  );
  if (totalDuration > maxTotalDuration) {
    return `${itemLabel} total duration exceeds ${maxTotalDuration} seconds`;
  }

  for (const item of items) {
    if (
      item.durationSeconds < minDuration ||
      item.durationSeconds > maxDuration
    ) {
      return `${itemLabel} duration must be between ${minDuration} and ${maxDuration} seconds`;
    }
  }

  return null;
}

function validateApimartReferenceVideos(items: SeedanceTimedReferenceAsset[]) {
  for (const item of items) {
    const label = item.name?.trim() || 'Reference video';
    const width =
      typeof item.width === 'number' && Number.isFinite(item.width)
        ? Math.round(item.width)
        : 0;
    const height =
      typeof item.height === 'number' && Number.isFinite(item.height)
        ? Math.round(item.height)
        : 0;

    if (width <= 0 || height <= 0) {
      return `${label} is missing width or height metadata. Please remove and re-upload the reference video.`;
    }

    const resolution = Math.min(width, height);
    if (
      resolution < SEEDANCE_2_APIMART_REFERENCE_VIDEO_MIN_RESOLUTION ||
      resolution > SEEDANCE_2_APIMART_REFERENCE_VIDEO_MAX_RESOLUTION
    ) {
      return `${label} is ${width}x${height}. Please upload a ${SEEDANCE_2_APIMART_REFERENCE_VIDEO_MIN_RESOLUTION}P-${SEEDANCE_2_APIMART_REFERENCE_VIDEO_MAX_RESOLUTION}P reference video.`;
    }
  }

  return null;
}

function validateSeedanceReferenceVideoPixelCount(
  items: SeedanceTimedReferenceAsset[]
) {
  for (const item of items) {
    if (
      exceedsSeedanceReferenceVideoPixelCount({
        width: item.width,
        height: item.height,
      })
    ) {
      return getSeedanceReferenceVideoPixelLimitMessage({
        name: item.name,
        width: item.width,
        height: item.height,
      });
    }
  }

  return null;
}

function isPublicHttpUrl(value?: string | null) {
  const normalized = value?.trim();
  if (!normalized) {
    return false;
  }

  try {
    const parsed = new URL(normalized);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

function isApimartImageReference(value?: string | null) {
  const normalized = value?.trim();
  if (!normalized) {
    return false;
  }

  return (
    isPublicHttpUrl(normalized) ||
    /^data:image\/[a-z0-9.+-]+;base64,/i.test(normalized)
  );
}

function collectGptImageReferences(options?: Record<string, unknown> | null) {
  const rawImageInput = Array.isArray(options?.image_input)
    ? options.image_input
    : [];
  const rawImageUrls = Array.isArray(options?.image_urls)
    ? options.image_urls
    : [];

  return [...rawImageInput, ...rawImageUrls]
    .map((url) => (typeof url === 'string' ? url.trim() : ''))
    .filter(Boolean)
    .filter((item, index, array) => array.indexOf(item) === index);
}

function validateApimartPublicReferenceUrls(options: Seedance2VideoOptions) {
  const firstFrameUrl = options.first_frame_url?.trim();
  if (firstFrameUrl && !isPublicHttpUrl(firstFrameUrl)) {
    return 'first_frame_url must be a public http(s) URL.';
  }

  const lastFrameUrl = options.last_frame_url?.trim();
  if (lastFrameUrl && !isPublicHttpUrl(lastFrameUrl)) {
    return 'last_frame_url must be a public http(s) URL.';
  }

  const invalidReferenceImage = options.reference_image_urls?.find(
    (item) => !isPublicHttpUrl(item)
  );
  if (invalidReferenceImage) {
    return 'reference images must use public http(s) URLs.';
  }

  const invalidReferenceVideo = options.reference_videos?.find(
    (item) => !isPublicHttpUrl(item.url)
  );
  if (invalidReferenceVideo) {
    return 'reference videos must use public http(s) URLs.';
  }

  const invalidReferenceAudio = options.reference_audios?.find(
    (item) => !isPublicHttpUrl(item.url)
  );
  if (invalidReferenceAudio) {
    return 'reference audios must use public http(s) URLs.';
  }

  return null;
}

const APIMART_GPT_IMAGE_ASPECT_RATIOS = new Set([
  '1:1',
  '16:9',
  '9:16',
  '4:3',
  '3:4',
  '3:2',
  '2:3',
  '5:4',
  '4:5',
  '2:1',
  '1:2',
  '21:9',
  '9:21',
]);

function validateKieGptImageOptions({
  model,
  scene,
  options,
}: {
  model?: string | null;
  scene?: string | null;
  options?: Record<string, unknown> | null;
}) {
  if (scene !== 'text-to-image' && scene !== 'image-to-image') {
    return 'invalid scene';
  }

  if (model !== getKieGptImageModelForScene(scene)) {
    return 'invalid model for GPT Image scene';
  }

  if (options?.aspect_ratio !== undefined) {
    return 'aspect_ratio not supported for GPT Image';
  }

  if (options?.quality !== undefined) {
    return 'quality not supported for GPT Image';
  }

  if (options?.resolution !== undefined) {
    return 'resolution not supported for GPT Image';
  }

  if (options?.output_format !== undefined) {
    return 'output_format not supported for GPT Image';
  }

  if (options?.google_search !== undefined) {
    return 'google_search not supported for GPT Image';
  }

  const imageInput = collectGptImageReferences(options);

  if (scene === 'image-to-image' && imageInput.length === 0) {
    return 'reference image is required';
  }

  if (scene === 'text-to-image' && imageInput.length > 0) {
    return 'text-to-image does not support reference images';
  }

  if (
    imageInput.length > getGptImageMaxReferenceImages(GPT_IMAGE_PROVIDER_KIE)
  ) {
    return 'too many reference images';
  }

  return null;
}

function validateApimartGptImageOptions({
  model,
  scene,
  options,
}: {
  model?: string | null;
  scene?: string | null;
  options?: Record<string, unknown> | null;
}) {
  if (scene !== 'text-to-image' && scene !== 'image-to-image') {
    return 'invalid scene';
  }

  if (!isApimartGptImageModel(model)) {
    return 'invalid model for GPT Image scene';
  }

  if (
    options?.aspect_ratio !== undefined &&
    (typeof options.aspect_ratio !== 'string' ||
      !APIMART_GPT_IMAGE_ASPECT_RATIOS.has(options.aspect_ratio))
  ) {
    return 'invalid aspect_ratio';
  }

  if (options?.resolution !== undefined) {
    return 'resolution not supported for APIMart GPT Image 2';
  }

  if (options?.quality !== undefined) {
    return 'quality not supported for APIMart GPT Image 2';
  }

  if (options?.output_format !== undefined) {
    return 'output_format not supported for APIMart GPT Image 2';
  }

  if (options?.google_search !== undefined) {
    return 'google_search not supported for GPT Image';
  }

  const imageInput = collectGptImageReferences(options);

  if (scene === 'image-to-image' && imageInput.length === 0) {
    return 'reference image is required';
  }

  if (scene === 'text-to-image' && imageInput.length > 0) {
    return 'text-to-image does not support reference images';
  }

  if (
    imageInput.length >
    getGptImageMaxReferenceImages(GPT_IMAGE_PROVIDER_APIMART)
  ) {
    return 'too many reference images';
  }

  const invalidReferenceImage = imageInput.find(
    (item) => !isApimartImageReference(item)
  );
  if (invalidReferenceImage) {
    return 'reference images must use public http(s) URLs or image data URIs.';
  }

  return null;
}

function validateSeedance15Options({
  prompt,
  scene,
  options,
}: {
  prompt?: string | null;
  scene?: string | null;
  options?: Seedance15VideoOptions | null;
}) {
  const promptError = validatePrompt(prompt);
  if (promptError) {
    return promptError;
  }

  if (scene !== 'text-to-video' && scene !== 'image-to-video') {
    return 'invalid scene';
  }

  const imageInput = Array.isArray(options?.image_input)
    ? options?.image_input.filter(
        (url) => typeof url === 'string' && url.trim()
      )
    : [];

  if (scene === 'image-to-video' && imageInput.length === 0) {
    return 'reference image is required';
  }

  if (imageInput.length > 2) {
    return 'image-to-video supports up to 2 images';
  }

  if (scene === 'text-to-video' && imageInput.length > 0) {
    return 'text-to-video does not support reference images';
  }

  if (
    options?.aspect_ratio &&
    !normalizeSeedanceAspectRatio(options.aspect_ratio, SEEDANCE_15_MODEL)
  ) {
    return 'invalid aspect_ratio';
  }

  if (
    options?.resolution &&
    !['480p', '720p', '1080p'].includes(options.resolution)
  ) {
    return 'invalid resolution';
  }

  if (
    options?.duration !== undefined &&
    normalizeSeedance15Duration(options.duration) !== String(options.duration)
  ) {
    return 'invalid duration';
  }

  if (
    options?.fixed_lens !== undefined &&
    typeof options.fixed_lens !== 'boolean'
  ) {
    return 'invalid fixed_lens';
  }

  if (
    options?.generate_audio !== undefined &&
    typeof options.generate_audio !== 'boolean'
  ) {
    return 'invalid generate_audio';
  }

  return null;
}

function normalizeSeedance15Options(
  options?: Seedance15VideoOptions | null
): Seedance15VideoOptions {
  const normalized: Seedance15VideoOptions = {
    aspect_ratio: normalizeSeedanceAspectRatio(
      options?.aspect_ratio,
      SEEDANCE_15_MODEL
    ),
    resolution:
      options?.resolution &&
      ['480p', '720p', '1080p'].includes(options.resolution)
        ? options.resolution
        : '480p',
    duration: normalizeSeedance15Duration(options?.duration) ?? '4',
    fixed_lens: Boolean(options?.fixed_lens),
    generate_audio: Boolean(options?.generate_audio),
  };

  if (Array.isArray(options?.image_input)) {
    normalized.image_input = options.image_input
      .filter((url) => typeof url === 'string' && url.trim())
      .slice(0, 2);
  }

  if (!normalized.aspect_ratio) {
    normalized.aspect_ratio = '16:9';
  }

  return normalized;
}

function validateSeedance2Options({
  model,
  prompt,
  options,
}: {
  model?: string | null;
  prompt?: string | null;
  options?: Seedance2VideoOptions | null;
}) {
  const promptError = validatePrompt(prompt);
  if (promptError) {
    return promptError;
  }

  if (!isSeedance2Mode(options?.seedance_mode)) {
    return 'invalid seedance_mode';
  }

  if (
    options?.resolution &&
    options.resolution !== '480p' &&
    options.resolution !== '720p'
  ) {
    return 'invalid resolution';
  }

  if (
    options?.duration !== undefined &&
    normalizeSeedance2Duration(options.duration) !== Number(options.duration)
  ) {
    return `duration must be an integer between ${SEEDANCE_2_MIN_DURATION} and ${SEEDANCE_2_MAX_DURATION}`;
  }

  if (
    options?.aspect_ratio &&
    !normalizeSeedanceAspectRatio(options.aspect_ratio, 'bytedance/seedance-2')
  ) {
    return 'invalid aspect_ratio';
  }

  if (
    options?.return_last_frame !== undefined &&
    typeof options.return_last_frame !== 'boolean'
  ) {
    return 'invalid return_last_frame';
  }

  if (
    options?.generate_audio !== undefined &&
    typeof options.generate_audio !== 'boolean'
  ) {
    return 'invalid generate_audio';
  }

  if (
    options?.web_search !== undefined &&
    typeof options.web_search !== 'boolean'
  ) {
    return 'invalid web_search';
  }

  if (
    options?.seed !== undefined &&
    (!Number.isInteger(options.seed) || !Number.isFinite(options.seed))
  ) {
    return 'invalid seed';
  }

  const referenceImages = isStringArray(options?.reference_image_urls)
    ? options.reference_image_urls.filter((url) => url.trim())
    : [];
  const normalizedReferenceVideos = normalizeTimedReferenceAssets(
    options?.reference_videos,
    'video'
  );
  const normalizedReferenceAudios = normalizeTimedReferenceAssets(
    options?.reference_audios,
    'audio'
  );
  const referenceVideos = normalizedReferenceVideos.items;
  const referenceAudios = normalizedReferenceAudios.items;
  const normalizedPromptReferenceBindings =
    normalizeSeedancePromptReferenceBindings(
      options?.prompt_reference_bindings
    );
  const promptReferenceBindings = normalizedPromptReferenceBindings.items;

  if (normalizedReferenceVideos.invalidCount > 0) {
    return 'invalid reference video metadata';
  }

  if (normalizedReferenceAudios.invalidCount > 0) {
    return 'invalid reference audio metadata';
  }

  if (normalizedPromptReferenceBindings.invalidCount > 0) {
    return 'invalid prompt reference bindings';
  }

  const resolvedReferences = resolveSeedancePromptReferenceSelection({
    prompt,
    bindings: promptReferenceBindings,
    referenceImageUrls: referenceImages,
    referenceVideos,
    referenceAudios,
  });
  const selectedReferenceImages = resolvedReferences.referenceImageUrls;
  const selectedReferenceVideos = resolvedReferences.referenceVideos;
  const selectedReferenceAudios = resolvedReferences.referenceAudios;

  if (selectedReferenceImages.length > SEEDANCE_2_REFERENCE_IMAGE_MAX_ITEMS) {
    return 'too many reference images';
  }

  if (
    selectedReferenceImages.length +
      selectedReferenceVideos.length +
      selectedReferenceAudios.length >
    SEEDANCE_2_REFERENCE_MAX_TOTAL_ITEMS
  ) {
    return `total reference assets exceed ${SEEDANCE_2_REFERENCE_MAX_TOTAL_ITEMS}`;
  }

  const videoError = validateTimedReferenceAssets({
    items: selectedReferenceVideos,
    itemLabel: 'reference videos',
    maxItems: SEEDANCE_2_REFERENCE_VIDEO_MAX_ITEMS,
    minDuration: SEEDANCE_2_REFERENCE_VIDEO_MIN_DURATION,
    maxDuration: SEEDANCE_2_REFERENCE_VIDEO_MAX_DURATION,
    maxTotalDuration: SEEDANCE_2_REFERENCE_VIDEO_MAX_TOTAL_DURATION,
  });
  if (videoError) {
    return videoError;
  }

  const audioError = validateTimedReferenceAssets({
    items: selectedReferenceAudios,
    itemLabel: 'reference audios',
    maxItems: SEEDANCE_2_REFERENCE_AUDIO_MAX_ITEMS,
    minDuration: SEEDANCE_2_REFERENCE_AUDIO_MIN_DURATION,
    maxDuration: SEEDANCE_2_REFERENCE_AUDIO_MAX_DURATION,
    maxTotalDuration: SEEDANCE_2_REFERENCE_AUDIO_MAX_TOTAL_DURATION,
  });
  if (audioError) {
    return audioError;
  }

  const hasFrames = Boolean(
    options?.first_frame_url || options?.last_frame_url
  );
  const hasMultimodalReferences =
    selectedReferenceImages.length > 0 ||
    selectedReferenceVideos.length > 0 ||
    selectedReferenceAudios.length > 0;
  const hasVisualReferences =
    selectedReferenceImages.length > 0 || selectedReferenceVideos.length > 0;
  const availableReferenceTargets = new Set<string>([
    ...referenceImages.map((item) => item.trim()),
    ...referenceVideos.map((item) => item.assetId?.trim() || item.url.trim()),
    ...referenceAudios.map((item) => item.assetId?.trim() || item.url.trim()),
  ]);
  const promptReferenceError = validateSeedancePromptReferenceTokens({
    prompt,
    bindings: promptReferenceBindings,
    allowTokens: options?.seedance_mode === 'multimodal-reference',
    availableTargets: availableReferenceTargets,
  });
  if (promptReferenceError) {
    return promptReferenceError;
  }

  if (isSeedance2AssetModel(model)) {
    if (options?.seedance_mode !== 'multimodal-reference') {
      return 'seedance-2-asset only supports multimodal-reference mode';
    }

    if (selectedReferenceImages.some((value) => /^https?:\/\//i.test(value))) {
      return 'reference images require active assets';
    }

    if (selectedReferenceVideos.some((item) => !item.assetId)) {
      return 'reference videos require active assets';
    }

    if (selectedReferenceAudios.some((item) => !item.assetId)) {
      return 'reference audios require active assets';
    }
  }

  switch (options?.seedance_mode) {
    case 'text':
      if (hasFrames || hasMultimodalReferences) {
        return 'text mode does not support reference inputs';
      }
      break;
    case 'first-frame':
      if (!options?.first_frame_url) {
        return 'first_frame_url is required';
      }
      if (options?.last_frame_url || hasMultimodalReferences) {
        return 'first-frame mode cannot be combined with last frame or multimodal references';
      }
      break;
    case 'first-last-frame':
      if (!options?.first_frame_url || !options?.last_frame_url) {
        return 'first_frame_url and last_frame_url are required';
      }
      if (hasMultimodalReferences) {
        return 'first-last-frame mode cannot be combined with multimodal references';
      }
      break;
    case 'multimodal-reference':
      if (hasFrames) {
        return 'multimodal-reference cannot be combined with first or last frame';
      }
      if (!hasMultimodalReferences) {
        return 'multimodal-reference requires at least one reference asset';
      }
      if (referenceAudios.length > 0 && !hasVisualReferences) {
        return 'audio references require at least one image or video reference';
      }
      break;
    default:
      return 'invalid seedance_mode';
  }

  return null;
}

function normalizeSeedance2Options(
  options?: Seedance2VideoOptions | null
): Seedance2VideoOptions {
  const reference_image_urls = isStringArray(options?.reference_image_urls)
    ? options.reference_image_urls
        .filter((url) => url.trim())
        .slice(0, SEEDANCE_2_REFERENCE_IMAGE_MAX_ITEMS)
    : [];
  const reference_videos = normalizeTimedReferenceAssets(
    options?.reference_videos,
    'video'
  ).items.slice(0, SEEDANCE_2_REFERENCE_VIDEO_MAX_ITEMS);
  const reference_audios = normalizeTimedReferenceAssets(
    options?.reference_audios,
    'audio'
  ).items.slice(0, SEEDANCE_2_REFERENCE_AUDIO_MAX_ITEMS);
  const normalizedPromptReferenceBindings =
    normalizeSeedancePromptReferenceBindings(
      options?.prompt_reference_bindings
    ).items;
  const availableReferenceTargets = new Set<string>([
    ...reference_image_urls.map((item) => item.trim()),
    ...reference_videos.map((item) => item.assetId?.trim() || item.url.trim()),
    ...reference_audios.map((item) => item.assetId?.trim() || item.url.trim()),
  ]);
  const prompt_reference_bindings = normalizedPromptReferenceBindings.filter(
    (item) => availableReferenceTargets.has(item.target)
  );

  return {
    seedance_mode: options?.seedance_mode,
    first_frame_url:
      typeof options?.first_frame_url === 'string'
        ? options.first_frame_url.trim() || undefined
        : undefined,
    last_frame_url:
      typeof options?.last_frame_url === 'string'
        ? options.last_frame_url.trim() || undefined
        : undefined,
    reference_image_urls,
    reference_videos,
    reference_audios,
    seed:
      typeof options?.seed === 'number' && Number.isInteger(options.seed)
        ? options.seed
        : undefined,
    return_last_frame: Boolean(options?.return_last_frame),
    generate_audio:
      typeof options?.generate_audio === 'boolean'
        ? options.generate_audio
        : true,
    resolution: options?.resolution === '720p' ? '720p' : '480p',
    aspect_ratio:
      normalizeSeedanceAspectRatio(
        options?.aspect_ratio,
        'bytedance/seedance-2'
      ) ?? '16:9',
    duration: normalizeSeedance2Duration(options?.duration) ?? 4,
    web_search:
      options?.seedance_mode === 'text' && Boolean(options?.web_search),
    prompt_reference_bindings,
  };
}

async function validateSeedanceReferenceAssetReadiness({
  aiProvider,
  options,
}: {
  aiProvider: KieProvider;
  options: Seedance2VideoOptions;
}) {
  const assetIds = new Set<string>();

  options.reference_image_urls?.forEach((item) => {
    const normalized = item.trim();
    if (isSeedanceReferenceAssetId(normalized)) {
      assetIds.add(normalized);
    }
  });

  options.reference_videos?.forEach((item) => {
    const normalized = item.assetId?.trim();
    if (normalized) {
      assetIds.add(normalized);
    }
  });

  options.reference_audios?.forEach((item) => {
    const normalized = item.assetId?.trim();
    if (normalized) {
      assetIds.add(normalized);
    }
  });

  if (assetIds.size === 0) {
    return null;
  }

  try {
    const results = await Promise.all(
      [...assetIds].map((assetId) => aiProvider.getSeedanceAsset({ assetId }))
    );
    const pendingAsset = results.find((item) => item.status !== 'Active');

    if (!pendingAsset) {
      return null;
    }

    if (pendingAsset.status === 'Failed') {
      return (
        pendingAsset.errorMessage ||
        `reference asset ${pendingAsset.assetId} failed to process`
      );
    }

    return `reference asset ${pendingAsset.assetId} is not ready`;
  } catch (error: any) {
    return error?.message || 'failed to verify reference assets';
  }
}

async function markAITaskSubmissionFailed({
  task,
  error,
}: {
  task: PersistedAITask;
  error: unknown;
}) {
  const errorMessage =
    error instanceof Error
      ? error.message
      : typeof error === 'string'
        ? error
        : 'ai generate failed';

  try {
    await updateAITaskById(task.id, {
      status: AITaskStatus.FAILED,
      taskId: null,
      taskInfo: JSON.stringify({
        status: 'failed',
        errorMessage,
        createTime: new Date(),
      }),
      taskResult: null,
      creditId: task.creditId,
    });
  } catch (updateError) {
    console.error('failed to mark ai task submission as failed', {
      localTaskId: task.id,
      errorMessage,
      updateError,
    });
  }
}

function isInsufficientCreditsError(error: unknown) {
  if (!(error instanceof Error) || !error.message) {
    return false;
  }

  return error.message.toLowerCase().includes('insufficient credits');
}

function buildAITaskCallbackUrl(provider: string, localTaskId: string) {
  const callbackUrl = new URL(`/api/ai/notify/${provider}`, envConfigs.app_url);
  callbackUrl.searchParams.set('localTaskId', localTaskId);
  return callbackUrl.toString();
}

async function persistSubmittedAITask({
  task,
  result,
}: {
  task: PersistedAITask;
  result: {
    taskStatus: string;
    taskId: string;
    taskInfo?: unknown;
    taskResult?: unknown;
  };
}) {
  let lastError: unknown;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await updateAITaskById(task.id, {
        status: result.taskStatus,
        taskId: result.taskId,
        taskInfo: result.taskInfo ? JSON.stringify(result.taskInfo) : null,
        taskResult: result.taskResult
          ? JSON.stringify(result.taskResult)
          : null,
        creditId: task.creditId,
      });
    } catch (error) {
      lastError = error;

      if (attempt < 2) {
        await new Promise((resolve) =>
          setTimeout(resolve, 200 * (attempt + 1))
        );
      }
    }
  }

  throw lastError;
}

function shouldModerateGenerationPrompt({
  configs,
  mediaType,
}: {
  configs: Configs;
  mediaType?: string | null;
}) {
  return (
    isCreemPromptModerationEnabled(configs) &&
    (mediaType === AIMediaType.IMAGE || mediaType === AIMediaType.VIDEO)
  );
}

function buildModerationExternalId({
  userId,
  localTaskId,
  stage,
}: {
  userId: string;
  localTaskId: string;
  stage: string;
}) {
  return `user_${userId}:task_${localTaskId}:${stage}`;
}

async function moderateGenerationPrompt({
  configs,
  mediaType,
  prompt,
  userId,
  localTaskId,
  provider,
  model,
  stage,
}: {
  configs: Configs;
  mediaType: string;
  prompt?: string | null;
  userId: string;
  localTaskId: string;
  provider: string;
  model: string;
  stage: 'user_prompt' | 'provider_prompt';
}) {
  if (!shouldModerateGenerationPrompt({ configs, mediaType })) {
    return null;
  }

  const trimmedPrompt = prompt?.trim() ?? '';
  if (!trimmedPrompt) {
    return null;
  }

  const externalId = buildModerationExternalId({
    userId,
    localTaskId,
    stage,
  });

  try {
    const result = await ensureCreemPromptAllowed({
      configs,
      prompt: trimmedPrompt,
      externalId,
    });

    console.info('[ai.moderation] allowed', {
      userId,
      localTaskId,
      externalId,
      stage,
      mediaType,
      provider,
      model,
      moderationProvider: result.provider,
      moderationId: result.id,
      decision: result.decision,
      usageUnits: result.usageUnits,
    });

    return result;
  } catch (error) {
    if (error instanceof PromptModerationDecisionError) {
      console.warn('[ai.moderation] blocked', {
        userId,
        localTaskId,
        externalId,
        stage,
        mediaType,
        provider,
        model,
        moderationProvider: error.result.provider,
        moderationId: error.result.id,
        decision: error.result.decision,
        usageUnits: error.result.usageUnits,
      });

      throw new Error(CREEM_PROMPT_MODERATION_REJECTED_MESSAGE);
    }

    console.warn('[ai.moderation] unavailable', {
      userId,
      localTaskId,
      externalId,
      stage,
      mediaType,
      provider,
      model,
      failClosed: isCreemPromptModerationFailClosed(configs),
      error,
    });

    if (isCreemPromptModerationFailClosed(configs)) {
      throw new Error(CREEM_PROMPT_MODERATION_UNAVAILABLE_MESSAGE);
    }

    return null;
  }
}

export async function POST(request: Request) {
  let currentUserId: string | null = null;
  let fallbackMediaType: string | null = null;
  let fallbackCostCredits = 0;

  try {
    let { provider, mediaType, model, prompt, options, scene } =
      await request.json();

    if (!provider || !mediaType || !model) {
      throw new Error('invalid params');
    }

    if (!prompt && !options) {
      throw new Error('prompt or options is required');
    }

    const configs = await getAllConfigs();
    provider = resolveVideoGenerationProvider({
      requestedProvider: provider,
      model,
      configs,
    });

    if (mediaType === AIMediaType.IMAGE && isAnyGptImageModel(model)) {
      const gptImageProvider = resolveGptImageProvider({
        requestedProvider: provider,
        configs,
      });
      provider = gptImageProvider;

      if (scene === 'text-to-image' || scene === 'image-to-image') {
        model = getGptImageModelForScene({
          provider: gptImageProvider,
          scene,
        });
      }
    }

    if (
      isSeedance2GenerationModel(model) &&
      provider === SEEDANCE_PROVIDER_APIMART
    ) {
      if (!configs.apimart_api_key) {
        throw new Error('The current Seedance 2.x provider is not configured.');
      }
    }

    if (
      mediaType === AIMediaType.IMAGE &&
      provider === GPT_IMAGE_PROVIDER_APIMART &&
      isApimartGptImageModel(model) &&
      !configs.apimart_api_key
    ) {
      throw new Error('The current GPT Image 2 provider is not configured.');
    }

    const aiService = await getAIService(configs);

    // check generate type
    if (!aiService.getMediaTypes().includes(mediaType)) {
      throw new Error('invalid mediaType');
    }

    // check ai provider
    const aiProvider = aiService.getProvider(provider);
    if (!aiProvider) {
      throw new Error('invalid provider');
    }

    // get current user
    const user = await getUserInfo();
    if (!user) {
      throw new Error('no auth, please sign in');
    }
    currentUserId = user.id;
    const localTaskId = getUuid();

    // todo: get cost credits from settings
    let costCredits = 4;
    let normalizedOptions = options;
    let providerPrompt = prompt;

    if (mediaType === AIMediaType.IMAGE) {
      if (scene !== 'image-to-image' && scene !== 'text-to-image') {
        throw new Error('invalid scene');
      }

      const validImageResolutions = new Set(['1K', '2K', '4K']);
      if (
        options?.resolution &&
        !validImageResolutions.has(String(options.resolution))
      ) {
        throw new Error('invalid resolution');
      }

      const normalizedResolution = normalizeImageResolution(
        options?.resolution
      );
      const advancedImageModel = getAdvancedImageModel(provider, model);
      const isKieGptImage =
        provider === GPT_IMAGE_PROVIDER_KIE && isKieGptImageModel(model);
      const isApimartGptImage =
        provider === GPT_IMAGE_PROVIDER_APIMART &&
        isApimartGptImageModel(model);
      const isGptImageModel = isKieGptImage || isApimartGptImage;
      const maxPromptLength = 20000;
      if (prompt && prompt.length > maxPromptLength) {
        throw new Error('prompt too long');
      }

      if (isKieGptImage) {
        const gptImageError = validateKieGptImageOptions({
          model,
          scene,
          options,
        });
        if (gptImageError) {
          throw new Error(gptImageError);
        }
      }

      if (isApimartGptImage) {
        const gptImageError = validateApimartGptImageOptions({
          model,
          scene,
          options,
        });
        if (gptImageError) {
          throw new Error(gptImageError);
        }
      }

      const modelAspectRatios: Record<string, Set<string>> = {
        'nano-banana-2': new Set([
          '1:1',
          '1:4',
          '1:8',
          '2:3',
          '3:2',
          '3:4',
          '4:1',
          '4:3',
          '4:5',
          '5:4',
          '8:1',
          '9:16',
          '16:9',
          '21:9',
          'auto',
        ]),
        'nano-banana-pro': new Set([
          '1:1',
          '2:3',
          '3:2',
          '3:4',
          '4:3',
          '4:5',
          '5:4',
          '9:16',
          '16:9',
          '21:9',
          'auto',
        ]),
      };

      if (
        !isGptImageModel &&
        !advancedImageModel &&
        (options?.aspect_ratio || options?.resolution || options?.output_format)
      ) {
        throw new Error('advanced image options not supported');
      }

      if (options?.aspect_ratio && advancedImageModel) {
        const allowedRatios = modelAspectRatios[advancedImageModel];
        if (allowedRatios && !allowedRatios.has(options.aspect_ratio)) {
          throw new Error('invalid aspect_ratio');
        }
      }

      if (options?.output_format) {
        const outputFormats = new Set(['png', 'jpg']);
        if (!outputFormats.has(options.output_format)) {
          throw new Error('invalid output_format');
        }
      }

      const maxImagesByModel: Record<string, number> = {
        'nano-banana-2': 14,
        'nano-banana-pro': 8,
      };

      if (options?.image_input && Array.isArray(options.image_input)) {
        const limit = advancedImageModel
          ? maxImagesByModel[advancedImageModel]
          : null;
        if (limit && options.image_input.length > limit) {
          throw new Error('too many reference images');
        }
      }

      if (options?.google_search && advancedImageModel !== 'nano-banana-2') {
        throw new Error('google_search not supported for this model');
      }

      const currentSubscription = isGptImageModel
        ? await getCurrentSubscription(user.id)
        : null;
      const configuredGptImageCredits = parseInt(
        configs.gpt_image_2_credits || '',
        10
      );

      costCredits = calculateImageCredits({
        scene,
        provider,
        model,
        resolution: normalizedResolution,
        googleSearch: Boolean(options?.google_search),
        multiplier: 10,
        gptImageCredits: getGptImageCreditsForSubscription({
          baseCredits:
            configuredGptImageCredits > 0
              ? configuredGptImageCredits
              : GPT_IMAGE_2_CREDITS,
          subscription: currentSubscription,
        }),
      });
    } else if (mediaType === AIMediaType.VIDEO) {
      if (
        scene !== 'text-to-video' &&
        scene !== 'image-to-video' &&
        scene !== 'video-to-video'
      ) {
        throw new Error('invalid scene');
      }

      if (isKlingVideoModel(model)) {
        const klingErrors = validateKlingVideoOptions({
          prompt,
          options: options as KlingVideoOptions,
        });

        if (klingErrors.length > 0) {
          throw new Error(klingErrors[0]);
        }

        costCredits = calculateKlingCredits({
          duration: options?.duration,
          mode: options?.mode,
          sound: options?.sound,
        });
      } else if (isSeedance15Model(model)) {
        const seedance15Error = validateSeedance15Options({
          prompt,
          scene,
          options: options as Seedance15VideoOptions,
        });
        if (seedance15Error) {
          throw new Error(seedance15Error);
        }

        normalizedOptions = normalizeSeedance15Options(
          options as Seedance15VideoOptions
        );

        costCredits = calculateSeedanceCredits({
          model,
          scene: scene as Seedance15Scene,
          options: normalizedOptions,
        });
      } else if (isSeedance2AssetModel(model)) {
        throw new Error(
          'seedance-2-asset is only used for reference asset preparation'
        );
      } else if (isSeedance2GenerationModel(model)) {
        const seedance2Error = validateSeedance2Options({
          model,
          prompt,
          options: options as Seedance2VideoOptions,
        });
        if (seedance2Error) {
          throw new Error(seedance2Error);
        }

        normalizedOptions = normalizeSeedance2Options(
          options as Seedance2VideoOptions
        );
        const resolvedReferences = resolveSeedancePromptReferenceSelection({
          prompt,
          bindings:
            (normalizedOptions.prompt_reference_bindings as
              | SeedancePromptReferenceBinding[]
              | undefined) || [],
          referenceImageUrls: normalizedOptions.reference_image_urls,
          referenceVideos: normalizedOptions.reference_videos,
          referenceAudios: normalizedOptions.reference_audios,
        });
        normalizedOptions = {
          ...normalizedOptions,
          reference_image_urls: resolvedReferences.referenceImageUrls,
          reference_videos: resolvedReferences.referenceVideos,
          reference_audios: resolvedReferences.referenceAudios,
          prompt_reference_bindings: resolvedReferences.activeBindings,
        };

        const usesSeedanceAssetReferences = hasSeedanceAssetReferences(
          normalizedOptions as Seedance2VideoOptions
        );

        if (
          provider === SEEDANCE_PROVIDER_APIMART &&
          usesSeedanceAssetReferences
        ) {
          throw new Error(
            'The current provider only supports public URL references for Seedance 2.x.'
          );
        }

        if (usesSeedanceAssetReferences) {
          const kieProvider = aiService.getProvider('kie');
          if (!(kieProvider instanceof KieProvider)) {
            throw new Error('kie provider not available');
          }

          const assetReadinessError =
            await validateSeedanceReferenceAssetReadiness({
              aiProvider: kieProvider,
              options: normalizedOptions as Seedance2VideoOptions,
            });
          if (assetReadinessError) {
            throw new Error(assetReadinessError);
          }
        }

        scene = getSeedance2CanonicalScene({
          mode: normalizedOptions.seedance_mode,
          hasReferenceImages:
            Array.isArray(normalizedOptions.reference_image_urls) &&
            normalizedOptions.reference_image_urls.length > 0,
        });

        costCredits = calculateSeedanceCredits({
          model,
          scene,
          options: normalizedOptions,
        });

        providerPrompt = resolvedReferences.prompt;

        const providerPromptError = validatePrompt(providerPrompt);
        if (providerPromptError) {
          throw new Error(
            providerPromptError ===
            'prompt must be between 3 and 2500 characters'
              ? 'prompt is too long after adding reference bindings'
              : providerPromptError
          );
        }

        if (provider === SEEDANCE_PROVIDER_APIMART) {
          const apimartPublicUrlError = validateApimartPublicReferenceUrls(
            normalizedOptions as Seedance2VideoOptions
          );
          if (apimartPublicUrlError) {
            throw new Error(apimartPublicUrlError);
          }
        }

        if (
          provider === SEEDANCE_PROVIDER_APIMART &&
          normalizedOptions.seedance_mode === 'multimodal-reference'
        ) {
          const apimartReferenceVideoError = validateApimartReferenceVideos(
            normalizedOptions.reference_videos || []
          );
          if (apimartReferenceVideoError) {
            throw new Error(apimartReferenceVideoError);
          }

          const apimartReferenceVideoPixelError =
            validateSeedanceReferenceVideoPixelCount(
              normalizedOptions.reference_videos || []
            );
          if (apimartReferenceVideoPixelError) {
            throw new Error(apimartReferenceVideoPixelError);
          }
        }
      } else {
        costCredits = calculateVideoCredits({
          scene,
          duration: options?.duration,
          resolution: options?.resolution,
          generateAudio: options?.generate_audio,
        });
      }
    } else if (mediaType === AIMediaType.MUSIC) {
      // generate music
      costCredits = 10;
      scene = 'text-to-music';
    } else {
      throw new Error('invalid mediaType');
    }

    fallbackMediaType = mediaType;
    fallbackCostCredits = costCredits;

    if (mediaType === AIMediaType.IMAGE && options) {
      normalizedOptions = {
        ...options,
        ...(options.resolution
          ? { resolution: normalizeImageResolution(options.resolution) }
          : {}),
      };
    }

    const trimmedPrompt = typeof prompt === 'string' ? prompt.trim() : '';
    const trimmedProviderPrompt =
      typeof providerPrompt === 'string' ? providerPrompt.trim() : '';
    await moderateGenerationPrompt({
      configs,
      mediaType,
      prompt: trimmedPrompt,
      userId: user.id,
      localTaskId,
      provider,
      model,
      stage: 'user_prompt',
    });

    if (trimmedProviderPrompt && trimmedProviderPrompt !== trimmedPrompt) {
      await moderateGenerationPrompt({
        configs,
        mediaType,
        prompt: trimmedProviderPrompt,
        userId: user.id,
        localTaskId,
        provider,
        model,
        stage: 'provider_prompt',
      });
    }

    const newAITask: NewAITask = {
      id: localTaskId,
      userId: user.id,
      mediaType,
      provider,
      model,
      prompt,
      scene,
      options: normalizedOptions ? JSON.stringify(normalizedOptions) : null,
      status: AITaskStatus.PENDING,
      costCredits,
      taskId: null,
      taskInfo: null,
      taskResult: null,
    };
    const createdAITask = await createAITask(newAITask);

    const callbackUrl = buildAITaskCallbackUrl(provider, createdAITask.id);

    const params: any = {
      mediaType,
      model,
      prompt: providerPrompt,
      callbackUrl,
      options: normalizedOptions,
    };

    let result;
    try {
      result = await aiProvider.generate({ params });
      if (!result?.taskId) {
        throw new Error(
          `ai generate failed, mediaType: ${mediaType}, provider: ${provider}, model: ${model}`
        );
      }
    } catch (error) {
      await markAITaskSubmissionFailed({
        task: createdAITask,
        error,
      });
      throw error;
    }

    let updatedAITask = null;
    try {
      updatedAITask = await persistSubmittedAITask({
        task: createdAITask,
        result,
      });
    } catch (updateError) {
      console.error(
        'failed to persist ai task submission after provider accepted job',
        {
          localTaskId: createdAITask.id,
          provider,
          providerTaskId: result.taskId,
          updateError,
        }
      );
    }

    return respData({
      ...(updatedAITask || createdAITask),
      taskId: updatedAITask?.taskId || result.taskId,
    });
  } catch (e: any) {
    console.log('generate failed', e);

    if (
      currentUserId &&
      fallbackMediaType &&
      fallbackCostCredits > 0 &&
      isInsufficientCreditsError(e)
    ) {
      try {
        const remainingCredits = await getRemainingCredits(currentUserId);
        const fallbackPayload = buildGenerationCreditFallbackPayload({
          mediaType: fallbackMediaType,
          requestedCostCredits: fallbackCostCredits,
          remainingCredits,
        });

        if (fallbackPayload) {
          return respJson(-2, 'insufficient credits', fallbackPayload);
        }
      } catch (fallbackError) {
        console.error('failed to build generation credit fallback', {
          currentUserId,
          fallbackMediaType,
          fallbackCostCredits,
          fallbackError,
        });
      }
    }

    return respErr(e.message);
  }
}
