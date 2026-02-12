import type * as monaco from 'monaco-editor';
import type { SensitiveWordMatch } from '../services/SensitiveWordService';

export interface SensitiveWordHoverProviderParams {
  getMatches: () => SensitiveWordMatch[];
}

function getSeverityLabel(severity: SensitiveWordMatch['severity']): string {
  if (severity === 'low') return '低';
  if (severity === 'medium') return '中';
  return '高';
}

function getSeverityEmoji(severity: SensitiveWordMatch['severity']): string {
  if (severity === 'low') return '⚠️';
  if (severity === 'medium') return '⚠️';
  return '🚫';
}

export function createSensitiveWordHoverProvider({ getMatches }: SensitiveWordHoverProviderParams): monaco.languages.HoverProvider {
  return {
    provideHover: (model, position) => {
      const RangeCtor = (globalThis as any).monaco?.Range;
      if (!RangeCtor) return null;

      const offset = model.getOffsetAt(position as any);
      const matches = getMatches();
      const match = matches.find((m) => offset >= m.startIndex && offset < m.endIndex);
      if (!match) return null;

      const start = model.getPositionAt(match.startIndex);
      const end = model.getPositionAt(match.endIndex);
      const range = new RangeCtor(start.lineNumber, start.column, end.lineNumber, end.column);

      const severityLabel = getSeverityLabel(match.severity);
      const emoji = getSeverityEmoji(match.severity);

      return {
        range,
        contents: [
          { value: `${emoji} 敏感词：${match.word}（${severityLabel}）` },
          { value: `建议：替换或弱化表达，避免触发敏感内容。` },
        ],
      } as any;
    },
  } as any;
}

