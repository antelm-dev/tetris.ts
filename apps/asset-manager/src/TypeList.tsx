import { Badge, Button, Stack, Text } from '@chakra-ui/react'
import type { AssetTypeSummary } from '../server/types'

interface TypeListProps {
  types: AssetTypeSummary[]
  activeId: string
  onSelect: (id: string) => void
}

export function TypeList({ types, activeId, onSelect }: TypeListProps) {
  return (
    <Stack as="nav" aria-label="Asset types" direction={{ base: 'row', md: 'column' }} gap="1" wrap="wrap">
      <Text textStyle="xs" color="fg.muted" fontWeight="medium" px="3" py="1" hideBelow="md">
        Asset types
      </Text>
      {types.map((type) => {
        const active = type.id === activeId
        return (
          <Button
            key={type.id}
            variant={active ? 'subtle' : 'ghost'}
            size="sm"
            justifyContent="space-between"
            aria-current={active ? 'page' : undefined}
            onClick={() => onSelect(type.id)}
          >
            {type.label}
            <Badge variant={active ? 'solid' : 'outline'} size="sm">
              {type.count}
            </Badge>
          </Button>
        )
      })}
    </Stack>
  )
}
