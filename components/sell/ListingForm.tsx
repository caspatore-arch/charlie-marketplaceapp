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
import { SellTodayToggle } from './SellTodayToggle';
import { SaleTypeSelector, type SaleType } from './SaleTypeSelector';
import { space } from '@/constants/theme';
import { CATEGORIES, CATEGORY_LABELS, CONDITIONS, CONDITION_LABELS, CLOTHING_SIZE_OPTIONS, SHOE_SIZE_OPTIONS } from '@/constants/campus';
import type { Category, Condition } from '@/constants/campus';

export interface ListingFormInitialValues {
  photos: PhotoItem[];
  saleType: SaleType;
  startPriceCents: number | null;
  buyoutPriceCents: number | null;
  /** Bids already placed on this auction. > 0 freezes the price fields. */
  bidCount: number;
  title: string;
  category: Category | null;
  condition: Condition | null;
  priceCents: number | null;
  size: string;
  brand: string;
  description: string;
  spotIds: string[];
  windows: WindowItem[];
  isSellToday: boolean;
}

export interface ListingFormSubmitValues {
  saleType: SaleType;
  startPriceCents?: number;
  buyoutPriceCents?: number | null;
  title: string;
  description?: string;
  category: Category;
  condition: Condition;
  priceCents: number;
  size?: string;
  brand?: string;
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
  onSubmit: (values: ListingFormSubmitValues) => void;
  onDirtyChange?: (dirty: boolean) => void;
  /** Extra content rendered below the form fields, above Publish (edit screen's "More" section). */
  footer?: React.ReactNode;
}

const DEFAULTS: ListingFormInitialValues = {
  photos: [],
  saleType: 'fixed',
  startPriceCents: null,
  buyoutPriceCents: null,
  bidCount: 0,
  title: '',
  category: null,
  condition: null,
  priceCents: null,
  size: '',
  brand: '',
  description: '',
  spotIds: [],
  windows: [],
  isSellToday: false,
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
  startPrice?: string;
  buyoutPrice?: string;
  spots?: string;
}

const FIELD_ORDER: (keyof FieldErrors)[] = [
  'photos',
  'title',
  'category',
  'condition',
  'price',
  'startPrice',
  'buyoutPrice',
  'spots',
];

/** docs/AUCTIONS.md §1: the $1 floor a platform fee can round against. */
const MIN_START_PRICE_CENTS = 100;

export const ListingForm = forwardRef<ListingFormHandle, ListingFormProps>(function ListingForm(
  { initialValues, submitLabel, submitting = false, submitError, onSubmit, onDirtyChange, footer },
  ref,
) {
  const merged = { ...DEFAULTS, ...initialValues };
  const { user } = useAuth();
  const campusId = user?.campus?.id;
  const spotsQuery = trpc.campus.spots.useQuery({ campusId: campusId! }, { enabled: !!campusId });

  const [photos, setPhotos] = useState<PhotoItem[]>(merged.photos);
  const [title, setTitle] = useState(merged.title);
  const [category, setCategory] = useState<Category | null>(merged.category);
  const [condition, setCondition] = useState<Condition | null>(merged.condition);
  const [priceInput, setPriceInput] = useState(priceCentsToInput(merged.priceCents));
  const [saleType, setSaleType] = useState<SaleType>(merged.saleType);
  const [startPriceInput, setStartPriceInput] = useState(priceCentsToInput(merged.startPriceCents));
  const [buyoutPriceInput, setBuyoutPriceInput] = useState(
    priceCentsToInput(merged.buyoutPriceCents),
  );
  const [size, setSize] = useState(merged.size);
  const [brand, setBrand] = useState(merged.brand);
  const [description, setDescription] = useState(merged.description);
  const [spotIds, setSpotIds] = useState<string[]>(merged.spotIds);
  const [windows, setWindows] = useState<WindowItem[]>(merged.windows);
  const [isSellToday, setIsSellToday] = useState(merged.isSellToday);

  const [touched, setTouched] = useState<Partial<Record<keyof FieldErrors, boolean>>>({});
  const [triedSubmit, setTriedSubmit] = useState(false);

  const scrollRef = useRef<ScrollView>(null);
  const sectionY = useRef<Partial<Record<keyof FieldErrors, number>>>({});

  const priceCents = parsePriceInput(priceInput);
  const startPriceCents = parsePriceInput(startPriceInput);
  const buyoutPriceCents = parsePriceInput(buyoutPriceInput);
  const isAuction = saleType === 'auction';
  // Rule 6: an auction that already has bids has made a promise to its bidders.
  const pricesLocked = merged.bidCount > 0 && merged.saleType === 'auction';
  const showSize = category === 'clothing' || category === 'shoes';
  const sizeOptions = category === 'shoes' ? SHOE_SIZE_OPTIONS : CLOTHING_SIZE_OPTIONS;

  const initialSnapshot = useMemo(
    () =>
      JSON.stringify({
        title: merged.title,
        category: merged.category,
        condition: merged.condition,
        priceCents: merged.priceCents,
        saleType: merged.saleType,
        startPriceCents: merged.startPriceCents,
        buyoutPriceCents: merged.buyoutPriceCents,
        size: merged.size,
        brand: merged.brand,
        description: merged.description,
        spotIds: [...merged.spotIds].sort(),
        windowCount: merged.windows.length,
        isSellToday: merged.isSellToday,
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
    saleType,
    startPriceCents,
    buyoutPriceCents,
    size,
    brand,
    description,
    spotIds: [...spotIds].sort(),
    windowCount: windows.length,
    isSellToday,
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
  if (isAuction) {
    if (startPriceCents === null) errors.startPrice = 'Set a start price for your auction.';
    else if (startPriceCents < MIN_START_PRICE_CENTS) {
      errors.startPrice = 'The start price has to be at least $1.';
    }
    if (
      buyoutPriceCents !== null &&
      startPriceCents !== null &&
      buyoutPriceCents <= startPriceCents
    ) {
      errors.buyoutPrice = 'Buy it now has to be more than the start price.';
    }
  } else if (priceCents === null || priceCents <= 0) {
    errors.price = 'Enter a price above $0.';
  }
  if (spotIds.length === 0) errors.spots = 'Pick at least one pickup spot.';

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
      saleType,
      startPriceCents: isAuction ? startPriceCents! : undefined,
      buyoutPriceCents: isAuction ? buyoutPriceCents : undefined,
      title: title.trim(),
      description: description.trim() || undefined,
      category: category!,
      condition: condition!,
      // An auction's price IS its start price; the server mirrors it too.
      priceCents: isAuction ? startPriceCents! : priceCents!,
      size: showSize && size ? size : undefined,
      brand: brand.trim() || undefined,
      isSellToday: isAuction ? false : isSellToday,
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
        <View>
          <Text variant="label" color="inkMuted" style={styles.label}>
            How are you selling it?
          </Text>
          <SaleTypeSelector value={saleType} onChange={setSaleType} disabled={pricesLocked} />
          {pricesLocked ? (
            <Text variant="caption" color="inkMuted" style={styles.error}>
              This auction already has bids, so the sale type and prices are locked. Bidders have
              committed to buy at these prices.
            </Text>
          ) : null}
        </View>

        <Divider style={styles.divider} />

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

        {isAuction ? (
          <>
            <View onLayout={recordY('startPrice')} style={styles.field}>
              <Input
                label="Start price"
                placeholder="0.00"
                value={startPriceInput}
                onChangeText={setStartPriceInput}
                onBlur={() => setTouched((t) => ({ ...t, startPrice: true }))}
                error={visible('startPrice')}
                editable={!pricesLocked}
                keyboardType="decimal-pad"
                helper="At least $1."
              />
              <Text variant="caption" color="inkMuted" style={styles.auctionNote}>
                If only one person bids, your item sells at the start price. Set it to the least
                you would happily accept.
              </Text>
            </View>

            <View onLayout={recordY('buyoutPrice')} style={styles.field}>
              <Input
                label="Buy it now (optional)"
                placeholder="0.00"
                value={buyoutPriceInput}
                onChangeText={setBuyoutPriceInput}
                onBlur={() => setTouched((t) => ({ ...t, buyoutPrice: true }))}
                error={visible('buyoutPrice')}
                editable={!pricesLocked}
                keyboardType="decimal-pad"
                helper="Leave blank for bidding only. Must be more than the start price."
              />
              <Text variant="caption" color="inkMuted" style={styles.auctionNote}>
                Someone can end the auction early by paying this. Bidding runs for 24 hours; a bid
                in the last 2 minutes adds 2 more.
              </Text>
            </View>
          </>
        ) : (
          <View onLayout={recordY('price')} style={styles.field}>
            <Input
              label="Price"
              placeholder="0.00"
              value={priceInput}
              onChangeText={setPriceInput}
              onBlur={() => setTouched((t) => ({ ...t, price: true }))}
              error={visible('price')}
              keyboardType="decimal-pad"
            />
          </View>
        )}

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
            Pickup spots
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

        <View style={styles.field}>
          <Text variant="label" color="inkMuted" style={styles.label}>
            Availability windows
          </Text>
          <WindowEditor windows={windows} onChange={setWindows} />
        </View>

        <Divider style={styles.divider} />

        {isAuction ? (
          <View style={styles.field}>
            <Text variant="caption" color="inkMuted">
              Auctions run for 24 hours from the moment you publish. &quot;Sell today&quot; is for
              fixed-price listings.
            </Text>
          </View>
        ) : (
          <View style={styles.field}>
            <SellTodayToggle value={isSellToday} onChange={setIsSellToday} />
          </View>
        )}

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
  auctionNote: { marginTop: space.xs, lineHeight: 16 },
  divider: { marginVertical: space.xl },
  footer: { marginTop: space.xl },
  submitError: { marginTop: space.lg, textAlign: 'center' },
  submit: { marginTop: space.xl },
});

export default ListingForm;
