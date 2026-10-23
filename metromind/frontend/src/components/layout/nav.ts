import { BarChart3, Database, FlaskConical, GitCompareArrows, Map as MapIcon, Navigation, Settings as SettingsIcon, type LucideIcon } from 'lucide-react'

export interface NavItem {
  to: string
  label: string
  icon: LucideIcon
  /** second key of the "g <key>" go-to shortcut */
  key: string
  description: string
}

export const NAV_GROUPS: { label: string; items: NavItem[] }[] = [
  {
    label: 'Travel',
    items: [
      { to: '/plan', label: 'Route planner', icon: Navigation, key: 'p', description: 'Plan a journey between two stations' },
      { to: '/explore', label: 'Network explorer', icon: MapIcon, key: 'e', description: 'Browse stations, lines and nearby stops' },
    ],
  },
  {
    label: 'Algorithms',
    items: [
      { to: '/lab', label: 'Algorithm lab', icon: FlaskConical, key: 'l', description: 'Replay a search step by step' },
      { to: '/compare', label: 'Compare', icon: GitCompareArrows, key: 'c', description: 'Benchmark algorithms on one trip' },
    ],
  },
  {
    label: 'Insights',
    items: [{ to: '/analytics', label: 'Analytics', icon: BarChart3, key: 'a', description: 'Network topology and benchmarks' }],
  },
  {
    label: 'System',
    items: [
      { to: '/data', label: 'Dataset', icon: Database, key: 'd', description: 'Source, validation report and versions' },
      { to: '/settings', label: 'Settings', icon: SettingsIcon, key: 's', description: 'Theme and routing defaults' },
    ],
  },
]

export const NAV_ITEMS = NAV_GROUPS.flatMap((g) => g.items)
