import type { SourcePaper } from './SourcePanel';
import type {
    Message,
    VisualizationPayload,
} from './ChatInterface.types';
import {
    CHAT_STORAGE_KEY,
    CHAT_SOURCES_KEY,
    CHAT_EXPERT_KEY,
} from './ChatInterface.types';

// ─── 文本解析 ─────────────────────────────────────────────────────────────────

export interface ParsedMessage {
    mainContent: string;
    suggestions: string[];
}

const SUGGESTION_PATTERNS = [
    /---\s*\n\s*\*?\*?您可能还想了解[：:]\*?\*?\s*\n([\s\S]*?)$/i,
    /---\s*\n\s*\*?\*?请选择下一步探索方向[：:]\*?\*?\s*\n([\s\S]*?)$/i,
    /---\s*\n\s*\*?\*?您可以继续探索[：:]\*?\*?\s*\n([\s\S]*?)$/i,
    /---\s*\n\s*\*?\*?You might also want to explore[：:]\*?\*?\s*\n([\s\S]*?)$/i,
    /---\s*\n\s*\*?\*?Related questions[：:]\*?\*?\s*\n([\s\S]*?)$/i,
];

export const parseSuggestions = (content: string): ParsedMessage => {
    let match: RegExpMatchArray | null = null;
    for (const pattern of SUGGESTION_PATTERNS) {
        match = content.match(pattern);
        if (match) break;
    }
    if (!match) return { mainContent: content, suggestions: [] };

    const mainContent = content.slice(0, match.index).trim();
    const suggestions: string[] = [];
    for (const line of match[1].split('\n')) {
        const m = line.match(/^\s*(?:\d+[.、])\s*(?:→\s*)?(.+?)\s*$/);
        if (m?.[1]) {
            const q = m[1].trim().replace(/^[\[→]\s*|\]$/g, '').trim();
            if (q) suggestions.push(q);
        }
    }
    return { mainContent, suggestions };
};

// ─── 可视化块解析 ──────────────────────────────────────────────────────────────

export const parseVisualizationBlocks = (
    content: string,
): { content: string; visualizations: VisualizationPayload[] } => {
    if (!content) return { content, visualizations: [] };
    const visualizations: VisualizationPayload[] = [];
    const cleaned = content.replace(/```livemat-viz\s*([\s\S]*?)```/g, (_match, jsonText) => {
        try {
            const parsed = JSON.parse(jsonText.trim());
            if (parsed?.type) visualizations.push(parsed as VisualizationPayload);
        } catch {
            // ignore malformed blocks
        }
        return '';
    });
    return { content: cleaned.trim(), visualizations };
};

// ─── LLM 流解析 ───────────────────────────────────────────────────────────────

export const tryParseStreamJson = (content: string): Record<string, any> | null => {
    const text = content.trim();
    if (!text || (!text.startsWith('{') && !text.startsWith('['))) return null;
    try {
        const parsed = JSON.parse(text);
        return parsed && typeof parsed === 'object' ? parsed : null;
    } catch {
        return null;
    }
};

export const formatToolLabel = (key: string, title: string): string => {
    const n = (key || title || '').toLowerCase();
    if (n.includes('kb_search') || n.includes('kb_hybrid'))  return 'Knowledge search';
    if (n.includes('library_stats') || n === 'stats')        return 'Statistics';
    if (n.includes('query_analyzer'))  return 'Intent analysis';
    if (n.includes('filter_extractor')) return 'Filter extraction';
    if (n.includes('query_expander'))  return 'Query expansion';
    if (n.includes('query_translator')) return 'Term translation';
    if (n.includes('answer_synthesizer')) return 'Generating answer';
    if (n.includes('review_outline'))  return 'Review outline';
    if (n.includes('phase_diagram'))   return 'Generating phase diagram';
    if (n.includes('template_builder')) return 'Building extraction template';
    if (n.includes('template_extract')) return 'Extracting paper data';
    return title || key;
};

// ─── 来源 ──────────────────────────────────────────────────────────────────────

export const normalizeSources = (items: any[]): SourcePaper[] => {
    if (!Array.isArray(items)) return [];
    return items.map((item: any) => {
        const authors = Array.isArray(item.authors)
            ? item.authors.filter((a: any) => a != null).map(String)
            : [];
        const journal = item.journal || undefined;
        const year = typeof item.year === 'number' ? item.year
            : typeof item.publish_year === 'number' ? item.publish_year
            : null;
        return {
            source_id:     item.source_id || item.paper_id || item.id || crypto.randomUUID(),
            source_type:   item.source_type || 'delivery',
            paper_id:      item.paper_id || null,
            title:         item.paper_title || item.title || 'Untitled source',
            similarity:    typeof item.similarity === 'number' ? item.similarity : 1,
            subtitle:      item.subtitle || journal || undefined,
            library_label: item.library_label || (item.paper_id && !item.source_type ? 'Paper' : 'Knowledge base'),
            authors,
            journal,
            year,
        };
    });
};

export const buildSourceIndexMap = (items: SourcePaper[], offset = 0): Map<string, number> => {
    const map = new Map<string, number>();
    items.forEach((s, idx) => {
        const n = offset + idx + 1;
        map.set(s.source_id, n);
        if (s.paper_id) map.set(s.paper_id, n);
    });
    return map;
};

export const processMessageContent = (
    content: string,
    messageSources: SourcePaper[],
    allSources?: SourcePaper[],
): string => {
    const pool = allSources && allSources.length > 0 ? allSources : messageSources;
    const indexMap = buildSourceIndexMap(pool);

    const resolveLabel = (id: string): string => {
        const n = indexMap.get(id);
        if (n !== undefined) return String(n);
        const src = pool.find(s => s.source_id === id || s.paper_id === id);
        if (src) return src.title.length > 20 ? src.title.slice(0, 20) + '…' : src.title;
        return id.slice(0, 8);
    };

    let result = content.replace(
        /\[source_type:\s*\w+\]\s*\[source_id:\s*([^\]]+)\]/gi,
        (_m, sid) => {
            const trimmed = sid.trim();
            return `[[${resolveLabel(trimmed)}]](#cite/${trimmed})`;
        },
    );
    result = result.replace(/\[source_id:\s*([^\]]+)\]/gi, (_m, sid) => {
        const trimmed = sid.trim();
        return `[[${resolveLabel(trimmed)}]](#cite/${trimmed})`;
    });
    result = result.replace(/\[paper_id:\s*([a-f0-9-]{36})\]/gi, (_m, pid) => {
        const trimmed = pid.trim();
        return `[[${resolveLabel(trimmed)}]](#cite/${trimmed})`;
    });
    return result;
};

// ─── Agent 步骤推导 ────────────────────────────────────────────────────────────

export const buildUserSteps = (
    msg: Message,
): Array<{ label: string; detail?: string; done: boolean }> => {
    const steps: Array<{ label: string; detail?: string; done: boolean; type?: string; originalTitle?: string }> = [];
    const events = msg.agentEvents || [];
    const thinking = msg.thinkingContent;

    for (const ev of events) {
        if (ev.type === 'step') {
            const existingIdx = steps.findIndex(s => s.type === 'step' && s.originalTitle === ev.title && !s.done);
            if (existingIdx >= 0) {
                steps[existingIdx].detail = ev.detail;
                steps[existingIdx].done = ev.status === 'completed' || ev.status === 'failed';
            } else {
                steps.push({
                    label: ev.title || 'Processing',
                    detail: ev.detail,
                    done: ev.status === 'completed' || ev.status === 'failed',
                    type: 'step',
                    originalTitle: ev.title,
                });
            }
        } else if (ev.type === 'tool') {
            // Find if we already have a step for this tool that is running
            const existingIdx = steps.findIndex(s => s.type === 'tool' && s.originalTitle === ev.title && !s.done);
            if (existingIdx >= 0) {
                steps[existingIdx].detail = ev.detail;
                steps[existingIdx].done = ev.status === 'completed' || ev.status === 'failed';
            } else {
                steps.push({
                    label: formatToolLabel(ev.title || '', ev.title || ''),
                    detail: ev.detail,
                    done: ev.status === 'completed' || ev.status === 'failed',
                    type: 'tool',
                    originalTitle: ev.title,
                });
            }
        } else if (ev.type === 'observation') {
            steps.push({
                label: ev.title || 'Observation',
                detail: ev.detail,
                done: true,
                type: 'observation',
            });
        } else if (ev.type === 'tool_call') {
            const toolId = ev.data?.tool_id || ev.title || 'tool';
            steps.push({
                label: toolId,
                detail: ev.data?.args ? JSON.stringify(ev.data.args).slice(0, 80) : ev.detail,
                done: false,
                type: 'tool_call',
                originalTitle: ev.data?.call_id || toolId,
            });
        } else if (ev.type === 'tool_result') {
            const callId = ev.data?.call_id || ev.title;
            const existingIdx = steps.findIndex(
                s => s.type === 'tool_call' && s.originalTitle === callId && !s.done,
            );
            if (existingIdx >= 0) {
                steps[existingIdx].done = true;
                steps[existingIdx].detail = ev.data?.result?.title || ev.detail || 'done';
            }
        } else if (ev.type === 'subagent_start') {
            steps.push({
                label: `@${ev.data?.subagent || ev.title}`,
                detail: ev.data?.task?.slice(0, 60) || ev.detail,
                done: false,
                type: 'subagent',
                originalTitle: ev.data?.subagent || ev.title,
            });
        } else if (ev.type === 'subagent_end') {
            const name = ev.data?.subagent || ev.title;
            const existingIdx = steps.findIndex(
                s => s.type === 'subagent' && s.originalTitle === name && !s.done,
            );
            if (existingIdx >= 0) {
                steps[existingIdx].done = true;
                steps[existingIdx].detail = ev.data?.summary?.slice(0, 60) || 'done';
            }
        }
    }

    if (steps.length === 0 && thinking) {
        if (thinking.search_intent) {
            steps.push({ label: 'Understanding query', done: true });
        }
        if ((thinking.keywords as string[] | undefined)?.length) {
            const kw = (thinking.keywords as string[])
                .map(k => (k.length > 25 ? k.slice(0, 25) + '...' : k))
                .slice(0, 3);
            steps.push({ label: 'Extracting concepts', detail: kw.join(', '), done: true });
        }
        if (steps.length === 0) {
            steps.push({ label: 'Analyzing', done: false });
        }
    }

    return steps;
};

// ─── LocalStorage 辅助 ────────────────────────────────────────────────────────

export const loadSavedExpertId = (): string | undefined => {
    try { return localStorage.getItem(CHAT_EXPERT_KEY) || undefined; }
    catch { return undefined; }
};

export const loadPersistedMessages = (): Message[] => {
    try {
        const saved = localStorage.getItem(CHAT_STORAGE_KEY);
        if (saved) {
            const parsed = JSON.parse(saved);
            return Array.isArray(parsed) ? parsed : [];
        }
    } catch { /* ignore */ }
    return [];
};

export const loadPersistedSources = (): SourcePaper[] => {
    try {
        const saved = localStorage.getItem(CHAT_SOURCES_KEY);
        if (saved) {
            const parsed = JSON.parse(saved);
            if (Array.isArray(parsed)) return normalizeSources(parsed);
        }
    } catch { /* ignore */ }
    return [];
};
