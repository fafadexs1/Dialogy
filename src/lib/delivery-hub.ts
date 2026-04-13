export const DELIVERY_HUB_PROVIDER = 'delivery-hub';

export type DeliveryHubMenuItem = {
  id: string;
  name: string;
  description: string;
  price: string;
  imageUrl: string;
};

export type DeliveryHubMenuSection = {
  id: string;
  title: string;
  description: string;
  items: DeliveryHubMenuItem[];
};

export type DeliveryHubBusiness = {
  id: string;
  name: string;
  category: string;
  description: string;
  coverUrl: string;
  deliveryTime: string;
  deliveryFee: string;
  minimumOrder: string;
  orderUrl: string;
  menuSections: DeliveryHubMenuSection[];
};

export type DeliveryHubConfig = {
  title: string;
  subtitle: string;
  slug: string;
  isPublished: boolean;
  businesses: DeliveryHubBusiness[];
};

const MAX_BUSINESSES = 24;
const MAX_SECTIONS_PER_BUSINESS = 20;
const MAX_ITEMS_PER_SECTION = 40;

function toStringValue(value: unknown, maxLength: number): string {
  if (typeof value !== 'string') {
    return '';
  }

  return value.trim().slice(0, maxLength);
}

function toBooleanValue(value: unknown): boolean {
  return value === true;
}

function toId(value: unknown, fallback: string): string {
  const normalized = toStringValue(value, 80);
  return normalized || fallback;
}

export function normalizeDeliveryHubSlug(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

export function createEmptyDeliveryHubConfig(): DeliveryHubConfig {
  return {
    title: 'Vitrine Delivery',
    subtitle: 'Escolha um negocio, abra o cardapio e compartilhe com seus clientes.',
    slug: '',
    isPublished: false,
    businesses: [],
  };
}

function normalizeMenuItem(input: unknown, businessIndex: number, sectionIndex: number, itemIndex: number): DeliveryHubMenuItem {
  const item = (input && typeof input === 'object') ? input as Record<string, unknown> : {};

  return {
    id: toId(item.id, `item-${businessIndex + 1}-${sectionIndex + 1}-${itemIndex + 1}`),
    name: toStringValue(item.name, 120),
    description: toStringValue(item.description, 500),
    price: toStringValue(item.price, 40),
    imageUrl: toStringValue(item.imageUrl, 500),
  };
}

function normalizeMenuSection(input: unknown, businessIndex: number, sectionIndex: number): DeliveryHubMenuSection {
  const section = (input && typeof input === 'object') ? input as Record<string, unknown> : {};
  const itemsInput = Array.isArray(section.items) ? section.items : [];

  return {
    id: toId(section.id, `section-${businessIndex + 1}-${sectionIndex + 1}`),
    title: toStringValue(section.title, 120),
    description: toStringValue(section.description, 300),
    items: itemsInput
      .slice(0, MAX_ITEMS_PER_SECTION)
      .map((item, itemIndex) => normalizeMenuItem(item, businessIndex, sectionIndex, itemIndex))
      .filter((item) => item.name || item.description || item.price),
  };
}

function normalizeBusiness(input: unknown, businessIndex: number): DeliveryHubBusiness {
  const business = (input && typeof input === 'object') ? input as Record<string, unknown> : {};
  const sectionsInput = Array.isArray(business.menuSections) ? business.menuSections : [];

  return {
    id: toId(business.id, `business-${businessIndex + 1}`),
    name: toStringValue(business.name, 120),
    category: toStringValue(business.category, 60),
    description: toStringValue(business.description, 500),
    coverUrl: toStringValue(business.coverUrl, 500),
    deliveryTime: toStringValue(business.deliveryTime, 60),
    deliveryFee: toStringValue(business.deliveryFee, 60),
    minimumOrder: toStringValue(business.minimumOrder, 60),
    orderUrl: toStringValue(business.orderUrl, 500),
    menuSections: sectionsInput
      .slice(0, MAX_SECTIONS_PER_BUSINESS)
      .map((section, sectionIndex) => normalizeMenuSection(section, businessIndex, sectionIndex))
      .filter((section) => section.title || section.description || section.items.length > 0),
  };
}

export function normalizeDeliveryHubConfig(input: unknown): DeliveryHubConfig {
  const source = (input && typeof input === 'object') ? input as Record<string, unknown> : {};
  const businessesInput = Array.isArray(source.businesses) ? source.businesses : [];
  const defaults = createEmptyDeliveryHubConfig();

  return {
    title: toStringValue(source.title, 120) || defaults.title,
    subtitle: toStringValue(source.subtitle, 300) || defaults.subtitle,
    slug: normalizeDeliveryHubSlug(toStringValue(source.slug, 120)),
    isPublished: toBooleanValue(source.isPublished),
    businesses: businessesInput
      .slice(0, MAX_BUSINESSES)
      .map((business, businessIndex) => normalizeBusiness(business, businessIndex))
      .filter((business) => business.name || business.description || business.menuSections.length > 0),
  };
}

export type DeliveryHubVitrine = {
  id: string;
  workspaceId: string;
  title: string;
  subtitle: string;
  slug: string;
  isPublished: boolean;
  businesses: DeliveryHubBusiness[];
  createdAt: string;
  updatedAt: string;
};

export function buildDeliveryHubPublicPath(slug: string): string {
  const normalizedSlug = normalizeDeliveryHubSlug(slug);
  return normalizedSlug ? `/delivery/${normalizedSlug}` : '/delivery';
}

export function buildBusinessPublicPath(slug: string, businessId: string): string {
  const normalizedSlug = normalizeDeliveryHubSlug(slug);
  if (!normalizedSlug || !businessId) {
    return '';
  }
  return `/delivery/${normalizedSlug}/${businessId}`;
}

export function buildDeliveryHubShareUrl(baseUrl: string, slug: string): string {
  const normalizedSlug = normalizeDeliveryHubSlug(slug);
  if (!normalizedSlug) {
    return '';
  }

  const trimmedBaseUrl = baseUrl.trim().replace(/\/+$/, '');
  return `${trimmedBaseUrl}${buildDeliveryHubPublicPath(normalizedSlug)}`;
}

export function buildBusinessShareUrl(baseUrl: string, slug: string, businessId: string): string {
  const path = buildBusinessPublicPath(slug, businessId);
  if (!path) {
    return '';
  }

  const trimmedBaseUrl = baseUrl.trim().replace(/\/+$/, '');
  return `${trimmedBaseUrl}${path}`;
}
