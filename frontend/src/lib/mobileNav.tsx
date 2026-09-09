import * as React from 'react'

/**
 * Estado de "el sidebar está abierto como drawer en mobile" -- vive acá
 * (no en Sidebar) porque quien lo abre es el botón de hamburguesa en el
 * header de cada página (InboxLayout, ContactsPage, etc.), varios
 * niveles por debajo de donde vive <Sidebar> en AccountLayout.
 */
interface MobileNavContextValue {
  open: boolean
  setOpen: (open: boolean) => void
}

const MobileNavContext = React.createContext<MobileNavContextValue | null>(null)

export function MobileNavProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = React.useState(false)
  const value = React.useMemo(() => ({ open, setOpen }), [open])
  return <MobileNavContext.Provider value={value}>{children}</MobileNavContext.Provider>
}

export function useMobileNav(): MobileNavContextValue {
  const ctx = React.useContext(MobileNavContext)
  if (!ctx) throw new Error('useMobileNav debe usarse dentro de MobileNavProvider')
  return ctx
}
