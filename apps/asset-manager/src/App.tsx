import {
  Badge,
  Box,
  Button,
  EmptyState,
  Flex,
  HStack,
  Heading,
  Input,
  InputGroup,
  Kbd,
  SegmentGroup,
  Spacer,
  Spinner,
  Stack,
  Table,
  Text
} from '@chakra-ui/react'
import { useEffect, useRef, useState } from 'react'
import type { AssetItem, AssetTypeSummary } from '../server/types'
import { AssetRow } from './AssetRow'
import { player } from './audio'
import {
  assetEndpoint,
  assetUrl,
  formatBytes,
  friendlyName,
  hasAcceptedExtension,
  typeFilters,
  visibleItems
} from './format'
import { Toaster, notify } from './Toaster'
import { TypeList } from './TypeList'

function failure(error: unknown, fallback: string): void {
  notify(error instanceof Error ? error.message : fallback, 'error')
}

async function upload(type: AssetTypeSummary, name: string, file: File, method: 'POST' | 'PUT'): Promise<AssetItem> {
  const response = await fetch(assetEndpoint(type.id, name), {
    method,
    headers: { 'content-type': file.type || 'application/octet-stream' },
    body: file
  })
  const payload = (await response.json().catch(() => ({}))) as { asset?: AssetItem; error?: string }
  if (!response.ok || !payload.asset) {
    throw new Error(payload.error ?? (method === 'PUT' ? 'The replacement failed.' : 'The upload failed.'))
  }
  return payload.asset
}

export function App() {
  const [types, setTypes] = useState<AssetTypeSummary[]>()
  const [failed, setFailed] = useState(false)
  const [activeId, setActiveId] = useState('')
  const [filter, setFilter] = useState('all')
  const [query, setQuery] = useState('')
  const [playing, setPlaying] = useState<string>()
  const [busy, setBusy] = useState<string[]>([])
  const [adding, setAdding] = useState(false)
  const search = useRef<HTMLInputElement>(null)
  const picker = useRef<HTMLInputElement>(null)
  const replaceTarget = useRef<string>(undefined)

  useEffect(() => {
    fetch('/api/assets', { cache: 'no-store' })
      .then(async (response) => {
        if (!response.ok) throw new Error('Asset catalogue request failed')
        const payload = (await response.json()) as { types: AssetTypeSummary[] }
        setTypes(payload.types)
        setActiveId(payload.types[0]?.id ?? '')
        setFilter(payload.types[0]?.filters[0]?.id ?? 'all')
      })
      .catch(() => setFailed(true))
  }, [])

  useEffect(() => {
    const focusSearch = (event: KeyboardEvent): void => {
      if (event.key === '/' && document.activeElement !== search.current) {
        event.preventDefault()
        search.current?.focus()
      }
    }
    // A pause queued by switching src arrives after play() has unpaused the player; ignore it.
    const stopped = (): void => {
      if (player.paused) setPlaying(undefined)
    }
    const failed = (): void => {
      setPlaying(undefined)
      notify('This asset could not be played.', 'error')
    }
    document.addEventListener('keydown', focusSearch)
    player.addEventListener('pause', stopped)
    player.addEventListener('ended', stopped)
    player.addEventListener('error', failed)
    return () => {
      document.removeEventListener('keydown', focusSearch)
      player.removeEventListener('pause', stopped)
      player.removeEventListener('ended', stopped)
      player.removeEventListener('error', failed)
    }
  }, [])

  const type = types?.find((entry) => entry.id === activeId)
  const total = types?.reduce((sum, entry) => sum + entry.count, 0)
  const visible = type ? visibleItems(type.items, filter, query) : []
  const drifted = type?.items.filter((asset) => asset.inSync === false).length ?? 0

  const selectType = (id: string): void => {
    setActiveId(id)
    setFilter(types?.find((entry) => entry.id === id)?.filters[0]?.id ?? 'all')
    setQuery('')
    player.pause()
  }

  const updateItems = (typeId: string, change: (items: AssetItem[]) => AssetItem[]): void => {
    setTypes((current) =>
      current?.map((entry) => {
        if (entry.id !== typeId) return entry
        const items = change(entry.items)
        return { ...entry, items, count: items.length }
      })
    )
  }

  // Keyed by type and name: the same filename can exist under several types.
  const setRowBusy = (type: AssetTypeSummary, name: string, value: boolean): void => {
    const key = `${type.id}/${name}`
    setBusy((current) => (value ? [...current, key] : current.filter((entry) => entry !== key)))
  }

  const accepts = (type: AssetTypeSummary, file: File): boolean => {
    if (hasAcceptedExtension(type.accept, file.name)) return true
    notify(`Choose a supported ${type.singular} file.`, 'error')
    return false
  }

  const togglePlayback = (url: string): void => {
    if (playing === url && !player.paused) {
      player.pause()
      return
    }
    setPlaying(url)
    player.src = url
    player.play().catch((error: unknown) => {
      // Stopping or switching tracks before playback starts aborts the pending play().
      if (error instanceof DOMException && error.name === 'AbortError') return
      setPlaying(undefined)
      // A media error has already been reported by the player's `error` listener.
      if (!player.error) notify('This asset could not be played.', 'error')
    })
  }

  const replaceAsset = async (type: AssetTypeSummary, name: string, file: File): Promise<void> => {
    if (!accepts(type, file)) return
    setRowBusy(type, name, true)
    try {
      const asset = await upload(type, name, file, 'PUT')
      updateItems(type.id, (items) => items.map((entry) => (entry.name === name ? asset : entry)))
      notify(`${friendlyName(name)} replaced successfully.`, 'success')
    } catch (error) {
      failure(error, 'The replacement failed.')
    } finally {
      setRowBusy(type, name, false)
    }
  }

  const addAsset = async (type: AssetTypeSummary, file: File): Promise<void> => {
    if (!accepts(type, file)) return
    setAdding(true)
    try {
      const asset = await upload(type, file.name, file, 'POST')
      updateItems(type.id, (items) => [...items, asset].sort((a, b) => a.name.localeCompare(b.name)))
      notify(`${friendlyName(file.name)} added successfully.`, 'success')
    } catch (error) {
      failure(error, 'The upload failed.')
    } finally {
      setAdding(false)
    }
  }

  const deleteAsset = async (type: AssetTypeSummary, name: string): Promise<void> => {
    if (!window.confirm(`Delete ${name} from every configured copy?`)) return
    setRowBusy(type, name, true)
    try {
      const response = await fetch(assetEndpoint(type.id, name), { method: 'DELETE' })
      if (!response.ok) {
        const payload = (await response.json().catch(() => ({}))) as { error?: string }
        throw new Error(payload.error ?? 'The deletion failed.')
      }
      updateItems(type.id, (items) => items.filter((entry) => entry.name !== name))
      notify(`${friendlyName(name)} deleted.`, 'success')
    } catch (error) {
      failure(error, 'The deletion failed.')
    } finally {
      setRowBusy(type, name, false)
    }
  }

  const pick = (target: string | undefined): void => {
    replaceTarget.current = target
    picker.current?.click()
  }

  return (
    <Flex direction="column" minH="100dvh" bg="bg">
      <Flex as="header" align="center" gap="3" px="4" py="3" borderBottomWidth="1px" wrap="wrap">
        <Heading size="md" whiteSpace="nowrap">
          Asset Manager
        </Heading>
        <Badge variant="outline">Local workspace</Badge>
        <Spacer />
        <Text textStyle="sm" color="fg.muted" aria-live="polite">
          {total ?? '—'} managed assets
        </Text>
      </Flex>

      <Flex direction={{ base: 'column', md: 'row' }} flex="1" minH="0">
        <Box
          as="aside"
          w={{ md: '56' }}
          flexShrink="0"
          p="3"
          borderBottomWidth={{ base: '1px', md: '0' }}
          borderEndWidth={{ md: '1px' }}
        >
          {failed ? (
            <Text color="fg.error" textStyle="sm" px="3">
              Catalogue unavailable
            </Text>
          ) : types ? (
            <TypeList types={types} activeId={activeId} onSelect={selectType} />
          ) : (
            <Spinner size="sm" m="3" />
          )}
        </Box>

        <Stack as="main" flex="1" minW="0" p={{ base: '3', md: '5' }} gap="4">
          {failed ? (
            <EmptyState.Root>
              <EmptyState.Content>
                <EmptyState.Title>Could not load game assets.</EmptyState.Title>
                <EmptyState.Description>Start the asset manager and try again.</EmptyState.Description>
              </EmptyState.Content>
            </EmptyState.Root>
          ) : !type ? (
            <HStack color="fg.muted">
              <Spinner size="sm" /> <Text>Loading asset catalogue…</Text>
            </HStack>
          ) : (
            <>
              <Flex align="start" gap="3" wrap="wrap">
                <Stack gap="1" flex="1" minW="0">
                  <Heading size="lg">{type.label}</Heading>
                  <Text textStyle="sm" color="fg.muted">
                    {type.description}
                  </Text>
                </Stack>
                <HStack>
                  {drifted > 0 && (
                    <Badge colorPalette="red" title="Mirrors out of sync">
                      {drifted} out of sync
                    </Badge>
                  )}
                  <Badge size="lg">{type.count}</Badge>
                </HStack>
              </Flex>

              <Flex gap="3" wrap="wrap" align="center">
                <InputGroup flex="1" minW="48" endElement={<Kbd size="sm">/</Kbd>}>
                  <Input
                    ref={search}
                    type="search"
                    size="sm"
                    placeholder="Search assets…"
                    aria-label="Search assets"
                    autoComplete="off"
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Escape') setQuery('')
                    }}
                  />
                </InputGroup>
                <SegmentGroup.Root
                  size="sm"
                  value={filter}
                  onValueChange={(details) => setFilter(details.value ?? 'all')}
                  aria-label="Filter assets"
                >
                  <SegmentGroup.Indicator />
                  <SegmentGroup.Items
                    items={typeFilters(type).map((entry) => ({ value: entry.id, label: entry.label }))}
                  />
                </SegmentGroup.Root>
                <Button size="sm" loading={adding} onClick={() => pick(undefined)}>
                  + Add
                </Button>
                <Text textStyle="xs" color="fg.muted">
                  {type.accept.split(',')[0].replace(/^\./, '').toUpperCase()} · {formatBytes(type.maxBytes)} max
                </Text>
              </Flex>

              <input
                ref={picker}
                type="file"
                hidden
                accept={type.accept}
                onChange={(event) => {
                  const file = event.target.files?.[0]
                  const target = replaceTarget.current
                  event.target.value = ''
                  if (!file) return
                  if (target) void replaceAsset(type, target, file)
                  else void addAsset(type, file)
                }}
              />

              {visible.length === 0 ? (
                <EmptyState.Root size="sm">
                  <EmptyState.Content>
                    <EmptyState.Title>
                      {type.items.length ? 'No assets match that search.' : 'No assets yet.'}
                    </EmptyState.Title>
                  </EmptyState.Content>
                </EmptyState.Root>
              ) : (
                // Drops between rows must not make the browser navigate to the file.
                <Table.ScrollArea
                  borderWidth="1px"
                  rounded="md"
                  aria-live="polite"
                  onDragOver={(event) => event.preventDefault()}
                  onDrop={(event) => event.preventDefault()}
                >
                  <Table.Root size="sm" interactive>
                    <Table.Header>
                      <Table.Row>
                        <Table.ColumnHeader>Asset</Table.ColumnHeader>
                        <Table.ColumnHeader>Size</Table.ColumnHeader>
                        <Table.ColumnHeader textAlign="end">Actions</Table.ColumnHeader>
                      </Table.Row>
                    </Table.Header>
                    <Table.Body>
                      {visible.map((asset) => {
                        const url = assetUrl(type.id, asset)
                        return (
                          <AssetRow
                            key={url}
                            type={type}
                            asset={asset}
                            playing={playing === url}
                            busy={busy.includes(`${type.id}/${asset.name}`)}
                            onPlay={() => togglePlayback(url)}
                            onReplace={() => pick(asset.name)}
                            onDropFiles={(files) => {
                              if (files.length > 1) notify(`Drop a single ${type.singular} file.`, 'error')
                              else void replaceAsset(type, asset.name, files[0])
                            }}
                            onDelete={() => void deleteAsset(type, asset.name)}
                          />
                        )
                      })}
                    </Table.Body>
                  </Table.Root>
                </Table.ScrollArea>
              )}
            </>
          )}
        </Stack>
      </Flex>
      <Toaster />
    </Flex>
  )
}
