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
