import * as AvatarPrimitive from '@radix-ui/react-avatar'
import * as React from 'react'

import { avatarTone, initials as toInitials } from '@/lib/format'
import { cn } from '@/lib/utils'

const SIZES = {
  sm: 'size-7 text-[11px]',
  md: 'size-9 text-xs',
  lg: 'size-11 text-sm',
  xl: 'size-14 text-base',
} as const

interface ContactAvatarProps extends React.ComponentProps<typeof AvatarPrimitive.Root> {
  name?: string | null
  seed: string
  size?: keyof typeof SIZES
  src?: string | null
}

/** Iniciales con un tono estable por contacto: la Cloud API no expone la foto de perfil. */
function ContactAvatar({
  name,
  seed,
  src,
  size = 'md',
  className,
  ...props
}: ContactAvatarProps) {
  return (
    <AvatarPrimitive.Root
      data-slot="avatar"
      className={cn(
        'relative flex shrink-0 overflow-hidden rounded-full select-none',
        SIZES[size],
        className,
      )}
      {...props}
    >
      {src && (
        <AvatarPrimitive.Image src={src} alt="" className="aspect-square size-full object-cover" />
      )}
      <AvatarPrimitive.Fallback
        delayMs={src ? 300 : 0}
        className={cn(
          'flex size-full items-center justify-center rounded-full font-semibold tracking-tight',
          avatarTone(seed),
        )}
      >
        {toInitials(name)}
      </AvatarPrimitive.Fallback>
    </AvatarPrimitive.Root>
  )
}

export { ContactAvatar }
