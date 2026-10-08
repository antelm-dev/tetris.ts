import { Badge, Button, HStack, IconButton, Image, Stack, Table, Text } from '@chakra-ui/react'
import { useEffect, useState } from 'react'
import type { AssetItem, AssetTypeSummary } from '../server/types'
import { knownDuration, loadDuration } from './audio'
import { assetUrl, formatBytes, formatDuration, friendlyName } from './format'

interface AssetRowProps {
  type: AssetTypeSummary
  asset: AssetItem
  playing: boolean
  busy: boolean
  onPlay: () => void
  onReplace: () => void
  onDropFiles: (files: FileList) => void
  onDelete: () => void
}

/** Key rows by asset URL so a replaced file remounts and is probed again. */
export function AssetRow({ type, asset, playing, busy, onPlay, onReplace, onDropFiles, onDelete }: AssetRowProps) {
  const url = assetUrl(type.id, asset)
  const label = friendlyName(asset.name)
  const audio = type.preview === 'audio'
  const [duration, setDuration] = useState<number>()
  const [dropTarget, setDropTarget] = useState(false)

  // Durations are probed lazily (first hover or Play); mounting only reuses lookups already made.
  const showDuration = (): void => void loadDuration(url).then(setDuration)
  useEffect(() => void knownDuration(url)?.then(setDuration), [url])

  return (
    <Table.Row
      aria-busy={busy}
      opacity={busy ? 0.5 : undefined}
      pointerEvents={busy ? 'none' : undefined}
      bg={dropTarget ? 'bg.emphasized' : undefined}
      onPointerEnter={audio && duration === undefined ? showDuration : undefined}
      onDragOver={(event) => {
        event.preventDefault()
        setDropTarget(true)
      }}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDropTarget(false)
      }}
      onDrop={(event) => {
        event.preventDefault()
        setDropTarget(false)
        if (event.dataTransfer.files.length) onDropFiles(event.dataTransfer.files)
      }}
    >
      <Table.Cell whiteSpace="normal">
        <HStack gap="3" wrap="wrap">
          <Badge variant="surface" fontFamily="mono">
            {asset.badge}
          </Badge>
          {type.preview === 'image' && (
            <Image src={url} alt="" loading="lazy" boxSize="8" objectFit="contain" rounded="sm" bg="bg.muted" />
          )}
          <Stack gap="0" minW="0">
            <Text fontWeight="medium">{label}</Text>
            <Text textStyle="xs" color="fg.muted" fontFamily="mono" wordBreak="break-all">
              {asset.name}
            </Text>
          </Stack>
          {asset.used === false && <Badge colorPalette="gray">Unused</Badge>}
          {asset.modified === true && <Badge colorPalette="yellow">Modified</Badge>}
          {asset.inSync === false && <Badge colorPalette="red">Out of sync</Badge>}
        </HStack>
      </Table.Cell>
      <Table.Cell whiteSpace="nowrap" color="fg.muted">
        {formatBytes(asset.bytes)}
        {duration !== undefined && (
          <Text as="span" display="block" textStyle="xs">
            {formatDuration(duration)}
          </Text>
        )}
      </Table.Cell>
      <Table.Cell>
        <Stack direction={{ base: 'column', sm: 'row' }} gap="1" justify="end" align="end">
          {audio && (
            <Button
              size="xs"
              variant={playing ? 'solid' : 'outline'}
              aria-label={`${playing ? 'Stop' : 'Play'} ${label}`}
              onClick={() => {
                showDuration()
                onPlay()
              }}
            >
              {/* U+FE0E keeps ▶ a text glyph instead of an emoji. */}
              {playing ? '■ Stop' : '▶︎ Play'}
            </Button>
          )}
          <Button size="xs" variant="outline" aria-label={`Replace ${label}`} onClick={onReplace}>
            ↥ Replace
          </Button>
          <IconButton
            size="xs"
            variant="ghost"
            colorPalette="red"
            aria-label={`Delete ${label}`}
            title="Delete"
            onClick={onDelete}
          >
            ✕
          </IconButton>
        </Stack>
      </Table.Cell>
    </Table.Row>
  )
}
