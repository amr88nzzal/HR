import {
  Badge,
  Group,
  NavLink,
  Paper,
  SegmentedControl,
  Stack,
  Text,
  TextInput,
  Title,
  Typography,
} from '@mantine/core';
import { useEffect, useMemo, useState, type MouseEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { ARTICLES, GUIDE_ROLES, matches, type GuideRole } from './articles';
import { renderMarkdown } from './render';

const readHash = (): string => decodeURIComponent(window.location.hash.replace(/^#/, ''));

export const HelpPage = () => {
  const { t } = useTranslation();
  const [role, setRole] = useState<'all' | GuideRole>('all');
  const [q, setQ] = useState('');
  const [id, setId] = useState(readHash);

  useEffect(() => {
    const on = () => setId(readHash());
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);

  const list = useMemo(
    () => ARTICLES.filter((a) => (role === 'all' || a.roles.includes(role)) && matches(a, q)),
    [role, q],
  );
  const current = ARTICLES.find((a) => a.id === id) ?? list[0];
  const html = useMemo(() => (current ? renderMarkdown(current.body) : ''), [current]);

  const open = (articleId: string) => {
    window.location.hash = encodeURIComponent(articleId);
  };
  // الروابط الداخلية [نص](#مقال) تفتح المقال دون إعادة تحميل
  // Internal links [text](#article) open the article without a reload
  const onContentClick = (e: MouseEvent<HTMLElement>) => {
    const a = (e.target as HTMLElement).closest('a');
    const href = a?.getAttribute('href');
    if (href?.startsWith('#')) {
      e.preventDefault();
      open(decodeURIComponent(href.slice(1)));
    }
  };

  return (
    <Stack>
      <Title order={3}>{t('help.title')}</Title>
      <Group align="flex-start" wrap="wrap" gap="lg">
        <Stack w={300} maw="100%" gap="xs">
          <TextInput
            placeholder={t('help.search')}
            value={q}
            onChange={(e) => setQ(e.currentTarget.value)}
          />
          <SegmentedControl
            size="xs"
            fullWidth
            value={role}
            onChange={(v) => setRole(v as 'all' | GuideRole)}
            data={[
              { value: 'all', label: t('help.roles.all') },
              ...GUIDE_ROLES.map((r) => ({ value: r, label: t(`help.roles.${r}`) })),
            ]}
          />
          {list.map((a) => (
            <NavLink
              key={a.id}
              label={a.title}
              description={a.summary}
              active={a.id === current?.id}
              onClick={() => open(a.id)}
            />
          ))}
          {list.length === 0 && (
            <Text c="dimmed" size="sm">
              {t('help.empty')}
            </Text>
          )}
        </Stack>
        <Paper withBorder p="lg" style={{ flex: 1, minWidth: 280 }}>
          {current ? (
            <Stack gap="xs">
              <Group gap="xs">
                {current.roles.map((r) => (
                  <Badge key={r} variant="light" size="sm">
                    {t(`help.roles.${r}`)}
                  </Badge>
                ))}
              </Group>
              <Typography>
                {/* المحتوى معقَّم بـ DOMPurify ومصدره المستودع / sanitized by DOMPurify, sourced from the repo */}
                <div onClick={onContentClick} dangerouslySetInnerHTML={{ __html: html }} />
              </Typography>
            </Stack>
          ) : (
            <Text c="dimmed">{t('help.empty')}</Text>
          )}
        </Paper>
      </Group>
    </Stack>
  );
};
