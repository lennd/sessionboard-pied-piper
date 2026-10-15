import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo } from 'react';
import { Navigate, useParams } from 'react-router-dom';
import { useI18n } from '../../i18n/I18nProvider';
import type { CodeRef } from '../../workspace/panels/CodeDrawer';
import { Workspace } from '../../workspace/Workspace';
import { apiFetch } from '../api';
import { Splash } from '../components/Splash';
import { usePrefs, useUpdatePrefs } from '../local';
import { effectiveLevel, effectiveTheme } from '../preferences';
import { ReviewPanel } from './ReviewPanel';
import { fetchReviewImpact, reviewKey, useReview } from './reviewsApi';

const MAP_STALE_MS = 30_000;

const codeLoader = (reviewId: string) => async (code: CodeRef) => {
  const query = new URLSearchParams({ repo: code.repo, path: code.path, start: String(code.startLine), end: String(code.endLine) });
  return (await apiFetch<{ snippet: string }>(`/reviews/${reviewId}/code?${query.toString()}`)).snippet;
};

/** One change across several repositories: their maps as one system, the pull requests overlaid, and Claude's explanation of the whole. */
export const ReviewPage = () => {
  const { reviewId = '' } = useParams();
  const review = useReview(reviewId);
  const { data: prefs } = usePrefs();
  const updatePrefs = useUpdatePrefs();
  const { t, setLanguage } = useI18n();
  const client = useQueryClient();
  const impact = useQuery({ queryKey: ['review-impact', reviewId], queryFn: () => fetchReviewImpact(reviewId), enabled: Boolean(reviewId), staleTime: MAP_STALE_MS, retry: false });
  const loadCode = useMemo(() => codeLoader(reviewId), [reviewId]);
  const scenes = useMemo(() => (impact.data ? [impact.data] : []), [impact.data]);

  if (review.isError) return <Navigate to="/reviews" replace />;
  if (!review.data) return <Splash />;
  const data = review.data;
  return (
    <>
      {impact.isSuccess && impact.data === null && <p className="alert ok" data-testid="review-no-map" style={{ position: 'fixed', top: 64, left: '50%', transform: 'translateX(-50%)', zIndex: 50 }}>{t('reviews.noMap')}</p>}
      <Workspace
        extraScenes={scenes}
        initialPanel="review"
        panels={[{ id: 'review', glyph: '⇄', title: t('reviews.panel'), render: (ctx) => <ReviewPanel review={data} ctx={ctx} onExplained={() => void client.invalidateQueries({ queryKey: reviewKey(reviewId) })} /> }]}
        loadCode={loadCode}
        theme={effectiveTheme(prefs)}
        onTheme={(theme) => updatePrefs.mutate({ theme })}
        onLanguage={(uiLanguage) => {
          setLanguage(uiLanguage);
          updatePrefs.mutate({ uiLanguage });
        }}
        initialLevel={effectiveLevel(prefs)}
        homeHref="/reviews"
        context={{ title: data.title, detail: data.parts.map((p) => `${p.name} ${p.pull === 'branch' ? '' : `#${p.pull}`}`.trim()).join(' · '), href: '/reviews' }}
      />
    </>
  );
};
