export interface AssetItem {
  name: string
  bytes: number
  updatedAt: string
  filter: string
  badge: string
  /** Whether the usage source cites this asset; omitted when the type has no usage source. */
  used?: boolean
  /** Whether git reports uncommitted changes to the source or any mirror. */
  modified?: boolean
  /** Whether every mirror matches the source byte for byte; omitted when the type has no mirrors. */
  inSync?: boolean
}

export interface AssetFilter {
  id: string
  label: string
}

export interface AssetTypeDefinition {
  id: string
  label: string
  singular: string
  description: string
  sourceDir: string
  mirrors: string[]
  extensions: string[]
  accept: string
  contentType: string
  preview: 'audio' | 'image' | 'none'
  maxBytes: number
  filters: AssetFilter[]
  /** File whose text cites asset filenames; used to flag unused assets. */
  usageSource?: string
  classify?: (name: string) => string
  badge?: (name: string) => string
  /** Returns an error message when the contents are not acceptable. */
  validate?: (contents: Buffer) => string | undefined
}

export type AssetTypeSummary = Pick<
  AssetTypeDefinition,
  'id' | 'label' | 'singular' | 'description' | 'accept' | 'preview' | 'maxBytes' | 'filters'
> & {
  count: number
  items: AssetItem[]
}
