import { Check } from 'lucide-react'
import * as React from 'react'

import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'

/** Input libre con sugerencias por coincidencia parcial; el valor no tiene que estar en `options`. */
export function Combobox({
  id,
  value,
  onChange,
  options,
  placeholder,
  emptyText = 'Sin coincidencias',
  className,
  disabled,
  maxResults = 200,
}: {
  id?: string
  value: string
  onChange: (value: string) => void
  options: string[]
  placeholder?: string
  emptyText?: string
  className?: string
  disabled?: boolean
  maxResults?: number
}) {
  const [open, setOpen] = React.useState(false)
  const [activeIndex, setActiveIndex] = React.useState(0)
  const rootRef = React.useRef<HTMLDivElement>(null)

  const filtered = React.useMemo(() => {
    const query = value.trim().toLowerCase()
    const matches = query ? options.filter((o) => o.toLowerCase().includes(query)) : options
    return matches.slice(0, maxResults)
  }, [options, value, maxResults])

  const overflow = React.useMemo(() => {
    const query = value.trim().toLowerCase()
    const total = query ? options.filter((o) => o.toLowerCase().includes(query)).length : options.length
    return total - filtered.length
  }, [options, value, filtered.length])

  React.useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  function selectOption(option: string) {
    onChange(option)
    setOpen(false)
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!open && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
      setOpen(true)
      setActiveIndex(0)
      return
    }
    if (!open || filtered.length === 0) return
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActiveIndex((i) => (i + 1) % filtered.length)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActiveIndex((i) => (i - 1 + filtered.length) % filtered.length)
    } else if (e.key === 'Enter') {
      e.preventDefault()
      selectOption(filtered[activeIndex])
    } else if (e.key === 'Escape') {
      setOpen(false)
    }
  }

  const showDropdown = open && options.length > 0

  return (
    <div ref={rootRef} className="relative">
      <Input
        id={id}
        role="combobox"
        aria-expanded={showDropdown}
        aria-autocomplete="list"
        autoComplete="off"
        disabled={disabled}
        className={cn('font-mono', className)}
        placeholder={placeholder}
        value={value}
        onChange={(e) => {
          onChange(e.target.value)
          setActiveIndex(0)
          if (options.length > 0) setOpen(true)
        }}
        onFocus={() => {
          if (options.length > 0) {
            setOpen(true)
            setActiveIndex(0)
          }
        }}
        onKeyDown={handleKeyDown}
      />
      {showDropdown && (
        <div className="absolute top-full right-0 left-0 z-20 mt-1 max-h-56 overflow-auto rounded-md border border-border bg-surface py-1 shadow-lg">
          {filtered.length === 0 ? (
            <p className="px-3 py-2 text-[12.5px] text-muted-foreground">{emptyText}</p>
          ) : (
            <>
              {filtered.map((option, i) => (
                <button
                  key={option}
                  type="button"
                  className={cn(
                    'flex w-full items-center gap-2 px-3 py-1.5 text-left font-mono text-[12.5px]',
                    i === activeIndex ? 'bg-surface-2 text-foreground' : 'text-muted-foreground',
                  )}
                  onMouseEnter={() => setActiveIndex(i)}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => selectOption(option)}
                >
                  <Check className={cn('size-3.5 shrink-0', option === value ? 'opacity-100' : 'opacity-0')} />
                  <span className="truncate">{option}</span>
                </button>
              ))}
              {overflow > 0 && (
                <p className="px-3 py-1.5 text-[11.5px] text-muted-foreground/70">
                  y {overflow} más -- seguí escribiendo para acotar
                </p>
              )}
            </>
          )}
        </div>
      )}
    </div>
  )
}
