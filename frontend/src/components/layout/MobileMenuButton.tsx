import { Menu } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { useMobileNav } from '@/lib/mobileNav'

/** Abre el sidebar como drawer; oculto desde `lg`, donde el sidebar siempre está visible. */
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
