'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import {
  CreditCard,
  Download,
  ImageIcon,
  Loader2,
  Share2,
  Sparkles,
  User,
  Wand,
} from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { toast } from 'sonner';

import { Link, useRouter } from '@/core/i18n/navigation';
import { envConfigs } from '@/config';
import { AIMediaType, AITaskStatus } from '@/extensions/ai/types';
import {
  ImageUploader,
  ImageUploaderValue,
  LazyImage,
} from '@/shared/blocks/common';
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
import { GeneratorResultOverlay } from '@/shared/blocks/generator/result-status-overlay';
import { ShareShowcaseDialog } from '@/shared/blocks/generator/share-showcase-dialog';
import { Button } from '@/shared/components/ui/button';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/shared/components/ui/card';
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
  createGenerationCreditFallbackPayload,
  GenerationCreditFallbackPayload,
  IMAGE_STANDARD_FALLBACK_CREDITS,
  isGenerationCreditFallbackPayload,
} from '@/shared/lib/generation-credit-fallback';
import {
  trackGtmActivation,
  trackGtmGenerateContentCompleted,
  trackGtmGenerateContentStarted,
} from '@/shared/lib/gtm';
import { md5 } from '@/shared/lib/hash';
import { calculateImageCredits } from '@/shared/lib/image-pricing';
import { resolvePriorityQueueWaitRangeMs } from '@/shared/lib/membership-priority-queue-config';
import { buildShareActionLabels } from '@/shared/lib/share-action-labels';
import { cn } from '@/shared/lib/utils';

interface ImageGeneratorProps {
  id?: string;
  allowMultipleImages?: boolean;
  maxImages?: number;
  maxSizeMB?: number;
  srOnlyTitle?: string;
  className?: string;
  promptKey?: string;
  embedded?: boolean;
}

interface GeneratedImage {
  id: string;
  url: string;
  taskId: string;
  imageIndex: number;
  provider?: string;
  model?: string;
  prompt?: string;
}

interface ShareShowcaseResult {
  shareUrl: string;
  imageUrl: string;
  title: string;
  description: string;
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

interface GenerateAnalyticsSnapshot {
  provider?: string;
  model?: string;
  mode: string;
  costCredits: number;
  promptLength: number;
}

interface PendingImageGenerationRequest {
  scene: 'text-to-image' | 'image-to-image';
  provider: string;
  model: NanoBananaModel;
  prompt: string;
  options: Record<string, unknown>;
  analyticsSnapshot: GenerateAnalyticsSnapshot;
}

type ImageGeneratorTab = 'text-to-image' | 'image-to-image';

const POLL_INTERVAL = 5000;
const GENERATION_TIMEOUT = 180000;
const MAX_PROMPT_LENGTH = 20000;
const IMAGE_CREDITS_MULTIPLIER = 10;
const IMAGE_QUEUE_RETURN_HREF = '/models/gpt-image-2#nano-banana-generator';
const VIDEO_QUEUE_RETURN_HREF =
  '/seedance-2-0-video-generator#seedance-generator';
const KLING_QUEUE_RETURN_HREF = '/models/kling-3#kling-3-generator';
const DEFAULT_PROMPT =
  'Canon camera, 85mm fixed lens, creating a gradual change of f/1.8, f/2.8, f/10, f/14 aperture effects, a gentle and beautiful lady as the model, background is the city blue hour after sunset';
const DEFAULT_PREVIEW_IMAGE =
  'https://cdn.nano-banana-2-ai.com/uploads/landing/friend/nano-banana/hero/imgtoimg1.webp';
const IMAGE_DEMO_EXAMPLES = [
  {
    src: 'https://cdn.nano-banana-2-ai.com/uploads/landing/friend/nano-banana/generator-demos/ip-creation.webp',
    alt: 'Image Editing in IP Creation',
  },
  {
    src: 'https://cdn.nano-banana-2-ai.com/uploads/landing/friend/nano-banana/generator-demos/novel-view-synthesis.webp',
    alt: 'Image Editing in Novel View Synthesis',
  },
  {
    src: 'https://cdn.nano-banana-2-ai.com/uploads/landing/friend/nano-banana/generator-demos/object-add.webp',
    alt: 'Image Editing in Object Add',
  },
  {
    src: 'https://cdn.nano-banana-2-ai.com/uploads/landing/friend/nano-banana/generator-demos/object-removal.webp',
    alt: 'Image Editing in Object Removal',
  },
  {
    src: 'https://cdn.nano-banana-2-ai.com/uploads/landing/friend/nano-banana/generator-demos/text-editing.webp',
    alt: 'Image Editing in Text Editing',
  },
  {
    src: 'https://cdn.nano-banana-2-ai.com/uploads/landing/friend/nano-banana/generator-demos/poster-editing.webp',
    alt: 'Image Editing in Poster Editing',
  },
] as const;

const MODEL_NANO_BANANA_2 = 'nano-banana-2';
const MODEL_NANO_BANANA_PRO = 'nano-banana-pro';

const RESOLUTION_OPTIONS = ['1K', '2K', '4K'] as const;
const OUTPUT_FORMAT_OPTIONS = ['png', 'jpg'] as const;

const ASPECT_RATIO_OPTIONS = {
  [MODEL_NANO_BANANA_2]: [
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
  ],
  [MODEL_NANO_BANANA_PRO]: [
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
  ],
} as const;

type NanoBananaModel = 'nano-banana-2' | 'nano-banana-pro';
type AspectRatio = (typeof ASPECT_RATIO_OPTIONS)[NanoBananaModel][number];

const MODEL_OPTIONS = [
  {
    value: MODEL_NANO_BANANA_2,
    label: 'Nano Banana',
    provider: 'kie',
    scenes: ['text-to-image', 'image-to-image'],
  },
  {
    value: MODEL_NANO_BANANA_PRO,
    label: 'Nano Banana Pro',
    provider: 'kie',
    scenes: ['text-to-image', 'image-to-image'],
  },
];

const MODEL_MAX_IMAGES: Record<NanoBananaModel, number> = {
  [MODEL_NANO_BANANA_2]: 14,
  [MODEL_NANO_BANANA_PRO]: 8,
};

function parseTaskResult(taskResult: string | null): any {
  if (!taskResult) {
    return null;
  }

  try {
    return JSON.parse(taskResult);
  } catch (error) {
    console.warn('Failed to parse taskResult:', error);
    return null;
  }
}

function extractImageUrls(result: any): string[] {
  if (!result) {
    return [];
  }

  const output = result.output ?? result.images ?? result.data;

  if (!output) {
    return [];
  }

  if (typeof output === 'string') {
    return [output];
  }

  if (Array.isArray(output)) {
    return output
      .flatMap((item) => {
        if (!item) return [];
        if (typeof item === 'string') return [item];
        if (typeof item === 'object') {
          const candidate =
            item.url ?? item.uri ?? item.image ?? item.src ?? item.imageUrl;
          return typeof candidate === 'string' ? [candidate] : [];
        }
        return [];
      })
      .filter(Boolean);
  }

  if (typeof output === 'object') {
    const candidate =
      output.url ?? output.uri ?? output.image ?? output.src ?? output.imageUrl;
    if (typeof candidate === 'string') {
      return [candidate];
    }
  }

  return [];
}

export function ImageGenerator({
  id,
  allowMultipleImages = true,
  maxImages = 14,
  maxSizeMB = 5,
  srOnlyTitle,
  className,
  promptKey,
  embedded = false,
}: ImageGeneratorProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const locale = useLocale();
  const t = useTranslations('ai.image.generator');

  const [activeTab, setActiveTab] =
    useState<ImageGeneratorTab>('text-to-image');

  const [provider, setProvider] = useState(MODEL_OPTIONS[0]?.provider ?? '');
  const [model, setModel] = useState<NanoBananaModel>(
    (MODEL_OPTIONS[0]?.value as NanoBananaModel) ?? MODEL_NANO_BANANA_2
  );
  const [resolution, setResolution] = useState<string>(RESOLUTION_OPTIONS[0]);
  const [outputFormat, setOutputFormat] = useState<string>(
    OUTPUT_FORMAT_OPTIONS[0]
  );
  const [aspectRatio, setAspectRatio] = useState<AspectRatio>(
    ASPECT_RATIO_OPTIONS[MODEL_NANO_BANANA_2][0]
  );
  const [useGoogleSearch, setUseGoogleSearch] = useState(false);
  // Set default values only when no promptKey is provided
  const [prompt, setPrompt] = useState(promptKey ? '' : DEFAULT_PROMPT);
  const [previewImage, setPreviewImage] = useState<string>(
    promptKey ? '' : DEFAULT_PREVIEW_IMAGE
  );
  const [referenceImageItems, setReferenceImageItems] = useState<
    ImageUploaderValue[]
  >([]);
  const [referenceImageUrls, setReferenceImageUrls] = useState<string[]>([]);
  const [generatedImages, setGeneratedImages] = useState<GeneratedImage[]>([]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [progress, setProgress] = useState(0);
  const [taskId, setTaskId] = useState<string | null>(null);
  const [providerTaskId, setProviderTaskId] = useState<string | null>(null);
  const [generationStartTime, setGenerationStartTime] = useState<number | null>(
    null
  );
  const analyticsSnapshotRef = useRef<GenerateAnalyticsSnapshot | null>(null);
  const [taskStatus, setTaskStatus] = useState<AITaskStatus | null>(null);
  const [downloadingImageId, setDownloadingImageId] = useState<string | null>(
    null
  );
  const [sharingImageId, setSharingImageId] = useState<string | null>(null);
  const [shareTargetImage, setShareTargetImage] =
    useState<GeneratedImage | null>(null);
  const [shareResult, setShareResult] = useState<ShareShowcaseResult | null>(
    null
  );
  const [isMounted, setIsMounted] = useState(false);
  const promptTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const pendingGenerateRequestRef =
    useRef<PendingImageGenerationRequest | null>(null);
  const [isLoadingCredits, setIsLoadingCredits] = useState(false);
  const [availableProviders, setAvailableProviders] = useState<string[]>([]);
  const [isLoadingProviders, setIsLoadingProviders] = useState(true);
  const hasLoadedCreditsRef = useRef(false);
  const lastAppliedPromptRef = useRef<string | null>(null);
  const [creditFallback, setCreditFallback] =
    useState<GenerationCreditFallbackPayload | null>(null);
  const { canDownload, paidDownloadDialogProps } = usePaidDownloadGate();

  const {
    user,
    isCheckSign,
    setIsShowSignModal,
    fetchUserCredits,
    currentSubscription,
    hasPaidEntitlement,
    hasFetchedCurrentSubscription,
    isFetchingCurrentSubscription,
    fetchCurrentSubscription,
    configs,
  } = useAppContext();

  useEffect(() => {
    setIsMounted(true);

    fetch('/api/ai/providers')
      .then((res) => res.json())
      .then((data) => {
        if (data.code === 0 && data.data?.providers !== undefined) {
          const providers = data.data.providers || [];
          setAvailableProviders(providers);

          if (providers.includes('kie')) {
            setProvider('kie');
            setModel(MODEL_NANO_BANANA_2);
          } else {
            setProvider('');
            setModel(MODEL_NANO_BANANA_2);
          }
        }
      })
      .catch((error) => {
        console.error('Failed to fetch AI providers:', error);
        setAvailableProviders([]);
      })
      .finally(() => {
        setIsLoadingProviders(false);
      });
  }, []);

  const userIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (user?.id !== userIdRef.current) {
      userIdRef.current = user?.id || null;
      hasLoadedCreditsRef.current = false;
    }

    if (user && !user.credits && !hasLoadedCreditsRef.current) {
      hasLoadedCreditsRef.current = true;
      setIsLoadingCredits(true);
      fetchUserCredits().finally(() => {
        setIsLoadingCredits(false);
      });
    }
  }, [user?.id, user?.credits, fetchUserCredits]);

  useEffect(() => {
    const resetGenerationState = () => {
      setReferenceImageItems([]);
      setReferenceImageUrls([]);
      setGeneratedImages([]);
      setIsGenerating(false);
      setProgress(0);
      setTaskId(null);
      setProviderTaskId(null);
      setGenerationStartTime(null);
      setTaskStatus(null);
      setDownloadingImageId(null);
      setSharingImageId(null);
    };

    if (promptKey) {
      resetGenerationState();
      setPrompt('');
      setPreviewImage('');
      setActiveTab('image-to-image');
      lastAppliedPromptRef.current = null;

      fetch(`/api/prompts/by-title?title=${encodeURIComponent(promptKey)}`)
        .then((res) => res.json())
        .then((data) => {
          if (data.success && data.data) {
            if (data.data.promptDescription) {
              setPrompt(data.data.promptDescription);
            }
            if (data.data.image) {
              setPreviewImage(data.data.image);
            }
            setActiveTab('image-to-image');

            if (availableProviders.includes('kie')) {
              setProvider('kie');
              setModel(MODEL_NANO_BANANA_2);
            }
          }
        })
        .catch((error) => {
          console.error('Failed to fetch prompt:', error);
        });
    } else {
      const promptParam = searchParams?.get('prompt')?.trim();

      if (!promptParam) {
        resetGenerationState();
        setPrompt(DEFAULT_PROMPT);
        setPreviewImage(DEFAULT_PREVIEW_IMAGE);
      }

      setActiveTab('text-to-image');

      if (availableProviders.includes('kie')) {
        setProvider('kie');
        setModel(MODEL_NANO_BANANA_2);
      }
    }
  }, [promptKey, availableProviders, searchParams]);

  useEffect(() => {
    if (promptKey) return;

    const promptParam = searchParams?.get('prompt')?.trim();
    if (!promptParam) {
      lastAppliedPromptRef.current = null;
      return;
    }

    if (promptParam === lastAppliedPromptRef.current) {
      return;
    }

    setReferenceImageItems([]);
    setReferenceImageUrls([]);
    setGeneratedImages([]);
    setIsGenerating(false);
    setProgress(0);
    setTaskId(null);
    setProviderTaskId(null);
    setGenerationStartTime(null);
    setTaskStatus(null);
    setDownloadingImageId(null);
    setSharingImageId(null);
    setPrompt(promptParam.slice(0, MAX_PROMPT_LENGTH));
    setPreviewImage('');
    setActiveTab('text-to-image');
    lastAppliedPromptRef.current = promptParam;

    window.requestAnimationFrame(() => {
      promptTextareaRef.current?.focus();
      promptTextareaRef.current?.setSelectionRange(
        promptTextareaRef.current.value.length,
        promptTextareaRef.current.value.length
      );
    });
  }, [promptKey, searchParams]);

  const promptLength = prompt.trim().length;
  const remainingCredits = user?.credits?.remainingCredits ?? 0;
  const isPromptTooLong = promptLength > MAX_PROMPT_LENGTH;
  const isTextToImageMode = activeTab === 'text-to-image';
  const isNanoBanana2 = model === MODEL_NANO_BANANA_2;
  const modelKey: NanoBananaModel =
    model in ASPECT_RATIO_OPTIONS ? model : MODEL_NANO_BANANA_2;
  const modelAspectRatios = ASPECT_RATIO_OPTIONS[modelKey];
  const modelMaxImages = MODEL_MAX_IMAGES[modelKey];
  const effectiveMaxImages = allowMultipleImages
    ? Math.min(maxImages, modelMaxImages)
    : 1;
  const costCredits = useMemo(
    () =>
      calculateImageCredits({
        scene: isTextToImageMode ? 'text-to-image' : 'image-to-image',
        provider,
        model,
        resolution,
        googleSearch: isNanoBanana2 && useGoogleSearch,
        multiplier: IMAGE_CREDITS_MULTIPLIER,
      }),
    [
      isTextToImageMode,
      provider,
      model,
      resolution,
      isNanoBanana2,
      useGoogleSearch,
    ]
  );
  const hasQueueBypassAccess = Boolean(
    currentSubscription || hasPaidEntitlement
  );
  const showCreditsCost = hasFetchedCurrentSubscription && hasQueueBypassAccess;
  const imageQueueWaitRangeMs = useMemo(
    () =>
      resolvePriorityQueueWaitRangeMs({
        configs,
        mediaType: 'image',
      }),
    [
      configs.image_generation_queue_wait_max_minutes,
      configs.image_generation_queue_wait_min_minutes,
    ]
  );
  const queueCopy = useMemo(
    () => ({
      title: t.has('queue.title') ? t('queue.title') : 'Standard Queue',
      description: t.has('queue.description')
        ? t('queue.description')
        : 'Non-member tasks are currently in the standard queue. Members can start generating sooner.',
      taskLabel: t.has('queue.task_label')
        ? t('queue.task_label')
        : 'Image generation',
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
      imageStandardBadge: t.has('credit_fallback.standard_badge')
        ? t('credit_fallback.standard_badge')
        : 'Standard',
      imageStandardTitle: t.has('credit_fallback.image_standard_title')
        ? t('credit_fallback.image_standard_title')
        : 'GPT Image 2 · 1K',
      imageStandardDescription: t.has(
        'credit_fallback.image_standard_description'
      )
        ? t('credit_fallback.image_standard_description')
        : 'Lower-cost image mode for quick creation.',
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
        scene: isTextToImageMode ? 'text-to-image' : 'image-to-image',
        provider,
        model,
        prompt: prompt.trim(),
        options: {
          ...(!isTextToImageMode
            ? { image_input: referenceImageUrls.slice(0, modelMaxImages) }
            : {}),
          ...(aspectRatio ? { aspect_ratio: aspectRatio } : {}),
          ...(resolution ? { resolution } : {}),
          ...(outputFormat ? { output_format: outputFormat } : {}),
          ...(isNanoBanana2 && useGoogleSearch ? { google_search: true } : {}),
        },
        analyticsSnapshot: {
          provider,
          model,
          mode: isTextToImageMode ? 'text-to-image' : 'image-to-image',
          costCredits,
          promptLength: prompt.trim().length,
        },
      } satisfies PendingImageGenerationRequest),
    [
      aspectRatio,
      costCredits,
      isNanoBanana2,
      isTextToImageMode,
      model,
      modelMaxImages,
      outputFormat,
      prompt,
      provider,
      referenceImageUrls,
      resolution,
      useGoogleSearch,
    ]
  );
  const queueSnapshotDigest = useMemo(() => md5(queuePayload), [queuePayload]);

  const handleTabChange = (value: string) => {
    const tab = value as ImageGeneratorTab;
    setActiveTab(tab);
  };
  const handleModelChange = (value: string) => {
    setModel(value as NanoBananaModel);
    setProvider('kie');
    if (value !== MODEL_NANO_BANANA_2) {
      setUseGoogleSearch(false);
    }
  };

  const handleResolutionChange = (value: string) => {
    setResolution(value);
  };

  const handleAspectRatioChange = (value: string) => {
    setAspectRatio(value as AspectRatio);
  };

  const handleOutputFormatChange = (value: string) => {
    setOutputFormat(value);
  };

  const taskStatusLabel = useMemo(() => {
    if (!taskStatus) {
      return '';
    }

    switch (taskStatus) {
      case AITaskStatus.PENDING:
        return 'Waiting for the model to start';
      case AITaskStatus.PROCESSING:
        return 'Generating your image...';
      case AITaskStatus.SUCCESS:
        return 'Image generation completed';
      case AITaskStatus.FAILED:
        return 'Generation failed';
      default:
        return '';
    }
  }, [taskStatus]);

  const handleReferenceImagesChange = useCallback(
    (items: ImageUploaderValue[]) => {
      setReferenceImageItems(items);
      const uploadedUrls = items
        .filter((item) => item.status === 'uploaded' && item.url)
        .map((item) => item.url as string);
      setReferenceImageUrls(uploadedUrls);
    },
    []
  );

  const isReferenceUploading = useMemo(
    () => referenceImageItems.some((item) => item.status === 'uploading'),
    [referenceImageItems]
  );

  const hasReferenceUploadError = useMemo(
    () => referenceImageItems.some((item) => item.status === 'error'),
    [referenceImageItems]
  );

  useEffect(() => {
    if (referenceImageItems.length > effectiveMaxImages) {
      const trimmedItems = referenceImageItems.slice(0, effectiveMaxImages);
      setReferenceImageItems(trimmedItems);
      const trimmedUrls = trimmedItems
        .filter((item) => item.status === 'uploaded' && item.url)
        .map((item) => item.url as string);
      setReferenceImageUrls(trimmedUrls);
    }
  }, [effectiveMaxImages, referenceImageItems]);

  useEffect(() => {
    const allowedRatios = (ASPECT_RATIO_OPTIONS[model] ??
      modelAspectRatios) as readonly AspectRatio[];
    if (allowedRatios && !allowedRatios.includes(aspectRatio)) {
      setAspectRatio(allowedRatios[0]);
    }
  }, [model, modelAspectRatios, aspectRatio]);

  const resetTaskState = useCallback(() => {
    analyticsSnapshotRef.current = null;
    pendingGenerateRequestRef.current = null;
    setIsGenerating(false);
    setProgress(0);
    setTaskId(null);
    setProviderTaskId(null);
    setGenerationStartTime(null);
    setTaskStatus(null);
  }, []);

  const pollTaskStatus = useCallback(
    async (id: string, providerTaskIdForQuery?: string | null) => {
      try {
        if (
          generationStartTime &&
          Date.now() - generationStartTime > GENERATION_TIMEOUT
        ) {
          resetTaskState();
          toast.error('Image generation timed out. Please try again.');
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

        const parsedResult = parseTaskResult(task.taskInfo);
        const imageUrls = extractImageUrls(parsedResult);

        if (currentStatus === AITaskStatus.PENDING) {
          setProgress((prev) => Math.max(prev, 20));
          return false;
        }

        if (currentStatus === AITaskStatus.PROCESSING) {
          if (imageUrls.length > 0) {
            setGeneratedImages(
              imageUrls.map((url, index) => ({
                id: `${task.id}-${index}`,
                url,
                taskId: task.id,
                imageIndex: index,
                provider: task.provider,
                model: task.model,
                prompt: task.prompt ?? undefined,
              }))
            );
            setProgress((prev) => Math.max(prev, 85));
          } else {
            setProgress((prev) => Math.min(prev + 10, 80));
          }
          return false;
        }

        if (currentStatus === AITaskStatus.SUCCESS) {
          if (imageUrls.length === 0) {
            toast.error('The provider returned no images. Please retry.');
          } else {
            const analyticsSnapshot = analyticsSnapshotRef.current;
            const images = imageUrls.map((url, index) => ({
              id: `${task.id}-${index}`,
              url,
              taskId: task.id,
              imageIndex: index,
              provider: task.provider,
              model: task.model,
              prompt: task.prompt ?? undefined,
            }));
            setGeneratedImages(images);
            trackGtmGenerateContentCompleted({
              contentType: 'image',
              provider: analyticsSnapshot?.provider ?? task.provider,
              model: analyticsSnapshot?.model ?? task.model,
              mode: analyticsSnapshot?.mode ?? 'text-to-image',
              costCredits: analyticsSnapshot?.costCredits,
              promptLength:
                analyticsSnapshot?.promptLength ?? task.prompt?.length,
              outputCount: images.length,
              taskId: task.id,
            });
            void trackGtmActivation({
              contentType: 'image',
              provider: analyticsSnapshot?.provider ?? task.provider,
              model: analyticsSnapshot?.model ?? task.model,
              mode: analyticsSnapshot?.mode ?? 'text-to-image',
              userId: user?.id,
            });
            toast.success('Image generated successfully');
          }

          setProgress(100);
          resetTaskState();
          return true;
        }

        if (currentStatus === AITaskStatus.FAILED) {
          const errorMessage =
            parsedResult?.errorMessage || 'Generate image failed';
          toast.error(errorMessage);
          resetTaskState();

          fetchUserCredits();

          return true;
        }

        setProgress((prev) => Math.min(prev + 5, 95));
        return false;
      } catch (error: any) {
        console.error('Error polling image task:', error);
        toast.error(`Query task failed: ${error.message}`);
        resetTaskState();

        fetchUserCredits();

        return true;
      }
    },
    [generationStartTime, resetTaskState, fetchUserCredits, user?.id]
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

  const submitImageGeneration = useCallback(async () => {
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
      analyticsSnapshot,
    } = request;

    setIsGenerating(true);
    setProgress(15);
    setTaskStatus(AITaskStatus.PENDING);
    setGeneratedImages([]);
    setSharingImageId(null);
    setGenerationStartTime(Date.now());
    analyticsSnapshotRef.current = analyticsSnapshot;
    trackGtmGenerateContentStarted({
      contentType: 'image',
      provider: analyticsSnapshot.provider,
      model: analyticsSnapshot.model,
      mode: analyticsSnapshot.mode,
      costCredits: analyticsSnapshot.costCredits,
      promptLength: analyticsSnapshot.promptLength,
      configs,
    });

    try {
      const resp = await fetch('/api/ai/generate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          mediaType: AIMediaType.IMAGE,
          scene,
          provider: requestProvider,
          model: requestModel,
          prompt: requestPrompt,
          options,
        }),
      });

      if (!resp.ok) {
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

        throw new Error(message || 'Failed to create an image task');
      }

      const newTaskId = data?.id;
      if (!newTaskId) {
        throw new Error('Task id missing in response');
      }

      if (data.status === AITaskStatus.SUCCESS && data.taskInfo) {
        const parsedResult = parseTaskResult(data.taskInfo);
        const imageUrls = extractImageUrls(parsedResult);

        if (imageUrls.length > 0) {
          const images = imageUrls.map((url, index) => ({
            id: `${newTaskId}-${index}`,
            url,
            taskId: newTaskId,
            imageIndex: index,
            provider: requestProvider,
            model: requestModel,
            prompt: requestPrompt,
          }));
          setGeneratedImages(images);
          trackGtmGenerateContentCompleted({
            contentType: 'image',
            provider: analyticsSnapshot.provider,
            model: analyticsSnapshot.model,
            mode: analyticsSnapshot.mode,
            costCredits: analyticsSnapshot.costCredits,
            promptLength: analyticsSnapshot.promptLength,
            outputCount: images.length,
            taskId: newTaskId,
            configs,
          });
          void trackGtmActivation({
            contentType: 'image',
            provider: analyticsSnapshot.provider,
            model: analyticsSnapshot.model,
            mode: analyticsSnapshot.mode,
            userId: user?.id,
          });
          setProgress(100);
          resetTaskState();
          await fetchUserCredits();
          toast.success('Image generated successfully');
          return true;
        }
      }

      setTaskId(newTaskId);
      setProviderTaskId(data?.taskId ?? null);
      setProgress(25);

      await fetchUserCredits();
      return true;
    } catch (error: any) {
      console.error('Failed to generate image:', error);
      toast.error(`Failed to generate image: ${error.message}`);
      resetTaskState();
      return false;
    }
  }, [configs, fetchUserCredits, resetTaskState, user?.id]);

  const {
    queueState,
    isQueueActive,
    isQueueSubmitting,
    startQueue,
    cancelQueue,
    retryQueue,
    trackUpgradeClick,
  } = useMembershipPriorityQueue({
    mediaType: 'image',
    userId: user?.id ?? null,
    enabled: hasFetchedCurrentSubscription && !hasQueueBypassAccess,
    waitRangeMs: imageQueueWaitRangeMs,
    snapshotDigest: queueSnapshotDigest,
    serializedPayload: queuePayload,
    onSubmit: async (serializedPayload) => {
      const parsedRequest = JSON.parse(
        serializedPayload
      ) as PendingImageGenerationRequest;
      pendingGenerateRequestRef.current = parsedRequest;
      return submitImageGeneration();
    },
    trackingConfigs: configs,
  });
  const isCurrentRequestRetryable =
    queueState?.status === 'submit_failed' &&
    queueState.snapshotDigest === queueSnapshotDigest;
  const showGeneratingResultOverlay =
    isGenerating && generatedImages.length === 0 && !isQueueActive;

  const handleCancelQueue = useCallback(() => {
    pendingGenerateRequestRef.current = null;
    cancelQueue();
  }, [cancelQueue]);

  const handleCloseCreditFallback = useCallback(() => {
    setCreditFallback(null);
  }, []);

  const handleUpgradeFromCreditFallback = useCallback(() => {
    setCreditFallback(null);
    router.push('/pricing');
  }, [router]);

  const handleContinueWithImageFallback = useCallback(async () => {
    const trimmedPrompt = prompt.trim();
    if (!trimmedPrompt) {
      return;
    }

    setCreditFallback(null);
    handleCancelQueue();
    setProvider('kie');
    setModel(MODEL_NANO_BANANA_2);
    setResolution('1K');
    setUseGoogleSearch(false);

    const fallbackScene = isTextToImageMode
      ? 'text-to-image'
      : 'image-to-image';
    const fallbackRequest: PendingImageGenerationRequest = {
      scene: fallbackScene,
      provider: 'kie',
      model: MODEL_NANO_BANANA_2,
      prompt: trimmedPrompt,
      options: {
        ...(!isTextToImageMode
          ? {
              image_input: referenceImageUrls.slice(
                0,
                MODEL_MAX_IMAGES[MODEL_NANO_BANANA_2]
              ),
            }
          : {}),
        ...(aspectRatio ? { aspect_ratio: aspectRatio } : {}),
        resolution: '1K',
        ...(outputFormat ? { output_format: outputFormat } : {}),
      },
      analyticsSnapshot: {
        provider: 'kie',
        model: MODEL_NANO_BANANA_2,
        mode: fallbackScene,
        costCredits: calculateImageCredits({
          scene: fallbackScene,
          provider: 'kie',
          model: MODEL_NANO_BANANA_2,
          resolution: '1K',
          googleSearch: false,
          multiplier: IMAGE_CREDITS_MULTIPLIER,
        }),
        promptLength: trimmedPrompt.length,
      },
    };

    pendingGenerateRequestRef.current = fallbackRequest;
    await submitImageGeneration();
  }, [
    aspectRatio,
    handleCancelQueue,
    isTextToImageMode,
    outputFormat,
    prompt,
    referenceImageUrls,
    submitImageGeneration,
  ]);

  const creditFallbackActions = useMemo(() => {
    if (
      !creditFallback?.fallbackOptions.some(
        (option) => option.id === 'image_standard'
      )
    ) {
      return [];
    }

    return [
      {
        id: 'image_standard',
        badgeLabel: creditFallbackCopy.imageStandardBadge,
        title: creditFallbackCopy.imageStandardTitle,
        description: creditFallbackCopy.imageStandardDescription,
        creditsLabel: t('credits_cost', {
          credits: IMAGE_STANDARD_FALLBACK_CREDITS,
        }),
        visualType: 'image' as const,
        onSelect: handleContinueWithImageFallback,
      },
    ];
  }, [creditFallback, creditFallbackCopy, handleContinueWithImageFallback, t]);

  const handleGenerate = async () => {
    if (availableProviders.length === 0) {
      toast.error('Please contact the administrator to configure AI models.');
      return;
    }

    if (!availableProviders.includes(provider)) {
      toast.error('Please contact the administrator to configure AI models.');
      return;
    }

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
          mediaType: 'image',
          requestedCostCredits: costCredits,
          remainingCredits,
        })
      );
      return;
    }

    const trimmedPrompt = prompt.trim();
    if (!trimmedPrompt) {
      toast.error('Please enter a prompt before generating.');
      return;
    }

    if (!provider || !model) {
      toast.error('Provider or model is not configured correctly.');
      return;
    }

    if (!isTextToImageMode && referenceImageUrls.length === 0) {
      toast.error('Please upload reference images before generating.');
      return;
    }

    if (!isTextToImageMode && referenceImageUrls.length > modelMaxImages) {
      toast.error(`Maximum ${modelMaxImages} reference images allowed.`);
      return;
    }

    const options: Record<string, unknown> = {};

    if (!isTextToImageMode) {
      options.image_input = referenceImageUrls.slice(0, modelMaxImages);
    }

    if (aspectRatio) {
      options.aspect_ratio = aspectRatio;
    }

    if (resolution) {
      options.resolution = resolution;
    }

    if (outputFormat) {
      options.output_format = outputFormat;
    }

    if (isNanoBanana2 && useGoogleSearch) {
      options.google_search = true;
    }

    pendingGenerateRequestRef.current = {
      scene: isTextToImageMode ? 'text-to-image' : 'image-to-image',
      provider,
      model,
      prompt: trimmedPrompt,
      options,
      analyticsSnapshot: {
        provider,
        model,
        mode: isTextToImageMode ? 'text-to-image' : 'image-to-image',
        costCredits,
        promptLength: trimmedPrompt.length,
      },
    };

    if (hasQueueBypassAccessForAttempt) {
      await submitImageGeneration();
      return;
    }

    const queueStartResult = await startQueue({
      forceQueue: true,
    });
    if (queueStartResult.status === 'existing_other_queue') {
      router.push(
        queueStartResult.queue?.scope === 'kling-video'
          ? KLING_QUEUE_RETURN_HREF
          : queueStartResult.queue?.mediaType === 'video'
            ? VIDEO_QUEUE_RETURN_HREF
            : IMAGE_QUEUE_RETURN_HREF
      );
    }
  };

  const handleDownloadImage = async (image: GeneratedImage) => {
    if (!image.url) {
      return;
    }

    if (!(await canDownload('image'))) {
      return;
    }

    try {
      setDownloadingImageId(image.id);
      const resp = await fetch(
        `/api/proxy/file?url=${encodeURIComponent(image.url)}`
      );
      if (!resp.ok) {
        throw new Error('Failed to fetch image');
      }

      const blob = await resp.blob();
      const blobUrl = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = blobUrl;
      link.download = `${image.id}.png`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      setTimeout(() => URL.revokeObjectURL(blobUrl), 200);
      toast.success(t('download_success'));
    } catch (error) {
      console.error('Failed to download image:', error);
      toast.error(t('download_failed'));
    } finally {
      setDownloadingImageId(null);
    }
  };

  const openShareConfirm = (image: GeneratedImage) => {
    if (!image.url) {
      return;
    }

    if (!user) {
      setIsShowSignModal(true);
      return;
    }

    setShareTargetImage(image);
    setShareResult(null);
  };

  const handleConfirmShareImage = async () => {
    const image = shareTargetImage;
    if (!image?.url) {
      return;
    }

    try {
      setSharingImageId(image.id);
      const resp = await fetch('/api/showcases/share', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          taskId: image.taskId,
          imageIndex: image.imageIndex,
          locale,
        }),
      });

      if (!resp.ok) {
        throw new Error(`request failed with status: ${resp.status}`);
      }

      const { code, message, data } = await resp.json();
      if (code !== 0 || !data?.shareUrl) {
        throw new Error(message || 'Failed to publish image');
      }

      const shareUrl = data.shareUrl as string;
      setShareResult({
        shareUrl,
        imageUrl: image.url,
        title: image.prompt?.trim()
          ? image.prompt.trim().slice(0, 90)
          : t('generated_image'),
        description: image.prompt?.trim()
          ? image.prompt.trim().slice(0, 180)
          : t('generated_image'),
      });
      toast.success(
        data.alreadyShared
          ? t('share_showcase.ready')
          : t('share_showcase.published')
      );
    } catch (error) {
      console.error('Failed to share image:', error);
      toast.error(t('share_showcase.failed'));
    } finally {
      setSharingImageId(null);
    }
  };

  const content = (
    <div className={cn(!embedded && 'container')}>
      <div className={cn('mx-auto', embedded ? 'max-w-7xl' : 'max-w-6xl')}>
        <div className="grid grid-cols-1 gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <Card>
            <CardHeader>
              {srOnlyTitle && <h2 className="sr-only">{srOnlyTitle}</h2>}
              <CardTitle className="flex items-center gap-2 text-xl font-semibold">
                <Wand className="h-5 w-5" />
                {t('title')}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-6 pb-8">
              <Tabs value={activeTab} onValueChange={handleTabChange}>
                <TabsList className="bg-primary/10 grid w-full grid-cols-2">
                  <TabsTrigger value="text-to-image">
                    {t('tabs.text-to-image')}
                  </TabsTrigger>
                  <TabsTrigger value="image-to-image">
                    {t('tabs.image-to-image')}
                  </TabsTrigger>
                </TabsList>
              </Tabs>

              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label>{t('form.model')}</Label>
                  <Select value={model} onValueChange={handleModelChange}>
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder={t('form.select_model')} />
                    </SelectTrigger>
                    <SelectContent>
                      {MODEL_OPTIONS.filter((option) =>
                        option.scenes.includes(activeTab)
                      ).map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-muted-foreground text-xs">
                    {t('form.model_hint')}
                  </p>
                </div>

                <div className="space-y-2">
                  <Label>{t('form.resolution')}</Label>
                  <Select
                    value={resolution}
                    onValueChange={handleResolutionChange}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder={t('form.select_resolution')} />
                    </SelectTrigger>
                    <SelectContent>
                      {RESOLUTION_OPTIONS.map((option) => (
                        <SelectItem key={option} value={option}>
                          {option}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label>{t('form.aspect_ratio')}</Label>
                  <Select
                    value={aspectRatio}
                    onValueChange={handleAspectRatioChange}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue
                        placeholder={t('form.select_aspect_ratio')}
                      />
                    </SelectTrigger>
                    <SelectContent>
                      {modelAspectRatios.map((option) => (
                        <SelectItem key={option} value={option}>
                          {option}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label>{t('form.output_format')}</Label>
                  <Select
                    value={outputFormat}
                    onValueChange={handleOutputFormatChange}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue
                        placeholder={t('form.select_output_format')}
                      />
                    </SelectTrigger>
                    <SelectContent>
                      {OUTPUT_FORMAT_OPTIONS.map((option) => (
                        <SelectItem key={option} value={option}>
                          {option.toUpperCase()}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {isNanoBanana2 && (
                <div className="space-y-2">
                  <Label className="flex items-center justify-between gap-2">
                    <span>{t('form.google_search')}</span>
                    <Switch
                      checked={useGoogleSearch}
                      onCheckedChange={setUseGoogleSearch}
                    />
                  </Label>
                  <p className="text-muted-foreground text-xs">
                    {t('form.google_search_hint')}
                  </p>
                </div>
              )}

              {!isTextToImageMode && (
                <div className="space-y-4">
                  <ImageUploader
                    title={t('form.reference_image')}
                    allowMultiple={allowMultipleImages}
                    maxImages={effectiveMaxImages}
                    maxSizeMB={maxSizeMB}
                    onChange={handleReferenceImagesChange}
                    emptyHint={t('form.reference_image_placeholder')}
                  />

                  {hasReferenceUploadError && (
                    <p className="text-destructive text-xs">
                      {t('form.some_images_failed_to_upload')}
                    </p>
                  )}
                </div>
              )}

              <div className="space-y-2">
                <Label htmlFor="image-prompt">{t('form.prompt')}</Label>
                <Textarea
                  ref={promptTextareaRef}
                  id="image-prompt"
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  placeholder={t('form.prompt_placeholder')}
                  className="min-h-32"
                />
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
                    isGenerating ||
                    isLoadingCredits ||
                    isLoadingProviders ||
                    isFetchingCurrentSubscription ||
                    !prompt.trim() ||
                    isPromptTooLong ||
                    isReferenceUploading ||
                    hasReferenceUploadError ||
                    (!isLoadingCredits &&
                      Boolean(currentSubscription) &&
                      remainingCredits < costCredits)
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
                  ) : isLoadingProviders || isFetchingCurrentSubscription ? (
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

              {!isMounted || isLoadingCredits || isLoadingProviders ? (
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
                  <span className="flex items-center gap-2">
                    <Loader2 className="h-3 w-3 animate-spin" />
                    {t('credits_remaining', { credits: 0 })}
                  </span>
                </div>
              ) : user && remainingCredits > 0 ? (
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

              {isGenerating ? (
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
                <ImageIcon className="h-5 w-5" />
                {t('generated_images')}
              </CardTitle>
            </CardHeader>
            <CardContent className="pb-8">
              {generatedImages.length > 0 ? (
                <div
                  className={
                    generatedImages.length === 1
                      ? 'grid grid-cols-1 gap-6'
                      : 'grid gap-6 sm:grid-cols-2'
                  }
                >
                  {generatedImages.map((image) => (
                    <div key={image.id} className="space-y-3">
                      <div
                        className={
                          generatedImages.length === 1
                            ? 'relative overflow-hidden rounded-lg border'
                            : 'relative aspect-square overflow-hidden rounded-lg border'
                        }
                      >
                        <LazyImage
                          src={image.url}
                          alt={image.prompt || t('generated_image')}
                          className={
                            generatedImages.length === 1
                              ? 'h-auto w-full'
                              : 'h-full w-full object-cover'
                          }
                        />

                        <div className="absolute right-2 bottom-2 left-2 flex flex-wrap justify-end gap-2 text-sm">
                          <Button
                            size="sm"
                            variant="ghost"
                            className="gap-2 bg-black/40 text-white backdrop-blur-sm hover:bg-black/60"
                            onClick={() => openShareConfirm(image)}
                            disabled={sharingImageId === image.id}
                          >
                            {sharingImageId === image.id ? (
                              <>
                                <Loader2 className="h-4 w-4 animate-spin" />
                                <span>{t('share_showcase.sharing')}</span>
                              </>
                            ) : (
                              <>
                                <Share2 className="h-4 w-4" />
                                <span>{t('share_showcase.button')}</span>
                              </>
                            )}
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="gap-2 bg-black/40 text-white backdrop-blur-sm hover:bg-black/60"
                            onClick={() => handleDownloadImage(image)}
                            disabled={downloadingImageId === image.id}
                          >
                            {downloadingImageId === image.id ? (
                              <>
                                <Loader2 className="h-4 w-4 animate-spin" />
                                <span>{t('downloading')}</span>
                              </>
                            ) : (
                              <>
                                <Download className="h-4 w-4" />
                                <span>{t('download')}</span>
                              </>
                            )}
                          </Button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="relative flex min-h-[360px] flex-col items-center justify-center overflow-hidden rounded-xl py-4 text-center">
                  {previewImage && (
                    <div className="mb-6 overflow-hidden rounded-lg border">
                      <LazyImage
                        src={previewImage}
                        alt="Preview image"
                        className="w-full"
                      />
                    </div>
                  )}
                  {!promptKey && (
                    <div className="mb-6 grid w-full gap-3 sm:grid-cols-2">
                      {IMAGE_DEMO_EXAMPLES.map((item) => (
                        <div
                          key={item.src}
                          className="overflow-hidden rounded-lg border"
                        >
                          <LazyImage
                            src={item.src}
                            alt={item.alt}
                            className="w-full"
                          />
                        </div>
                      ))}
                    </div>
                  )}
                  {isQueueActive && queueState ? (
                    <div className="w-full max-w-md text-left">
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
                        onUpgradeClick={trackUpgradeClick}
                        onRetry={
                          isCurrentRequestRetryable ? retryQueue : undefined
                        }
                        upgradeHref="/pricing"
                        isSubmitting={isQueueSubmitting}
                        isSubmitFailed={isCurrentRequestRetryable}
                        retryLabel={queueCopy.retryLabel}
                        submitFailedLabel={queueCopy.submitFailedLabel}
                        className="bg-background/80 shadow-sm backdrop-blur-sm"
                      />
                    </div>
                  ) : (
                    <p className="text-muted-foreground">
                      {isGenerating
                        ? t('ready_to_generate')
                        : t('no_images_generated')}
                    </p>
                  )}
                  {showGeneratingResultOverlay ? (
                    <GeneratorResultOverlay
                      title={t('generating')}
                      progressLabel={t('progress')}
                      progress={progress}
                      status={taskStatusLabel}
                    />
                  ) : null}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );

  const fallbackDialog = (
    <>
      <ShareShowcaseDialog
        open={Boolean(shareTargetImage)}
        onOpenChange={(open) => {
          if (!open) {
            setShareTargetImage(null);
            setShareResult(null);
          }
        }}
        isSharing={Boolean(sharingImageId)}
        title={t('share_showcase.title')}
        description={t('share_showcase.description')}
        rewardHint={t('share_showcase.reward_hint', {
          credits: referralCredits,
        })}
        resultTitle={t('share_showcase.result_title')}
        resultDescription={t('share_showcase.result_description')}
        resultRewardHint={t('share_showcase.result_reward_hint', {
          credits: referralCredits,
        })}
        confirmLabel={t('share_showcase.confirm')}
        cancelLabel={t('share_showcase.cancel')}
        sharingLabel={t('share_showcase.sharing')}
        actionLabels={buildShareActionLabels({
          t,
          namespace: 'share_showcase',
        })}
        appName={envConfigs.app_name}
        result={shareResult}
        onConfirm={handleConfirmShareImage}
      />
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
    </>
  );

  if (embedded) {
    return (
      <div id={id} className={className}>
        {content}
        {fallbackDialog}
      </div>
    );
  }

  return (
    <section id={id} className={cn('py-16 md:py-24', className)}>
      {content}
      {fallbackDialog}
    </section>
  );
}
