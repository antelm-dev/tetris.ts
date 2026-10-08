import { Badge, Flex, Heading } from '@chakra-ui/react'

export function App() {
  return (
    <Flex as="header" align="center" gap="3" px="4" py="3" borderBottomWidth="1px">
      <Heading size="md">Asset Manager</Heading>
      <Badge>Local workspace</Badge>
    </Flex>
  )
}
