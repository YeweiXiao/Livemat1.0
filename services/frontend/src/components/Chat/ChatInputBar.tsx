import React, { useEffect, useCallback } from 'react';
import { Input, Tooltip } from 'antd';
import {
    ArrowUpOutlined,
    FilterOutlined,
    PauseCircleFilled,
    RobotOutlined,
    MessageOutlined,
} from '@ant-design/icons';
import type { SearchFilters, ChatMode } from '../../api/chat';
import styles from './ChatInputBar.module.css';

export interface ChatInputBarProps {
    input: string;
    onInputChange: (value: string) => void;
    loading: boolean;
    chatMode: ChatMode;
    onModeChange: (mode: ChatMode) => void;
    filters: SearchFilters;
    onFiltersChange: (updater: (prev: SearchFilters) => SearchFilters) => void;
    showFilters: boolean;
    onToggleFilters: () => void;
    sessionId?: string;
    inputRef: React.RefObject<any>;
    onSend: () => void;
    onStop?: () => void;
}

const MODES: { key: ChatMode; label: string; icon: React.ReactNode; tooltip: string }[] = [
    { key: 'agent', label: 'LiveMat智能体', icon: <RobotOutlined />, tooltip: '智能检索知识库、检索论文、综合分析' },
    { key: 'ask',   label: '快速问答',      icon: <MessageOutlined />, tooltip: '基于模型知识直接回答' },
];

const PLACEHOLDERS: Record<ChatMode, string> = {
    agent: '输入研究问题...',
    ask:   '输入问题...',
};

export const ChatInputBar: React.FC<ChatInputBarProps> = ({
    input,
    onInputChange,
    loading,
    chatMode,
    onModeChange,
    filters,
    onFiltersChange,
    showFilters,
    onToggleFilters,
    inputRef,
    onSend,
    onStop,
}) => {
    useEffect(() => {
        if (!loading) inputRef.current?.focus?.();
    }, [loading, inputRef]);

    const focusInput = useCallback(() => {
        inputRef.current?.focus?.();
    }, [inputRef]);

    const hasFilters = !!(filters.year_from || filters.year_to || filters.authors?.length || filters.journals?.length);

    return (
        <div className={styles.root}>
            {showFilters && (
                <div className={styles.filterPopup}>
                    <div className={styles.filterGrid}>
                        <div className={styles.filterField}>
                            <span className={styles.filterLabel}>Year</span>
                            <div className={styles.filterInputGroup}>
                                <Input
                                    placeholder="From"
                                    className={styles.filterInput}
                                    size="small"
                                    type="number"
                                    value={filters.year_from || ''}
                                    onChange={e =>
                                        onFiltersChange(f => ({
                                            ...f,
                                            year_from: e.target.value ? parseInt(e.target.value) : undefined,
                                        }))
                                    }
                                />
                                <span className={styles.filterDash}>&ndash;</span>
                                <Input
                                    placeholder="To"
                                    className={styles.filterInput}
                                    size="small"
                                    type="number"
                                    value={filters.year_to || ''}
                                    onChange={e =>
                                        onFiltersChange(f => ({
                                            ...f,
                                            year_to: e.target.value ? parseInt(e.target.value) : undefined,
                                        }))
                                    }
                                />
                            </div>
                        </div>
                        <div className={styles.filterField}>
                            <span className={styles.filterLabel}>Authors</span>
                            <Input
                                placeholder="Keywords"
                                className={styles.filterInput}
                                size="small"
                                value={filters.authors?.join(', ') || ''}
                                onChange={e =>
                                    onFiltersChange(f => ({
                                        ...f,
                                        authors: e.target.value
                                            ? e.target.value.split(',').map(s => s.trim())
                                            : undefined,
                                    }))
                                }
                            />
                        </div>
                        <div className={styles.filterField}>
                            <span className={styles.filterLabel}>Journal</span>
                            <Input
                                placeholder="Name"
                                className={styles.filterInput}
                                size="small"
                                value={filters.journals?.join(', ') || ''}
                                onChange={e =>
                                    onFiltersChange(f => ({
                                        ...f,
                                        journals: e.target.value
                                            ? e.target.value.split(',').map(s => s.trim())
                                            : undefined,
                                    }))
                                }
                            />
                        </div>
                        <button className={styles.filterClearBtn} onClick={() => onFiltersChange(() => ({}))}>
                            Clear
                        </button>
                    </div>
                </div>
            )}

            {/* The entire card IS the input field — click anywhere to type */}
            <div className={styles.card} onClick={focusInput}>
                <Input.TextArea
                    ref={inputRef}
                    value={input}
                    onChange={e => onInputChange(e.target.value)}
                    onPressEnter={e => {
                        if (!e.shiftKey) {
                            e.preventDefault();
                            onSend();
                        }
                    }}
                    placeholder={PLACEHOLDERS[chatMode]}
                    autoSize={{ minRows: 3, maxRows: 8 }}
                    className={styles.textarea}
                    disabled={loading}
                />

                {/* Controls pinned to the bottom of the card */}
                <div className={styles.footer} onClick={e => e.stopPropagation()}>
                    <div className={styles.controls}>
                        <div className={styles.modeSwitch}>
                            {MODES.map(m => (
                                <Tooltip key={m.key} title={m.tooltip} placement="top">
                                    <button
                                        className={`${styles.modeBtn} ${chatMode === m.key ? styles.modeBtnActive : ''}`}
                                        onClick={() => onModeChange(m.key)}
                                    >
                                        {m.icon}
                                        <span>{m.label}</span>
                                    </button>
                                </Tooltip>
                            ))}
                        </div>

                        {chatMode === 'agent' && (
                            <Tooltip title="Search filters">
                                <button
                                    className={`${styles.iconBtn} ${showFilters || hasFilters ? styles.iconBtnActive : ''}`}
                                    onClick={onToggleFilters}
                                >
                                    <FilterOutlined />
                                    {hasFilters && <span className={styles.filterDot} />}
                                </button>
                            </Tooltip>
                        )}
                    </div>

                    {loading ? (
                        <button
                            className={styles.stopBtn}
                            onClick={onStop}
                            title="Stop generating"
                        >
                            <PauseCircleFilled />
                        </button>
                    ) : (
                        <button
                            className={`${styles.sendBtn} ${input.trim() ? styles.sendBtnActive : ''}`}
                            onClick={onSend}
                            disabled={!input.trim()}
                        >
                            <ArrowUpOutlined />
                        </button>
                    )}
                </div>
            </div>

            <p className={styles.disclaimer}>
                LiveMat may produce inaccurate information. Verify important results.
            </p>
        </div>
    );
};
