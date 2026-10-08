import { Badge, HStack, Image, Stack, Table, Text } from '@chakra-ui/react'
import type { AssetItem, AssetTypeSummary } from '../server/types'
import { assetUrl, formatBytes, friendlyName } from './format'

interface AssetRowProps {
  type: AssetTypeSummary
  asset: AssetItem
}

export function AssetRow({ type, asset }: AssetRowProps) {
  const url = assetUrl(type.id, asset)

  return (
    <Table.Row>
      <Table.Cell>
        <HStack gap="3" wrap="wrap">
          <Badge variant="surface" fontFamily="mono">
            {asset.badge}
          </Badge>
          {type.preview === 'image' && (
            <Image src={url} alt="" loading="lazy" boxSize="8" objectFit="contain" rounded="sm" bg="bg.muted" />
          )}
          <Stack gap="0" minW="0">
            <Text fontWeight="medium" truncate>
              {friendlyName(asset.name)}
            </Text>
            <Text textStyle="xs" color="fg.muted" fontFamily="mono" truncate>
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
      </Table.Cell>
      <Table.Cell textAlign="end" />
    </Table.Row>
  )
}
