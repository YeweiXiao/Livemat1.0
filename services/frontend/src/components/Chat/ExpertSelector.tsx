import React, { useEffect, useMemo, useState } from 'react';
import { Select, Button, Divider } from 'antd';
import { PlusOutlined, SwapOutlined } from '@ant-design/icons';
import { Expert, expertApi } from '../../api/expert';
import { ExpertAvatar } from '@/utils/expertVisuals';
import styles from './ExpertSelector.module.css';

interface ExpertSelectorProps {
    value?: string;
    onChange: (expertId: string | undefined, expert: Expert | undefined) => void;
    onCreateClick?: () => void;
}

const DOMAIN_LABELS: Record<string, string> = {
    polymer: '高分子',
    microbe: '微生物',
    delivery: '递送系统',
    literature: '文献分析',
    experiment: '实验设计',
    'living-material': '活体材料',
    hydrogel: '水凝胶',
    'wound-care': '创面护理',
    'data-analysis': '数据分析',
    custom: '自定义',
};

export const ExpertSelector: React.FC<ExpertSelectorProps> = ({ value, onChange, onCreateClick }) => {
    const [experts, setExperts] = useState<Expert[]>([]);
    const [loading, setLoading] = useState(false);

    useEffect(() => {
        let cancelled = false;
        setLoading(true);
        expertApi.list(undefined, 'active')
            .then(list => { if (!cancelled) setExperts(list); })
            .catch(() => {})
            .finally(() => { if (!cancelled) setLoading(false); });
        return () => { cancelled = true; };
    }, []);

    const handleChange = (id: string | undefined) => {
        if (!id || id === '__none__') {
            onChange(undefined, undefined);
            return;
        }
        const expert = experts.find(e => e.id === id);
        onChange(id, expert);
    };

    const sortedExperts = useMemo(
        () =>
            [...experts].sort((a, b) => {
                if (a.is_system !== b.is_system) return a.is_system ? -1 : 1;
                return (b.usage_count || 0) - (a.usage_count || 0);
            }),
        [experts]
    );

    const options = sortedExperts.map((expert) => ({
        value: expert.id,
        label: expert.name,
        search_text: `${expert.name} ${expert.domain || ''} ${(expert.description || '').slice(0, 80)}`,
        expert,
    }));

    return (
        <div className={styles.bar}>
            <SwapOutlined className={styles.barIcon} />
            <Select
                className={styles.select}
                popupClassName={styles.dropdown}
                placeholder="通用助手"
                value={value || undefined}
                onChange={handleChange}
                loading={loading}
                showSearch
                filterOption={(input, option: any) => {
                    const text = String(option?.search_text || '').toLowerCase();
                    return text.includes(input.toLowerCase());
                }}
                allowClear
                onClear={() => onChange(undefined, undefined)}
                popupMatchSelectWidth={false}
                variant="borderless"
                suffixIcon={null}
                dropdownRender={(menu) => (
                    <>
                        {menu}
                        {onCreateClick && (
                            <>
                                <Divider style={{ margin: '4px 0' }} />
                                <Button
                                    type="text"
                                    icon={<PlusOutlined />}
                                    onClick={onCreateClick}
                                    style={{ width: '100%', textAlign: 'left', padding: '4px 12px', fontSize: 12 }}
                                >
                                    创建新专家
                                </Button>
                            </>
                        )}
                    </>
                )}
                options={options}
                optionRender={(option: any) => {
                    const e: Expert = option?.data?.expert;
                    if (!e) return option?.label;
                    return (
                        <div className={styles.optionRow}>
                            <ExpertAvatar expert={e} size={26} />
                            <div className={styles.optionBody}>
                                <div className={styles.optionLine1}>
                                    <span className={styles.optionTitle}>{e.name}</span>
                                    <span className={styles.domainBadge}>
                                        {DOMAIN_LABELS[e.domain || ''] || (e.domain || '通用')}
                                    </span>
                                </div>
                                <div className={styles.optionLine2}>
                                    {e.description || '研究问答专家'}
                                </div>
                            </div>
                        </div>
                    );
                }}
                labelRender={(props: any) => {
                    const e = options.find((item) => item.value === props.value)?.expert;
                    if (!e) return props.label;
                    return (
                        <span className={styles.selectedValue}>
                            <ExpertAvatar expert={e} size={18} />
                            <span className={styles.selectedName}>{e.name}</span>
                        </span>
                    );
                }}
            />
        </div>
    );
};
