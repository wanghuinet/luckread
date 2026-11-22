import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

describe('native public content search', () => {
  it('calls the real canonical search endpoint with query and opaque pagination cursor', () => {
    const api = read('../lib/social-screen-api.ts');
    expect(api).toContain('export function fetchContentSearchPage');
    expect(api).toContain("'/search?' + params.toString()");
    expect(api).toContain("params.set('cursor', options.cursor)");
    expect(api).toContain('auth: false');
  });

  it('renders real mapped API results and supports submitting and loading more', () => {
    const screen = read('../app/(drawer)/(tabs)/(search)/search.tsx');
    expect(screen).toContain('fetchContentSearchPage(query');
    expect(screen).toContain('mapContentToFeedContent(item, undefined, social, author, sessionToken)');
    expect(screen).not.toContain('readContentBody(');
    expect(screen).toContain('Do not dereference bodyRef or');
    expect(screen).toContain('<FeedItem');
    expect(screen).toContain('runContentSearch(false)');
    expect(screen).toContain('runContentSearch(true)');
    expect(screen).toContain('加载更多搜索结果');
    expect(screen).toContain('没有找到匹配的公开内容');
    expect(screen).toContain('推荐搜索词');
    expect(screen).toContain('不代表全站搜索量排名');
    expect(screen).toContain('runContentSearch(false, term)');
  });

  it('does not fall back to fake or locally filtered sample posts', () => {
    const screen = read('../app/(drawer)/(tabs)/(search)/search.tsx');
    expect(screen).not.toContain('samplePosts');
    expect(screen).not.toContain('filter((post) => post.message');
  });
});

describe('native X-style search center', () => {
  it('uses the real W04 trending-search projection instead of presenting topics as search-volume trends', () => {
    const api = read('../lib/social-screen-api.ts');
    const screen = read('../app/(drawer)/(tabs)/(search)/search.tsx');
    expect(api).toContain('export function fetchTrendingSearches');
    expect(api).toContain("'/search/trending?' + params.toString()");
    expect(screen).toContain('fetchTrendingSearches({ limit: 10, signal: controller.signal })');
    expect(screen).toContain('近期热门搜索');
    expect(screen).toContain('W04 聚合趋势');
    expect(screen).not.toContain('topics.slice(0, 8)');
    expect(screen).not.toContain('不代表全站搜索量排名');
  });

  it('isolates recent searches in SecureStore by the active account and supports delete and clear', () => {
    const history = read('../lib/search-history.ts');
    const screen = read('../app/(drawer)/(tabs)/(search)/search.tsx');
    expect(history).toContain('SEARCH_HISTORY_STORAGE_PREFIX');
    expect(history).toContain('searchHistoryStorageKey(viewerId)');
    expect(history).toContain('MAX_SEARCH_HISTORY_ITEMS = 10');
    expect(screen).toContain("import * as SecureStore from 'expo-secure-store';");
    expect(screen).toContain('readSearchHistory(SecureStore, viewerId)');
    expect(screen).toContain('addSearchHistoryEntry(SecureStore, scope, query)');
    expect(screen).toContain('removeSearchHistoryEntry(SecureStore, scope, term)');
    expect(screen).toContain('clearSearchHistory(SecureStore, scope)');
    expect(screen).toContain('最近搜索');
    expect(screen).toContain('清空');
  });

  it('runs a selected recent or trending term through the same canonical content search flow', () => {
    const screen = read('../app/(drawer)/(tabs)/(search)/search.tsx');
    expect(screen).toContain('runContentSearch(false, term)');
    expect(screen).toContain('runContentSearch(false, item.term)');
    expect(screen).toContain('fetchContentSearchPage(query');
    expect(screen).toContain('runContentSearch(true)');
  });

  it('does not claim suggestion/autocomplete or unsupported filter APIs are implemented', () => {
    const screen = read('../app/(drawer)/(tabs)/(search)/search.tsx');
    expect(screen).not.toContain('fetchSearchSuggestions');
    expect(screen).not.toContain('/search/suggestions');
    expect(screen).not.toContain('sortBy=');
  });
});
