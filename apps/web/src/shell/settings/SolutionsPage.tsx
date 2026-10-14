import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { useI18n } from '../../i18n/I18nProvider';
import { apiFetch } from '../api';
import { formatRelative } from '../format';
import type { SolutionSummary } from '../solutions/solutionsApi';
import { useSettingsContext } from './SettingsLayout';

export const SolutionsPage = () => {
  const { t, language } = useI18n();
  const { repo: maybeRepo } = useSettingsContext();
  const repo = maybeRepo ?? { id: '' };
  const solutions = useQuery({ queryKey: ['solutions', repo.id], queryFn: () => apiFetch<SolutionSummary[]>(`/repos/${repo.id}/solutions`) });
  return (
    <section>
      <h1>{t('solutions.title')}</h1>
      <p className="shell-sub">{t('solutions.subtitle')}</p>
      {solutions.data && solutions.data.length === 0 && <p className="alert ok" data-testid="solutions-empty">{t('solutions.empty')}</p>}
      {solutions.data && solutions.data.length > 0 && (
        <table className="table">
          <tbody>
            {solutions.data.map((s) => (
              <tr key={s.id} data-testid={`solution-${s.id}`}>
                <td>◆ {s.title}</td>
                <td><span className={`tag status-${s.status}`}>{t(`solutionStatus.${s.status}`)}</span></td>
                <td className="muted-a">{t('solutions.version', { n: s.latestVersion })}</td>
                <td className="muted-a">{t('solutions.progress', { done: s.progress.done, total: s.progress.total })}</td>
                <td className="muted-a">{formatRelative(s.updatedAt, language)}</td>
                <td style={{ textAlign: 'right' }}><Link className="btn-primary btn-small" data-testid={`solution-open-${s.id}`} to={`/repos/${repo.id}/solutions/${s.id}`}>{t('solutions.open')} →</Link></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
};
