import type { ChatMessage, AgentEventData } from '../../api/chat';
import type { SourcePaper } from './SourcePanel';

// ─── 公共常量 ───────────────────────────────────────────────────────────────
export const CHAT_STORAGE_KEY = 'chat_messages';
export const CHAT_SOURCES_KEY = 'chat_sources';
export const CHAT_SESSION_KEY = 'chat_session_id';
export const CHAT_EXPERT_KEY  = 'chat_expert_id';

export const TIMELINE_EVENT_TYPES = new Set([
    'step', 'tool', 'observation', 'coverage', 'keywords', 'thinking',
    'tool_call', 'tool_result', 'subagent_start', 'subagent_end',
    'mode_profile', 'error',
]);

// ─── 数据结构 ────────────────────────────────────────────────────────────────
export interface LlmStreamItem {
    key: string;
    title: string;
    content: string;
    done?: boolean;
    status?: string;
}

export interface ExplorationPathData {
    path: Array<{ query: string; step_number?: number }>;
    current: string;
    step: number;
}

export interface AtpsVisualizationPayload {
    type: 'atps_phase_diagram';
    title?: string;
    mode?: 'merchuk' | 'points';
    image_url?: string;
    point_count?: number;
    parameters?: Record<string, number>;
    points?: Array<{ x: number; y: number }>;
}

export interface PhaseDiagramVisualizationPayload {
    type: 'phase_diagram';
    title?: string;
    diagram_type?: string;
    axes?: {
        x?: { label?: string; unit?: string; min?: number; max?: number };
        y?: { label?: string; unit?: string; min?: number; max?: number };
    };
    curves?: Array<{
        label: string;
        curve_type: string;
        points: Array<{ x: number; y: number }>;
        style?: string;
        color?: string;
    }>;
    regions?: Array<{
        label: string;
        boundary_points?: Array<{ x: number; y: number }>;
        color?: string;
        opacity?: number;
    }>;
    critical_points?: Array<{
        label: string;
        x: number;
        y: number;
        annotation?: string;
    }>;
    formulas?: Array<{
        latex: string;
        description?: string;
    }>;
    annotations?: Array<{
        text: string;
        x: number;
        y: number;
    }>;
    system_info?: string;
    conditions?: string;
}

export type VisualizationPayload = AtpsVisualizationPayload | PhaseDiagramVisualizationPayload;

export interface Message extends ChatMessage {
    id: string;
    isThinking?: boolean;
    thinkingContent?: Record<string, any>;
    agentEvents?: AgentEventData[];
    llmStreams?: Record<string, LlmStreamItem>;
    sources?: SourcePaper[];
    reviewOutline?: any;
    explorePath?: ExplorationPathData;
    visualizations?: VisualizationPayload[];
    templateResults?: Array<Record<string, any>>;
}

// ─── 组件 Props ──────────────────────────────────────────────────────────────
export interface ChatInterfaceProps {
    onSourcesUpdate: (sources: SourcePaper[]) => void;
    onSessionChange?: (sessionId?: string) => void;
    onCreateExpert?: () => void;
    onCiteClick?: (sourceId: string) => void;
}
