/**
 * Browse tab: campus header, filter row (category / pickup today / price /
 * size), infinite-scrolling 2-col listing grid, pull-to-refresh, skeleton
 * loading, and empty/error states. Works signed-out — every query here is
 * `listing.feed` (public) plus `campus.list` (public).
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { FlatList, Platform, RefreshControl, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Search } from 'lucide-react-native';
import { Screen } from '@/components/ui/Screen';
import { Text } from '@/components/ui/Text';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { ListingCard } from '@/components/ListingCard';
import { FilterBar, type CategoryFilter } from '@/components/browse/FilterBar';
import { SearchBar } from '@/components/browse/SearchBar';
import { PriceFilterSheet } from '@/components/browse/PriceFilterSheet';
import { SizeFilterSheet } from '@/components/browse/SizeFilterSheet';
import { BrowseGridSkeleton } from '@/components/browse/BrowseGridSkeleton';
import { trpc } from '@/lib/trpc';
import { colors, space } from '@/constants/theme';
import { DEFAULT_CAMPUS_SLUG, CLOTHING_SIZE_OPTIONS, SHOE_SIZE_OPTIONS } from '@/constants/campus';
import { formatPrice } from '@/utils/format';
import type { ListingCard as ListingCardType } from '@/types';

export default function BrowseScreen() {
  const router = useRouter();

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

  // The campus name is identity, so it scrolls away with the content. Search
  // and the filter row are controls: they stay pinned above the grid, because
  // in an infinite feed a filter you have to scroll back up to reach is a
  // filter people stop using.
  const controlsBlock = (
    <View style={styles.controls}>
      <SearchBar value={searchInput} onChangeText={setSearchInput} />
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
      <Text variant="title">{campus?.name ?? 'Campus Swap'}</Text>
      {campus?.isDemo ? (
        <Text variant="caption" color="inkFaint" style={styles.demoNote}>
          Demo campus — listings and locations are for demonstration only.
        </Text>
      ) : null}
    </View>
  );

  let body: React.ReactNode;
  if (!campus && campusQuery.isPending) {
    body = (
      <View style={styles.bodyPad}>
        {headerBlock}
        <View style={styles.padHorizontal}>
          <BrowseGridSkeleton />
        </View>
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
        <View style={styles.padHorizontal}>
          <BrowseGridSkeleton />
        </View>
      </View>
    );
  } else if (feedQuery.isError) {
    body = (
      <View style={styles.bodyPad}>
        {headerBlock}
        <ErrorState message={feedQuery.error.message} onRetry={() => feedQuery.refetch()} />
      </View>
    );
  } else {
    body = (
      <FlatList
        data={items}
        keyExtractor={(item) => item.id}
        numColumns={2}
        columnWrapperStyle={styles.gridRow}
        contentContainerStyle={styles.gridContent}
        ListHeaderComponent={headerBlock}
        renderItem={({ item }) => (
          <View style={styles.gridCell}>
            <ListingCard listing={item} onPress={() => goToListing(item.id)} />
          </View>
        )}
        refreshControl={
          <RefreshControl
            refreshing={feedQuery.isRefetching && !feedQuery.isFetchingNextPage}
            onRefresh={() => feedQuery.refetch()}
            tintColor={colors.accent}
          />
        }
        onEndReachedThreshold={0.4}
        onEndReached={() => {
          if (feedQuery.hasNextPage && !feedQuery.isFetchingNextPage) feedQuery.fetchNextPage();
        }}
        keyboardDismissMode="on-drag"
        initialNumToRender={8}
        maxToRenderPerBatch={8}
        windowSize={7}
        removeClippedSubviews={Platform.OS === 'android'}
        ListFooterComponent={
          feedQuery.isFetchingNextPage ? (
            <View style={styles.footerLoading}>
              <BrowseGridSkeleton />
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
  header: { paddingTop: space.sm, paddingBottom: space.md, paddingHorizontal: space.lg },
  demoNote: { marginTop: 2 },
  controls: {
    paddingHorizontal: space.lg,
    paddingTop: space.sm,
    paddingBottom: space.md,
    backgroundColor: colors.bg,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.line,
  },
  filterWrap: { marginTop: space.md },
  gridRow: { gap: space.md, paddingHorizontal: space.lg },
  gridContent: { gap: space.md, paddingBottom: space.xxl },
  // maxWidth pins a lone cell to half the row. With numColumns={2} a flex:1
  // cell stretches to the full width whenever a row is short — one search
  // result rendered as a single giant card.
  gridCell: { flex: 1, maxWidth: '50%' },
  footerLoading: { paddingHorizontal: space.lg, paddingTop: space.md },
});
