import { HelpCircle } from 'lucide-react'
import type * as React from 'react'

import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

/**
 * Reemplaza los párrafos fijos de "cómo funciona este campo" que antes
 * quedaban siempre visibles debajo del label -- ahora es un ícono que
 * solo muestra el texto al pasar el mouse/tocar. Se guarda el texto,
 * se saca el ruido permanente del panel.
 */
export function HelpTooltip({ children }: { children: React.ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          className="text-muted-foreground/70 transition-colors hover:text-foreground"
          aria-label="Ayuda"
        >
          <HelpCircle className="size-3.5" />
        </button>
      </TooltipTrigger>
      <TooltipContent side="top" className="max-w-64 font-normal leading-snug text-pretty">
        {children}
      </TooltipContent>
    </Tooltip>
  )
}
