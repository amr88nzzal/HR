import { Badge, Button, Group, Modal, Select, Stack, Switch, Text } from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { IconPlus } from '@tabler/icons-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useList, type Row } from '../../api/hooks';
import { useAuth } from '../../auth/AuthContext';
import { DataTable, type Column } from '../../components/DataTable';
import { localName } from '../../lib/names';
import { useFormat } from '../../lib/useFormat';
import { str } from '../employees/shared';
import { DocumentEditor } from './DocumentEditor';

type Selected = { typeId: string; docId: string | null };

/** وثائق مالك واحد (موظف/فرع/الشركة): قائمة + إنشاء بنوع + فتح للتعديل. */
export const DocumentsPanel = ({
  ownerType,
  ownerId,
}: {
  ownerType: 'employee' | 'branch' | 'company';
  ownerId: string | null;
}) => {
  const { t, i18n } = useTranslation();
  const { can } = useAuth();
  const fmt = useFormat();
  const [status, setStatus] = useState<'active' | 'superseded'>('active');
  const [selected, setSelected] = useState<Selected | null>(null);
  const [picking, { open: startPick, close: stopPick }] = useDisclosure(false);
  const list = useList('/documents', {
    ownerType,
    ownerId: ownerId ?? undefined,
    status,
    pageSize: 100,
  });
  const types = useList(
    '/document-types',
    { ownerType, isActive: true },
    can('archive.document_type.read'),
  );
  const typeRows = (types.data?.data ?? []) as Row[];
  const rows = (list.data?.data ?? []) as Row[];

  const columns: Column<Row>[] = [
    {
      key: 'type',
      header: t('hr.archive.type'),
      render: (r) =>
        i18n.language === 'en'
          ? str(r['typeNameEn']) || str(r['typeNameAr'])
          : str(r['typeNameAr']),
    },
    {
      key: 'version',
      header: '#',
      render: (r) => <Badge variant="light">v{String(r['versionNo'] ?? 1)}</Badge>,
    },
    {
      key: 'files',
      header: t('hr.archive.files'),
      render: (r) => t('hr.archive.fileCount', { count: Number(r['fileCount'] ?? 0) }),
    },
    {
      key: 'created',
      header: t('hr.archive.created'),
      render: (r) => fmt.date(str(r['createdAt']).slice(0, 10)),
    },
  ];

  const close = () => setSelected(null);

  return (
    <Stack>
      <Group justify="space-between">
        <Switch
          label={t('hr.archive.showSuperseded')}
          checked={status === 'superseded'}
          onChange={(e) => setStatus(e.currentTarget.checked ? 'superseded' : 'active')}
        />
        {can('archive.document.create') && (
          <Button size="xs" leftSection={<IconPlus size={14} />} onClick={startPick}>
            {t('hr.archive.newDocument')}
          </Button>
        )}
      </Group>
      <DataTable
        columns={columns}
        rows={rows as never}
        loading={list.isLoading}
        page={1}
        pageSize={Math.max(rows.length, 1)}
        total={list.data?.meta?.total ?? rows.length}
        onPage={() => undefined}
        onRowClick={(r) => setSelected({ typeId: str(r['documentTypeId']), docId: r.id })}
      />
      <Modal opened={picking} onClose={stopPick} title={t('hr.archive.newDocument')} centered>
        {typeRows.length === 0 ? (
          <Text c="dimmed">{t('hr.archive.noTypes')}</Text>
        ) : (
          <Select
            label={t('hr.archive.selectType')}
            searchable
            data={typeRows.map((r) => ({ value: r.id, label: localName(r, i18n.language) }))}
            onChange={(v) => {
              if (v) {
                stopPick();
                setSelected({ typeId: v, docId: null });
              }
            }}
          />
        )}
      </Modal>
      <Modal
        opened={selected !== null}
        onClose={close}
        title={t('hr.archive.docsTitle')}
        centered
        size="lg"
      >
        {selected && (
          <DocumentEditor
            typeId={selected.typeId}
            docId={selected.docId}
            ownerId={ownerId}
            onSwitch={(id) => setSelected({ typeId: selected.typeId, docId: id })}
            onClose={close}
          />
        )}
      </Modal>
    </Stack>
  );
};
