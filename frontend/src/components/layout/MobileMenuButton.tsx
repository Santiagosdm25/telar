import { Menu } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { useMobileNav } from '@/lib/mobileNav'

/** Un botón, repetido en el header de cada página -- abre el sidebar como drawer. Invisible desde `lg` para arriba, donde el sidebar ya está siempre visible. */
export function MobileMenuButton() {
  const { setOpen } = useMobileNav()
  return (
    <Button
      variant="ghost"
      size="icon-sm"
      className="shrink-0 lg:hidden"
      onClick={() => setOpen(true)}
      aria-label="Abrir menú"
    >
      <Menu />
    </Button>
  )
}
