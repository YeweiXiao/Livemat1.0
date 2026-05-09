export interface ChatMessage {
    role: 'user' | 'assistant' | 'system';
    content: string;
}

export interface SearchFilters {
    category_ids?: string[];
    year_from?: number;
    year_to?: number;
    authors?: string[];
    journals?: string[];
    feature_filters?: Record<string, any>;
}

export type ChatMode = 'agent' | 'ask';

export interface ChatCompletionOptions {
    query: string;
    history: ChatMessage[];
    filters?: SearchFilters;
    mode?: ChatMode;
    session_id?: string;
    expert_id?: string;
    paper_ids?: string[];
}

export interface AgentMeta {
    name: string;
    description: string;
    mode: 'primary' | 'subagent' | 'all';
    color?: string;
    knowledge_bases?: string[];
}

export interface ChatSession {
    id: string;
    mode: ChatMode;
    title?: string;
    preview?: string;
    message_count?: number;
    filters?: SearchFilters;
    expert_id?: string;
    messages?: ChatMessage[];
    context_paper_ids?: string[];
    context_papers?: SearchResultItem[];
    review_state?: any;
    exploration_path?: any[];
    created_time?: string;
    updated_time?: string;
}

export interface SearchResultItem {
    source_id: string;
    source_type: 'polymer' | 'microbe' | 'delivery';
    paper_id?: string | null;
    title: string;
    similarity: number;
    subtitle?: string;
    library_label?: string;
}

export interface ThinkingData {
    search_intent: boolean;
    keywords: string[];
    root_categories?: string[];
    auto_filters?: any;
    applied_filters?: any;
    display_filters?: any;
    category_ids_mapped?: string[];
    trace_id?: string;
}

export interface AgentEventData {
    type:
        | 'session' | 'thinking' | 'sources' | 'explore_path' | 'review_outline'
        | 'step' | 'tool' | 'observation' | 'coverage' | 'keywords'
        | 'llm_stream' | 'mode_profile'
        | 'tool_call' | 'tool_result' | 'subagent_start' | 'subagent_end'
        | 'permission_ask' | 'permission_reply' | 'visualization' | 'error';
    title: string;
    status?: 'running' | 'completed' | 'failed' | 'info';
    detail?: string;
    meta?: Record<string, any>;
    data?: any;
}

export const chatApi = {
    completions: async (
        options: ChatCompletionOptions,
        onChunk: (chunk: string) => void,
        onError: (err: any) => void
    ) => {
        const token = localStorage.getItem('access_token');
        const baseUrl = import.meta.env.VITE_API_BASE_URL || '/api';

        try {
            const response = await fetch(`${baseUrl}/v1/chat/completions`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({
                    query: options.query,
                    history: options.history,
                    filters: options.filters,
                    mode: options.mode || 'agent',
                    session_id: options.session_id,
                    expert_id: options.expert_id,
                    paper_ids: options.paper_ids || [],
                })
            });

            if (!response.ok) {
                throw new Error(`Chat request failed: ${response.statusText}`);
            }

            const reader = response.body?.getReader();
            const decoder = new TextDecoder();

            if (reader) {
                while (true) {
                    const { done, value } = await reader.read();
                    if (done) break;
                    const chunk = decoder.decode(value, { stream: true });
                    onChunk(chunk);
                }
            }
        } catch (error) {
            onError(error);
        }
    },

    // 获取会话列表
    listSessions: async (limit: number = 20): Promise<ChatSession[]> => {
        const token = localStorage.getItem('access_token');
        const baseUrl = import.meta.env.VITE_API_BASE_URL || '/api';

        const response = await fetch(`${baseUrl}/v1/chat/sessions?limit=${limit}`, {
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });

        if (!response.ok) {
            throw new Error('Failed to fetch sessions');
        }

        const data = await response.json();
        return data.sessions;
    },

    // 获取会话详情
    getSession: async (sessionId: string): Promise<ChatSession> => {
        const token = localStorage.getItem('access_token');
        const baseUrl = import.meta.env.VITE_API_BASE_URL || '/api';

        const response = await fetch(`${baseUrl}/v1/chat/sessions/${sessionId}`, {
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });

        if (!response.ok) {
            throw new Error('Failed to fetch session');
        }

        return response.json();
    },

    // 获取可用 Agent 列表 (新框架)
    listAgents: async (): Promise<AgentMeta[]> => {
        const token = localStorage.getItem('access_token');
        const baseUrl = import.meta.env.VITE_API_BASE_URL || '/api';
        try {
            const response = await fetch(`${baseUrl}/v1/agents`, {
                headers: { 'Authorization': `Bearer ${token}` },
            });
            if (!response.ok) return [];
            const data = await response.json();
            return data.agents || [];
        } catch {
            return [];
        }
    },

    // 删除会话
    deleteSession: async (sessionId: string): Promise<void> => {
        const token = localStorage.getItem('access_token');
        const baseUrl = import.meta.env.VITE_API_BASE_URL || '/api';

        const response = await fetch(`${baseUrl}/v1/chat/sessions/${sessionId}`, {
            method: 'DELETE',
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });

        if (!response.ok) {
            throw new Error('Failed to delete session');
        }
    }
};

// 辅助函数：解析流式响应中的特殊指令
export function parseStreamDirective(chunk: string): {
    type: 'agent_event' | 'text';
    data?: AgentEventData;
    text?: string;
} {
    if (chunk.startsWith('__AGENT_EVENT__:')) {
        try {
            const jsonStr = chunk.replace('__AGENT_EVENT__:', '').trim();
            return { type: 'agent_event', data: JSON.parse(jsonStr) };
        } catch {
            return { type: 'text', text: chunk };
        }
    }

    return { type: 'text', text: chunk };
}

