import { Select, Stack, Title } from '@mantine/core';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { enumOptions, useLookup } from '../employees/shared';
import { DocumentsPanel } from './DocumentsPanel';

/** أرشيف وثائق الشركة والفروع (وثائق الموظفين من بطاقة الموظف). */
export const DocumentsPage = () => {
  const { t } = useTranslation();
  const branches = useLookup('/branches', 'system.branch.read');
  const [owner, setOwner] = useState<'company' | 'branch'>('company');
  const [branchId, setBranchId] = useState<string | null>(null);
  return (
    <Stack>
      <Title order={2}>{t('nav.documents')}</Title>
      <Select
        label={t('fields.ownerType')}
        allowDeselect={false}
        data={enumOptions(t, 'ownerType', ['company', 'branch'])}
        value={owner}
        onChange={(v) => {
          setOwner((v as 'company' | 'branch') ?? 'company');
          setBranchId(null);
        }}
        w={220}
      />
      {owner === 'branch' && (
        <Select
          label={t('hr.archive.ownerBranch')}
          searchable
          data={branches.options}
          value={branchId}
          onChange={setBranchId}
          w={260}
        />
      )}
      {(owner === 'company' || branchId) && (
        <DocumentsPanel
          key={`${owner}:${branchId ?? ''}`}
          ownerType={owner}
          ownerId={owner === 'company' ? null : branchId}
        />
      )}
    </Stack>
  );
};
