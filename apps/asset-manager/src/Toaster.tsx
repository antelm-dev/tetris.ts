import { Toaster as ChakraToaster, Portal, Toast, createToaster } from '@chakra-ui/react'

export const toaster = createToaster({ placement: 'bottom-end', pauseOnPageIdle: true })

export function notify(description: string, type: 'success' | 'error'): void {
  toaster.create({ description, type, closable: true })
}

export function Toaster() {
  return (
    <Portal>
      <ChakraToaster toaster={toaster} insetInline={{ mdDown: '4' }}>
        {(toast) => (
          <Toast.Root width={{ md: 'sm' }}>
            <Toast.Indicator />
            <Toast.Description flex="1">{toast.description}</Toast.Description>
            {toast.closable && <Toast.CloseTrigger />}
          </Toast.Root>
        )}
      </ChakraToaster>
    </Portal>
  )
}
