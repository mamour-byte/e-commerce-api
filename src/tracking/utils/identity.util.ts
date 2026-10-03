import { createHash } from 'node:crypto';
import { TrafficPlatform } from '@prisma/client';

export interface HashedIdentity {
  emailHash?: string;
  phoneHash?: string;
  firstName?: string;
  lastName?: string;
  city?: string;
  country?: string;
}

export function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function normalizePhone(phone: string): string {
  const trimmed = phone.trim();
  const hasPlus = trimmed.startsWith('+') || trimmed.startsWith('00');
  const digits = trimmed.replace(/\D/g, '');
  if (!digits) {
    return '';
  }
  return hasPlus ? `+${digits}` : digits;
}

export function hashEmail(email: string): string | undefined {
  const normalized = normalizeEmail(email);
  return normalized ? sha256(normalized) : undefined;
}

export function hashPhone(phone: string): string | undefined {
  const normalized = normalizePhone(phone);
  return normalized ? sha256(normalized) : undefined;
}

export function buildIdentity(input: {
  email?: string | null;
  phone?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  city?: string | null;
  country?: string | null;
}): HashedIdentity {
  const identity: HashedIdentity = {};

  const emailHash = input.email ? hashEmail(input.email) : undefined;
  if (emailHash) {
    identity.emailHash = emailHash;
  }

  const phoneHash = input.phone ? hashPhone(input.phone) : undefined;
  if (phoneHash) {
    identity.phoneHash = phoneHash;
  }

  if (input.firstName?.trim()) {
    identity.firstName = input.firstName.trim().toLowerCase();
  }
  if (input.lastName?.trim()) {
    identity.lastName = input.lastName.trim().toLowerCase();
  }
  if (input.city?.trim()) {
    identity.city = input.city.trim().toLowerCase();
  }
  if (input.country?.trim()) {
    identity.country = input.country.trim().toUpperCase();
  }

  return identity;
}

export interface ClickIdBundle {
  fbclid?: string | null;
  gclid?: string | null;
  gbraid?: string | null;
  wbraid?: string | null;
  ttclid?: string | null;
  msclkid?: string | null;
  clickId?: string | null;
  clickIdType?: string | null;
}

export interface PlatformResolution {
  platform: TrafficPlatform;
  clickId?: string;
  clickIdType?: string;
  campaignKey?: string;
}

const SEARCH_ENGINES = [
  'google.',
  'bing.com',
  'duckduckgo.com',
  'search.yahoo',
  'yandex.',
  'ecosia.org',
  'brave.com',
  'qwant.com',
  'startpage.com',
  'baidu.com',
  'search.marcia',
];

const SOURCE_HINTS: Record<string, TrafficPlatform> = {
  facebook: TrafficPlatform.META,
  instagram: TrafficPlatform.META,
  messenger: TrafficPlatform.META,
  google: TrafficPlatform.GOOGLE,
  tiktok: TrafficPlatform.TIKTOK,
  snapchat: TrafficPlatform.TIKTOK,
  whatsapp: TrafficPlatform.WHATSAPP,
  email: TrafficPlatform.EMAIL,
  newsletter: TrafficPlatform.EMAIL,
  wa: TrafficPlatform.WHATSAPP,
};

const PAID_MEDIUMS = new Set([
  'cpc',
  'paid',
  'paidsearch',
  'paidsocial',
  'ppc',
  'display',
  'paid_solutions',
  'paidsocial_traffic',
]);

export function normalizeUtmValue(value?: string | null): string | undefined {
  if (!value) {
    return undefined;
  }
  const trimmed = value.trim().toLowerCase();
  return trimmed.length ? trimmed : undefined;
}

function hostFromReferrer(referrer?: string | null): string | undefined {
  if (!referrer) {
    return undefined;
  }
  try {
    return new URL(referrer).hostname.toLowerCase();
  } catch {
    return undefined;
  }
}

export function resolvePlatform(input: {
  fbclid?: string | null;
  gclid?: string | null;
  gbraid?: string | null;
  wbraid?: string | null;
  ttclid?: string | null;
  msclkid?: string | null;
  utmSource?: string | null;
  utmMedium?: string | null;
  utmCampaign?: string | null;
  referrer?: string | null;
}): PlatformResolution {
  const clickIds: Array<[string | null | undefined, string]> = [
    [input.fbclid, 'FBCLID'],
    [input.gclid, 'GCLID'],
    [input.gbraid, 'GBRAID'],
    [input.wbraid, 'WBRAID'],
    [input.ttclid, 'TTCLID'],
    [input.msclkid, 'MSCLKID'],
  ];

  for (const [value, type] of clickIds) {
    if (value) {
      return {
        platform:
          type === 'TTCLID' ? TrafficPlatform.TIKTOK : TrafficPlatform.GOOGLE,
        clickId: value,
        clickIdType: type,
        campaignKey: normalizeUtmValue(input.utmCampaign),
      };
    }
  }

  const campaignKey = normalizeUtmValue(input.utmCampaign);
  const medium = normalizeUtmValue(input.utmMedium);
  const source = normalizeUtmValue(input.utmSource);
  const host = hostFromReferrer(input.referrer);

  if (source) {
    const hinted = SOURCE_HINTS[source];
    if (hinted && PAID_MEDIUMS.has(medium || '')) {
      return {
        platform: hinted,
        campaignKey,
      };
    }
    if (source === 'organic' || (source === 'google' && medium === 'organic')) {
      return { platform: TrafficPlatform.ORGANIC, campaignKey };
    }
  }

  if (host) {
    if (SEARCH_ENGINES.some((engine) => host.includes(engine))) {
      return { platform: TrafficPlatform.ORGANIC, campaignKey };
    }
    if (host.includes('facebook.') || host.includes('instagram.')) {
      return { platform: TrafficPlatform.META, campaignKey };
    }
    if (host.includes('tiktok.')) {
      return { platform: TrafficPlatform.TIKTOK, campaignKey };
    }
    if (host === 'wa.me' || host.includes('whatsapp.')) {
      return { platform: TrafficPlatform.WHATSAPP, campaignKey };
    }
    return { platform: TrafficPlatform.REFERRAL, campaignKey };
  }

  if (source === 'email' || source === 'newsletter') {
    return { platform: TrafficPlatform.EMAIL, campaignKey };
  }

  if (!input.referrer && !source && !medium) {
    return { platform: TrafficPlatform.DIRECT, campaignKey };
  }

  return { platform: TrafficPlatform.UNKNOWN, campaignKey };
}

export function parseDevice(userAgent?: string | null): string | undefined {
  if (!userAgent) {
    return undefined;
  }
  const ua = userAgent.toLowerCase();
  if (ua.includes('ipad') || ua.includes('tablet')) {
    return 'tablet';
  }
  if (ua.includes('mobi')) {
    return 'mobile';
  }
  return 'desktop';
}

export function normalizeSearchTerm(query: string): string {
  return query.trim().toLowerCase().replace(/\s+/g, ' ').slice(0, 120);
}
