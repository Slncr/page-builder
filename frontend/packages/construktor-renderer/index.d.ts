import type {
  ComponentType,
  ReactElement,
  ReactNode,
} from 'react';

export interface ConstruktorBlock {
  id: string;
  type: string;
  version?: string;
  parentId?: string | null;
  props: Record<string, unknown>;
  children?: ConstruktorBlock[];
  slots?: Record<string, ConstruktorBlock[]>;
  integrationSlot?: string;
  requiredIntegrationSlot?: string | boolean;
  integrationRequired?: boolean;
  integration?: {
    name?: string;
    slot?: string;
    required?: boolean;
  };
}

export interface NormalizedContent {
  byId: Record<string, ConstruktorBlock>;
  rootOrder: string[];
  childrenByParent: Record<string, string[]>;
}

export interface RendererDocument {
  id?: string;
  title?: string;
  slug?: string;
  routePath?: string;
  path?: string;
  locale?: string;
  content?: NormalizedContent;
  document?: RendererDocument | {
    blocks?: ConstruktorBlock[];
    [key: string]: unknown;
  };
  blocks?: ConstruktorBlock[];
  page?: RendererDocument;
  [key: string]: unknown;
}

export interface AssetResolverContext {
  block?: ConstruktorBlock;
  purpose?: string;
  document?: RendererDocument;
}

export type AssetResolver = (
  assetId: string,
  context?: AssetResolverContext,
) => string;

export interface FormSubmission {
  data: Record<string, FormDataEntryValue>;
  website?: string;
  startedAt?: string;
}

export interface FormSubmissionContext {
  action?: string;
  formId?: string;
  block?: ConstruktorBlock;
  document?: RendererDocument;
}

export interface FormSubmissionResult {
  message?: string;
  redirectUrl?: string;
  [key: string]: unknown;
}

export type FormSubmitter = (
  submission: FormSubmission,
  context?: FormSubmissionContext,
) => Promise<FormSubmissionResult | void>;

export interface LinkResolverContext {
  block?: ConstruktorBlock;
  purpose?: string;
  fallback?: string;
  document?: RendererDocument;
}

export interface ResolvedLink {
  href: string;
  target?: string;
  rel?: string;
  [key: string]: unknown;
}

export type LinkResolver = (
  value: string,
  context?: LinkResolverContext,
) => string | ResolvedLink;

export interface IntegrationSlotProps {
  block: ConstruktorBlock;
  document: RendererDocument;
  children?: ReactNode;
  assetResolver: AssetResolver;
  formSubmitter: FormSubmitter;
  linkResolver: LinkResolver;
  integrationSlots: IntegrationSlots;
}

export type IntegrationSlotComponent = ComponentType<IntegrationSlotProps>;

export interface IntegrationSlotDefinition {
  component?: IntegrationSlotComponent;
  render?: IntegrationSlotComponent;
  required?: boolean;
}

export type IntegrationSlots = Record<
  string,
  IntegrationSlotComponent | IntegrationSlotDefinition | ReactElement
>;

export interface IntegrationAdapters {
  assetResolver: AssetResolver;
  formSubmitter: FormSubmitter;
  linkResolver: LinkResolver;
  integrationSlots: IntegrationSlots;
}

export interface CreateIntegrationAdaptersOptions {
  apiBaseUrl?: string;
  basePath?: string;
  fetchImpl?: typeof fetch;
}

export interface PublicRendererProps {
  document?: RendererDocument;
  /** @deprecated Use document. */
  page?: RendererDocument;
  assetResolver?: AssetResolver;
  formSubmitter?: FormSubmitter;
  linkResolver?: LinkResolver;
  integrationSlots?: IntegrationSlots;
  className?: string;
  editor?: boolean;
  onError?: (error: Error, info: unknown) => void;
}

export class MissingIntegrationSlotError extends Error {
  slotName: string;
  blockId?: string;
}

export function PublicRenderer(props: PublicRendererProps): ReactElement;
export const ConstruktorRenderer: typeof PublicRenderer;
export default PublicRenderer;

export function normalizeRendererDocument(value: RendererDocument): NormalizedContent;
export function createIntegrationAdapters(
  options?: CreateIntegrationAdaptersOptions,
): IntegrationAdapters;

export const defaultIntegrationAdapters: Readonly<IntegrationAdapters>;
export const defaultAssetResolver: AssetResolver;
export const defaultFormSubmitter: FormSubmitter;
export const defaultLinkResolver: LinkResolver;
export const defaultIntegrationSlots: Readonly<IntegrationSlots>;

export function safeMediaUrl(value?: unknown): string;
export function safeNavigationUrl(value?: unknown, fallback?: string): string;
export function sanitizeHtml(value?: string): string;
export const INTERACTIVE_BLOCK_TYPES: Set<string>;
export function isInteractiveBlock(type: string): boolean;

export function StaticBlock(props: {
  block: ConstruktorBlock;
  document?: RendererDocument;
  adapters: IntegrationAdapters;
  children?: ReactNode;
}): ReactElement | null;

export function InteractiveBlock(props: {
  block: ConstruktorBlock;
  document?: RendererDocument;
  adapters: IntegrationAdapters;
}): ReactElement | null;
