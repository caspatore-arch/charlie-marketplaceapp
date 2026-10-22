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
import { PriceGuideBar } from './PriceGuideBar';
import { DAY_MS } from '@/components/booking/time';
import { confirmAction } from '@/utils/confirm';
import { formatPrice } from '@/utils/format';
import { OFFERS_ENABLED } from '@/constants/features';
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
  /** Offer "Fill in from photos" (create screen only). */
  enableAutofill?: boolean;
  /** The listing being edited, so the price guide doesn't compare it with itself. */
  listingId?: string;
  /** One line shown right above the submit button (new listing: the 24-hour rule). */
  publishCaption?: string;
  /** Rendered below the submit button (edit screen: the Remove action). */
  afterSubmit?: React.ReactNode;
  /** Note shown under the price and spots fields (edit: a meetup is already booked). */
  bookedNotice?: string;
  /** Note shown above the meetup-time editor (edit: past times were trimmed). */
  windowsNotice?: string;
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
  return (cents / 100).toFixed(2);
}

/** Keeps only digits and one dot, at most two decimals: "1.2.3" -> "1.2", "12.345" -> "12.34". */
function sanitizePriceInput(text: string): string {
  const cleaned = text.replace(/[^0-9.]/g, '');
  const dot = cleaned.indexOf('.');
  if (dot === -1) return cleaned;
  return `${cleaned.slice(0, dot)}.${cleaned.slice(dot + 1).replace(/\./g, '').slice(0, 2)}`;
}

function parsePriceInput(text: string): number | null {
  const cleaned = sanitizePriceInput(text);
  if (!cleaned || cleaned === '.') return null;
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

/** The $1 minimum asking price. */
const MIN_PRICE_CENTS = 100;
/** The server's ceiling for an asking price. */
const MAX_PRICE_CENTS = 5_000_00;
/** Above this we ask "Looks high" before publishing. */
const HIGH_PRICE_CENTS = 2_000_00;

export const ListingForm = forwardRef<ListingFormHandle, ListingFormProps>(function ListingForm(
  { initialValues, submitLabel, submitting = false, submitError, until, onSubmit, onDirtyChange, footer, enableAutofill = false, listingId, publishCaption, afterSubmit, bookedNotice, windowsNotice },
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

  const [aiEstimate, setAiEstimate] = useState<{ lowCents: number; highCents: number } | null>(null);
  const [autofillNote, setAutofillNote] = useState<{ text: string; error?: boolean } | null>(null);
  const draftMutation = trpc.listing.draftFromPhotos.useMutation({
    onSuccess: (draft) => {
      // Fill only what the seller hasn't typed yet.
      if (!title.trim()) setTitle(draft.title);
      if (!category) setCategory(draft.category);
      if (!condition) setCondition(draft.condition);
      if (!brand.trim() && draft.brand) setBrand(draft.brand);
      if (!description.trim()) setDescription(draft.description);
      if (parsePriceInput(priceInput) === null) {
        const mid = Math.round((draft.priceLowCents + draft.priceHighCents) / 2 / 100) * 100;
        setPriceInput(priceCentsToInput(mid));
      }
      setAiEstimate({ lowCents: draft.priceLowCents, highCents: draft.priceHighCents });
      setAutofillNote({
        text: draft.simulated
          ? 'Demo draft: AI autofill is off on this server, so these are placeholder details.'
          : 'Filled in from your photos. Check every detail before you publish.',
      });
    },
    onError: (err) => setAutofillNote({ text: err.message, error: true }),
  });

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
  } else if (priceCents > MAX_PRICE_CENTS) {
    errors.price = `Asking prices top out at ${formatPrice(MAX_PRICE_CENTS)}.`;
  }
  if (spotIds.length === 0) errors.spots = 'Pick at least one campus meetup place.';
  if (windows.length === 0) errors.windows = 'Add at least one time you can meet in the next 24 hours.';

  const visible = (key: keyof FieldErrors): string | undefined =>
    (touched[key] || triedSubmit) && errors[key] ? errors[key] : undefined;

  const uploading = photos.some((p) => p.status === 'uploading');
  const donePhotoUrls = photos.filter((p) => p.status === 'done' && p.url).map((p) => p.url!);
  const showAutofill = enableAutofill && donePhotoUrls.length > 0 && !uploading;
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

    if (priceCents! > HIGH_PRICE_CENTS) {
      confirmAction(
        'Looks high',
        `${formatPrice(priceCents!)} is a lot for a campus sale. Items that are priced to sell go faster. Post it at this price?`,
        'Post at this price',
        submitNow,
        { cancelLabel: 'Change price', destructive: false },
      );
      return;
    }
    submitNow();
  }

  function submitNow() {
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
          {showAutofill ? (
            <Button
              title={autofillNote && !autofillNote.error ? 'Fill in again from photos' : 'Fill in details from photos'}
              variant="secondary"
              onPress={() => {
                setAutofillNote(null);
                draftMutation.mutate({ photoUrls: donePhotoUrls.slice(0, 4) });
              }}
              loading={draftMutation.isPending}
              disabled={draftMutation.isPending}
              style={styles.autofill}
            />
          ) : null}
          {autofillNote ? (
            <Text variant="caption" color={autofillNote.error ? 'danger' : 'inkMuted'} style={styles.error}>
              {autofillNote.text}
            </Text>
          ) : null}
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
            onChangeText={(t) => setPriceInput(sanitizePriceInput(t))}
            onBlur={() => setTouched((t) => ({ ...t, price: true }))}
            error={visible('price')}
            keyboardType="decimal-pad"
            maxLength={7}
            helper={
              OFFERS_ENABLED
                ? 'At least $1. You keep 100% — buyers pay you in person. Buyers can book at this price or send you an offer below it.'
                : 'At least $1. You keep 100% — buyers pay you in person. Buyers book your price and a time.'
            }
          />
          {bookedNotice ? (
            <Text variant="caption" color="inkMuted" style={styles.error}>
              {bookedNotice}
            </Text>
          ) : null}
          <PriceGuideBar
            category={category}
            title={title}
            priceCents={priceCents}
            aiEstimate={aiEstimate}
            excludeListingId={listingId}
            onUsePrice={(cents) => {
              setPriceInput(priceCentsToInput(cents));
              setTouched((t) => ({ ...t, price: true }));
            }}
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
            placeholder="Measurements, what's included, any flaws or wear, why you're selling it"
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
          {windowsNotice ? (
            <Text variant="caption" color="inkMuted" style={styles.label}>
              {windowsNotice}
            </Text>
          ) : null}
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

        {hasError && triedSubmit ? (
          <Text variant="caption" color="danger" style={styles.summary} accessibilityRole="alert">
            {Object.keys(errors).length === 1 ? '1 thing left to fix' : `${Object.keys(errors).length} things left to fix`}
          </Text>
        ) : null}
        {publishCaption ? (
          <Text variant="caption" color="inkMuted" style={styles.caption}>
            {publishCaption}
          </Text>
        ) : null}
        <Button
          title={uploading ? 'Uploading photos…' : submitLabel}
          onPress={handleSubmit}
          loading={submitting}
          disabled={uploading || submitting}
          style={styles.submit}
        />
        {afterSubmit ? <View style={styles.afterSubmit}>{afterSubmit}</View> : null}
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
  autofill: { marginTop: space.md },
  submitError: { marginTop: space.lg, textAlign: 'center' },
  submit: { marginTop: space.md },
  caption: { marginTop: space.xl, textAlign: 'center' },
  summary: { marginTop: space.lg, textAlign: 'center' },
  afterSubmit: { marginTop: space.lg, alignItems: 'center' },
});

export default ListingForm;
