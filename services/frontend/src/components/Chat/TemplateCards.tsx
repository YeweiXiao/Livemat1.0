import React, { useState } from 'react';
import { Typography, Tag, Tooltip } from 'antd';
import {
    CheckCircleOutlined,
    CopyOutlined,
    CheckOutlined,
    DatabaseOutlined,
    FileSearchOutlined,
    RightOutlined,
} from '@ant-design/icons';
import { motion } from 'framer-motion';
import styles from './TemplateCards.module.css';

const { Text } = Typography;

const TYPE_COLORS: Record<string, string> = {
    string: '#3b82f6',
    number: '#10b981',
    boolean: '#f59e0b',
    array: '#8b5cf6',
    object: '#ec4899',
};

interface TemplateField {
    name: string;
    label: string;
    type: string;
    description: string;
    required?: boolean;
    example?: string;
}

interface TemplateCreatedData {
    template_id: string;
    template_name: string;
    field_count: number;
    fields: TemplateField[];
}

export const TemplateCreatedCard: React.FC<{ data: TemplateCreatedData }> = ({ data }) => {
    const [idCopied, setIdCopied] = useState(false);

    const copyId = () => {
        navigator.clipboard.writeText(data.template_id).then(() => {
            setIdCopied(true);
            setTimeout(() => setIdCopied(false), 2000);
        });
    };

    return (
        <motion.div
            className={styles.card}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3 }}
        >
            <div className={styles.header}>
                <div className={styles.headerIcon}>
                    <DatabaseOutlined />
                </div>
                <div className={styles.headerContent}>
                    <div className={styles.headerTitle}>
                        Extraction Template Created
                    </div>
                    <div className={styles.headerSubtitle}>
                        {data.template_name}
                    </div>
                </div>
                <div className={styles.headerBadge}>
                    <CheckCircleOutlined style={{ marginRight: 4 }} />
                    Saved
                </div>
            </div>

            <div className={styles.idRow}>
                <Text type="secondary" style={{ fontSize: 11 }}>Template ID</Text>
                <Tooltip title={idCopied ? 'Copied!' : 'Click to copy'}>
                    <button className={styles.idButton} onClick={copyId}>
                        <code className={styles.idCode}>{data.template_id.slice(0, 8)}...{data.template_id.slice(-4)}</code>
                        {idCopied ? <CheckOutlined style={{ fontSize: 10 }} /> : <CopyOutlined style={{ fontSize: 10 }} />}
                    </button>
                </Tooltip>
            </div>

            <div className={styles.fieldsSection}>
                <div className={styles.fieldsLabel}>
                    Extraction Fields ({data.fields?.length || data.field_count})
                </div>
                <div className={styles.fieldsList}>
                    {(data.fields || []).map((field, idx) => (
                        <div key={field.name} className={styles.fieldItem}>
                            <span className={styles.fieldIndex}>{idx + 1}</span>
                            <div className={styles.fieldInfo}>
                                <div className={styles.fieldName}>
                                    {field.label}
                                    {field.required && (
                                        <span className={styles.requiredDot}>*</span>
                                    )}
                                </div>
                                <div className={styles.fieldMeta}>
                                    <Tag
                                        color={TYPE_COLORS[field.type] || '#666'}
                                        style={{ fontSize: 10, lineHeight: '16px', padding: '0 4px', margin: 0 }}
                                    >
                                        {field.type}
                                    </Tag>
                                    <span className={styles.fieldDesc}>
                                        {field.description.length > 60
                                            ? field.description.slice(0, 60) + '...'
                                            : field.description}
                                    </span>
                                </div>
                            </div>
                        </div>
                    ))}
                </div>
            </div>

            <div className={styles.footer}>
                <Text type="secondary" style={{ fontSize: 11 }}>
                    Use template_extract with this ID to extract data from papers
                </Text>
            </div>
        </motion.div>
    );
};

interface ExtractionResult {
    paper_id: string;
    title: string;
    extracted: Record<string, any>;
}

interface ExtractionData {
    template_name: string;
    results: ExtractionResult[];
}

export const ExtractionResultCard: React.FC<{ data: ExtractionData }> = ({ data }) => {
    const [expandedIdx, setExpandedIdx] = useState<number | null>(
        data.results.length === 1 ? 0 : null
    );

    const renderValue = (value: any): React.ReactNode => {
        if (value === null || value === undefined) {
            return <span className={styles.nullValue}>not found</span>;
        }
        if (typeof value === 'boolean') {
            return <span className={styles.boolValue}>{value ? 'Yes' : 'No'}</span>;
        }
        if (typeof value === 'number') {
            return <span className={styles.numValue}>{value}</span>;
        }
        if (Array.isArray(value)) {
            if (value.length === 0) return <span className={styles.nullValue}>empty</span>;
            return (
                <div className={styles.arrayValue}>
                    {value.map((v, i) => (
                        <Tag key={i} className={styles.arrayTag}>{String(v)}</Tag>
                    ))}
                </div>
            );
        }
        if (typeof value === 'object') {
            return (
                <pre className={styles.jsonValue}>
                    {JSON.stringify(value, null, 2)}
                </pre>
            );
        }
        return <span className={styles.strValue}>{String(value)}</span>;
    };

    return (
        <motion.div
            className={styles.card}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3 }}
        >
            <div className={styles.header}>
                <div className={`${styles.headerIcon} ${styles.extractIcon}`}>
                    <FileSearchOutlined />
                </div>
                <div className={styles.headerContent}>
                    <div className={styles.headerTitle}>
                        Structured Data Extraction
                    </div>
                    <div className={styles.headerSubtitle}>
                        {data.results.length} paper{data.results.length > 1 ? 's' : ''} · {data.template_name}
                    </div>
                </div>
            </div>

            <div className={styles.resultsList}>
                {data.results.map((result, idx) => {
                    const isExpanded = expandedIdx === idx;
                    const entries = Object.entries(result.extracted).filter(
                        ([k]) => k !== 'error'
                    );
                    const hasError = 'error' in result.extracted;

                    return (
                        <div key={result.paper_id} className={styles.resultItem}>
                            <button
                                className={styles.resultHeader}
                                onClick={() => setExpandedIdx(isExpanded ? null : idx)}
                            >
                                <span className={styles.resultIndex}>{idx + 1}</span>
                                <div className={styles.resultTitle}>
                                    <div className={styles.resultPaperTitle}>
                                        {result.title}
                                    </div>
                                    <div className={styles.resultPaperId}>
                                        {result.paper_id.slice(0, 8)}...
                                    </div>
                                </div>
                                {hasError ? (
                                    <Tag color="red" style={{ fontSize: 10, margin: 0 }}>Error</Tag>
                                ) : (
                                    <Tag color="green" style={{ fontSize: 10, margin: 0 }}>
                                        {entries.length} fields
                                    </Tag>
                                )}
                                <RightOutlined
                                    className={`${styles.expandIcon} ${isExpanded ? styles.expanded : ''}`}
                                />
                            </button>

                            {isExpanded && (
                                <motion.div
                                    className={styles.resultBody}
                                    initial={{ opacity: 0, height: 0 }}
                                    animate={{ opacity: 1, height: 'auto' }}
                                    transition={{ duration: 0.2 }}
                                >
                                    {hasError ? (
                                        <div className={styles.errorMsg}>
                                            {String(result.extracted.error)}
                                        </div>
                                    ) : (
                                        <div className={styles.fieldsTable}>
                                            {entries.map(([key, value]) => (
                                                <div key={key} className={styles.tableRow}>
                                                    <div className={styles.tableKey}>{key}</div>
                                                    <div className={styles.tableValue}>
                                                        {renderValue(value)}
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </motion.div>
                            )}
                        </div>
                    );
                })}
            </div>
        </motion.div>
    );
};
