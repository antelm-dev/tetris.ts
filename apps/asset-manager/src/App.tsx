import {
  Badge,
  Box,
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
import type { AssetTypeSummary } from '../server/types'
import { AssetRow } from './AssetRow'
import { formatBytes, typeFilters, visibleItems } from './format'
import { TypeList } from './TypeList'

export function App() {
  const [types, setTypes] = useState<AssetTypeSummary[]>()
  const [failed, setFailed] = useState(false)
  const [activeId, setActiveId] = useState('')
  const [filter, setFilter] = useState('all')
  const [query, setQuery] = useState('')
  const search = useRef<HTMLInputElement>(null)

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
    document.addEventListener('keydown', focusSearch)
    return () => document.removeEventListener('keydown', focusSearch)
  }, [])

  const type = types?.find((entry) => entry.id === activeId)
  const total = types?.reduce((sum, entry) => sum + entry.count, 0)

  const selectType = (id: string): void => {
    setActiveId(id)
    setFilter(types?.find((entry) => entry.id === id)?.filters[0]?.id ?? 'all')
    setQuery('')
  }

  return (
    <Flex direction="column" minH="100dvh" bg="bg">
      <Flex as="header" align="center" gap="3" px="4" py="3" borderBottomWidth="1px">
        <Heading size="md">Asset Manager</Heading>
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
                  {type.items.some((asset) => asset.inSync === false) && (
                    <Badge colorPalette="red" title="Mirrors out of sync">
                      {type.items.filter((asset) => asset.inSync === false).length} out of sync
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
                <Text textStyle="xs" color="fg.muted">
                  {type.accept.split(',')[0].toUpperCase()} · {formatBytes(type.maxBytes)} max
                </Text>
              </Flex>

              <AssetTable type={type} filter={filter} query={query} />
            </>
          )}
        </Stack>
      </Flex>
    </Flex>
  )
}

function AssetTable({ type, filter, query }: { type: AssetTypeSummary; filter: string; query: string }) {
  const visible = visibleItems(type.items, filter, query)
  if (visible.length === 0) {
    return (
      <EmptyState.Root size="sm">
        <EmptyState.Content>
          <EmptyState.Title>{type.items.length ? 'No assets match that search.' : 'No assets yet.'}</EmptyState.Title>
        </EmptyState.Content>
      </EmptyState.Root>
    )
  }
  return (
    <Table.ScrollArea borderWidth="1px" rounded="md">
      <Table.Root size="sm" interactive>
        <Table.Header>
          <Table.Row>
            <Table.ColumnHeader>Asset</Table.ColumnHeader>
            <Table.ColumnHeader>Size</Table.ColumnHeader>
            <Table.ColumnHeader textAlign="end">Actions</Table.ColumnHeader>
          </Table.Row>
        </Table.Header>
        <Table.Body>
          {visible.map((asset) => (
            <AssetRow key={asset.name} type={type} asset={asset} />
          ))}
        </Table.Body>
      </Table.Root>
    </Table.ScrollArea>
  )
}
