import { Stack, Tabs, Title } from '@mantine/core';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../auth/AuthContext';
import { BasesPanel } from './BasesPanel';
import { ComponentsPanel } from './ComponentsPanel';
import { RatesPanel } from './RatesPanel';
import { StructuresPanel } from './StructuresPanel';

export const SetupPage = () => {
  const { t } = useTranslation();
  const { can } = useAuth();
  const tabs = [
    { value: 'components', perm: 'payroll.component.read', body: <ComponentsPanel /> },
    { value: 'bases', perm: 'payroll.base.read', body: <BasesPanel /> },
    { value: 'rateTables', perm: 'payroll.rate_table.read', body: <RatesPanel /> },
    { value: 'structures', perm: 'payroll.structure.read', body: <StructuresPanel /> },
  ].filter((x) => can(x.perm));
  return (
    <Stack>
      <Title order={2}>{t('nav.payrollSetup')}</Title>
      <Tabs defaultValue={tabs[0]?.value} keepMounted={false}>
        <Tabs.List>
          {tabs.map((x) => (
            <Tabs.Tab key={x.value} value={x.value}>
              {t(`payroll.tabs.${x.value}`)}
            </Tabs.Tab>
          ))}
        </Tabs.List>
        {tabs.map((x) => (
          <Tabs.Panel key={x.value} value={x.value} pt="md">
            {x.body}
          </Tabs.Panel>
        ))}
      </Tabs>
    </Stack>
  );
};
