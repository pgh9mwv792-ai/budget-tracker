// One stable color + label per macro, defined once and reused across the app
// (targets header bars, meal summaries, food previews) so a macro always reads
// the same color. Colors are drawn from the palette already used in the meal
// tracker's food preview (protein=emerald, carbs=sky, fat=fuchsia); energy gets
// amber. Past 100% of target a bar switches to OVER_BAR (the app's over color).

export const MACRO_KEYS = ['calories', 'protein', 'carbs', 'fat']

export const MACRO_META = {
  calories: {
    label: 'Energy',
    unit: 'kcal',
    bar: 'bg-amber-500',
    text: 'text-amber-600 dark:text-amber-400',
  },
  protein: {
    label: 'Protein',
    unit: 'g',
    bar: 'bg-emerald-500',
    text: 'text-emerald-600 dark:text-emerald-400',
  },
  carbs: {
    label: 'Carbs',
    unit: 'g',
    bar: 'bg-sky-500',
    text: 'text-sky-600 dark:text-sky-400',
  },
  fat: {
    label: 'Fat',
    unit: 'g',
    bar: 'bg-fuchsia-500',
    text: 'text-fuchsia-600 dark:text-fuchsia-400',
  },
}

// The app's warning/over color — a macro bar turns this once it passes target.
export const OVER_BAR = 'bg-red-500'
