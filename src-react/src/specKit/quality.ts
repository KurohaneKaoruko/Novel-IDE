import type { SpecKitConfig, SpecKitValidationReport } from '../services';

export interface SpecKitLintMetrics {
  dialogueRatio: number;
  actionRatio: number;
  descriptionRatio: number;
  conflictSignalCount: number;
  themeKeywordHits?: Record<string, number>;
}

export interface SpecKitQualityBreakdown {
  structureScore: number;
  ratioScore: number;
  conflictScore: number;
  themeScore: number;
}

export interface SpecKitQualityScore {
  total: number;
  breakdown: SpecKitQualityBreakdown;
}

export function scoreValidationReport(report: SpecKitValidationReport): number {
  const errors = report.issues.filter((i) => i.severity === 'error').length;
  const warnings = report.issues.filter((i) => i.severity === 'warning').length;
  const score = 100 - errors * 20 - warnings * 5;
  return Math.max(0, Math.min(100, score));
}

function ratioPenalty(actual: number, target: number): number {
  const delta = Math.abs(actual - target);
  if (delta <= 0.05) return 0;
  if (delta <= 0.12) return 5;
  if (delta <= 0.2) return 12;
  return 25;
}

export function scoreLintMetrics(metrics: SpecKitLintMetrics, cfg: SpecKitConfig): SpecKitQualityBreakdown {
  const ratioScore = Math.max(
    0,
    100 -
      ratioPenalty(metrics.dialogueRatio, cfg.ratios.dialogue) -
      ratioPenalty(metrics.actionRatio, cfg.ratios.action) -
      ratioPenalty(metrics.descriptionRatio, cfg.ratios.description)
  );

  const conflictScore = metrics.conflictSignalCount > 0 ? 100 : 70;

  const themeKeywords = cfg.theme.keywords.filter(Boolean);
  const totalHits =
    themeKeywords.length === 0
      ? 100
      : themeKeywords.reduce((sum, k) => sum + (metrics.themeKeywordHits?.[k] ?? 0), 0) > 0
        ? 100
        : 70;

  return {
    structureScore: 100,
    ratioScore,
    conflictScore,
    themeScore: totalHits,
  };
}

export function scoreQuality(
  report: SpecKitValidationReport,
  metrics: SpecKitLintMetrics,
  cfg: SpecKitConfig
): SpecKitQualityScore {
  const structureScore = scoreValidationReport(report);
  const lint = scoreLintMetrics(metrics, cfg);

  const total = Math.round(structureScore * 0.55 + lint.ratioScore * 0.25 + lint.conflictScore * 0.1 + lint.themeScore * 0.1);
  return {
    total: Math.max(0, Math.min(100, total)),
    breakdown: { ...lint, structureScore },
  };
}

export function compareVariants(a: SpecKitQualityScore, b: SpecKitQualityScore): 'A' | 'B' | 'tie' {
  if (a.total === b.total) return 'tie';
  return a.total > b.total ? 'A' : 'B';
}

