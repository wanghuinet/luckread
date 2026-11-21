'use client'

import { Button } from '@payloadcms/ui/elements/Button'
import type { ComponentProps } from 'react'

type Props = Omit<ComponentProps<typeof Button>, 'buttonStyle' | 'size' | 'margin'> & {
  tone?: 'primary' | 'secondary' | 'error' | 'subtle' | 'transparent' | 'tab'
}

export default function CreatorActionButton({ tone = 'secondary', ...props }: Props) {
  return <Button {...props} buttonStyle={tone} size="small" margin={false} />
}
