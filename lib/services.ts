export type Gender = "male" | "female" | "unisex"

export const CATEGORIES = [
  { id: "haircut", label: "Hårklipp" },
  { id: "braids", label: "Fletter" },
  { id: "nails", label: "Negler" },
  { id: "lashes", label: "Vipper" },
  { id: "brows", label: "Bryn" },
  { id: "body", label: "Fysiske behandlinger" },
] as const

export type CategoryId = (typeof CATEGORIES)[number]["id"]

export type Service = {
  id: string
  category: CategoryId
  name: string
  gender: Gender
  style_id?: string // maps to existing styles table if available
  minutes?: number
  price_min?: number
  price_max?: number
}

// Minimal demo set across categories with gender filtering.
// Where possible we map to existing seeded style ids for backend compatibility.
export const SERVICES: Service[] = [
  // Haircut
  { id: "mens-basic-cut", category: "haircut", name: "Herreklipp", gender: "male", style_id: "mid-fade", minutes: 30 },
  { id: "mens-skin-fade", category: "haircut", name: "Skin fade", gender: "male", style_id: "skin-fade", minutes: 45 },
  {
    id: "womens-basic-cut",
    category: "haircut",
    name: "Dameklipp",
    gender: "female",
    style_id: "low-fade",
    minutes: 40,
  },
  { id: "womens-taper", category: "haircut", name: "Dame taper", gender: "female", style_id: "taper", minutes: 35 },
  { id: "unisex-trim", category: "haircut", name: "Unisex trim", gender: "unisex", style_id: "high-fade", minutes: 25 },

  // Braids
  { id: "braids-classic", category: "braids", name: "Fletter klassisk", gender: "unisex", minutes: 60 },
  { id: "braids-women", category: "braids", name: "Fletter (kvinner)", gender: "female", minutes: 90 },

  // Nails
  { id: "nails-basic", category: "nails", name: "Enkel manikyr", gender: "unisex", minutes: 45 },
  { id: "nails-gel", category: "nails", name: "Gel-negler", gender: "female", minutes: 60 },

  // Lashes
  { id: "lashes-classic", category: "lashes", name: "Vipper klassisk", gender: "female", minutes: 75 },

  // Brows
  { id: "brows-shape", category: "brows", name: "Bryn forming", gender: "unisex", minutes: 20 },

  // Body
  { id: "body-massage", category: "body", name: "Massasje 45", gender: "unisex", minutes: 45 },
  { id: "body-stretch", category: "body", name: "Stretching 30", gender: "unisex", minutes: 30 },
]

// Fallback mapping when a selected service has no style_id.
// This keeps the backend RPCs working without schema changes.
export const STYLE_FALLBACK_FOR_CATEGORY: Record<CategoryId, string> = {
  haircut: "mid-fade",
  braids: "taper",
  nails: "low-fade",
  lashes: "high-fade",
  brows: "skin-fade",
  body: "taper",
}
