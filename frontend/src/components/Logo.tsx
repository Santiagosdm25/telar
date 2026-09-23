import type { SVGProps } from 'react'

type Variant = 'mark' | 'horizontal' | 'vertical' | 'icon'

interface LogoProps extends Omit<SVGProps<SVGSVGElement>, 'children'> {
  /** mark: solo el icono · horizontal/vertical: icono + logotipo · icon: version simplificada para 16-32px */
  variant?: Variant
  /** alto en px; el ancho se calcula solo */
  size?: number
  /** color del acento (hilo). Por defecto el coral de marca. */
  accent?: string
  /** el resto de la marca hereda currentColor */
  title?: string
}

const ACCENT = '#FF6B4A'
const WORD_D =
  'M40.79 98.40Q30.77 98.40 24.30 95.79Q17.82 93.19 14.65 87.02Q11.48 80.84 11.48 70.29L11.55 4.54H28.91L28.84 71.43Q28.84 76.77 31.71 79.64Q34.58 82.51 39.92 82.51H51.27V98.40ZM0.00 38.58V24.97H51.27V38.58ZM95.99 100.00Q86.65 100.00 79.64 96.80Q72.63 93.59 68.02 88.22Q63.42 82.84 61.08 76.17Q58.74 69.49 58.74 62.48V59.95Q58.74 52.74 61.08 46.03Q63.42 39.32 67.99 34.01Q72.56 28.70 79.41 25.57Q86.25 22.43 95.19 22.43Q106.94 22.43 114.85 27.60Q122.76 32.78 126.80 41.09Q130.84 49.40 130.84 59.01V65.75H66.62V54.41H119.16L113.48 59.95Q113.48 53.00 111.45 48.06Q109.41 43.12 105.37 40.45Q101.34 37.78 95.19 37.78Q88.99 37.78 84.71 40.62Q80.44 43.46 78.27 48.70Q76.10 53.94 76.10 61.28Q76.10 68.16 78.20 73.43Q80.31 78.70 84.71 81.68Q89.12 84.65 95.99 84.65Q102.74 84.65 107.01 81.91Q111.28 79.17 112.48 75.23H129.57Q128.04 82.64 123.46 88.25Q118.89 93.86 111.92 96.93Q104.94 100.00 95.99 100.00ZM143.93 97.46V0.00H162.48V97.46ZM134.85 13.89V0.00H162.48V13.89ZM224.23 97.46V75.97H221.16V52.07Q221.16 45.86 218.09 42.76Q215.02 39.65 208.68 39.65Q205.34 39.65 200.67 39.79Q195.99 39.92 191.26 40.12Q186.52 40.32 182.78 40.59V24.83Q185.85 24.57 189.69 24.33Q193.52 24.10 197.63 24.00Q201.74 23.90 205.34 23.90Q216.49 23.90 223.93 26.87Q231.38 29.84 235.15 36.11Q238.92 42.39 238.92 52.54V97.46ZM200.87 99.33Q192.99 99.33 187.08 96.56Q181.17 93.79 177.90 88.55Q174.63 83.31 174.63 75.97Q174.63 68.02 178.54 62.92Q182.44 57.81 189.59 55.31Q196.73 52.80 206.34 52.80H223.16V63.89H206.07Q199.73 63.89 196.33 66.99Q192.92 70.09 192.92 75.10Q192.92 80.04 196.33 83.08Q199.73 86.11 206.07 86.11Q209.95 86.11 213.25 84.71Q216.56 83.31 218.72 79.94Q220.89 76.57 221.16 70.63L225.70 75.83Q225.03 83.44 222.03 88.65Q219.03 93.86 213.75 96.60Q208.48 99.33 200.87 99.33ZM255.54 97.46V24.97H270.23V55.67H269.83Q269.83 40.12 276.50 32.08Q283.18 24.03 296.13 24.03H298.80V40.19H293.72Q284.31 40.19 279.21 45.23Q274.10 50.27 274.10 59.75V97.46Z'
const WORD_W = 298.8

/** Marca completa. viewBox de origen: 9 15 105 94. */
const MarkFull = ({ accent }: { accent: string }) => (
  <>
    <path
      d="M32 20 H78 A18 18 0 0 1 96 38 V70 A18 18 0 0 1 78 88 H48 L24 104 L34 88 H32 A18 18 0 0 1 14 70 V38 A18 18 0 0 1 32 20 Z"
      fill="none"
      stroke="currentColor"
      strokeWidth={10}
      strokeLinejoin="round"
    />
    <g fill="none" stroke="currentColor" strokeWidth={6} strokeLinecap="round" opacity={0.28}>
      <path d="M46 30 V78" />
      <path d="M74 30 V78" />
    </g>
    <path d="M32 40 H78" fill="none" stroke="currentColor" strokeWidth={8} strokeLinecap="round" />
    <path d="M32 68 H64" fill="none" stroke="currentColor" strokeWidth={8} strokeLinecap="round" />
    <g fill="none" stroke="currentColor" strokeWidth={6} strokeLinecap="butt" opacity={0.75}>
      <path d="M46 34 V46" />
      <path d="M74 62 V74" />
    </g>
    <path d="M32 54 H110" fill="none" stroke={accent} strokeWidth={8} strokeLinecap="round" />
    <circle cx={110} cy={54} r={4} fill={accent} />
  </>
)

/** Icono simplificado, legible desde 16-32px. viewBox de origen: 8 12 116 100. */
const MarkIcon = ({ accent }: { accent: string }) => (
  <>
    <path
      d="M32 20 H78 A18 18 0 0 1 96 38 V70 A18 18 0 0 1 78 88 H48 L24 104 L34 88 H32 A18 18 0 0 1 14 70 V38 A18 18 0 0 1 32 20 Z"
      fill="none"
      stroke="currentColor"
      strokeWidth={12}
      strokeLinejoin="round"
    />
    <path d="M32 38 H78" fill="none" stroke="currentColor" strokeWidth={9} strokeLinecap="round" />
    <path d="M32 62 H112" fill="none" stroke={accent} strokeWidth={10} strokeLinecap="round" />
  </>
)

/** El trazo hereda currentColor; el hilo coral queda fijo salvo `accent="currentColor"`. */
export function Logo({
  variant = 'horizontal',
  size = 32,
  accent = ACCENT,
  title = 'Telar',
  ...props
}: LogoProps) {
  const common = { role: 'img' as const, 'aria-label': title, ...props }

  if (variant === 'icon') {
    return (
      <svg viewBox="8 12 116 100" height={size} width={(size * 116) / 100} {...common}>
        <MarkIcon accent={accent} />
      </svg>
    )
  }

  if (variant === 'mark') {
    return (
      <svg viewBox="9 15 105 94" height={size} width={(size * 105) / 94} {...common}>
        <MarkFull accent={accent} />
      </svg>
    )
  }

  if (variant === 'vertical') {
    const gap = 22
    const wordH = 46
    const wordScale = wordH / 100
    const wordW = WORD_W * wordScale
    const vw = Math.max(105, wordW)
    const vh = 94 + gap + wordH
    return (
      <svg viewBox={`0 0 ${vw} ${vh}`} height={size} width={(size * vw) / vh} {...common}>
        <g transform={`translate(${(vw - 105) / 2 - 9} ${-15})`}>
          <MarkFull accent={accent} />
        </g>
        <g fill="currentColor" transform={`translate(${(vw - wordW) / 2} ${94 + gap}) scale(${wordScale})`}>
          <path d={WORD_D} />
        </g>
      </svg>
    )
  }

  // horizontal
  const gap = 30
  const wordH = 58
  const wordScale = wordH / 100
  const wordW = WORD_W * wordScale
  const w = 105 + gap + wordW
  return (
    <svg viewBox={`0 0 ${w} 94`} height={size} width={(size * w) / 94} {...common}>
      <g transform="translate(-9 -15)">
        <MarkFull accent={accent} />
      </g>
      <g fill="currentColor" transform={`translate(${105 + gap} ${(94 - wordH) / 2 + 2}) scale(${wordScale})`}>
        <path d={WORD_D} />
      </g>
    </svg>
  )
}

export default Logo
