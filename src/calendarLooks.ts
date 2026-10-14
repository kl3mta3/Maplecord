import type { CSSProperties } from 'react'

/**
 * The backgrounds a calendar can have. They are drawn here, from gradients, so nothing is uploaded or kept for them
 * but the name, and they can never go missing. The server knows the same names (CalendarLooks in the server's
 * contracts); one this app does not know is drawn as no background at all.
 */
export const CALENDAR_BACKGROUNDS: { id: string; name: string; style: CSSProperties }[] = [
  {
    id: 'night', name: 'Night sky',
    style: {
      backgroundImage: 'radial-gradient(1px 1px at 20% 30%, #ffffffb0 50%, transparent 51%), radial-gradient(1px 1px at 70% 60%, #ffffff90 50%, transparent 51%), '
        + 'radial-gradient(1.5px 1.5px at 40% 80%, #ffffffa0 50%, transparent 51%), radial-gradient(1px 1px at 85% 15%, #ffffffb0 50%, transparent 51%), linear-gradient(180deg, #0b1026 0%, #1b1440 100%)',
      backgroundSize: '180px 180px, 240px 240px, 320px 320px, 260px 260px, cover',
    },
  },
  { id: 'dusk', name: 'Dusk', style: { backgroundImage: 'linear-gradient(165deg, #1e1b4b 0%, #4c1d95 50%, #9a3412 100%)' } },
  {
    id: 'aurora', name: 'Aurora',
    style: { backgroundImage: 'radial-gradient(ellipse at 20% 0%, #10b98160 0%, transparent 55%), radial-gradient(ellipse at 80% 10%, #8b5cf660 0%, transparent 50%), radial-gradient(ellipse at 50% 100%, #06b6d440 0%, transparent 60%), linear-gradient(#070b14, #070b14)' },
  },
  { id: 'ember', name: 'Embers', style: { backgroundImage: 'radial-gradient(ellipse at 50% 120%, #ea580c70 0%, transparent 60%), radial-gradient(ellipse at 10% 0%, #7c2d1250 0%, transparent 50%), linear-gradient(#120a07, #120a07)' } },
  { id: 'ocean', name: 'Deep sea', style: { backgroundImage: 'linear-gradient(180deg, #082f49 0%, #0c4a6e 55%, #155e75 100%)' } },
  {
    id: 'grid', name: 'Graph paper',
    style: { backgroundImage: 'linear-gradient(var(--border) 1px, transparent 1px), linear-gradient(90deg, var(--border) 1px, transparent 1px), linear-gradient(var(--bg0), var(--bg0))', backgroundSize: '24px 24px, 24px 24px, cover' },
  },
  { id: 'dots', name: 'Dots', style: { backgroundImage: 'radial-gradient(var(--border) 1.5px, transparent 1.6px), linear-gradient(var(--bg0), var(--bg0))', backgroundSize: '18px 18px, cover' } },
]

/** How a calendar with this background is drawn, or null for none (or one this app does not know). */
export const calendarBackground = (id: string | null | undefined) => CALENDAR_BACKGROUNDS.find(b => b.id === id)?.style ?? null
