/**
 * Browse tab: campus header, filter row (category / pickup today / price /
 * size), infinite-scrolling 2-col listing grid, pull-to-refresh, skeleton
 * loading, and empty/error states. Works signed-out — every query here is
 * `listing.feed` (public) plus `campus.list` (public).
 */
import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, FlatList, Platform, Pressable, RefreshControl, StyleSheet, View, useWindowDimensions } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { Heart, LayoutGrid, Layers, Search } from 'lucide-react-native';
import { Screen } from '@/components/ui/Screen';
import { Text } from '@/components/ui/Text';
import { RefetchBanner } from '@/components/ui/RefetchBanner';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { ListingCard } from '@/components/ListingCard';
import { FilterBar, type CategoryFilter } from '@/components/browse/FilterBar';
import { SearchBar } from '@/components/browse/SearchBar';
import { PriceFilterSheet } from '@/components/browse/PriceFilterSheet';
import { SizeFilterSheet } from '@/components/browse/SizeFilterSheet';
import { BrowseGridSkeleton } from '@/components/browse/BrowseGridSkeleton';
import { SwipeDeck } from '@/components/browse/SwipeDeck';
import { trpc } from '@/lib/trpc';
import { useRequireAuth } from '@/hooks/useAuth';
import { breakpoints, colors, maxContentWidth, minTouchHeight, radius, space } from '@/constants/theme';
import { DEFAULT_CAMPUS_SLUG, CLOTHING_SIZE_OPTIONS, SHOE_SIZE_OPTIONS } from '@/constants/campus';
import { formatPrice } from '@/utils/format';
import type { ListingCard as ListingCardType } from '@/types';

type ViewMode = 'grid' | 'swipe';

const keyExtractor = (item: ListingCardType) => item.id;

/**
 * One grid cell. Memoized so a parent state change (typing in search, opening
 * a sheet, a fetch flag flipping) does not re-render every visible card: all
 * props here are primitives or stable references, and `onOpen` is a single
 * callback shared by every cell (ListingCard calls it with its own id).
 */
const GridCell = memo(function GridCell({
  item,
  maxWidth,
  onOpen,
}: {
  item: ListingCardType;
  maxWidth: `${number}%`;
  onOpen: (id: string) => void;
}) {
  return (
    <View style={[styles.gridCell, { maxWidth }]}>
      <ListingCard listing={item} onPressListing={onOpen} />
    </View>
  );
});

export default function BrowseScreen() {
  const router = useRouter();
  const requireAuth = useRequireAuth();
  const utils = trpc.useUtils();
  const [viewMode, setViewMode] = useState<ViewMode>('grid');

  // Use useWindowDimensions (not Dimensions.get) so resizing a desktop
  // browser window updates the column count. Dimensions.get freezes at the
  // width the app started at (see components/PhotoGallery.tsx ~line 31).
  // The available grid width is capped at maxContentWidth when the viewport
  // exceeds breakpoints.lg, matching the centred column in Screen.tsx.
  const { width: windowWidth } = useWindowDimensions();
  const gridWidth = windowWidth >= breakpoints.lg
    ? Math.min(windowWidth, maxContentWidth)
    : windowWidth;
  // 2 columns up to lg breakpoint; 3 columns from lg upward (≥768px).
  // A 3rd column at 768px gives ~240px per card — wide enough for a photo
  // and price, and still comfortable in a half-screen laptop window.
  const numColumns = gridWidth >= breakpoints.lg ? 3 : 2;

  const campusQuery = trpc.campus.list.useQuery();
  const campus = useMemo(() => {
    const list = campusQuery.data ?? [];
    return list.find((c) => c.slug === DEFAULT_CAMPUS_SLUG) ?? list[0];
  }, [campusQuery.data]);

  const [category, setCategory] = useState<CategoryFilter>('all');
  const [pickupToday, setPickupToday] = useState(false);
  const [minCents, setMinCents] = useState<number | undefined>(undefined);
  const [maxCents, setMaxCents] = useState<number | undefined>(undefined);
  const [size, setSize] = useState<string | undefined>(undefined);
  const [priceSheetOpen, setPriceSheetOpen] = useState(false);
  const [sizeSheetOpen, setSizeSheetOpen] = useState(false);

  const [searchInput, setSearchInput] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  useEffect(() => {
    const handle = setTimeout(() => setDebouncedSearch(searchInput.trim()), 300);
    return () => clearTimeout(handle);
  }, [searchInput]);
  const hasSearch = debouncedSearch.length > 0;

  const sizeVisible = category === 'clothing' || category === 'shoes';
  const sizeOptions = category === 'clothing' ? CLOTHING_SIZE_OPTIONS : category === 'shoes' ? SHOE_SIZE_OPTIONS : [];

  const handleCategoryChange = useCallback((next: CategoryFilter) => {
    setCategory(next);
    if (next !== 'clothing' && next !== 'shoes') setSize(undefined);
  }, []);

  const filtersActive =
    category !== 'all' ||
    pickupToday ||
    minCents !== undefined ||
    maxCents !== undefined ||
    (sizeVisible && size !== undefined);

  const clearFilters = useCallback(() => {
    setCategory('all');
    setPickupToday(false);
    setMinCents(undefined);
    setMaxCents(undefined);
    setSize(undefined);
  }, []);

  const clearFiltersAndSearch = useCallback(() => {
    clearFilters();
    setSearchInput('');
    setDebouncedSearch('');
  }, [clearFilters]);

  const priceLabel = useMemo(() => {
    if (minCents === undefined && maxCents === undefined) return 'Price';
    if (minCents !== undefined && maxCents !== undefined) {
      return `${formatPrice(minCents)}–${formatPrice(maxCents)}`;
    }
    if (minCents !== undefined) return `${formatPrice(minCents)}+`;
    return `Up to ${formatPrice(maxCents!)}`;
  }, [minCents, maxCents]);

  const feedQuery = trpc.listing.feed.useInfiniteQuery(
    {
      campusId: campus?.id ?? '',
      q: hasSearch ? debouncedSearch : undefined,
      category: category === 'all' ? undefined : category,
      minCents,
      maxCents,
      size: sizeVisible ? size : undefined,
      pickupToday: pickupToday || undefined,
      limit: 20,
    },
    {
      enabled: !!campus,
      getNextPageParam: (last) => last.nextCursor,
      initialCursor: undefined as string | undefined,
    },
  );

  const items = useMemo(
    () => feedQuery.data?.pages.flatMap((p) => p.items) ?? ([] as ListingCardType[]),
    [feedQuery.data],
  );

  const goToListing = useCallback((id: string) => router.push(`/listing/${id}`), [router]);

  // Right-swipe/save mutation for swipe mode. Mirrors listing/[id].tsx's
  // toggleSave usage, but always `saved: true` — a swipe-right never unsaves.
  const toggleSaveMutation = trpc.listing.toggleSave.useMutation({
    onSettled: (_data, _err, vars) => {
      utils.listing.saved.invalidate();
      utils.listing.byId.invalidate({ id: vars.id });
    },
    onError: (err) => Alert.alert('Could not save', err.message),
  });

  const onSwipeSave = useCallback(
    (item: ListingCardType) => {
      if (!requireAuth('/')) return false;
      toggleSaveMutation.mutate({ id: item.id, saved: true });
      return true;
    },
    [requireAuth, toggleSaveMutation],
  );

  // Keyed on the feed's inputs: any change remounts the deck at its first
  // card rather than leaving it at a stale index into a different list.
  const deckResetKey = useMemo(
    () =>
      JSON.stringify({
        campusId: campus?.id,
        q: hasSearch ? debouncedSearch : undefined,
        category,
        minCents,
        maxCents,
        size: sizeVisible ? size : undefined,
        pickupToday,
      }),
    [campus?.id, hasSearch, debouncedSearch, category, minCents, maxCents, sizeVisible, size, pickupToday],
  );

  // The campus name is identity, so it scrolls away with the content. Search
  // and the filter row are controls: they stay pinned above the grid, because
  // in an infinite feed a filter you have to scroll back up to reach is a
  // filter people stop using.
  const { hasNextPage, isFetchingNextPage, fetchNextPage } = feedQuery;
  // Stable so the deck's near-end effect doesn't re-fire (and re-request a
  // page that just failed) on every render.
  // The ref closes the gap the flags leave: onEndReached can fire twice before
  // a re-render flips isFetchingNextPage, and fetchNextPage cancels and
  // restarts an in-flight request by default.
  const loadingMoreRef = useRef(false);
  const loadMore = useCallback(() => {
    if (loadingMoreRef.current || !hasNextPage || isFetchingNextPage) return;
    loadingMoreRef.current = true;
    fetchNextPage().finally(() => {
      loadingMoreRef.current = false;
    });
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  // Scroll position. Tab screens stay mounted under a pushed listing, but on
  // web the hidden screen's scroller can come back at 0, so remember the
  // offset (a ref: no re-renders while scrolling) and restore it on focus.
  const listRef = useRef<FlatList<ListingCardType>>(null);
  const scrollOffset = useRef(0);
  const onScroll = useCallback((e: { nativeEvent: { contentOffset: { y: number } } }) => {
    scrollOffset.current = e.nativeEvent.contentOffset.y;
  }, []);
  useFocusEffect(
    useCallback(() => {
      const y = scrollOffset.current;
      if (y <= 0) return;
      const handle = requestAnimationFrame(() => listRef.current?.scrollToOffset({ offset: y, animated: false }));
      return () => cancelAnimationFrame(handle);
    }, []),
  );
  // A different feed (new filters/search) or column count starts at the top.
  useEffect(() => {
    scrollOffset.current = 0;
  }, [deckResetKey, numColumns]);

  const onRefresh = useCallback(() => {
    feedQuery.refetch();
  }, [feedQuery.refetch]);
  const renderItem = useCallback(
    ({ item }: { item: ListingCardType }) => (
      <GridCell item={item} maxWidth={`${(100 / numColumns).toFixed(4)}%` as `${number}%`} onOpen={goToListing} />
    ),
    [numColumns, goToListing],
  );

  const controlsBlock = (
    <View style={styles.controls}>
      <View style={styles.searchRow}>
        <View style={styles.searchBarFlex}>
          <SearchBar value={searchInput} onChangeText={setSearchInput} />
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Saved items"
          onPress={() => router.push('/saved')}
          hitSlop={8}
          style={({ pressed }) => [styles.viewToggle, pressed && styles.viewTogglePressed]}
        >
          <Heart size={20} color={colors.ink} />
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={viewMode === 'grid' ? 'Switch to swipe view' : 'Switch to grid view'}
          onPress={() => setViewMode((m) => (m === 'grid' ? 'swipe' : 'grid'))}
          hitSlop={8}
          style={({ pressed }) => [styles.viewToggle, pressed && styles.viewTogglePressed]}
        >
          {viewMode === 'grid' ? (
            <Layers size={20} color={colors.ink} />
          ) : (
            <LayoutGrid size={20} color={colors.ink} />
          )}
        </Pressable>
      </View>
      <View style={styles.filterWrap}>
        <FilterBar
          category={category}
          onCategoryChange={handleCategoryChange}
          pickupToday={pickupToday}
          onTogglePickupToday={() => setPickupToday((v) => !v)}
          priceLabel={priceLabel}
          priceActive={minCents !== undefined || maxCents !== undefined}
          onPressPrice={() => setPriceSheetOpen(true)}
          sizeVisible={sizeVisible}
          sizeLabel={size ?? 'Size'}
          sizeActive={!!size}
          onPressSize={() => setSizeSheetOpen(true)}
        />
      </View>
    </View>
  );

  const headerBlock = (
    <View style={styles.header}>
      <View style={styles.brandRow}>
        {campus?.name ? <Text variant="heading">{campus.name}</Text> : null}
        {campus?.isDemo ? (
          <Text variant="caption" color="inkFaint" style={styles.demoNote}>
            Demo campus: listings and spots are for demonstration only
          </Text>
        ) : null}
      </View>
      <Text variant="bodySm" color="inkMuted">
        Buy and sell the same day. Get cash for things you don&apos;t use, or buy something at a college discount.
      </Text>
      {feedQuery.isError && items.length > 0 ? <RefetchBanner onRetry={() => feedQuery.refetch()} /> : null}
    </View>
  );

  let body: React.ReactNode;
  if (!campus && campusQuery.isPending) {
    body = (
      <View style={styles.bodyPad}>
        {headerBlock}
        <BrowseGridSkeleton numColumns={numColumns} />
      </View>
    );
  } else if (campusQuery.isError) {
    body = (
      <View style={styles.bodyPad}>
        {headerBlock}
        <ErrorState message={campusQuery.error.message} onRetry={() => campusQuery.refetch()} />
      </View>
    );
  } else if (feedQuery.isPending) {
    body = (
      <View style={styles.bodyPad}>
        {headerBlock}
        <BrowseGridSkeleton numColumns={numColumns} />
      </View>
    );
  } else if (feedQuery.isError && items.length === 0) {
    body = (
      <View style={styles.bodyPad}>
        {headerBlock}
        <ErrorState message={feedQuery.error.message} onRetry={() => feedQuery.refetch()} />
      </View>
    );
  } else if (viewMode === 'swipe') {
    body = (
      <SwipeDeck
        key={deckResetKey}
        items={items}
        onOpen={goToListing}
        onSave={onSwipeSave}
        onNearEnd={loadMore}
        hasMore={!!feedQuery.hasNextPage}
        isFetchingMore={feedQuery.isFetchingNextPage}
        onSwitchToGrid={() => setViewMode('grid')}
      />
    );
  } else {
    body = (
      <FlatList
        // key includes numColumns: FlatList cannot change numColumns without
        // remounting — React Native throws a warning and renders incorrectly
        // if numColumns changes on an existing instance. The key forces a
        // clean remount when the window is resized across a breakpoint.
        key={`grid-${numColumns}`}
        ref={listRef}
        data={items}
        keyExtractor={keyExtractor}
        numColumns={numColumns}
        columnWrapperStyle={styles.gridRow}
        contentContainerStyle={styles.gridContent}
        ListHeaderComponent={headerBlock}
        renderItem={renderItem}
        refreshControl={
          <RefreshControl
            refreshing={feedQuery.isRefetching && !feedQuery.isFetchingNextPage}
            onRefresh={onRefresh}
            tintColor={colors.accent}
          />
        }
        // Threshold is in viewport lengths: start the next page ~2 screens
        // before the end so it has landed by the time you get there.
        onEndReachedThreshold={2}
        onEndReached={loadMore}
        onScroll={onScroll}
        scrollEventThrottle={32}
        keyboardDismissMode="on-drag"
        // Counts are rows (numColumns cells each). No getItemLayout: row
        // height is photo (width-dependent 4:5) + 2-5 text lines, so a fixed
        // guess would be wrong and cause jumps; memoized cells keep a wide
        // window cheap instead.
        initialNumToRender={5}
        maxToRenderPerBatch={6}
        updateCellsBatchingPeriod={40}
        windowSize={11}
        removeClippedSubviews={Platform.OS === 'android'}
        ListFooterComponent={
          feedQuery.isFetchingNextPage ? (
            <View style={styles.footerLoading}>
              <BrowseGridSkeleton numColumns={numColumns} rows={1} />
            </View>
          ) : feedQuery.isFetchNextPageError ? (
            <View style={styles.footerNote}>
              <Text variant="body" color="inkMuted" style={styles.footerText}>
                Couldn&apos;t load more.
              </Text>
              <Button title="Try again" variant="secondary" onPress={loadMore} />
            </View>
          ) : !feedQuery.hasNextPage && items.length > 0 ? (
            <View style={styles.footerNote}>
              <Text variant="label" color="inkMuted" style={styles.footerText}>
                That&apos;s everything on {campus?.name ?? 'campus'} right now.
              </Text>
            </View>
          ) : null
        }
        ListEmptyComponent={
          <View style={styles.padHorizontal}>
            <EmptyState
              icon={<Search size={40} color={colors.inkFaint} />}
              title={
                hasSearch
                  ? `No results for "${debouncedSearch}"`
                  : filtersActive
                    ? 'No matches'
                    : 'No listings yet'
              }
              body={
                hasSearch || filtersActive
                  ? 'Try widening your search or filters.'
                  : 'Check back soon — new items get posted often.'
              }
              actionLabel={hasSearch || filtersActive ? 'Clear filters' : undefined}
              onAction={hasSearch || filtersActive ? clearFiltersAndSearch : undefined}
            />
          </View>
        }
      />
    );
  }

  return (
    <Screen padded={false}>
      {controlsBlock}
      {body}
      <PriceFilterSheet
        visible={priceSheetOpen}
        onClose={() => setPriceSheetOpen(false)}
        minCents={minCents}
        maxCents={maxCents}
        onApply={(min, max) => {
          setMinCents(min);
          setMaxCents(max);
        }}
      />
      <SizeFilterSheet
        visible={sizeSheetOpen}
        onClose={() => setSizeSheetOpen(false)}
        options={sizeOptions}
        selected={size}
        onSelect={setSize}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  bodyPad: { flex: 1 },
  padHorizontal: { paddingHorizontal: space.lg },
  brandRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'baseline', columnGap: space.sm },
  header: { paddingTop: space.xs, paddingBottom: space.sm, paddingHorizontal: space.lg },
  demoNote: { flexShrink: 1 },
  controls: {
    paddingHorizontal: space.lg,
    paddingTop: space.sm,
    paddingBottom: space.md,
    backgroundColor: colors.bg,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.line,
  },
  filterWrap: { marginTop: space.md },
  searchRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  searchBarFlex: { flex: 1 },
  viewToggle: {
    width: minTouchHeight,
    height: minTouchHeight,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surface,
  },
  viewTogglePressed: { opacity: 0.85 },
  gridRow: { gap: space.md, paddingHorizontal: space.lg },
  gridContent: { gap: space.md, paddingBottom: space.xxl },
  // flex:1 lets cells share the row equally. maxWidth is applied inline as
  // `1/numColumns %` so a lone last-row cell never stretches to full width.
  // The static 50% is gone — see the renderItem inline style above.
  gridCell: { flex: 1 },
  footerLoading: { paddingTop: space.md },
  footerNote: { alignItems: 'center', gap: space.sm, paddingHorizontal: space.lg, paddingTop: space.lg },
  footerText: { textAlign: 'center' },
});
