type LintRequest = {
  type: 'lint';
  requestId: string;
  text: string;
  targetRatios?: {
    dialogue: number;
    action: number;
    description: number;
  };
  themeKeywords?: string[];
};

type LintIssueSeverity = 'error' | 'warning';

type LintIssue = {
  severity: LintIssueSeverity;
  code: string;
  message: string;
};

type LintResult = {
  type: 'lintResult';
  requestId: string;
  metrics: {
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
  issues: LintIssue[];
};

type ErrorResult = {
  type: 'error';
  requestId?: string;
  error: string;
};

function clamp01(v: number): number {
  if (Number.isNaN(v)) return 0;
  if (v < 0) return 0;
  if (v > 1) return 1;
  return v;
}

function countMatches(text: string, re: RegExp): number {
  let count = 0;
  let m: RegExpExecArray | null;
  const r = new RegExp(re.source, re.flags.includes('g') ? re.flags : `${re.flags}g`);
  while ((m = r.exec(text))) count += 1;
  return count;
}

function countKeywordHits(text: string, keywords: string[]): Record<string, number> {
  const hits: Record<string, number> = {};
  for (const k of keywords) {
    const key = k.trim();
    if (!key) continue;
    hits[key] = countMatches(text, new RegExp(escapeRegExp(key), 'g'));
  }
  return hits;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function extractDialogueSegments(text: string): string[] {
  const segs: string[] = [];
  const patterns = [/“([^”]+)”/g, /"([^"]+)"/g, /「([^」]+)」/g];
  for (const p of patterns) {
    let m: RegExpExecArray | null;
    const r = new RegExp(p.source, p.flags);
    while ((m = r.exec(text))) {
      if (m[1]) segs.push(m[1]);
    }
  }
  return segs;
}

function stripDialogue(text: string): string {
  return text
    .replace(/“[^”]*”/g, ' ')
    .replace(/"[^"]*"/g, ' ')
    .replace(/「[^」]*」/g, ' ');
}

function computeRatios(text: string): {
  totalChars: number;
  dialogueChars: number;
  actionChars: number;
  descriptionChars: number;
  dialogueRatio: number;
  actionRatio: number;
  descriptionRatio: number;
  conflictSignalCount: number;
  firstPersonCount: number;
  thirdPersonCount: number;
} {
  const totalChars = text.replace(/\s/g, '').length;
  const dialogueSegs = extractDialogueSegments(text);
  const dialogueChars = dialogueSegs.join('').replace(/\s/g, '').length;

  const nonDialogueText = stripDialogue(text);
  const nonDialogueChars = nonDialogueText.replace(/\s/g, '').length;
  const sentences = nonDialogueText
    .split(/[。！？.!?\n]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  const actionVerbs = [
    '走',
    '跑',
    '冲',
    '抓',
    '推',
    '拉',
    '按',
    '捡',
    '挥',
    '打',
    '踢',
    '躲',
    '扑',
    '跳',
    '摔',
    '掏',
    '拔',
    '关',
    '开',
    '躺',
    '站',
    '坐',
    '笑',
    '哭',
    '吼',
    '低声',
    '喊',
  ];
  const actionRe = new RegExp(actionVerbs.map(escapeRegExp).join('|'), 'g');
  const actionSentenceCount = sentences.filter((s) => actionRe.test(s)).length;
  const actionSentenceRatio = sentences.length > 0 ? actionSentenceCount / sentences.length : 0;

  const actionChars = Math.round(nonDialogueChars * actionSentenceRatio);
  const descriptionChars = Math.max(0, nonDialogueChars - actionChars);

  const denom = Math.max(1, dialogueChars + actionChars + descriptionChars);
  const dialogueRatio = dialogueChars / denom;
  const actionRatio = actionChars / denom;
  const descriptionRatio = descriptionChars / denom;

  const conflictSignalRe = /(但是|然而|却|阻止|对抗|冲突|危机|代价|后果|赌|威胁)/g;
  const conflictSignalCount = countMatches(nonDialogueText, conflictSignalRe);

  const firstPersonCount = countMatches(text, /我|我们|咱们/g);
  const thirdPersonCount = countMatches(text, /他|她|他们|她们|它|它们/g);

  return {
    totalChars,
    dialogueChars,
    actionChars,
    descriptionChars,
    dialogueRatio,
    actionRatio,
    descriptionRatio,
    conflictSignalCount,
    firstPersonCount,
    thirdPersonCount,
  };
}

function buildIssues(
  metrics: ReturnType<typeof computeRatios>,
  targetRatios?: LintRequest['targetRatios'],
  themeKeywordHits?: Record<string, number>
): LintIssue[] {
  const issues: LintIssue[] = [];

  if (metrics.totalChars >= 400 && metrics.conflictSignalCount === 0) {
    issues.push({
      severity: 'warning',
      code: 'plot.conflict_weak',
      message: '冲突信号偏弱：建议在场景中强化对抗、代价与转折。',
    });
  }

  if (metrics.firstPersonCount > 10 && metrics.thirdPersonCount > 10) {
    issues.push({
      severity: 'warning',
      code: 'style.pov_drift',
      message: '疑似叙述视角漂移：第一人称与第三人称同时大量出现。',
    });
  }

  if (targetRatios) {
    const tD = clamp01(targetRatios.dialogue);
    const tA = clamp01(targetRatios.action);
    const tS = clamp01(targetRatios.description);
    const tol = 0.12;

    if (Math.abs(metrics.dialogueRatio - tD) > tol) {
      issues.push({
        severity: 'warning',
        code: 'ratio.dialogue',
        message: `对白比例偏离目标：当前 ${(metrics.dialogueRatio * 100).toFixed(0)}%，目标 ${(tD * 100).toFixed(0)}%。`,
      });
    }
    if (Math.abs(metrics.actionRatio - tA) > tol) {
      issues.push({
        severity: 'warning',
        code: 'ratio.action',
        message: `动作比例偏离目标：当前 ${(metrics.actionRatio * 100).toFixed(0)}%，目标 ${(tA * 100).toFixed(0)}%。`,
      });
    }
    if (Math.abs(metrics.descriptionRatio - tS) > tol) {
      issues.push({
        severity: 'warning',
        code: 'ratio.description',
        message: `描写比例偏离目标：当前 ${(metrics.descriptionRatio * 100).toFixed(0)}%，目标 ${(tS * 100).toFixed(0)}%。`,
      });
    }
  }

  if (themeKeywordHits) {
    const keywords = Object.keys(themeKeywordHits);
    if (keywords.length > 0) {
      const totalHits = keywords.reduce((sum, k) => sum + (themeKeywordHits[k] ?? 0), 0);
      if (metrics.totalChars >= 800 && totalHits === 0) {
        issues.push({
          severity: 'warning',
          code: 'theme.missing',
          message: '主题线索覆盖不足：本段未出现主题关键词（可用意象/价值冲突替代直白复述）。',
        });
      }
    }
  }

  return issues;
}

self.onmessage = (event: MessageEvent<LintRequest>) => {
  const msg = event.data;
  try {
    if (msg.type !== 'lint') return;
    const metrics = computeRatios(msg.text);
    const themeKeywordHits = msg.themeKeywords ? countKeywordHits(msg.text, msg.themeKeywords) : {};
    const issues = buildIssues(metrics, msg.targetRatios, themeKeywordHits);
    const res: LintResult = {
      type: 'lintResult',
      requestId: msg.requestId,
      metrics: { ...metrics, themeKeywordHits },
      issues,
    };
    self.postMessage(res);
  } catch (e) {
    const err: ErrorResult = {
      type: 'error',
      requestId: msg?.requestId,
      error: e instanceof Error ? e.message : String(e),
    };
    self.postMessage(err);
  }
};

export {};
