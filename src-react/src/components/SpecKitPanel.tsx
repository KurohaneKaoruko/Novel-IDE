import React, { useMemo, useState } from 'react';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, Legend } from 'recharts';
import { specKitService } from '../services';
import type { StorySpec, SpecKitArcMap, SpecKitValidationReport } from '../services';
import './SpecKitPanel.css';

const keyBeats = [
  'hook',
  'inciting_incident',
  'turning_point_1',
  'midpoint',
  'turning_point_2',
  'climax',
  'resolution',
] as const;

export const SpecKitPanel: React.FC = () => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [storySpec, setStorySpec] = useState<StorySpec | null>(null);
  const [report, setReport] = useState<SpecKitValidationReport | null>(null);
  const [arcMap, setArcMap] = useState<SpecKitArcMap | null>(null);
  const [lastExport, setLastExport] = useState<string | null>(null);

  const beatToChapter = useMemo(() => {
    if (!storySpec) return new Map<string, number>();
    const map = new Map<string, number>();
    storySpec.chapters.forEach((ch, idx) => {
      if (keyBeats.includes(ch.beat_id as any) && !map.has(ch.beat_id)) {
        map.set(ch.beat_id, idx + 1);
      }
    });
    return map;
  }, [storySpec]);

  const actCounts = useMemo(() => {
    if (!storySpec) return { act1: 0, act2: 0, act3: 0 };
    return storySpec.chapters.reduce(
      (acc, ch) => {
        if (ch.act === 'act1') acc.act1 += 1;
        else if (ch.act === 'act2') acc.act2 += 1;
        else if (ch.act === 'act3') acc.act3 += 1;
        return acc;
      },
      { act1: 0, act2: 0, act3: 0 }
    );
  }, [storySpec]);

  const actChartData = useMemo(() => {
    if (!storySpec) return [];
    return storySpec.chapters.map((ch, i) => ({
      chapter: i + 1,
      act1: ch.act === 'act1' ? 1 : 0,
      act2: ch.act === 'act2' ? 1 : 0,
      act3: ch.act === 'act3' ? 1 : 0,
      beat: ch.beat_id,
      title: ch.title,
    }));
  }, [storySpec]);

  const arcDisplay = useMemo(() => {
    if (!storySpec || !arcMap) return [];
    const byId = new Map(storySpec.characters.map((c) => [c.id, c]));
    return arcMap.character_maps.map((m) => {
      const character = byId.get(m.character_id);
      const entries = Object.entries(m.beat_to_arc_step_index)
        .map(([beat, idx]) => {
          const step = character?.arc_steps?.[idx] ?? `步骤 ${idx + 1}`;
          return { beat, step };
        })
        .sort((a, b) => keyBeats.indexOf(a.beat as any) - keyBeats.indexOf(b.beat as any));
      return { ...m, entries };
    });
  }, [storySpec, arcMap]);

  const onGenerate = async () => {
    try {
      setLoading(true);
      setError(null);
      const spec = await specKitService.generateOutline();
      setStorySpec(spec);
      setReport(null);
      setArcMap(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  const onValidate = async () => {
    try {
      setLoading(true);
      setError(null);
      const r = await specKitService.validateStorySpec();
      setReport(r);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  const onMatchArcs = async () => {
    try {
      setLoading(true);
      setError(null);
      const map = await specKitService.matchCharacterArcs();
      setArcMap(map);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  const onExport = async (kind: 'md' | 'epub' | 'pdf') => {
    try {
      setLoading(true);
      setError(null);
      setLastExport(null);
      const path =
        kind === 'md'
          ? await specKitService.exportMarkdown()
          : kind === 'epub'
            ? await specKitService.exportEpub()
            : await specKitService.exportPdf();
      setLastExport(path);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  const issueSummary = useMemo(() => {
    if (!report) return { error: 0, warning: 0 };
    return report.issues.reduce(
      (acc, it) => {
        if (it.severity === 'error') acc.error += 1;
        else acc.warning += 1;
        return acc;
      },
      { error: 0, warning: 0 }
    );
  }, [report]);

  return (
    <>
      <div className="sidebar-header">Spec-Kit</div>
      <div className="sidebar-content spec-kit-panel">
        <div className="spec-kit-toolbar">
          <button disabled={loading} onClick={() => void onGenerate()}>
            生成三幕大纲
          </button>
          <button disabled={loading} onClick={() => void onValidate()}>
            校验
          </button>
          <button disabled={loading} onClick={() => void onMatchArcs()}>
            匹配弧线
          </button>
          <div style={{ flex: 1 }} />
          <button disabled={loading} onClick={() => void onExport('md')}>
            导出 MD
          </button>
          <button disabled={loading} onClick={() => void onExport('epub')}>
            导出 EPUB
          </button>
          <button disabled={loading} onClick={() => void onExport('pdf')}>
            导出 PDF
          </button>
        </div>

        {error ? <div className="error-text">{error}</div> : null}
        {lastExport ? <div style={{ padding: '0 10px', fontSize: 12, color: '#8bc34a' }}>已导出: {lastExport}</div> : null}

        {storySpec ? (
          <div className="spec-kit-block">
            <div className="spec-kit-title">结构概览</div>
            <div className="spec-kit-kv">
              <div>类型: {storySpec.story.story_type}</div>
              <div>目标字数: {storySpec.story.target_words}</div>
              <div>章节: {storySpec.chapters.length}</div>
              <div>
                幕比例: {actCounts.act1}/{actCounts.act2}/{actCounts.act3}
              </div>
            </div>

            <div className="spec-kit-chart">
              <ResponsiveContainer width="100%" height={160}>
                <BarChart data={actChartData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                  <XAxis dataKey="chapter" tick={{ fontSize: 10 }} interval={0} height={30} />
                  <YAxis hide domain={[0, 1]} />
                  <Tooltip
                    content={({ active, payload }) => {
                      if (!active || !payload || payload.length === 0) return null;
                      const p = payload[0].payload as any;
                      return (
                        <div className="spec-kit-tooltip">
                          <div className="tooltip-title">
                            第{p.chapter}章 {p.title}
                          </div>
                          <div>Beat: {p.beat}</div>
                        </div>
                      );
                    }}
                  />
                  <Legend />
                  <Bar dataKey="act1" stackId="a" name="Act 1" fill="#4f81bd" isAnimationActive={false} />
                  <Bar dataKey="act2" stackId="a" name="Act 2" fill="#c0504d" isAnimationActive={false} />
                  <Bar dataKey="act3" stackId="a" name="Act 3" fill="#9bbb59" isAnimationActive={false} />
                </BarChart>
              </ResponsiveContainer>
            </div>

            <div className="spec-kit-subtitle">关键节拍</div>
            <div className="spec-kit-beats">
              {keyBeats.map((b) => (
                <div key={b} className="spec-kit-beat-row">
                  <span className="spec-kit-beat-id">{b}</span>
                  <span className="spec-kit-beat-ch">{beatToChapter.get(b) ? `第${beatToChapter.get(b)}章` : '未出现'}</span>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div style={{ padding: 10, color: '#888' }}>尚未生成 StorySpec（先点“生成三幕大纲”）。</div>
        )}

        {report ? (
          <div className="spec-kit-block">
            <div className="spec-kit-title">合规报告</div>
            <div className="spec-kit-kv">
              <div>错误: {issueSummary.error}</div>
              <div>警告: {issueSummary.warning}</div>
            </div>
            <div className="spec-kit-issues">
              {report.issues.length === 0 ? (
                <div style={{ padding: 8, color: '#8bc34a' }}>全部通过</div>
              ) : (
                report.issues.map((it, idx) => (
                  <div key={`${it.code}-${idx}`} className={`spec-kit-issue ${it.severity}`}>
                    <div className="spec-kit-issue-head">
                      <span className="spec-kit-issue-sev">{it.severity}</span>
                      <span className="spec-kit-issue-code">{it.code}</span>
                    </div>
                    <div className="spec-kit-issue-msg">{it.message}</div>
                    <div className="spec-kit-issue-path">{it.path}</div>
                  </div>
                ))
              )}
            </div>
          </div>
        ) : null}

        {arcMap ? (
          <div className="spec-kit-block">
            <div className="spec-kit-title">弧线匹配</div>
            {arcDisplay.length === 0 ? (
              <div style={{ padding: 10, color: '#888' }}>暂无弧线映射</div>
            ) : (
              <div className="spec-kit-arcs">
                {arcDisplay.map((c) => (
                  <div key={c.character_id} className="spec-kit-arc-card">
                    <div className="spec-kit-arc-title">
                      {c.character_name} ({c.archetype_id})
                    </div>
                    {c.entries.length === 0 ? (
                      <div style={{ padding: 8, color: '#888' }}>无可映射节拍</div>
                    ) : (
                      c.entries.map((e) => (
                        <div key={`${c.character_id}-${e.beat}`} className="spec-kit-arc-row">
                          <span className="spec-kit-arc-beat">{e.beat}</span>
                          <span className="spec-kit-arc-step">{e.step}</span>
                        </div>
                      ))
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : null}
      </div>
    </>
  );
};
