/**
 * Campus + catalog constants shared across screens.
 * Category/condition labels mirror the enums in docs/CONTRACT.md.
 */

export const DEFAULT_CAMPUS_SLUG = 'arizona';

export type Category =
  | 'clothing'
  | 'shoes'
  | 'jewelry'
  | 'accessories'
  | 'dorm'
  | 'books'
  | 'tech'
  | 'other';

export type Condition = 'new' | 'like_new' | 'good' | 'fair';

export const CATEGORY_LABELS: Record<Category, string> = {
  clothing: 'Clothing',
  shoes: 'Shoes',
  jewelry: 'Jewelry',
  accessories: 'Accessories',
  dorm: 'Dorm',
  books: 'Books',
  tech: 'Tech',
  other: 'Other',
};

export const CATEGORIES: Category[] = [
  'clothing',
  'shoes',
  'jewelry',
  'accessories',
  'dorm',
  'books',
  'tech',
  'other',
];

export const CONDITION_LABELS: Record<Condition, string> = {
  new: 'New',
  like_new: 'Like new',
  good: 'Good',
  fair: 'Fair',
};

export const CONDITIONS: Condition[] = ['new', 'like_new', 'good', 'fair'];

/** Clothing/shoe size options shown on the Sell screen when category is clothing/shoes. */
export const CLOTHING_SIZE_OPTIONS: string[] = [
  'XXS',
  'XS',
  'S',
  'M',
  'L',
  'XL',
  'XXL',
];

export const SHOE_SIZE_OPTIONS: string[] = [
  '5',
  '5.5',
  '6',
  '6.5',
  '7',
  '7.5',
  '8',
  '8.5',
  '9',
  '9.5',
  '10',
  '10.5',
  '11',
  '11.5',
  '12',
  '13',
];
