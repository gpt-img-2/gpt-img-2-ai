'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import {
  BookOpen,
  CreditCard,
  Download,
  ImageIcon,
  Loader2,
  Share2,
  Sparkles,
  User,
  Video,
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
  ImageWatermarkOverlay,
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
import { Tabs, TabsList, TabsTrigger } from '@/shared/components/ui/tabs';
import { Textarea } from '@/shared/components/ui/textarea';
import { useAppContext } from '@/shared/contexts/app';
import { useMembershipPriorityQueue } from '@/shared/hooks/use-membership-priority-queue';
import {
  createGenerationCreditFallbackPayload,
  GenerationCreditFallbackPayload,
  isGenerationCreditFallbackPayload,
} from '@/shared/lib/generation-credit-fallback';
import {
  getGptImageMaxReferenceImages,
  getGptImageModelForScene,
  GptImageRuntimeProvider,
  resolveGptImageProvider,
} from '@/shared/lib/gpt-image';
import { getGptImageCreditsForSubscription } from '@/shared/lib/gpt-image-membership';
import {
  trackGtmActivation,
  trackGtmGenerateContentCompleted,
  trackGtmGenerateContentStarted,
} from '@/shared/lib/gtm';
import { getUuid, md5 } from '@/shared/lib/hash';
import {
  calculateImageCredits,
  GPT_IMAGE_2_CREDITS,
} from '@/shared/lib/image-pricing';
import { resolvePriorityQueueWaitRangeMs } from '@/shared/lib/membership-priority-queue-config';
import { buildShareActionLabels } from '@/shared/lib/share-action-labels';
import { cn } from '@/shared/lib/utils';

interface GptImage2GeneratorProps {
  id?: string;
  srOnlyTitle?: string;
  className?: string;
  embedded?: boolean;
  hideHeader?: boolean;
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
}

interface GenerateAnalyticsSnapshot {
  provider: string;
  model: string;
  mode: GptImageScene;
  costCredits: number;
  promptLength: number;
}

interface PendingGptImageRequest {
  clientRequestId: string;
  scene: GptImageScene;
  provider: GptImageRuntimeProvider;
  model: string;
  prompt: string;
  options: Record<string, unknown>;
  analyticsSnapshot: GenerateAnalyticsSnapshot;
}

type GptImageScene = 'text-to-image' | 'image-to-image';

const POLL_INTERVAL = 5000;
const GENERATION_TIMEOUT = 10 * 60 * 1000;
const MAX_PROMPT_LENGTH = 20000;
const VIDEO_PROMPT_PREFILL_MAX_LENGTH = 2500;
const IMAGE_CREDITS_MULTIPLIER = 10;
const DEFAULT_PROMPT =
  'Create a photorealistic candid photograph of an elderly sailor standing on a small fishing boat, calmly adjusting a net while his dog sits nearby on the deck. Shot like a 35mm film photograph, medium close-up at eye level, using a 50mm lens.';
const GPT_IMAGE_2_DEMO_EXAMPLES = [
  {
    src: 'https://cdn.nano-banana-2-ai.com/uploads/landing/gpt-image-2-demo-zeroz.webp',
    alt: 'GPT Image 2 yoga pants action reference demo',
  },
] as const;

function parseTaskResult(taskResult: string | null): any {
  if (!taskResult) {
    return null;
  }

  try {
    return JSON.parse(taskResult);
  } catch {
    return null;
  }
}

function extractImageUrls(result: any): string[] {
  if (!result) {
    return [];
  }

  const output = result.images ?? result.output ?? result.data;
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
            item.imageUrl ?? item.url ?? item.uri ?? item.image ?? item.src;
          return typeof candidate === 'string' ? [candidate] : [];
        }
        return [];
      })
      .filter(Boolean);
  }

  if (typeof output === 'object') {
    const candidate =
      output.imageUrl ?? output.url ?? output.uri ?? output.image ?? output.src;
    if (typeof candidate === 'string') {
      return [candidate];
    }
  }

  return [];
}

function isTransientPollError(error: unknown) {
  const message =
    error instanceof Error
      ? error.message
      : typeof error === 'string'
        ? error
        : '';

  return (
    /\bstatus:\s*(?:502|503|504)\b/i.test(message) ||
    /failed to fetch|networkerror|load failed/i.test(message)
  );
}

function normalizeGptImageRequestOptions(
  scene: GptImageScene,
  options?: Record<string, unknown> | null,
  clientRequestId?: string,
  maxReferenceImages = getGptImageMaxReferenceImages()
) {
  const normalized: Record<string, unknown> = {};

  if (clientRequestId) {
    normalized.clientRequestId = clientRequestId;
  }

  if (scene === 'image-to-image' && Array.isArray(options?.image_input)) {
    normalized.image_input = options.image_input
      .map((url) => (typeof url === 'string' ? url.trim() : ''))
      .filter(Boolean)
      .slice(0, maxReferenceImages);
  }

  return normalized;
}

export function GptImage2Generator({
  id = 'generator',
  srOnlyTitle,
  className,
  embedded = false,
  hideHeader = false,
}: GptImage2GeneratorProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const locale = useLocale();
  const t = useTranslations('ai.image.generator');
  const defaultPrompt = useMemo(
    () =>
      t.has('form.default_prompt') ? t('form.default_prompt') : DEFAULT_PROMPT,
    [t]
  );
  const [activeTab, setActiveTab] = useState<GptImageScene>('text-to-image');
  const [prompt, setPrompt] = useState(defaultPrompt);
  const [referenceImageItems, setReferenceImageItems] = useState<
    ImageUploaderValue[]
  >([]);
  const [referenceImageUrls, setReferenceImageUrls] = useState<string[]>([]);
  const [generatedImages, setGeneratedImages] = useState<GeneratedImage[]>([]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isLoadingCredits, setIsLoadingCredits] = useState(false);
  const [progress, setProgress] = useState(0);
  const [taskId, setTaskId] = useState<string | null>(null);
  const [providerTaskId, setProviderTaskId] = useState<string | null>(null);
  const [generationStartTime, setGenerationStartTime] = useState<number | null>(
    null
  );
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
  const [availableProviders, setAvailableProviders] = useState<string[]>([]);
  const [isLoadingProviders, setIsLoadingProviders] = useState(true);
  const [clientRequestId, setClientRequestId] = useState(() => getUuid());
  const [creditFallback, setCreditFallback] =
    useState<GenerationCreditFallbackPayload | null>(null);
  const pendingGenerateRequestRef = useRef<PendingGptImageRequest | null>(null);
  const analyticsSnapshotRef = useRef<GenerateAnalyticsSnapshot | null>(null);
  const transientPollErrorCountRef = useRef(0);
  const hasLoadedCreditsRef = useRef(false);
  const userIdRef = useRef<string | null>(null);
  const promptTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const lastAppliedPromptRef = useRef<string | null>(null);
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
    fetchConfigs,
    hasFetchedConfigs,
  } = useAppContext();

  const provider = useMemo(
    () =>
      resolveGptImageProvider({
        configs,
        availableProviders,
      }),
    [availableProviders, configs]
  );
  const maxReferenceImages = getGptImageMaxReferenceImages(provider);
  const model = getGptImageModelForScene({
    provider,
    scene: activeTab,
  });

  useEffect(() => {
    if (!hasFetchedConfigs) {
      void fetchConfigs();
    }
  }, [fetchConfigs, hasFetchedConfigs]);

  useEffect(() => {
    fetch('/api/ai/providers')
      .then((res) => res.json())
      .then((data) => {
        if (data.code === 0 && Array.isArray(data.data?.providers)) {
          setAvailableProviders(data.data.providers);
        }
      })
      .catch((error) => {
        console.error('Failed to fetch AI providers:', error);
      })
      .finally(() => setIsLoadingProviders(false));
  }, []);

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
    const uploadedUrls = referenceImageItems
      .filter((item) => item.status === 'uploaded' && item.url)
      .map((item) => item.url as string)
      .slice(0, maxReferenceImages);
    setReferenceImageUrls(uploadedUrls);
  }, [maxReferenceImages, referenceImageItems]);

  const isTextToImageMode = activeTab === 'text-to-image';
  const promptLength = prompt.trim().length;
  const isPromptTooLong = promptLength > MAX_PROMPT_LENGTH;
  const remainingCredits = user?.credits?.remainingCredits ?? 0;
  const configuredGptImageCredits = useMemo(() => {
    const parsedCredits = parseInt(configs.gpt_image_2_credits || '', 10);
    return parsedCredits > 0 ? parsedCredits : GPT_IMAGE_2_CREDITS;
  }, [configs.gpt_image_2_credits]);
  const resolveCostCredits = useCallback(
    (subscription = currentSubscription) =>
      calculateImageCredits({
        scene: activeTab,
        provider,
        model,
        multiplier: IMAGE_CREDITS_MULTIPLIER,
        gptImageCredits: getGptImageCreditsForSubscription({
          baseCredits: configuredGptImageCredits,
          subscription,
        }),
      }),
    [activeTab, configuredGptImageCredits, currentSubscription, model, provider]
  );
  const costCredits = useMemo(
    () => resolveCostCredits(currentSubscription),
    [currentSubscription, resolveCostCredits]
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
  const shouldWatermarkGeneratedImages = Boolean(
    user && hasFetchedCurrentSubscription && !hasPaidEntitlement
  );
  const hasReferenceUploadError = referenceImageItems.some(
    (item) => item.status === 'error'
  );
  const isReferenceUploading = referenceImageItems.some(
    (item) => item.status === 'uploading'
  );
  const isProviderConfigured = availableProviders.includes(provider);
  const taskStatusLabel =
    taskStatus === AITaskStatus.PENDING
      ? 'Waiting for GPT Image 2'
      : taskStatus === AITaskStatus.PROCESSING
        ? 'Rendering image'
        : null;
  const queueCopy = useMemo(
    () => ({
      gptTitle: t.has('gpt_image_2.title')
        ? t('gpt_image_2.title')
        : 'GPT Image 2 Generator',
      gptDescription: t.has('gpt_image_2.description')
        ? t('gpt_image_2.description', { max: maxReferenceImages })
        : `Create images from text prompts or up to ${maxReferenceImages} reference images.`,
      generateTitle: t.has('gpt_image_2.generate_title')
        ? t('gpt_image_2.generate_title')
        : 'Generate',
      modeSection: t.has('gpt_image_2.mode_section')
        ? t('gpt_image_2.mode_section')
        : 'Mode',
      promptSection: t.has('gpt_image_2.prompt_section')
        ? t('gpt_image_2.prompt_section')
        : 'Prompt',
      generateButton: t.has('gpt_image_2.generate_button')
        ? t('gpt_image_2.generate_button')
        : 'Generate with GPT Image 2',
      referenceImageHint: t.has('gpt_image_2.reference_image_hint')
        ? t('gpt_image_2.reference_image_hint', { max: maxReferenceImages })
        : `Upload up to ${maxReferenceImages} reference images`,
      providerNotConfigured: t.has('gpt_image_2.provider_not_configured')
        ? t('gpt_image_2.provider_not_configured', {
            provider: provider === 'apimart' ? 'APIMart' : 'KIE',
          })
        : `Please contact the administrator to configure ${
            provider === 'apimart' ? 'APIMart' : 'KIE'
          }.`,
      creditFallback: t.has('gpt_image_2.credit_fallback')
        ? t('gpt_image_2.credit_fallback', {
            credits: creditFallback?.requestedCostCredits ?? costCredits,
          })
        : `This generation needs ${
            creditFallback?.requestedCostCredits ?? costCredits
          } credits. Please add credits to continue.`,
      resultHint: t.has('gpt_image_2.result_hint')
        ? t('gpt_image_2.result_hint')
        : 'Your GPT Image 2 result will appear here when generation completes.',
      readyTitle: t.has('gpt_image_2.ready_title')
        ? t('gpt_image_2.ready_title')
        : 'Ready for your first image',
      readyDescription: t.has('gpt_image_2.ready_description')
        ? t('gpt_image_2.ready_description')
        : 'Describe a scene, then generate.',
      promptLibraryTitle: t.has('gpt_image_2.prompt_library_title')
        ? t('gpt_image_2.prompt_library_title')
        : 'Need prompt ideas?',
      promptLibraryDescription: t.has('gpt_image_2.prompt_library_description')
        ? t('gpt_image_2.prompt_library_description')
        : 'Browse copyable GPT Image 2 prompts before writing your own.',
      promptLibraryButton: t.has('gpt_image_2.prompt_library_button')
        ? t('gpt_image_2.prompt_library_button')
        : 'Open prompt gallery',
      videoCtaTitle: t.has('gpt_image_2.video_cta_title')
        ? t('gpt_image_2.video_cta_title')
        : 'Turn this image into a video',
      videoCtaDescription: t.has('gpt_image_2.video_cta_description')
        ? t('gpt_image_2.video_cta_description')
        : 'Use this result as the first frame and continue the same prompt in the video generator.',
      videoCtaButton: t.has('gpt_image_2.video_cta_button')
        ? t('gpt_image_2.video_cta_button')
        : 'Create video',
      watermarkHint: t.has('gpt_image_2.watermark_hint')
        ? t('gpt_image_2.watermark_hint')
        : 'This preview includes a watermark. Paid plans and credit packs unlock no-watermark results.',
      watermarkUpgradeLabel: t.has('gpt_image_2.watermark_upgrade_label')
        ? t('gpt_image_2.watermark_upgrade_label')
        : 'View pricing',
      queueTitle: t.has('queue.title') ? t('queue.title') : 'Standard Queue',
      queueDescription: t.has('queue.description')
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
    [
      costCredits,
      creditFallback?.requestedCostCredits,
      maxReferenceImages,
      provider,
      t,
    ]
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
          }. You can add more credits, check in, or invite friends to continue.`,
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
  const queueSnapshotPayload = useMemo(
    () =>
      JSON.stringify({
        clientRequestId,
        scene: activeTab,
        provider,
        model,
        prompt: prompt.trim(),
        options: {
          clientRequestId,
          ...(!isTextToImageMode
            ? {
                image_input: referenceImageUrls.slice(0, maxReferenceImages),
              }
            : {}),
        },
        analyticsSnapshot: {
          provider,
          model,
          mode: activeTab,
          costCredits,
          promptLength: prompt.trim().length,
        },
      } satisfies PendingGptImageRequest),
    [
      activeTab,
      clientRequestId,
      costCredits,
      isTextToImageMode,
      maxReferenceImages,
      model,
      prompt,
      provider,
      referenceImageUrls,
    ]
  );
  const queueDigestPayload = useMemo(
    () =>
      JSON.stringify({
        scene: activeTab,
        provider,
        model,
        prompt: prompt.trim(),
        options: {
          ...(!isTextToImageMode
            ? {
                image_input: referenceImageUrls.slice(0, maxReferenceImages),
              }
            : {}),
        },
        analyticsSnapshot: {
          provider,
          model,
          mode: activeTab,
          costCredits,
          promptLength: prompt.trim().length,
        },
      }),
    [
      activeTab,
      costCredits,
      isTextToImageMode,
      maxReferenceImages,
      model,
      prompt,
      provider,
      referenceImageUrls,
    ]
  );
  const queuePayload = queueSnapshotPayload;
  const queueSnapshotDigest = useMemo(
    () => md5(queueDigestPayload),
    [queueDigestPayload]
  );

  const resetTaskState = useCallback(() => {
    analyticsSnapshotRef.current = null;
    pendingGenerateRequestRef.current = null;
    setIsGenerating(false);
    setProgress(0);
    setTaskId(null);
    setProviderTaskId(null);
    setGenerationStartTime(null);
    setTaskStatus(null);
    transientPollErrorCountRef.current = 0;
  }, []);

  useEffect(() => {
    const promptParam = searchParams?.get('prompt')?.trim();

    if (!promptParam) {
      lastAppliedPromptRef.current = null;
      return;
    }

    if (promptParam === lastAppliedPromptRef.current) {
      return;
    }

    resetTaskState();
    setReferenceImageItems([]);
    setReferenceImageUrls([]);
    setGeneratedImages([]);
    setDownloadingImageId(null);
    setSharingImageId(null);
    setCreditFallback(null);
    setPrompt(promptParam.slice(0, MAX_PROMPT_LENGTH));
    setActiveTab('text-to-image');
    lastAppliedPromptRef.current = promptParam;

    window.requestAnimationFrame(() => {
      const textarea = promptTextareaRef.current;
      if (!textarea) return;

      textarea.focus();
      textarea.setSelectionRange(textarea.value.length, textarea.value.length);
    });
  }, [resetTaskState, searchParams]);

  const pollTaskStatus = useCallback(
    async (id: string, providerTaskIdForQuery?: string | null) => {
      try {
        if (
          generationStartTime &&
          Date.now() - generationStartTime > GENERATION_TIMEOUT
        ) {
          resetTaskState();
          setClientRequestId(getUuid());
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

        transientPollErrorCountRef.current = 0;
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
          setProgress((prev) => Math.min(prev + 10, 80));
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
              mode: analyticsSnapshot?.mode ?? activeTab,
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
              mode: analyticsSnapshot?.mode ?? activeTab,
              userId: user?.id,
            });
            toast.success('Image generated successfully');
          }

          setProgress(100);
          resetTaskState();
          setClientRequestId(getUuid());
          void fetchUserCredits();
          return true;
        }

        if (currentStatus === AITaskStatus.FAILED) {
          toast.error(parsedResult?.errorMessage || 'Generate image failed');
          resetTaskState();
          setClientRequestId(getUuid());
          void fetchUserCredits();
          return true;
        }

        setProgress((prev) => Math.min(prev + 5, 95));
        return false;
      } catch (error: any) {
        console.error('Error polling image task:', error);
        if (isTransientPollError(error)) {
          transientPollErrorCountRef.current += 1;
          setProgress((prev) => Math.min(Math.max(prev, 25), 85));
          setTaskStatus((prev) => prev ?? AITaskStatus.PROCESSING);

          if (transientPollErrorCountRef.current === 1) {
            toast.info('Still generating. Rechecking the provider shortly...');
          }

          return false;
        }

        toast.error(`Query task failed: ${error.message}`);
        resetTaskState();
        void fetchUserCredits();
        return true;
      }
    },
    [activeTab, fetchUserCredits, generationStartTime, resetTaskState, user?.id]
  );

  useEffect(() => {
    if (!taskId || !isGenerating) {
      return;
    }

    let cancelled = false;
    const tick = async () => {
      const completed = await pollTaskStatus(taskId, providerTaskId);
      if (completed) {
        cancelled = true;
      }
    };

    tick();
    const interval = setInterval(async () => {
      if (cancelled) {
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
  }, [isGenerating, pollTaskStatus, providerTaskId, taskId]);

  const submitImageGeneration = useCallback(async () => {
    const request = pendingGenerateRequestRef.current;
    if (!request) {
      return false;
    }

    const {
      clientRequestId,
      scene,
      provider,
      model,
      prompt: requestPrompt,
      options,
    } = request;
    const analyticsSnapshot = request.analyticsSnapshot;

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
          provider,
          model,
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
          toast.error('Insufficient credits for this generation.');
          return false;
        }

        throw new Error(message || 'Failed to create an image task');
      }

      const newTaskId = data?.id;
      if (!newTaskId) {
        throw new Error('Task id missing in response');
      }

      setTaskId(newTaskId);
      setProviderTaskId(data?.taskId ?? null);
      setProgress(25);
      await fetchUserCredits();
      return true;
    } catch (error: any) {
      console.error('Failed to generate image:', error);
      if (isTransientPollError(error)) {
        try {
          const recoveryResp = await fetch('/api/ai/recover', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              mediaType: AIMediaType.IMAGE,
              scene,
              provider,
              model,
              clientRequestId,
              sinceMs: GENERATION_TIMEOUT,
            }),
          });

          if (recoveryResp.ok) {
            const { code, data } = await recoveryResp.json();
            const recoveredTask =
              code === 0 ? (data as BackendTask | null) : null;

            if (recoveredTask?.id) {
              setTaskId(recoveredTask.id);
              setProviderTaskId(recoveredTask.taskId ?? null);
              setTaskStatus(
                (recoveredTask.status as AITaskStatus) || AITaskStatus.PENDING
              );
              setProgress((prev) =>
                Math.max(prev, recoveredTask.taskId ? 25 : 20)
              );
              void fetchUserCredits();
              toast.info(
                'Generation is still starting. Rechecking status shortly...'
              );
              return true;
            }
          }
        } catch (recoveryError) {
          console.warn(
            'Failed to recover image task after transient submit error:',
            recoveryError
          );
        }
      }

      toast.error(`Failed to generate image: ${error.message}`);
      resetTaskState();
      return false;
    }
  }, [configs, fetchUserCredits, resetTaskState]);

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
    scope: 'gpt-image-2',
    userId: user?.id ?? null,
    enabled: hasFetchedCurrentSubscription && !hasQueueBypassAccess,
    waitRangeMs: imageQueueWaitRangeMs,
    snapshotDigest: queueSnapshotDigest,
    serializedPayload: queuePayload,
    onSubmit: async (serializedPayload) => {
      const parsedRequest = JSON.parse(
        serializedPayload
      ) as PendingGptImageRequest;
      const recoveredClientRequestId =
        parsedRequest.clientRequestId || getUuid();
      pendingGenerateRequestRef.current = {
        ...parsedRequest,
        clientRequestId: recoveredClientRequestId,
        options: normalizeGptImageRequestOptions(
          parsedRequest.scene,
          parsedRequest.options,
          recoveredClientRequestId,
          maxReferenceImages
        ),
      };
      return submitImageGeneration();
    },
    trackingConfigs: configs,
  });
  const handleCloseCreditFallback = useCallback(() => {
    setCreditFallback(null);
  }, []);
  const handleUpgradeFromCreditFallback = useCallback(() => {
    setCreditFallback(null);
    router.push('/pricing');
  }, [router]);
  const isCurrentRequestRetryable =
    queueState?.status === 'submit_failed' &&
    queueState.snapshotDigest === queueSnapshotDigest;
  const showGeneratingResultOverlay =
    isGenerating && generatedImages.length === 0 && !isQueueActive;

  const handleGenerate = async () => {
    if (!availableProviders.includes(provider)) {
      toast.error(queueCopy.providerNotConfigured);
      return;
    }

    if (!user) {
      setIsShowSignModal(true);
      return;
    }

    let currentSubscriptionForAttempt = currentSubscription;
    let hasPaidEntitlementForAttempt = hasPaidEntitlement;
    if (!hasFetchedCurrentSubscription || !hasPaidEntitlementForAttempt) {
      const subscriptionResult = await fetchCurrentSubscription({
        force: !hasPaidEntitlementForAttempt,
      });
      if (!subscriptionResult.ok) {
        toast.error(queueCopy.membershipCheckingLabel);
        return;
      }
      currentSubscriptionForAttempt = subscriptionResult.subscription;
      hasPaidEntitlementForAttempt = subscriptionResult.hasPaidEntitlement;
    } else if (isFetchingCurrentSubscription) {
      toast.error(queueCopy.membershipCheckingLabel);
      return;
    }

    const attemptCostCredits = resolveCostCredits(
      currentSubscriptionForAttempt
    );

    if (hasPaidEntitlementForAttempt && remainingCredits < attemptCostCredits) {
      setCreditFallback(
        createGenerationCreditFallbackPayload({
          mediaType: 'image',
          requestedCostCredits: attemptCostCredits,
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

    if (!isTextToImageMode && referenceImageUrls.length === 0) {
      toast.error('Please upload reference images before generating.');
      return;
    }

    const requestOptions: Record<string, unknown> = {
      clientRequestId,
      ...(!isTextToImageMode
        ? {
            image_input: referenceImageUrls.slice(0, maxReferenceImages),
          }
        : {}),
    };
    const request: PendingGptImageRequest = {
      clientRequestId,
      scene: activeTab,
      provider,
      model,
      prompt: trimmedPrompt,
      options: requestOptions,
      analyticsSnapshot: {
        provider,
        model,
        mode: activeTab,
        costCredits: attemptCostCredits,
        promptLength: trimmedPrompt.length,
      },
    };

    pendingGenerateRequestRef.current = request;
    setCreditFallback(null);
    if (hasPaidEntitlementForAttempt) {
      await submitImageGeneration();
      return;
    }

    const queueStartResult = await startQueue({
      forceQueue: true,
    });
    if (queueStartResult.status === 'existing_other_queue') {
      router.push('/models/gpt-image-2#generator');
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
          : 'GPT Image 2 image',
        description: image.prompt?.trim()
          ? image.prompt.trim().slice(0, 180)
          : 'Generated with GPT Image 2',
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

  const buildImageToVideoHref = useCallback(
    (image: GeneratedImage) => {
      const params = new URLSearchParams();
      const sourcePrompt = image.prompt?.trim() || prompt.trim();

      if (sourcePrompt) {
        params.set(
          'prompt',
          sourcePrompt.slice(0, VIDEO_PROMPT_PREFILL_MAX_LENGTH)
        );
      }

      params.set('mode', 'image-to-video');
      params.set('first_frame_url', image.url);

      return `/ai-video?${params.toString()}`;
    },
    [prompt]
  );

  const content = (
    <div className="container">
      <div className="font-display mx-auto max-w-7xl">
        {!hideHeader && (
          <div className="mb-6 space-y-2">
            {srOnlyTitle && <h2 className="sr-only">{srOnlyTitle}</h2>}
            <h2 className="text-2xl font-semibold tracking-normal">
              {queueCopy.gptTitle}
            </h2>
            <p className="text-muted-foreground text-sm">
              {queueCopy.gptDescription}
            </p>
          </div>
        )}

        <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(500px,560px)_minmax(0,1fr)] xl:items-start">
          <Card className="overflow-hidden xl:sticky xl:top-24">
            <CardHeader className="pb-4">
              <CardTitle className="flex items-center gap-2 text-xl font-semibold">
                <Wand className="h-5 w-5" />
                {queueCopy.generateTitle}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-6 px-6 pb-8 md:px-8">
              <div className="space-y-3">
                <p className="text-muted-foreground text-xs font-semibold tracking-[0.18em] uppercase">
                  {queueCopy.modeSection}
                </p>
                <Tabs
                  value={activeTab}
                  onValueChange={(value) => {
                    setActiveTab(value as GptImageScene);
                    setGeneratedImages([]);
                    setReferenceImageItems([]);
                  }}
                >
                  <TabsList className="bg-muted grid h-12 w-full grid-cols-2">
                    <TabsTrigger
                      value="text-to-image"
                      disabled={isGenerating || isQueueActive}
                      className="h-10"
                    >
                      {t('tabs.text-to-image')}
                    </TabsTrigger>
                    <TabsTrigger
                      value="image-to-image"
                      disabled={isGenerating || isQueueActive}
                      className="h-10"
                    >
                      {t('tabs.image-to-image')}
                    </TabsTrigger>
                  </TabsList>
                </Tabs>
              </div>

              {!isTextToImageMode && (
                <div className="space-y-4 border-t pt-5">
                  <ImageUploader
                    title={t('form.reference_image')}
                    allowMultiple
                    maxImages={maxReferenceImages}
                    maxSizeMB={5}
                    onChange={setReferenceImageItems}
                    emptyHint={queueCopy.referenceImageHint}
                  />

                  {hasReferenceUploadError && (
                    <p className="text-destructive text-xs">
                      {t('form.some_images_failed_to_upload')}
                    </p>
                  )}
                </div>
              )}

              <div className="space-y-3 border-t pt-5">
                <p className="text-muted-foreground text-xs font-semibold tracking-[0.18em] uppercase">
                  {queueCopy.promptSection}
                </p>
                <Label htmlFor="gpt-image-prompt">{t('form.prompt')}</Label>
                <Textarea
                  id="gpt-image-prompt"
                  ref={promptTextareaRef}
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  placeholder={t('form.prompt_placeholder')}
                  className="min-h-48"
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
                <div className="bg-muted/25 rounded-md border p-3">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0">
                      <p className="text-sm font-medium">
                        {queueCopy.promptLibraryTitle}
                      </p>
                      <p className="text-muted-foreground mt-1 text-xs leading-5">
                        {queueCopy.promptLibraryDescription}
                      </p>
                    </div>
                    <Button
                      asChild
                      variant="outline"
                      size="sm"
                      className="w-full sm:w-auto"
                    >
                      <Link href="/prompts/gpt-image-2">
                        <BookOpen className="h-4 w-4" />
                        <span>{queueCopy.promptLibraryButton}</span>
                      </Link>
                    </Button>
                  </div>
                </div>
              </div>

              {isCheckSign ? (
                <Button className="w-full" disabled size="lg">
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  {t('checking_account')}
                </Button>
              ) : user ? (
                <Button
                  size="lg"
                  className="h-12 w-full text-base font-semibold"
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
                    (!isTextToImageMode && referenceImageUrls.length === 0) ||
                    (!isLoadingProviders &&
                      Boolean(currentSubscription) &&
                      remainingCredits < costCredits)
                  }
                >
                  {isQueueActive ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      {queueCopy.waitingButtonLabel}
                    </>
                  ) : isGenerating || isLoadingProviders || isLoadingCredits ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      {isLoadingProviders || isLoadingCredits
                        ? t('loading')
                        : t('generating')}
                    </>
                  ) : (
                    <>
                      <Sparkles className="mr-2 h-4 w-4" />
                      {queueCopy.generateButton}
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

              {user && (
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
              )}

              {!isLoadingProviders && !isProviderConfigured && (
                <div className="border-destructive/30 bg-destructive/5 text-destructive rounded-md border p-3 text-sm">
                  {queueCopy.providerNotConfigured}
                </div>
              )}

              {creditFallback && (
                <div className="border-destructive/30 bg-destructive/5 text-destructive rounded-md border p-3 text-sm">
                  {queueCopy.creditFallback}
                </div>
              )}

              {user &&
                (creditFallback ||
                  (currentSubscription && remainingCredits < costCredits)) && (
                  <Link href="/pricing">
                    <Button variant="outline" className="w-full" size="lg">
                      <CreditCard className="mr-2 h-4 w-4" />
                      {t('buy_credits')}
                    </Button>
                  </Link>
                )}

              {isGenerating ? (
                <div className="space-y-2 rounded-md border p-4">
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

          <Card className="overflow-hidden">
            <CardHeader className="pb-4">
              <div className="flex items-center justify-between gap-4">
                <CardTitle className="flex items-center gap-2 text-xl font-semibold">
                  <ImageIcon className="h-5 w-5" />
                  {t('generated_images')}
                </CardTitle>
                <div className="text-muted-foreground rounded-full border px-3 py-1 text-xs">
                  GPT Image 2
                </div>
              </div>
            </CardHeader>
            <CardContent className="px-6 pb-8 md:px-8">
              {generatedImages.length > 0 ? (
                <div className="grid grid-cols-1 gap-6">
                  {generatedImages.map((image) => (
                    <div key={image.id} className="space-y-3">
                      <div className="relative overflow-hidden rounded-md border">
                        <LazyImage
                          src={image.url}
                          alt={image.prompt || t('generated_image')}
                          className="h-auto w-full"
                        />
                        {shouldWatermarkGeneratedImages && (
                          <ImageWatermarkOverlay />
                        )}
                        <div className="absolute right-3 bottom-3 left-3 z-20 flex flex-wrap justify-end gap-2">
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
                      {shouldWatermarkGeneratedImages && (
                        <p className="text-muted-foreground text-xs leading-5">
                          {queueCopy.watermarkHint}{' '}
                          <Link
                            href="/pricing"
                            className="text-primary font-medium hover:underline"
                          >
                            {queueCopy.watermarkUpgradeLabel}
                          </Link>
                        </p>
                      )}
                      <div className="bg-muted/25 rounded-md border p-4">
                        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                          <div className="min-w-0">
                            <p className="text-sm font-medium">
                              {queueCopy.videoCtaTitle}
                            </p>
                            <p className="text-muted-foreground mt-1 text-xs leading-5">
                              {queueCopy.videoCtaDescription}
                            </p>
                          </div>
                          <Button
                            asChild
                            variant="outline"
                            size="sm"
                            className="w-full sm:w-auto"
                          >
                            <Link href={buildImageToVideoHref(image)}>
                              <Video className="h-4 w-4" />
                              <span>{queueCopy.videoCtaButton}</span>
                            </Link>
                          </Button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="bg-muted/20 relative flex min-h-[360px] flex-col justify-between overflow-hidden rounded-md border border-dashed px-6 py-6 md:min-h-[560px] xl:min-h-[640px]">
                  <div className="flex justify-end">
                    <div className="text-muted-foreground rounded-full border px-3 py-1 text-xs">
                      {isTextToImageMode
                        ? t('tabs.text-to-image')
                        : t('tabs.image-to-image')}
                    </div>
                  </div>
                  <div className="flex flex-1 flex-col items-center justify-center gap-5 py-6 text-center">
                    <div className="grid w-full max-w-sm gap-3">
                      {GPT_IMAGE_2_DEMO_EXAMPLES.map((item) => (
                        <div
                          key={item.src}
                          className="bg-background aspect-[2/3] overflow-hidden rounded-md border shadow-sm"
                        >
                          <LazyImage
                            src={item.src}
                            alt={item.alt}
                            className="h-full w-full object-cover"
                          />
                        </div>
                      ))}
                    </div>
                    {isQueueActive && queueState ? (
                      <div className="w-full max-w-md text-left">
                        <MembershipPriorityQueueCard
                          title={queueCopy.queueTitle}
                          description={queueCopy.queueDescription}
                          taskLabel={queueCopy.taskLabel}
                          remainingLabel={queueCopy.remainingLabel}
                          remainingMs={queueState.remainingMs}
                          upgradeLabel={queueCopy.upgradeLabel}
                          cancelLabel={queueCopy.cancelLabel}
                          submittingLabel={queueCopy.submittingLabel}
                          onCancel={cancelQueue}
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
                      <div>
                        <ImageIcon className="text-muted-foreground mx-auto mb-4 h-10 w-10" />
                        <p className="text-lg font-semibold">
                          {isGenerating
                            ? t('ready_to_generate')
                            : queueCopy.readyTitle}
                        </p>
                        <p className="text-muted-foreground mt-2 max-w-sm text-sm">
                          {isGenerating
                            ? queueCopy.resultHint
                            : queueCopy.readyDescription}
                        </p>
                      </div>
                    )}
                  </div>
                  <div className="text-muted-foreground flex items-center justify-between border-t pt-4 text-xs">
                    <span>GPT Image 2</span>
                    <span>
                      {isTextToImageMode
                        ? t('tabs.text-to-image')
                        : t('tabs.image-to-image')}
                    </span>
                  </div>
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
  const shareDialog = (
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
  );
  const fallbackDialog = (
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
      actions={[]}
      earnTitle={
        t.has('credit_fallback.earn_title')
          ? t('credit_fallback.earn_title')
          : 'Free ways to get credits'
      }
      earnActions={creditEarnActions}
    />
  );

  if (embedded) {
    return (
      <div id={id} className={className}>
        {content}
        {shareDialog}
        {fallbackDialog}
        <PaidDownloadDialog {...paidDownloadDialogProps} />
      </div>
    );
  }

  return (
    <section className={cn('py-16 md:py-24', className)} id={id}>
      {content}
      {shareDialog}
      {fallbackDialog}
      <PaidDownloadDialog {...paidDownloadDialogProps} />
    </section>
  );
}
