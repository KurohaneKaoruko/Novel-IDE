import React, { useEffect, useMemo, useRef, useState } from 'react';
import { specKitService } from '../services';
import type { SpecKitConfig } from '../services';
import './SpecKitLintPanel.css';

type LintMetrics = {
  totalChars: number;
  dialogueChars: number;
  actionChars: number;
  descriptionChars: number;
  dialogueRatio: number;
  actionRatio: number;
  descriptionRatio: number;
  firstPersonCount: number;
  thirdPersonCount: number;
  conflictSignalCount: number;
  themeKeywordHits: Record<string, number>;
};

type LintIssue = {
  severity: 'error' | 'warning';
  code: string;
  message: string;
};

type LintResult = {
  metrics: LintMetrics;
  issues: LintIssue[];
};

export interface SpecKitLintPanelProps {
  text: string;
  enabled: boolean;
}

export const SpecKitLintPanel: React.FC<SpecKitLintPanelProps> = ({ text, enabled }) => {
  const [config, setConfig] = useState<SpecKitConfig | null>(null);
  const [result, setResult] = useState<LintResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const worker = useMemo(() => {
    return new Worker(new URL('../workers/specKitLint.worker.ts', import.meta.url), { type: 'module' });
  }, []);

  const lastRequestIdRef = useRef<string>('');
  const debounceRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      worker.terminate();
    };
  }, [worker]);

  useEffect(() => {
    if (!enabled) return;
    void (async () => {
      try {
        setError(null);
        const cfg = await specKitService.loadConfig();
        setConfig(cfg);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    })();
  }, [enabled]);

  useEffect(() => {
    if (!enabled) return;
    const onMessage = (event: MessageEvent<any>) => {
      const data = event.data;
      if (!data || data.requestId !== lastRequestIdRef.current) return;
      if (data.type === 'lintResult') {
        setResult({ metrics: data.metrics as LintMetrics, issues: data.issues as LintIssue[] });
      } else if (data.type === 'error') {
        setError(data.error || 'lint error');
      }
    };
    worker.addEventListener('message', onMessage);
    return () => worker.removeEventListener('message', onMessage);
  }, [enabled, worker]);

  useEffect(() => {
    if (!enabled) return;
    if (!config) return;
    if (debounceRef.current) window.clearTimeout(debounceRef.current);
    debounceRef.current = window.setTimeout(() => {
      const requestId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      lastRequestIdRef.current = requestId;
      worker.postMessage({
        type: 'lint',
        requestId,
        text,
        targetRatios: config.ratios,
        themeKeywords: config.theme.keywords,
      });
    }, 250);
  }, [enabled, text, config, worker]);

  const pct = (v: number) => `${Math.round(v * 100)}%`;

  return (
    <div className="spec-kit-lint">
      <div className="spec-kit-lint-header">
        <div className="spec-kit-lint-title">Spec-Kit 实时检查</div>
      </div>

      {error ? <div className="error-text" style={{ margin: 10 }}>{error}</div> : null}

      {!enabled ? <div style={{ padding: 10, color: '#888' }}>未启用</div> : null}

      {enabled && !config ? <div style={{ padding: 10, color: '#888' }}>正在加载配置…</div> : null}

      {enabled && config && result ? (
        <>
          <div className="spec-kit-lint-section">
            <div className="spec-kit-lint-section-title">比例</div>
            <div className="spec-kit-lint-rows">
              <div className="spec-kit-lint-row">
                <span>对白</span>
                <span>{pct(result.metrics.dialogueRatio)} / {pct(config.ratios.dialogue)}</span>
              </div>
              <div className="spec-kit-lint-row">
                <span>动作</span>
                <span>{pct(result.metrics.actionRatio)} / {pct(config.ratios.action)}</span>
              </div>
              <div className="spec-kit-lint-row">
                <span>描写</span>
                <span>{pct(result.metrics.descriptionRatio)} / {pct(config.ratios.description)}</span>
              </div>
            </div>
          </div>

          <div className="spec-kit-lint-section">
            <div className="spec-kit-lint-section-title">主题</div>
            {config.theme.keywords.length === 0 ? (
              <div style={{ padding: 10, color: '#888' }}>未设置主题关键词</div>
            ) : (
              <div className="spec-kit-lint-tags">
                {config.theme.keywords.map((k) => (
                  <span key={k} className="spec-kit-lint-tag">
                    {k}: {result.metrics.themeKeywordHits[k] ?? 0}
                  </span>
                ))}
              </div>
            )}
          </div>

          <div className="spec-kit-lint-section">
            <div className="spec-kit-lint-section-title">问题</div>
            {result.issues.length === 0 ? (
              <div style={{ padding: 10, color: '#8bc34a' }}>暂无问题</div>
            ) : (
              <div className="spec-kit-lint-issues">
                {result.issues.map((it, idx) => (
                  <div key={`${it.code}-${idx}`} className={`spec-kit-lint-issue ${it.severity}`}>
                    <div className="spec-kit-lint-issue-code">{it.code}</div>
                    <div className="spec-kit-lint-issue-msg">{it.message}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      ) : null}

      {enabled && config && !result ? <div style={{ padding: 10, color: '#888' }}>正在分析…</div> : null}
    </div>
  );
};
