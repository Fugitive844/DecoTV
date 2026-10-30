/* eslint-disable @typescript-eslint/no-explicit-any, no-console */

import { NextRequest, NextResponse } from 'next/server';

import { resolveAdultFilter } from '@/lib/adult-filter';
import { getConfig } from '@/lib/config';
import {
  fetchDoubanJson,
  fetchDoubanText,
  isDoubanFetchError,
  resolveServerDoubanProxyConfig,
} from '@/lib/douban-proxy';
import { getDetailFromApi, searchFromApi } from '@/lib/downstream';
import { rankSearchResults } from '@/lib/search-ranking';
import {
  decodeTvboxId,
  encodeTvboxId,
  getLastNonEmptySearchParam,
  TvboxEncodedIdPayload,
} from '@/lib/tvbox-utils';
import { DoubanItem, SearchResult } from '@/lib/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type DoubanCategoryMode = 'recent-hot' | 'recommend' | 'top250';

interface TvboxDoubanCategory {
  type_id: string;
  type_name: string;
  mode: DoubanCategoryMode;
  kind: 'movie' | 'tv';
  category?: string;
  format?: string;
  label?: string;
  region?: string;
  sort?: string;
}

interface DoubanRecentHotResponse {
  items: Array<{
    id: string;
    title: string;
    card_subtitle?: string;
    pic?: {
      large?: string;
      normal?: string;
    };
    rating?: {
      value?: number;
    };
  }>;
}

interface DoubanRecommendResponse {
  items: Array<{
    id: string;
    title: string;
    year?: string;
    type?: string;
    pic?: {
      large?: string;
      normal?: string;
    };
    rating?: {
      value?: number;
    };
  }>;
}

interface DoubanSearchSubjectsResponse {
  subjects: Array<{
    id: string;
    title: string;
    cover: string;
    rate: string;
  }>;
}

const TVBOX_DOUBAN_CATEGORIES: TvboxDoubanCategory[] = [
  {
    type_id: 'movie_hot',
    type_name: '豆瓣热门电影',
    mode: 'recent-hot',
    kind: 'movie',
    category: '热门',
  },
  {
    type_id: 'movie_top250',
    type_name: '豆瓣 Top250',
    mode: 'top250',
    kind: 'movie',
  },
  {
    type_id: 'movie_latest',
    type_name: '豆瓣最新电影',
    mode: 'recent-hot',
    kind: 'movie',
    category: '最新',
  },
  {
    type_id: 'movie_high_score',
    type_name: '豆瓣高分电影',
    mode: 'recent-hot',
    kind: 'movie',
    category: '豆瓣高分',
  },
  {
    type_id: 'movie_chinese',
    type_name: '华语电影',
    mode: 'recommend',
    kind: 'movie',
    region: '华语',
  },
  {
    type_id: 'tv_hot',
    type_name: '热门剧集',
    mode: 'recent-hot',
    kind: 'tv',
    category: 'tv',
  },
  {
    type_id: 'tv_domestic',
    type_name: '国产剧',
    mode: 'recent-hot',
    kind: 'tv',
    category: 'tv',
    label: 'tv_domestic',
  },
  {
    type_id: 'tv_animation',
    type_name: '动画番剧',
    mode: 'recent-hot',
    kind: 'tv',
    category: 'tv',
    label: 'tv_animation',
  },
  {
    type_id: 'show_hot',
    type_name: '热门综艺',
    mode: 'recent-hot',
    kind: 'tv',
    category: 'show',
    format: '综艺',
  },
];

function jsonText(payload: unknown, status = 200): NextResponse {
  return new NextResponse(JSON.stringify(payload), {
    status,
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'public, max-age=300, s-maxage=300',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
}

function getCategory(typeId: string | null): TvboxDoubanCategory {
  return (
    TVBOX_DOUBAN_CATEGORIES.find((category) => category.type_id === typeId) ||
    TVBOX_DOUBAN_CATEGORIES[0]
  );
}

function getPageStart(searchParams: URLSearchParams, limit: number): number {
  const page = Math.max(1, Number(searchParams.get('pg') || '1') || 1);
  return (page - 1) * limit;
}

function getYearFromSubtitle(value?: string): string {
  return value?.match(/(\d{4})/)?.[1] || '';
}

function normalizeDoubanRate(value: unknown): string {
  const rating = Number(value);
  return Number.isFinite(rating) && rating > 0 ? rating.toFixed(1) : '';
}

function toDoubanItemFromRecent(
  item: DoubanRecentHotResponse['items'][number],
) {
  return {
    id: item.id,
    title: item.title,
    poster: item.pic?.normal || item.pic?.large || '',
    rate: normalizeDoubanRate(item.rating?.value),
    year: getYearFromSubtitle(item.card_subtitle),
  };
}

function toDoubanItemFromRecommend(
  item: DoubanRecommendResponse['items'][number],
) {
  return {
    id: item.id,
    title: item.title,
    poster: item.pic?.normal || item.pic?.large || '',
    rate: normalizeDoubanRate(item.rating?.value),
    year: item.year || '',
  };
}

async function fetchDoubanItems(
  request: NextRequest,
  category: TvboxDoubanCategory,
  pageStart: number,
  limit: number,
): Promise<DoubanItem[]> {
  const proxyConfig = await resolveServerDoubanProxyConfig(request);

  if (category.mode === 'top250') {
    const target = `https://movie.douban.com/top250?start=${pageStart}&filter=`;
    const doubanResult = await fetchDoubanText(target, proxyConfig);
    const html = doubanResult.data;
    const moviePattern =
      /<div class="item">[\s\S]*?<a[^>]+href="https?:\/\/movie\.douban\.com\/subject\/(\d+)\/"[\s\S]*?<img[^>]+alt="([^"]+)"[^>]*src="([^"]+)"[\s\S]*?<span class="rating_num"[^>]*>([^<]*)<\/span>[\s\S]*?<\/div>/g;
    const movies: DoubanItem[] = [];
    let match;

    while ((match = moviePattern.exec(html)) !== null) {
      movies.push({
        id: match[1],
        title: match[2],
        poster: match[3].replace(/^http:/, 'https:'),
        rate: match[4] || '',
        year: '',
      });
    }

    return movies;
  }

  if (category.mode === 'recent-hot') {
    const params = new URLSearchParams({
      start: String(pageStart),
      limit: String(limit),
      category: category.category || category.kind,
      type:
        category.label ||
        (category.kind === 'movie'
          ? '全部'
          : category.category || category.kind),
    });
    const target = `https://m.douban.com/rexxar/api/v2/subject/recent_hot/${category.kind}?${params.toString()}`;
    const result = await fetchDoubanJson<DoubanRecentHotResponse>(
      target,
      proxyConfig,
    );
    return result.data.items.map(toDoubanItemFromRecent);
  }

  const selectedCategories: Record<string, string> = {};
  if (category.category) selectedCategories['类型'] = category.category;
  if (category.format) selectedCategories['形式'] = category.format;
  if (category.region) selectedCategories['地区'] = category.region;

  const tags = [
    category.category,
    category.format,
    category.region,
    category.label,
  ].filter((item): item is string => Boolean(item));
  try {
    const searchSubjectsParams = new URLSearchParams({
      type: category.kind,
      tag: tags[0] || category.category || category.kind,
      sort: 'recommend',
      page_limit: String(limit),
      page_start: String(pageStart),
    });
    const searchSubjectsTarget = `https://movie.douban.com/j/search_subjects?${searchSubjectsParams.toString()}`;
    const searchSubjectsResult =
      await fetchDoubanJson<DoubanSearchSubjectsResponse>(
        searchSubjectsTarget,
        proxyConfig,
      );

    if (searchSubjectsResult.data.subjects.length > 0) {
      return searchSubjectsResult.data.subjects.map((item) => ({
        id: item.id,
        title: item.title,
        poster: item.cover,
        rate: item.rate || '',
        year: '',
      }));
    }
  } catch (error) {
    console.warn('[TVBox Douban] search_subjects fallback:', error);
  }

  const params = new URLSearchParams({
    refresh: '0',
    start: String(pageStart),
    count: String(limit),
    selected_categories: JSON.stringify(selectedCategories),
    uncollect: 'false',
    score_range: '0,10',
    tags: tags.join(','),
  });
  if (category.sort) params.set('sort', category.sort);

  const target = `https://m.douban.com/rexxar/api/v2/${category.kind}/recommend?${params.toString()}`;
  const result = await fetchDoubanJson<DoubanRecommendResponse>(
    target,
    proxyConfig,
  );
  return result.data.items
    .filter((item) => item.type === 'movie' || item.type === 'tv')
    .map(toDoubanItemFromRecommend);
}

function toCategoryResponse() {
  return {
    code: 1,
    msg: 'success',
    class: TVBOX_DOUBAN_CATEGORIES.map((category) => ({
      type_id: category.type_id,
      type_name: category.type_name,
    })),
    list: [],
  };
}

function toDoubanVod(item: DoubanItem, category: TvboxDoubanCategory) {
  const payload: TvboxEncodedIdPayload = {
    kind: 'douban',
    id: item.id,
    title: item.title,
    poster: item.poster,
    year: item.year,
    rate: item.rate,
    typeName: category.type_name,
  };

  return {
    vod_id: encodeTvboxId(payload),
    vod_name: item.title,
    vod_pic: item.poster,
    vod_remarks: item.rate ? `豆瓣 ${item.rate}` : item.year || '',
    vod_year: item.year || '',
    type_name: category.type_name,
    vod_content: '豆瓣导航条目，打开详情后将自动聚合可播放资源。',
  };
}

function buildVodPlayUrl(result: SearchResult): string {
  return result.episodes
    .map((url, index) => {
      const title = result.episodes_titles?.[index] || `第${index + 1}集`;
      return `${title}$${url}`;
    })
    .join('#');
}

function toPlayableVod(result: SearchResult) {
  const payload: TvboxEncodedIdPayload = {
    kind: 'source',
    id: result.id,
    title: result.title,
    source: result.source,
    sourceName: result.source_name,
  };

  return {
    vod_id: encodeTvboxId(payload),
    vod_name: result.title,
    vod_pic: result.poster,
    vod_remarks: result.remarks || result.quality_tag || result.year || '',
    vod_year: result.year || '',
    vod_content: result.desc || '',
    type_name: result.type_name || result.class || result.source_name,
    vod_play_from: result.source_name || result.source,
    vod_play_url: buildVodPlayUrl(result),
  };
}

async function searchPlayableSources(
  request: NextRequest,
  query: string,
  maxResults = 8,
): Promise<SearchResult[]> {
  const config = await getConfig();
  const { searchParams } = new URL(request.url);
  const filterAdult = await resolveAdultFilter(
    searchParams,
    config.SiteConfig.DisableYellowFilter,
  );
  const sourceLimit = Math.max(
    1,
    Number(process.env.TVBOX_DOUBAN_SOURCE_LIMIT || '18') || 18,
  );
  const timeoutMs = Math.max(
    1000,
    Number(process.env.TVBOX_DOUBAN_SEARCH_TIMEOUT || '6500') || 6500,
  );

  const sources = config.SourceConfig.filter((source) => {
    if (source.disabled) return false;
    if (filterAdult && source.is_adult) return false;
    return true;
  }).slice(0, sourceLimit);

  const results: SearchResult[] = [];
  const concurrency = 6;

  for (let index = 0; index < sources.length; index += concurrency) {
    const batch = sources.slice(index, index + concurrency);
    const settled = await Promise.allSettled(
      batch.map((source) =>
        Promise.race([
          searchFromApi(source, query),
          new Promise<SearchResult[]>((resolve) =>
            setTimeout(() => resolve([]), timeoutMs),
          ),
        ]),
      ),
    );

    for (const item of settled) {
      if (item.status === 'fulfilled') {
        results.push(
          ...item.value.filter(
            (result) =>
              Array.isArray(result.episodes) && result.episodes.length > 0,
          ),
        );
      }
    }
  }

  return rankSearchResults(results, query).slice(0, maxResults);
}

function mergePlayableResultsAsVod(
  payload: Extract<TvboxEncodedIdPayload, { kind: 'douban' }>,
  results: SearchResult[],
) {
  const playableResults = results.filter(
    (result) => result.episodes.length > 0,
  );

  return {
    vod_id: encodeTvboxId(payload),
    vod_name: payload.title,
    vod_pic: payload.poster || playableResults[0]?.poster || '',
    vod_remarks: payload.rate ? `豆瓣 ${payload.rate}` : payload.year || '',
    vod_year: payload.year || playableResults[0]?.year || '',
    vod_content:
      playableResults[0]?.desc ||
      '来自豆瓣导航，已按片名聚合现有资源站播放地址。',
    type_name: payload.typeName || playableResults[0]?.type_name || '豆瓣导航',
    vod_play_from: playableResults
      .map((result) => result.source_name || result.source)
      .join('$$$'),
    vod_play_url: playableResults.map(buildVodPlayUrl).join('$$$'),
  };
}

async function getDetailVod(
  request: NextRequest,
  encodedId: string,
): Promise<any> {
  const payload = decodeTvboxId(encodedId);
  if (!payload) {
    return {
      vod_id: encodedId,
      vod_name: '未知条目',
      vod_play_from: '',
      vod_play_url: '',
    };
  }

  if (payload.kind === 'source') {
    const config = await getConfig();
    const source = config.SourceConfig.find(
      (item) => item.key === payload.source,
    );
    if (!source || source.disabled) {
      return {
        vod_id: encodedId,
        vod_name: payload.title,
        vod_play_from: '',
        vod_play_url: '',
      };
    }

    try {
      return toPlayableVod(await getDetailFromApi(source, payload.id));
    } catch {
      const fallbackResults = await searchPlayableSources(
        request,
        payload.title,
        4,
      );
      return mergePlayableResultsAsVod(
        {
          kind: 'douban',
          id: payload.id,
          title: payload.title,
          typeName: payload.sourceName,
        },
        fallbackResults,
      );
    }
  }

  const results = await searchPlayableSources(request, payload.title, 6);
  return mergePlayableResultsAsVod(payload, results);
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const ac = (searchParams.get('ac') || '').toLowerCase();
    const keyword = getLastNonEmptySearchParam(searchParams, [
      'wd',
      'q',
      'key',
      'keyword',
      'searchword',
    ]);

    if (keyword) {
      const results = await searchPlayableSources(request, keyword, 20);
      return jsonText({
        code: 1,
        msg: 'success',
        page: 1,
        pagecount: 1,
        limit: results.length,
        total: results.length,
        list: results.map(toPlayableVod),
      });
    }

    const ids = getLastNonEmptySearchParam(searchParams, ['ids', 'id']);
    if (ac === 'detail' || ids) {
      const vod = await getDetailVod(request, ids);
      return jsonText({
        code: 1,
        msg: 'success',
        list: [vod],
      });
    }

    if (ac === 'class') {
      return jsonText(toCategoryResponse());
    }

    const typeId =
      getLastNonEmptySearchParam(searchParams, ['t', 'type', 'type_id']) ||
      TVBOX_DOUBAN_CATEGORIES[0].type_id;
    const category = getCategory(typeId);
    const limit = Math.min(
      50,
      Math.max(1, Number(searchParams.get('limit') || '20') || 20),
    );
    const pageStart = getPageStart(searchParams, limit);
    const page = Math.max(1, Number(searchParams.get('pg') || '1') || 1);
    const list = await fetchDoubanItems(request, category, pageStart, limit);

    return jsonText({
      code: 1,
      msg: 'success',
      page,
      pagecount: list.length >= limit ? page + 1 : page,
      limit,
      total: pageStart + list.length,
      class: TVBOX_DOUBAN_CATEGORIES.map((item) => ({
        type_id: item.type_id,
        type_name: item.type_name,
      })),
      list: list.map((item) => toDoubanVod(item, category)),
    });
  } catch (error) {
    console.error('[TVBox Douban] failed:', error);
    return jsonText(
      {
        code: 500,
        msg: error instanceof Error ? error.message : '豆瓣导航加载失败',
        providerAttempts: isDoubanFetchError(error)
          ? error.attempts
          : undefined,
        list: [],
      },
      500,
    );
  }
}

export async function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
}
