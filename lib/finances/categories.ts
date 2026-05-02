/**
 * @file lib/finances/categories.ts
 * @description The canonical expense-category vocabulary used across the
 *              Financial OS module. Hard-coding the list lets us:
 *                - Pin the AI categoriser's output with a `z.enum(...)`,
 *                  preventing the model from inventing one-off categories.
 *                - Drive consistent UI labels, colour mapping, and
 *                  category-breakdown aggregation.
 *                - Map deterministically to common tax-deductibility defaults
 *                  (those defaults are guidance, never authoritative — the
 *                  user always has the final say).
 *
 *              When extending: add a row to EXPENSE_CATEGORIES and update
 *              the AI categoriser's tool description in lib/finances/categorize.ts
 *              so the model knows about the new category. Never rename an
 *              existing category — the slug is persisted in the
 *              `transactions.category` column.
 */

/** Stable slug values for the `transactions.category` column. */
export const EXPENSE_CATEGORIES = [
  'software',
  'subscriptions',
  'hardware',
  'office',
  'travel',
  'meals',
  'contractors',
  'professional-services',
  'advertising',
  'banking-fees',
  'taxes',
  'insurance',
  'utilities',
  'rent',
  'shipping',
  'cogs',
  'education',
  'other',
] as const;

/** TypeScript union derived from EXPENSE_CATEGORIES — use anywhere a category is required. */
export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number];

/** Default tax-deductibility recommendation per category (US/CA/UK common defaults). */
const DEFAULT_DEDUCTIBLE: Record<ExpenseCategory, boolean> = {
  software: true,
  subscriptions: true,
  hardware: true,
  office: true,
  travel: true,
  meals: true, // Note: typically only 50% deductible in US/CA — UI surfaces this.
  contractors: true,
  'professional-services': true,
  advertising: true,
  'banking-fees': true,
  taxes: false, // Income tax paid is not deductible; sales tax handling varies.
  insurance: true,
  utilities: true,
  rent: true,
  shipping: true,
  cogs: true,
  education: true,
  other: false,
};

/** Display label per category. */
const LABELS: Record<ExpenseCategory, string> = {
  software: 'Software',
  subscriptions: 'Subscriptions',
  hardware: 'Hardware',
  office: 'Office',
  travel: 'Travel',
  meals: 'Meals',
  contractors: 'Contractors',
  'professional-services': 'Professional services',
  advertising: 'Advertising',
  'banking-fees': 'Banking fees',
  taxes: 'Taxes',
  insurance: 'Insurance',
  utilities: 'Utilities',
  rent: 'Rent',
  shipping: 'Shipping',
  cogs: 'Cost of goods sold',
  education: 'Education',
  other: 'Other',
};

/**
 * Resolve the human-readable label for a category slug.
 * Falls back to the slug itself if the value is unknown (defence in depth
 * against rows from a future schema version).
 */
export function categoryLabel(slug: string): string {
  return (LABELS as Record<string, string>)[slug] ?? slug;
}

/**
 * Resolve the default tax-deductibility flag for a category. Used to seed
 * `taxDeductible` on AI-categorised expenses; the user can always override.
 */
export function defaultDeductible(category: ExpenseCategory): boolean {
  return DEFAULT_DEDUCTIBLE[category];
}

/** Type guard — narrows an arbitrary string to ExpenseCategory. */
export function isExpenseCategory(value: string): value is ExpenseCategory {
  return (EXPENSE_CATEGORIES as readonly string[]).includes(value);
}
