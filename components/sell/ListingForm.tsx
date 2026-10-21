/**
 * Shared Sell form: used by both `app/listing/new.tsx` (create) and
 * `app/listing/[id]/edit.tsx` (edit). Owns all field state, validation, and
 * the campus-spots query; the two routes only own which mutation to call and
 * where to navigate on success (per docs/DESIGN.md "Sell" section).
 */
import React, { forwardRef, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, View } from 'react-native';
import { trpc } from '@/lib/trpc';
import { useAuth } from '@/hooks/useAuth';
import { Text } from '@/components/ui/Text';
import { Input, TextArea } from '@/components/ui/Input';
import { Chip } from '@/components/ui/Chip';
import { Button } from '@/components/ui/Button';
import { Divider } from '@/components/ui/Divider';
import { PhotoPickerRow, type PhotoItem } from './PhotoPickerRow';
import { SpotMultiSelect } from './SpotMultiSelect';
import { WindowEditor, type WindowItem } from './WindowEditor';
import { DAY_MS } from '@/components/booking/time';
import { space } from '@/constants/theme';
import { CATEGORIES, CATEGORY_LABELS, CONDITIONS, CONDITION_LABELS, CLOTHING_SIZE_OPTIONS, SHOE_SIZE_OPTIONS } from '@/constants/campus';
import type { Category, Condition } from '@/constants/campus';

export interface ListingFormInitialValues {
  photos: PhotoItem[];
  title: string;
  category: Category | null;
  condition: Condition | null;
  priceCents: number | null;
  size: string;
  brand: string;
  description: string;
  spotIds: string[];
  windows: WindowItem[];
}

export interface ListingFormSubmitValues {
  title: string;
  description?: string;
  category: Category;
  condition: Condition;
  priceCents: number;
  size?: string;
  brand?: string;
  /** Every listing is live for 24 hours, so this is always true. */
  isSellToday: boolean;
  photoUrls: string[];
  spotIds: string[];
  windows: { startsAt: string; endsAt: string }[];
}

export interface ListingFormHandle {
  isDirty: () => boolean;
}

export interface ListingFormProps {
  initialValues?: Partial<ListingFormInitialValues>;
  submitLabel: string;
  submitting?: boolean;
  submitError?: string | null;
  /** End of the listing's life: new listings default to now + 24h; edit passes `expiresAt`. */
  until?: Date;
  onSubmit: (values: ListingFormSubmitValues) => void;
  onDirtyChange?: (dirty: boolean) => void;
  /** Extra content rendered below the form fields, above Publish (edit screen's "More" section). */
  footer?: React.ReactNode;
}

const DEFAULTS: ListingFormInitialValues = {
  photos: [],
  title: '',
  category: null,
  condition: null,
  priceCents: null,
  size: '',
  brand: '',
  description: '',
  spotIds: [],
  windows: [],
};

function priceCentsToInput(cents: number | null): string {
  if (cents === null) return '';
  return (cents / 100).toFixed(2).replace(/\.00$/, (m) => m); // keep cents visible if present
}

function parsePriceInput(text: string): number | null {
  const cleaned = text.replace(/[^0-9.]/g, '');
  if (!cleaned) return null;
  const dollars = Number.parseFloat(cleaned);
  if (Number.isNaN(dollars)) return null;
  return Math.round(dollars * 100);
}

interface FieldErrors {
  photos?: string;
  title?: string;
  category?: string;
  condition?: string;
  price?: string;
  spots?: string;
  windows?: string;
}

const FIELD_ORDER: (keyof FieldErrors)[] = [
  'photos',
  'title',
  'category',
  'condition',
  'price',
  'spots',
  'windows',
];

/** The $1 floor a platform fee can round against. */
const MIN_PRICE_CENTS = 100;

export const ListingForm = forwardRef<ListingFormHandle, ListingFormProps>(function ListingForm(
  { initialValues, submitLabel, submitting = false, submitError, until, onSubmit, onDirtyChange, footer },
  ref,
) {
  const merged = { ...DEFAULTS, ...initialValues };
  const { user } = useAuth();
  const campusId = user?.campus?.id;
  const timeZone = user?.campus?.timezone;
  const [defaultUntil] = useState(() => new Date(Date.now() + DAY_MS));
  const windowsUntil = until ?? defaultUntil;
  const spotsQuery = trpc.campus.spots.useQuery({ campusId: campusId! }, { enabled: !!campusId });

  const [photos, setPhotos] = useState<PhotoItem[]>(merged.photos);
  const [title, setTitle] = useState(merged.title);
  const [category, setCategory] = useState<Category | null>(merged.category);
  const [condition, setCondition] = useState<Condition | null>(merged.condition);
  const [priceInput, setPriceInput] = useState(priceCentsToInput(merged.priceCents));
  const [size, setSize] = useState(merged.size);
  const [brand, setBrand] = useState(merged.brand);
  const [description, setDescription] = useState(merged.description);
  const [spotIds, setSpotIds] = useState<string[]>(merged.spotIds);
  const [windows, setWindows] = useState<WindowItem[]>(merged.windows);

  const [touched, setTouched] = useState<Partial<Record<keyof FieldErrors, boolean>>>({});
  const [triedSubmit, setTriedSubmit] = useState(false);

  const scrollRef = useRef<ScrollView>(null);
  const sectionY = useRef<Partial<Record<keyof FieldErrors, number>>>({});

  const priceCents = parsePriceInput(priceInput);
  const showSize = category === 'clothing' || category === 'shoes';
  const sizeOptions = category === 'shoes' ? SHOE_SIZE_OPTIONS : CLOTHING_SIZE_OPTIONS;

  const initialSnapshot = useMemo(
    () =>
      JSON.stringify({
        title: merged.title,
        category: merged.category,
        condition: merged.condition,
        priceCents: merged.priceCents,
        size: merged.size,
        brand: merged.brand,
        description: merged.description,
        spotIds: [...merged.spotIds].sort(),
        windowCount: merged.windows.length,
        photoCount: merged.photos.length,
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const currentSnapshot = JSON.stringify({
    title,
    category,
    condition,
    priceCents,
    size,
    brand,
    description,
    spotIds: [...spotIds].sort(),
    windowCount: windows.length,
    photoCount: photos.length,
  });
  const dirty = currentSnapshot !== initialSnapshot;

  React.useEffect(() => {
    onDirtyChange?.(dirty);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dirty]);

  useImperativeHandle(ref, () => ({ isDirty: () => dirty }), [dirty]);

  const errors: FieldErrors = {};
  const doneCount = photos.filter((p) => p.status === 'done').length;
  if (doneCount === 0) errors.photos = 'Add at least one photo.';
  if (!title.trim()) errors.title = 'Give your item a title.';
  else if (title.length > 80) errors.title = 'Keep the title under 80 characters.';
  if (!category) errors.category = 'Pick a category.';
  if (!condition) errors.condition = 'Pick a condition.';
  if (priceCents === null || priceCents < MIN_PRICE_CENTS) {
    errors.price = 'Set an asking price of at least $1.';
  }
  if (spotIds.length === 0) errors.spots = 'Pick at least one campus meetup place.';
  if (windows.length === 0) errors.windows = 'Add at least one time you can meet in the next 24 hours.';

  const visible = (key: keyof FieldErrors): string | undefined =>
    (touched[key] || triedSubmit) && errors[key] ? errors[key] : undefined;

  const uploading = photos.some((p) => p.status === 'uploading');
  const hasError = Object.keys(errors).length > 0;

  function handleSubmit() {
    setTriedSubmit(true);
    if (hasError) {
      const firstKey = FIELD_ORDER.find((k) => errors[k]);
      if (firstKey) {
        const y = sectionY.current[firstKey];
        if (y !== undefined) scrollRef.current?.scrollTo({ y: Math.max(0, y - space.lg), animated: true });
      }
      return;
    }
    if (uploading) return;

    onSubmit({
      title: title.trim(),
      description: description.trim() || undefined,
      category: category!,
      condition: condition!,
      priceCents: priceCents!,
      size: showSize && size ? size : undefined,
      brand: brand.trim() || undefined,
      isSellToday: true,
      photoUrls: photos.filter((p) => p.status === 'done' && p.url).map((p) => p.url!),
      spotIds,
      windows: windows.map((w) => ({ startsAt: w.startsAt, endsAt: w.endsAt })),
    });
  }

  function recordY(key: keyof FieldErrors) {
    return (e: { nativeEvent: { layout: { y: number } } }) => {
      sectionY.current[key] = e.nativeEvent.layout.y;
    };
  }

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 0}
    >
      <ScrollView
        ref={scrollRef}
        style={styles.flex}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
      >
        <View onLayout={recordY('photos')}>
          <Text variant="label" color="inkMuted" style={styles.label}>
            Photos
          </Text>
          <PhotoPickerRow photos={photos} onChange={setPhotos} error={visible('photos')} />
        </View>

        <Divider style={styles.divider} />

        <View onLayout={recordY('title')}>
          <Input
            label="Title"
            placeholder="e.g. Blue denim jacket"
            value={title}
            onChangeText={setTitle}
            onBlur={() => setTouched((t) => ({ ...t, title: true }))}
            error={visible('title')}
            maxLength={80}
            returnKeyType="next"
          />
        </View>

        <View onLayout={recordY('category')} style={styles.field}>
          <Text variant="label" color="inkMuted" style={styles.label}>
            Category
          </Text>
          <View style={styles.chipWrap}>
            {CATEGORIES.map((c) => (
              <Chip
                key={c}
                label={CATEGORY_LABELS[c]}
                selected={category === c}
                onPress={() => {
                  setCategory(c);
                  setTouched((t) => ({ ...t, category: true }));
                  if (c !== 'clothing' && c !== 'shoes') setSize('');
                }}
              />
            ))}
          </View>
          {visible('category') ? (
            <Text variant="caption" color="danger" style={styles.error}>
              {visible('category')}
            </Text>
          ) : null}
        </View>

        <View onLayout={recordY('condition')} style={styles.field}>
          <Text variant="label" color="inkMuted" style={styles.label}>
            Condition
          </Text>
          <View style={styles.chipWrap}>
            {CONDITIONS.map((c) => (
              <Chip
                key={c}
                label={CONDITION_LABELS[c]}
                selected={condition === c}
                onPress={() => {
                  setCondition(c);
                  setTouched((t) => ({ ...t, condition: true }));
                }}
              />
            ))}
          </View>
          {visible('condition') ? (
            <Text variant="caption" color="danger" style={styles.error}>
              {visible('condition')}
            </Text>
          ) : null}
        </View>

        <View onLayout={recordY('price')} style={styles.field}>
          <Input
            label="Asking price ($)"
            placeholder="0.00"
            value={priceInput}
            onChangeText={setPriceInput}
            onBlur={() => setTouched((t) => ({ ...t, price: true }))}
            error={visible('price')}
            keyboardType="decimal-pad"
            helper="At least $1. Buyers can book at this price or send you an offer below it."
          />
        </View>

        {showSize ? (
          <View style={styles.field}>
            <Text variant="label" color="inkMuted" style={styles.label}>
              Size (optional)
            </Text>
            <View style={styles.chipWrap}>
              {sizeOptions.map((s) => (
                <Chip key={s} label={s} selected={size === s} onPress={() => setSize(size === s ? '' : s)} />
              ))}
            </View>
          </View>
        ) : null}

        <View style={styles.field}>
          <Input label="Brand (optional)" value={brand} onChangeText={setBrand} placeholder="e.g. Levi's" />
        </View>

        <View style={styles.field}>
          <TextArea
            label="Description (optional)"
            value={description}
            onChangeText={setDescription}
            maxLength={1000}
            placeholder="Fit, flaws, why you're selling it..."
          />
        </View>

        <Divider style={styles.divider} />

        <View onLayout={recordY('spots')} style={styles.field}>
          <Text variant="label" color="inkMuted" style={styles.label}>
            Campus meetup places
          </Text>
          <SpotMultiSelect
            spots={spotsQuery.data}
            isLoading={spotsQuery.isPending}
            selectedIds={spotIds}
            onToggle={(id) =>
              setSpotIds((prev) => {
                setTouched((t) => ({ ...t, spots: true }));
                return prev.includes(id) ? prev.filter((s) => s !== id) : [...prev, id];
              })
            }
            error={visible('spots')}
          />
        </View>

        <Divider style={styles.divider} />

        <View onLayout={recordY('windows')} style={styles.field}>
          <Text variant="label" color="inkMuted" style={styles.label}>
            When can you meet?
          </Text>
          <WindowEditor
            windows={windows}
            onChange={(w) => {
              setWindows(w);
              setTouched((t) => ({ ...t, windows: true }));
            }}
            until={windowsUntil}
            timeZone={timeZone}
            error={visible('windows')}
          />
        </View>

        {footer ? <View style={styles.footer}>{footer}</View> : null}

        {submitError ? (
          <Text variant="body" color="danger" style={styles.submitError}>
            {submitError}
          </Text>
        ) : null}

        <Button
          title={uploading ? 'Uploading photos…' : submitLabel}
          onPress={handleSubmit}
          loading={submitting}
          disabled={uploading || submitting}
          style={styles.submit}
        />
      </ScrollView>
    </KeyboardAvoidingView>
  );
});

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { padding: space.lg, paddingBottom: space.huge },
  label: { marginBottom: space.sm },
  field: { marginTop: space.lg },
  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  error: { marginTop: space.sm },
  divider: { marginVertical: space.xl },
  footer: { marginTop: space.xl },
  submitError: { marginTop: space.lg, textAlign: 'center' },
  submit: { marginTop: space.xl },
});

export default ListingForm;
