import { AnimatePresence, MotionConfig, motion } from 'framer-motion'
import * as React from 'react'

import { cn } from '@/lib/utils'

/**
 * Patrón "rail": colapsado a los iconos, se abre encima del contenido sin empujarlo.
 * `pinned` lo deja abierto y en flujo.
 */

export const RAIL_WIDTH = 60
export const EXPANDED_WIDTH = 232

const TRANSITION = { duration: 0.2, ease: [0.32, 0.72, 0, 1] } as const

interface SidebarContextValue {
  /** ¿Se ven los textos? En el drawer mobile siempre es true. */
  open: boolean
}

const SidebarContext = React.createContext<SidebarContextValue>({ open: true })

export function useSidebar() {
  return React.useContext(SidebarContext)
}

interface DesktopSidebarProps {
  pinned: boolean
  /** Mantiene el panel abierto sin hover, p. ej. con un dropdown abierto (vive en un portal). */
  holdOpen?: boolean
  className?: string
  children: React.ReactNode
}

export function DesktopSidebar({ pinned, holdOpen = false, className, children }: DesktopSidebarProps) {
  const [hovered, setHovered] = React.useState(false)
  const [focused, setFocused] = React.useState(false)
  const open = pinned || hovered || focused || holdOpen
  const floating = open && !pinned

  return (
    <MotionConfig reducedMotion="user">
      {/* Hueco en el flujo: solo cambia de ancho al fijar/soltar, nunca por hover. */}
      <motion.div
        className="relative hidden shrink-0 lg:block"
        initial={false}
        animate={{ width: pinned ? EXPANDED_WIDTH : RAIL_WIDTH }}
        transition={TRANSITION}
      >
        <motion.aside
          className={cn(
            'absolute inset-y-0 left-0 z-30 flex flex-col overflow-hidden border-r border-border bg-surface px-3',
            floating && 'shadow-panel',
            className,
          )}
          initial={false}
          animate={{ width: open ? EXPANDED_WIDTH : RAIL_WIDTH }}
          transition={TRANSITION}
          onMouseEnter={() => setHovered(true)}
          onMouseLeave={() => setHovered(false)}
          // Solo foco de teclado: un click con el mouse también enfoca el
          // link, y no queremos que el panel quede abierto después.
          onFocus={(e) => {
            if (e.target.matches(':focus-visible')) setFocused(true)
          }}
          onBlur={(e) => {
            if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setFocused(false)
          }}
        >
          <SidebarContext.Provider value={{ open }}>{children}</SidebarContext.Provider>
        </motion.aside>
      </motion.div>
    </MotionConfig>
  )
}

interface MobileSidebarProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  className?: string
  children: React.ReactNode
}

/** Drawer por debajo de `lg`. */
export function MobileSidebar({ open, onOpenChange, className, children }: MobileSidebarProps) {
  React.useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onOpenChange(false)
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onOpenChange])

  return (
    <MotionConfig reducedMotion="user">
      <AnimatePresence>
        {open && (
          <>
            <motion.div
              key="backdrop"
              className="fixed inset-0 z-40 bg-black/60 backdrop-blur-[2px] lg:hidden"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={TRANSITION}
              onClick={() => onOpenChange(false)}
              aria-hidden
            />
            <motion.aside
              key="drawer"
              className={cn(
                'fixed inset-y-0 left-0 z-50 flex w-[260px] flex-col border-r border-border bg-surface px-3 lg:hidden',
                className,
              )}
              initial={{ x: '-100%' }}
              animate={{ x: 0 }}
              exit={{ x: '-100%' }}
              transition={TRANSITION}
            >
              <SidebarContext.Provider value={{ open: true }}>{children}</SidebarContext.Provider>
            </motion.aside>
          </>
        )}
      </AnimatePresence>
    </MotionConfig>
  )
}

/** Siempre en el DOM (solo cambia la opacidad) para que los iconos no salten mientras anima el ancho. */
export function SidebarLabel({
  className,
  children,
}: {
  className?: string
  children: React.ReactNode
}) {
  const { open } = useSidebar()
  return (
    <motion.span
      className={cn('min-w-0 whitespace-nowrap', className)}
      initial={false}
      animate={{ opacity: open ? 1 : 0 }}
      transition={{ duration: open ? 0.18 : 0.08, delay: open ? 0.05 : 0 }}
    >
      {children}
    </motion.span>
  )
}
