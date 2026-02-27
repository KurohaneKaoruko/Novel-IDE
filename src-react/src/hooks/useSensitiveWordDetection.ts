import { useCallback, useEffect, useRef, useState } from 'react';

type MonacoEditor = {
  getModel: () => any | null;
  deltaDecorations: (oldDecorations: string[], newDecorations: any[]) => string[];
};

export interface UseSensitiveWordDetectionParams {
  editor: MonacoEditor | null;
  enabled: boolean;
  dictionary: string[];
  debounceMs?: number;
}

export interface UseSensitiveWordDetectionResult {
  sensitiveWordCount: number;
  isDetecting: boolean;
  loadDictionary: (dictionary: string[]) => void;
}

export function useSensitiveWordDetection({
  editor,
  enabled,
  dictionary,
  debounceMs = 300,
}: UseSensitiveWordDetectionParams): UseSensitiveWordDetectionResult {
  const [sensitiveWordCount, setSensitiveWordCount] = useState(0);
  const [isDetecting, setIsDetecting] = useState(false);

  const dictionaryRef = useRef<string[]>(dictionary);
  const decorationsRef = useRef<string[]>([]);
  const workerRef = useRef<Worker | null>(null);
  const debounceTimerRef = useRef<number | null>(null);
  const requestIdRef = useRef<string>('');

  useEffect(() => {
    dictionaryRef.current = dictionary;
  }, [dictionary]);

  const clearDecorations = useCallback(() => {
    if (!editor) return;
    decorationsRef.current = editor.deltaDecorations(decorationsRef.current, []);
  }, [editor]);

  const detectNow = useCallback(() => {
    if (!enabled || !editor) return;
    const model = editor.getModel?.();
    if (!model) return;

    if (!workerRef.current) {
      workerRef.current = new Worker(new URL('../workers/sensitiveWord.worker.ts', import.meta.url), { type: 'module' });
    }

    const requestId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    requestIdRef.current = requestId;
    setIsDetecting(true);

    workerRef.current.postMessage({
      type: 'detect',
      content: model.getValue?.() ?? '',
      dictionary: dictionaryRef.current,
      requestId,
    });
  }, [enabled, editor]);

  const scheduleDetect = useCallback(() => {
    if (debounceTimerRef.current) window.clearTimeout(debounceTimerRef.current);
    debounceTimerRef.current = window.setTimeout(() => {
      detectNow();
    }, debounceMs);
  }, [debounceMs, detectNow]);

  const loadDictionary = useCallback(
    (next: string[]) => {
      dictionaryRef.current = next;
      scheduleDetect();
    },
    [scheduleDetect]
  );

  useEffect(() => {
    if (!enabled) {
      setIsDetecting(false);
      setSensitiveWordCount(0);
      clearDecorations();
      return;
    }

    if (!editor) {
      setIsDetecting(false);
      setSensitiveWordCount(0);
      return;
    }

    const model = editor.getModel?.();
    if (!model) return;

    if (!workerRef.current) {
      workerRef.current = new Worker(new URL('../workers/sensitiveWord.worker.ts', import.meta.url), { type: 'module' });
    }

    workerRef.current.onmessage = (event: MessageEvent<any>) => {
      const data = event.data;
      if (!data || data.requestId !== requestIdRef.current) return;
      if (data.type !== 'detectResult') return;

      const matches = Array.isArray(data.matches) ? data.matches : [];
      setSensitiveWordCount(matches.length);
      setIsDetecting(false);

      const RangeCtor = (globalThis as any).monaco?.Range;
      if (RangeCtor && editor.deltaDecorations) {
        const newDecorations = matches.map((m: any) => {
          const start = model.getPositionAt?.(m.startIndex) ?? { lineNumber: 1, column: 1 };
          const end = model.getPositionAt?.(m.endIndex) ?? { lineNumber: 1, column: 1 };
          return {
            range: new RangeCtor(start.lineNumber, start.column, end.lineNumber, end.column),
            options: { inlineClassName: 'sensitive-word' },
          };
        });
        decorationsRef.current = editor.deltaDecorations(decorationsRef.current, newDecorations);
      }
    };

    const disposable = model.onDidChangeContent?.(() => {
      scheduleDetect();
    });

    detectNow();

    return () => {
      if (debounceTimerRef.current) window.clearTimeout(debounceTimerRef.current);
      if (disposable?.dispose) disposable.dispose();
      if (workerRef.current) {
        workerRef.current.terminate();
        workerRef.current = null;
      }
    };
  }, [enabled, editor, clearDecorations, scheduleDetect, detectNow]);

  return { sensitiveWordCount, isDetecting, loadDictionary };
}
