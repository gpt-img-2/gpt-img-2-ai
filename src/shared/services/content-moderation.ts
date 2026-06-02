import { Configs } from '@/shared/models/config';

export const CREEM_PROMPT_MODERATION_REJECTED_MESSAGE =
  'Your prompt could not be processed. Please revise and try again.';

export const CREEM_PROMPT_MODERATION_UNAVAILABLE_MESSAGE =
  'Prompt moderation is temporarily unavailable. Please try again.';

type CreemModerationDecision = 'allow' | 'deny' | 'flag';

export interface CreemPromptModerationResult {
  provider: 'creem';
  id?: string;
  decision: CreemModerationDecision;
  externalId?: string;
  usageUnits?: number;
}

export class PromptModerationDecisionError extends Error {
  result: CreemPromptModerationResult;

  constructor(result: CreemPromptModerationResult) {
    super(CREEM_PROMPT_MODERATION_REJECTED_MESSAGE);
    this.name = 'PromptModerationDecisionError';
    this.result = result;
  }
}

export class PromptModerationServiceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PromptModerationServiceError';
  }
}

function getCreemModerationBaseUrl(configs: Configs) {
  return configs.creem_environment === 'production'
    ? 'https://api.creem.io'
    : 'https://test-api.creem.io';
}

function isCreemModerationDecision(
  value: unknown
): value is CreemModerationDecision {
  return value === 'allow' || value === 'deny' || value === 'flag';
}

function getUsageUnits(value: unknown) {
  if (!value || typeof value !== 'object') {
    return undefined;
  }

  const units = (value as Record<string, unknown>).units;
  return typeof units === 'number' && Number.isFinite(units)
    ? units
    : undefined;
}

export function isCreemPromptModerationEnabled(configs: Configs) {
  return configs.creem_moderation_enabled === 'true';
}

export function isCreemPromptModerationFailClosed(configs: Configs) {
  return configs.creem_moderation_fail_closed !== 'false';
}

export async function screenPromptWithCreem({
  configs,
  prompt,
  externalId,
  timeoutMs = 5000,
}: {
  configs: Configs;
  prompt: string;
  externalId?: string;
  timeoutMs?: number;
}): Promise<CreemPromptModerationResult> {
  const apiKey = configs.creem_api_key?.trim();
  if (!apiKey) {
    throw new PromptModerationServiceError(
      'Creem moderation API key is not configured'
    );
  }

  const trimmedPrompt = prompt.trim();
  if (!trimmedPrompt) {
    throw new PromptModerationServiceError('Prompt is empty');
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(
      `${getCreemModerationBaseUrl(configs)}/v1/moderation/prompt`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
        },
        body: JSON.stringify({
          prompt: trimmedPrompt,
          external_id: externalId,
        }),
        cache: 'no-store',
        signal: controller.signal,
      }
    );

    if (!response.ok) {
      throw new PromptModerationServiceError(
        `Creem moderation request failed with status: ${response.status}`
      );
    }

    const payload = (await response.json()) as Record<string, unknown>;
    const decision = payload.decision;
    if (!isCreemModerationDecision(decision)) {
      throw new PromptModerationServiceError(
        'Creem moderation returned an invalid decision'
      );
    }

    return {
      provider: 'creem',
      id: typeof payload.id === 'string' ? payload.id : undefined,
      decision,
      externalId:
        typeof payload.external_id === 'string'
          ? payload.external_id
          : externalId,
      usageUnits: getUsageUnits(payload.usage),
    };
  } catch (error) {
    if (
      error instanceof PromptModerationServiceError ||
      error instanceof PromptModerationDecisionError
    ) {
      throw error;
    }

    const message =
      error instanceof Error
        ? error.message
        : 'Creem moderation request failed';
    throw new PromptModerationServiceError(message);
  } finally {
    clearTimeout(timeout);
  }
}

export async function ensureCreemPromptAllowed({
  configs,
  prompt,
  externalId,
}: {
  configs: Configs;
  prompt: string;
  externalId?: string;
}) {
  const result = await screenPromptWithCreem({
    configs,
    prompt,
    externalId,
  });

  if (result.decision !== 'allow') {
    throw new PromptModerationDecisionError(result);
  }

  return result;
}
