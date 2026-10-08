import { Badge, Card, Group, Loader, Stack, Text, Title } from '@mantine/core';
import { IconSitemap } from '@tabler/icons-react';
import { useTranslation } from 'react-i18next';
import { useList, type Row } from '../../api/hooks';
import { localName } from '../../lib/names';
import { useLookup } from '../employees/shared';

type Node = { row: Row; children: Node[] };

/** يبني غابة من قائمة مسطحة (الأب غير الموجود يجعل العقدة جذراً) ويمنع الحلقات بحارس عمق. */
export const buildTree = (rows: Row[]): Node[] => {
  const byId = new Map(rows.map((r) => [r.id, { row: r, children: [] as Node[] }]));
  const roots: Node[] = [];
  for (const node of byId.values()) {
    const parent =
      typeof node.row['parentId'] === 'string' ? byId.get(node.row['parentId']) : undefined;
    if (parent && parent !== node) parent.children.push(node);
    else roots.push(node);
  }
  return roots;
};

const sortByCode = (nodes: Node[]): Node[] =>
  [...nodes].sort((a, b) => String(a.row['code']).localeCompare(String(b.row['code'])));

const TreeNode = ({
  node,
  depth,
  branchName,
  lang,
}: {
  node: Node;
  depth: number;
  branchName: (id: unknown) => string;
  lang: string;
}) => {
  const branchIds = (node.row['branchIds'] as string[] | undefined) ?? [];
  return (
    <Stack gap={6} data-testid="org-node">
      <Card
        withBorder
        padding="xs"
        ms={depth * 28}
        opacity={node.row['isActive'] === false ? 0.55 : 1}
      >
        <Group gap="xs" wrap="wrap">
          <IconSitemap size={16} />
          <Text fw={500}>{localName(node.row, lang)}</Text>
          <Text size="xs" c="dimmed" dir="ltr">
            {String(node.row['code'])}
          </Text>
          {branchIds.map((id) => (
            <Badge key={id} variant="light" size="sm">
              {branchName(id)}
            </Badge>
          ))}
        </Group>
      </Card>
      {sortByCode(node.children).map((c) => (
        <TreeNode key={c.row.id} node={c} depth={depth + 1} branchName={branchName} lang={lang} />
      ))}
    </Stack>
  );
};

/** الهيكل التنظيمي كشجرة أقسام مع فروع كل قسم. */
export const OrgChartPage = () => {
  const { t, i18n } = useTranslation();
  const list = useList('/departments', { pageSize: 200 });
  const branches = useLookup('/branches', 'system.branch.read');
  const rows = (list.data?.data ?? []) as Row[];
  const roots = sortByCode(buildTree(rows));

  return (
    <Stack>
      <Title order={2}>{t('hr.org.chartTitle')}</Title>
      {list.isLoading && <Loader size="sm" />}
      {!list.isLoading && roots.length === 0 && <Text c="dimmed">{t('hr.org.noDepartments')}</Text>}
      {roots.map((n) => (
        <TreeNode
          key={n.row.id}
          node={n}
          depth={0}
          branchName={branches.name}
          lang={i18n.language}
        />
      ))}
    </Stack>
  );
};
