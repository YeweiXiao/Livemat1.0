import React, { useEffect, useRef, useMemo } from 'react';
import { Typography, Tooltip, Empty } from 'antd';
import {
    FileTextOutlined,
    ExperimentOutlined,
    TeamOutlined,
    CalendarOutlined,
    BookOutlined,
} from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import styles from './SourcePanel.module.css';

const { Text } = Typography;

export interface SourcePaper {
    source_id: string;
    source_type: 'polymer' | 'microbe' | 'delivery';
    paper_id?: string | null;
    title: string;
    similarity: number;
    subtitle?: string;
    library_label?: string;
    authors?: string[];
    journal?: string;
    year?: number | null;
}

interface SourcePanelProps {
    sources: SourcePaper[];
    highlightedSourceId?: string | null;
    onHighlightClear?: () => void;
}

const TYPE_CONFIG: Record<string, { color: string; accent: string; icon: string }> = {
    polymer:  { color: '#3b82f6', accent: 'rgba(59,130,246,0.08)',  icon: '🧬' },
    microbe:  { color: '#10b981', accent: 'rgba(16,185,129,0.08)',  icon: '🦠' },
    delivery: { color: '#8b5cf6', accent: 'rgba(139,92,246,0.08)',  icon: '💊' },
};

const formatAuthors = (authors?: string[]): string => {
    if (!authors || authors.length === 0) return '';
    if (authors.length === 1) return authors[0];
    if (authors.length === 2) return authors.join(' & ');
    return `${authors[0]} et al.`;
};

export const SourcePanel: React.FC<SourcePanelProps> = ({ sources, highlightedSourceId, onHighlightClear }) => {
    const navigate = useNavigate();
    const cardRefs = useRef<Map<string, HTMLDivElement>>(new Map());

    useEffect(() => {
        if (!highlightedSourceId) return;
        const match = sources.find(s => s.source_id === highlightedSourceId || s.paper_id === highlightedSourceId);
        if (!match) return;
        const el = cardRefs.current.get(match.source_id);
        if (el) {
            el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
        const timer = setTimeout(() => onHighlightClear?.(), 2500);
        return () => clearTimeout(timer);
    }, [highlightedSourceId, sources, onHighlightClear]);

    const isHighlighted = (item: SourcePaper) =>
        highlightedSourceId === item.source_id || highlightedSourceId === item.paper_id;

    const handleSourceClick = (source: SourcePaper) => {
        if (source.paper_id) {
            navigate(`/papers/${source.paper_id}`, {
                state: { returnTo: '/chat', returnLabel: '返回聊天' },
            });
            return;
        }
        const pathMap = {
            polymer: '/knowledge-base/polymers',
            microbe: '/knowledge-base/microbes',
            delivery: '/knowledge-base/delivery',
        } as const;
        navigate(`${pathMap[source.source_type]}?search=${encodeURIComponent(source.title)}`);
    };

    const typeGroups = useMemo(() => {
        const groups = new Map<string, SourcePaper[]>();
        for (const s of sources) {
            const key = s.library_label || s.source_type || 'other';
            if (!groups.has(key)) groups.set(key, []);
            groups.get(key)!.push(s);
        }
        return groups;
    }, [sources]);

    if (!sources || sources.length === 0) {
        return (
            <div className={styles.emptyContainer}>
                <Empty description="提问后将在此展示引用来源" image={Empty.PRESENTED_IMAGE_SIMPLE} />
            </div>
        );
    }

    let globalIndex = 0;

    return (
        <div className={styles.container}>
            <div className={styles.header}>
                <div className={styles.headerLeft}>
                    <FileTextOutlined className={styles.headerIcon} />
                    <span className={styles.headerTitle}>References</span>
                </div>
                <span className={styles.headerCount}>{sources.length}</span>
            </div>
            <div className={styles.sourceList}>
                {Array.from(typeGroups.entries()).map(([groupLabel, groupSources]) => (
                    <div key={groupLabel} className={styles.sourceGroup}>
                        <div className={styles.groupLabel}>
                            <ExperimentOutlined style={{ fontSize: 10, opacity: 0.5 }} />
                            <span>{groupLabel}</span>
                            <span className={styles.groupCount}>{groupSources.length}</span>
                        </div>
                        {groupSources.map((item) => {
                            globalIndex++;
                            const idx = globalIndex;
                            const typeConf = TYPE_CONFIG[item.source_type] || TYPE_CONFIG.delivery;
                            const authorsStr = formatAuthors(item.authors);
                            const hasMeta = authorsStr || item.journal || item.year;
                            return (
                                <div
                                    key={`${item.source_type}-${item.source_id}`}
                                    ref={el => { if (el) cardRefs.current.set(item.source_id, el); }}
                                >
                                    <Tooltip
                                        title={item.title}
                                        placement="left"
                                        mouseEnterDelay={0.5}
                                    >
                                        <div
                                            className={`${styles.sourceCard} ${isHighlighted(item) ? styles.sourceCardHighlighted : ''}`}
                                            onClick={() => handleSourceClick(item)}
                                        >
                                            <div className={styles.cardTop}>
                                                <span
                                                    className={styles.sourceIndex}
                                                    style={{ background: typeConf.accent, color: typeConf.color }}
                                                >
                                                    {idx}
                                                </span>
                                                <Text className={styles.sourceTitle}>
                                                    {item.title || '未命名来源'}
                                                </Text>
                                            </div>

                                            {hasMeta && (
                                                <div className={styles.cardMeta}>
                                                    {authorsStr && (
                                                        <span className={styles.metaItem}>
                                                            <TeamOutlined className={styles.metaIcon} />
                                                            <span className={styles.metaText}>{authorsStr}</span>
                                                        </span>
                                                    )}
                                                    {item.journal && (
                                                        <span className={styles.metaItem}>
                                                            <BookOutlined className={styles.metaIcon} />
                                                            <span className={styles.metaText}>{item.journal}</span>
                                                        </span>
                                                    )}
                                                    {item.year && (
                                                        <span className={styles.metaItem}>
                                                            <CalendarOutlined className={styles.metaIcon} />
                                                            <span className={styles.metaText}>{item.year}</span>
                                                        </span>
                                                    )}
                                                </div>
                                            )}

                                            <div className={styles.cardBottom}>
                                                <span className={styles.typeChip} style={{ color: typeConf.color, background: typeConf.accent }}>
                                                    {typeConf.icon} {item.library_label || item.source_type}
                                                </span>
                                                <span className={styles.similarityBadge}>
                                                    {(item.similarity * 100).toFixed(0)}%
                                                </span>
                                            </div>
                                        </div>
                                    </Tooltip>
                                </div>
                            );
                        })}
                    </div>
                ))}
            </div>
        </div>
    );
};
